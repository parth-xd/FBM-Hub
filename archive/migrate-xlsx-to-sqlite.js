#!/usr/bin/env node
// migrate-xlsx-to-sqlite.js — Import UK-US FBM Expenses DB.xlsx → fbm_hub.db
const XLSX = require('xlsx');
const Database = require('better-sqlite3');
const path = require('path');

const XLSX_PATH = path.join(__dirname, 'UK-US FBM Expenses DB.xlsx');
const DB_PATH = path.join(__dirname, 'fbm_hub.db');

// ═══ EXCEL DATE CONVERSION ═══
function excelDateToISO(serial) {
  if (serial == null || serial === '' || serial === '-') return null;
  if (typeof serial === 'string') {
    // Already a date string like "2/23/2026 4:00:00 PM"
    const d = new Date(serial);
    if (!isNaN(d.getTime())) return d.toISOString();
    return serial; // Return as-is if not parseable
  }
  if (typeof serial === 'number') {
    // Excel serial number → JS Date
    const epoch = new Date((serial - 25569) * 86400 * 1000);
    if (!isNaN(epoch.getTime())) return epoch.toISOString();
  }
  return null;
}

function toNum(v) {
  if (v == null || v === '' || v === '-') return null;
  const n = Number(v);
  return isNaN(n) ? null : n;
}

function toBool(v) {
  if (v === true || v === 1 || v === 'true' || v === 'TRUE' || v === 'Y' || v === 'Yes') return 1;
  return 0;
}

function toStr(v) {
  if (v == null) return null;
  const s = String(v).trim();
  return s === '' || s === '-' ? null : s;
}

// ═══ MAIN ═══
console.log('Reading Excel file...');
const wb = XLSX.readFile(XLSX_PATH);
const ws = wb.Sheets['Main STB Expenses'];
const allRows = XLSX.utils.sheet_to_json(ws, { header: 1, defval: null });

// Row 0 = section headers, Row 1 = column headers, data starts at row 2
const headers = allRows[1];
const dataRows = allRows.slice(2).filter(row => {
  // Skip completely empty rows or rows missing Order ID
  return row[2] != null && String(row[2]).trim() !== '';
});
console.log(`Found ${dataRows.length} data rows with Order IDs`);

// ═══ OPEN DATABASE ═══
const db = new Database(DB_PATH);
db.pragma('journal_mode = WAL');

// ═══ ADD MISSING COLUMNS ═══
const addColumnIfMissing = (name, type, dflt) => {
  try {
    db.exec(`ALTER TABLE orders ADD COLUMN ${name} ${type}${dflt != null ? ` DEFAULT ${dflt}` : ''}`);
    console.log(`  Added column: ${name}`);
  } catch (e) {
    if (!e.message.includes('duplicate column')) throw e;
  }
};

console.log('\nEnsuring all columns exist...');
addColumnIfMissing('unit_buy_price_inc_vat', 'REAL', null);
addColumnIfMissing('delivery_fee_per_line', 'REAL', null);
addColumnIfMissing('vat_status', 'TEXT', null);
addColumnIfMissing('supplier_order_date', 'TEXT', null);
addColumnIfMissing('supplier_order_ref', 'TEXT', null);
addColumnIfMissing('expected_delivery_time', 'TEXT', null);
addColumnIfMissing('marked_dispatched_on', 'TEXT', null);
addColumnIfMissing('refunded', 'INTEGER', '0');
addColumnIfMissing('refund_date', 'TEXT', null);

// ═══ CHECK DHL ORDERS ═══
// Read the DHL sheet to know which orders should be is_dhl=1
const dhlSheet = wb.Sheets['SHIPPING COST (DHL)'];
const dhlRows = dhlSheet ? XLSX.utils.sheet_to_json(dhlSheet, { header: 1, defval: null }) : [];
const dhlOrderIds = new Set();
for (let i = 1; i < dhlRows.length; i++) {
  const oid = toStr(dhlRows[i][0]);
  if (oid) dhlOrderIds.add(oid.trim());
}
console.log(`DHL orders identified: ${dhlOrderIds.size}`);

// ═══ CLEAR EXISTING DATA ═══
const existingCount = db.prepare('SELECT COUNT(*) as c FROM orders').get().c;
console.log(`\nExisting orders in DB: ${existingCount}`);
console.log('Clearing orders table...');
db.exec('DELETE FROM orders');

// ═══ PREPARE INSERT ═══
const insertStmt = db.prepare(`
  INSERT INTO orders (
    sheet_row, order_id, order_date, product_name, total_sell_price,
    total_buy_price_inc_vat, total_buy_price_exc_vat, shipping_cost_gbp,
    expected_profit, weight, label_printed, status, is_dhl, po_id,
    s_qty, b_qty, qty_received, discrepancy, exception_reason,
    exception_stock_solution, exception_po_created, goods_not_available,
    is_multi_po, ship_by_date, expected_delivery_date, purchased_by,
    checked_by, buy_link, asin, sku,
    unit_buy_price_inc_vat, delivery_fee_per_line, vat_status,
    supplier_order_date, supplier_order_ref, expected_delivery_time,
    marked_dispatched_on, refunded, refund_date,
    created_at, updated_at
  ) VALUES (
    ?, ?, ?, ?, ?,
    ?, ?, ?,
    ?, ?, ?, ?, ?, ?,
    ?, ?, ?, ?, ?,
    ?, ?, ?,
    ?, ?, ?, ?,
    ?, ?, ?, ?,
    ?, ?, ?,
    ?, ?, ?,
    ?, ?, ?,
    datetime('now'), datetime('now')
  )
`);

// ═══ INSERT ALL ROWS ═══
console.log('Importing data...');
let imported = 0;
let skipped = 0;

const insertAll = db.transaction(() => {
  for (let i = 0; i < dataRows.length; i++) {
    const r = dataRows[i];
    const orderId = toStr(r[2]);
    if (!orderId) { skipped++; continue; }

    // Clean order ID (remove annotations like " - ARRIVED DAMAGED")
    const cleanOrderId = orderId.split(' - ')[0].trim();

    const sheetRow = i + 3; // Excel row number (1-indexed + 2 header rows)

    try {
      insertStmt.run(
        sheetRow,                                   // sheet_row
        cleanOrderId,                               // order_id
        excelDateToISO(r[1]),                       // order_date
        toStr(r[7]),                                // product_name
        toNum(r[9]),                                // total_sell_price
        toNum(r[18]),                               // total_buy_price_inc_vat
        toNum(r[20]),                               // total_buy_price_exc_vat
        toNum(r[22]),                               // shipping_cost_gbp
        toNum(r[23]),                               // expected_profit
        toNum(r[21]),                               // weight
        toBool(r[31]),                              // label_printed
        'pending',                                  // status
        dhlOrderIds.has(cleanOrderId) ? 1 : 0,     // is_dhl
        toStr(r[14]),                               // po_id
        toNum(r[6]),                                // s_qty
        toNum(r[15]),                               // b_qty
        toNum(r[28]),                               // qty_received
        toNum(r[29]),                               // discrepancy
        toStr(r[32]),                               // exception_reason
        toStr(r[33]),                               // exception_stock_solution
        toBool(r[34]),                              // exception_po_created
        toBool(r[35]),                              // goods_not_available
        toBool(r[3]),                               // is_multi_po
        excelDateToISO(r[10]),                      // ship_by_date
        excelDateToISO(r[26]),                      // expected_delivery_date
        toStr(r[11]),                               // purchased_by
        toStr(r[12]),                               // checked_by
        toStr(r[13]),                               // buy_link
        toStr(r[4]),                                // asin
        toStr(r[5]),                                // sku
        toNum(r[16]),                               // unit_buy_price_inc_vat
        toNum(r[17]),                               // delivery_fee_per_line
        toStr(r[19]),                               // vat_status
        excelDateToISO(r[24]),                      // supplier_order_date
        toStr(r[25]),                               // supplier_order_ref
        toStr(r[27]),                               // expected_delivery_time
        excelDateToISO(r[36]),                      // marked_dispatched_on
        toBool(r[37]),                              // refunded
        excelDateToISO(r[38]),                      // refund_date
      );
      imported++;
    } catch (err) {
      console.error(`  Row ${sheetRow} error: ${err.message} — OrderID: ${cleanOrderId}`);
      skipped++;
    }
  }
});

insertAll();

// ═══ VERIFY ═══
const finalCount = db.prepare('SELECT COUNT(*) as c FROM orders').get().c;
const sampleOrder = db.prepare('SELECT order_id, order_date, product_name, total_sell_price FROM orders LIMIT 1').get();

console.log(`
╔═══════════════════════════════════════════════╗
║  ✅  Migration Complete                        ║
║                                               ║
║  Excel rows:      ${String(dataRows.length).padEnd(27)}║
║  Imported:        ${String(imported).padEnd(27)}║
║  Skipped:         ${String(skipped).padEnd(27)}║
║  Total in DB:     ${String(finalCount).padEnd(27)}║
╚═══════════════════════════════════════════════╝
`);

if (sampleOrder) {
  console.log('Sample order:', JSON.stringify(sampleOrder, null, 2));
}

db.close();
console.log('Done.');
