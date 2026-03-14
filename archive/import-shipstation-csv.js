#!/usr/bin/env node

require('dotenv').config();
const fs = require('fs');
const path = require('path');
const Database = require('better-sqlite3');

const DB_PATH = path.join(__dirname, 'fbm_hub.db');

function printUsage() {
  console.log('Usage: node import-shipstation-csv.js <csv-file> [--apply]');
  console.log('');
  console.log('Defaults to dry-run. Add --apply to write updates to SQLite.');
}

function parseCsv(content) {
  const rows = [];
  let row = [];
  let field = '';
  let inQuotes = false;

  for (let i = 0; i < content.length; i += 1) {
    const ch = content[i];
    const next = content[i + 1];

    if (ch === '"') {
      if (inQuotes && next === '"') {
        field += '"';
        i += 1;
      } else {
        inQuotes = !inQuotes;
      }
      continue;
    }

    if (ch === ',' && !inQuotes) {
      row.push(field);
      field = '';
      continue;
    }

    if ((ch === '\n' || ch === '\r') && !inQuotes) {
      if (ch === '\r' && next === '\n') {
        i += 1;
      }
      row.push(field);
      field = '';
      if (row.length > 1 || (row.length === 1 && row[0] !== '')) {
        rows.push(row);
      }
      row = [];
      continue;
    }

    field += ch;
  }

  if (field.length > 0 || row.length > 0) {
    row.push(field);
    rows.push(row);
  }

  return rows;
}

function extractAsinFromSku(sku) {
  if (!sku) return null;
  const match = String(sku).match(/\b(B0[A-Z0-9]{8})\b/i);
  return match ? match[1].toUpperCase() : null;
}

function normalizeOrderId(value) {
  return String(value || '').trim();
}

function extractOrderTokens(value) {
  const raw = String(value || '').trim();
  if (!raw) return [];

  const tokens = new Set([raw]);

  // Amazon-style order number: 111-1234567-1234567
  const amazonMatch = raw.match(/\b\d{3}-\d{7}-\d{7}\b/);
  if (amazonMatch) tokens.add(amazonMatch[0]);

  // Numeric marketplace order IDs like 200014553335196
  const longNumeric = raw.match(/\b\d{12,18}\b/g) || [];
  for (const n of longNumeric) tokens.add(n);

  return Array.from(tokens);
}

function isDhlCarrier(serviceRequested) {
  const v = String(serviceRequested || '').toLowerCase();
  return v.includes('expedited') || v.includes('dhl');
}

function main() {
  const args = process.argv.slice(2);
  if (args.length === 0) {
    printUsage();
    process.exit(1);
  }

  const apply = args.includes('--apply');
  const csvPathArg = args.find((a) => a !== '--apply');

  if (!csvPathArg) {
    printUsage();
    process.exit(1);
  }

  const csvPath = path.isAbsolute(csvPathArg)
    ? csvPathArg
    : path.join(__dirname, csvPathArg);

  if (!fs.existsSync(csvPath)) {
    console.error(`CSV not found: ${csvPath}`);
    process.exit(1);
  }

  const content = fs.readFileSync(csvPath, 'utf8');
  const rows = parseCsv(content);

  if (rows.length < 2) {
    console.error('CSV appears empty or missing data rows.');
    process.exit(1);
  }

  const headers = rows[0].map((h) => String(h || '').trim());
  const idxOrder = headers.indexOf('Order - Number');
  const idxSku = headers.indexOf('Item - SKU');
  const idxCarrier = headers.indexOf('Carrier - Service Requested');

  if (idxOrder === -1 || idxSku === -1 || idxCarrier === -1) {
    console.error('Required columns missing. Expected: Order - Number, Item - SKU, Carrier - Service Requested');
    process.exit(1);
  }

  const byOrder = new Map();

  for (let i = 1; i < rows.length; i += 1) {
    const r = rows[i];
    const orderId = normalizeOrderId(r[idxOrder]);
    if (!orderId) continue;

    const sku = String(r[idxSku] || '').trim();
    const carrier = String(r[idxCarrier] || '').trim();
    const asin = extractAsinFromSku(sku);
    const dhl = isDhlCarrier(carrier);

    const existing = byOrder.get(orderId) || {
      orderId,
      isDhl: false,
      asin: null,
      sku: null,
      lines: 0,
    };

    existing.lines += 1;
    existing.isDhl = existing.isDhl || dhl;
    if (!existing.asin && asin) existing.asin = asin;
    if (!existing.sku && sku) existing.sku = sku;

    byOrder.set(orderId, existing);
  }

  const db = new Database(DB_PATH);
  db.pragma('journal_mode = WAL');

  const allOrders = db
    .prepare("SELECT id, order_id, asin, sku, is_dhl FROM orders WHERE order_id IS NOT NULL AND order_id <> ''")
    .all();

  const orderLookup = new Map();
  for (const row of allOrders) {
    for (const token of extractOrderTokens(row.order_id)) {
      if (!orderLookup.has(token)) {
        orderLookup.set(token, row);
      }
    }
  }

  const updateOrder = db.prepare(`
    UPDATE orders
    SET
      is_dhl = CASE WHEN @importIsDhl = 1 THEN 1 ELSE is_dhl END,
      asin = CASE
        WHEN (asin IS NULL OR asin = '') AND @importAsin IS NOT NULL AND @importAsin <> '' THEN @importAsin
        ELSE asin
      END,
      sku = CASE
        WHEN (sku IS NULL OR sku = '') AND @importSku IS NOT NULL AND @importSku <> '' THEN @importSku
        ELSE sku
      END,
      updated_at = datetime('now'),
      updated_by = 'shipstation-import'
    WHERE id = @orderPk
  `);

  let matched = 0;
  let unmatched = 0;
  let withDhl = 0;
  let withAsin = 0;
  let rowsToUpdate = 0;

  const updates = [];

  for (const item of byOrder.values()) {
    const searchTokens = extractOrderTokens(item.orderId);
    const dbRow = searchTokens.map((t) => orderLookup.get(t)).find(Boolean);
    if (!dbRow) {
      unmatched += 1;
      continue;
    }

    matched += 1;
    if (item.isDhl) withDhl += 1;
    if (item.asin) withAsin += 1;

    const wouldChangeDhl = item.isDhl && Number(dbRow.is_dhl || 0) !== 1;
    const wouldChangeAsin = (!dbRow.asin || String(dbRow.asin).trim() === '') && !!item.asin;
    const wouldChangeSku = (!dbRow.sku || String(dbRow.sku).trim() === '') && !!item.sku;

    if (wouldChangeDhl || wouldChangeAsin || wouldChangeSku) {
      rowsToUpdate += 1;
      updates.push({
        orderId: item.orderId,
        orderPk: dbRow.id,
        importIsDhl: item.isDhl ? 1 : 0,
        importAsin: item.asin,
        importSku: item.sku,
      });
    }
  }

  console.log('ShipStation CSV import summary');
  console.log(`- CSV rows parsed: ${rows.length - 1}`);
  console.log(`- Unique order IDs in CSV: ${byOrder.size}`);
  console.log(`- Matched orders in DB: ${matched}`);
  console.log(`- Unmatched order IDs: ${unmatched}`);
  console.log(`- Orders with DHL signal: ${withDhl}`);
  console.log(`- Orders with ASIN extracted from SKU: ${withAsin}`);
  console.log(`- Orders requiring update: ${rowsToUpdate}`);

  if (!apply) {
    console.log('');
    console.log('Dry run only. Re-run with --apply to persist updates.');
    db.close();
    return;
  }

  const tx = db.transaction((rowsForUpdate) => {
    for (const u of rowsForUpdate) {
      updateOrder.run(u);
    }
  });

  tx(updates);

  console.log('');
  console.log(`Applied updates to ${updates.length} orders.`);
  db.close();
}

main();
