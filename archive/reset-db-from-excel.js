#!/usr/bin/env node
/**
 * Reset database from the Excel file: UK-US FBM Expenses DB.xlsx
 * Reads "Main STB Expenses" sheet and replaces all orders in the DB.
 * Also imports Reference Data, Royal Mail rates, and exchange rates.
 *
 * Usage: node reset-db-from-excel.js
 */

const path = require('path');
const Database = require('better-sqlite3');
const XLSX = require('xlsx');

const DB_PATH = path.join(__dirname, 'fbm_hub.db');
const EXCEL_PATH = path.join(__dirname, 'UK-US FBM Expenses DB.xlsx');

const db = new Database(DB_PATH);
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = OFF'); // Allow deleting orders even if audit_logs reference them

// ─── Helpers ───

function excelDateToString(val) {
  if (val == null || val === '' || val === '-') return null;
  if (typeof val === 'string') {
    // Already a date string like "2/15/2026 10:19:22 AM"
    const d = new Date(val);
    if (!isNaN(d.getTime())) return d.toISOString().split('T')[0];
    return val; // Return as-is if can't parse
  }
  if (typeof val === 'number') {
    // Excel serial date → JS Date
    // Excel epoch: 1900-01-01 (but with the famous Lotus 1-2-3 leap year bug)
    const epoch = new Date(1899, 11, 30); // Dec 30, 1899
    const ms = epoch.getTime() + val * 86400000;
    const d = new Date(ms);
    if (!isNaN(d.getTime())) return d.toISOString().split('T')[0];
    return null;
  }
  return null;
}

function parseNum(val, fallback = null) {
  if (val == null || val === '' || val === '-') return fallback;
  const n = Number(val);
  return isNaN(n) ? fallback : n;
}

function parseBool(val) {
  if (val === true || val === 'TRUE' || val === 'Yes' || val === 'Y' || val === 1) return 1;
  return 0;
}

function parseText(val) {
  if (val == null || val === '' || val === '-') return null;
  return String(val).trim() || null;
}

function getTodayDateString() {
  const d = new Date();
  return d.toISOString().split('T')[0]; // YYYY-MM-DD
}

// ─── Read Excel ───

console.log('📖 Reading Excel file...');
const wb = XLSX.readFile(EXCEL_PATH);

// ─── 1. Import Main STB Expenses (orders) ───

const mainSheet = wb.Sheets['Main STB Expenses'];
if (!mainSheet) {
  console.error('❌ Sheet "Main STB Expenses" not found');
  process.exit(1);
}

const mainData = XLSX.utils.sheet_to_json(mainSheet, { header: 1, range: 0 });
console.log(`📊 Main STB Expenses: ${mainData.length} rows (incl. 2 header rows)`);

// Row 0 = category headers, Row 1 = column headers, Row 2+ = data
const headers = mainData[1] || [];
console.log('📋 Headers:', headers.map((h, i) => `[${i}]${h}`).join(', '));

// Build DHL order set from the "SHIPPING COST (DHL)" sheet
const dhlOrders = new Set();
const dhlSheet = wb.Sheets['SHIPPING COST (DHL)'];
if (dhlSheet) {
  const dhlData = XLSX.utils.sheet_to_json(dhlSheet, { header: 1, range: 0 });
  for (let i = 1; i < dhlData.length; i++) {
    const orderId = parseText(dhlData[i] && dhlData[i][0]);
    if (orderId) dhlOrders.add(orderId);
  }
  console.log(`📦 DHL orders found: ${dhlOrders.size}`);
}

// Prepare order rows
const orders = [];
let skipped = 0;

for (let i = 2; i < mainData.length; i++) {
  const r = mainData[i];
  if (!r || r.length === 0) { skipped++; continue; }

  const orderId = parseText(r[2]);
  if (!orderId) { skipped++; continue; }

  orders.push({
    sheet_row: i + 1, // 1-based Excel row (row 1 = categories, row 2 = headers, row 3 = first data)
    order_id: orderId,
    order_date: excelDateToString(r[1]),
    is_multi_po: parseBool(r[3]),
    asin: parseText(r[4]),
    sku: parseText(r[5]),
    s_qty: parseNum(r[6], 1),
    product_name: parseText(r[7]),
    total_sell_price: parseNum(r[9]),
    ship_by_date: excelDateToString(r[10]),
    purchased_by: parseText(r[11]),
    checked_by: parseText(r[12]),
    buy_link: parseText(r[13]),
    po_id: parseText(r[14]),
    b_qty: parseNum(r[15], 1),
    unit_buy_price_inc_vat: parseNum(r[16]),
    delivery_fee_per_line: parseNum(r[17]),
    total_buy_price_inc_vat: parseNum(r[18]),
    vat_status: parseText(r[19]),
    total_buy_price_exc_vat: parseNum(r[20]),
    weight: parseNum(r[21]),
    shipping_cost_gbp: parseNum(r[22]),
    expected_profit: parseNum(r[23]),
    supplier_order_date: excelDateToString(r[24]),
    supplier_order_ref: parseText(r[25]),
    expected_delivery_date: excelDateToString(r[26]),
    expected_delivery_time: parseText(r[27]),
    qty_received: parseNum(r[28]),
    discrepancy: parseNum(r[29]),
    label_printed: parseBool(r[31]),
    exception_reason: parseText(r[32]),
    exception_stock_solution: parseText(r[33]),
    exception_po_created: parseBool(r[34]),
    goods_not_available: parseBool(r[35]),
    marked_dispatched_on: excelDateToString(r[36]),
    refunded: parseBool(r[37]),
    refund_date: excelDateToString(r[38]),
    is_dhl: dhlOrders.has(orderId) ? 1 : 0,
    rate_date: getTodayDateString(),
  });
}

console.log(`✅ Parsed ${orders.length} orders (${skipped} skipped empty/no-ID rows)`);

// ─── 2. Import Reference Data ───

const refSheet = wb.Sheets['Reference Data'];
let refRows = [];
if (refSheet) {
  const refData = XLSX.utils.sheet_to_json(refSheet, { header: 1, range: 0 });
  // Headers: ASIN, Weight (kg), AI-Suggested Supplier, Vetted Supplier, Buy price inc. VAT,
  //          Vatable?, Sourced By, Handling Time, Min Sell Price, Buy Box Sell Price, Active Sell Price, ...
  for (let i = 1; i < refData.length; i++) {
    const r = refData[i];
    const asin = parseText(r && r[0]);
    if (!asin || !asin.match(/^B0/i)) continue;
    refRows.push({
      asin,
      weight_kg: parseNum(r[1]),
      vetted_supplier: parseText(r[3]),
      buy_price_inc_vat: parseNum(r[4]),
      vat_status: parseText(r[5]),
      sourced_by: parseText(r[6]),
      handling_time: parseText(r[7]),
      min_sell_price: parseNum(r[8]),
      buy_box_sell_price: parseNum(r[9]),
      active_sell_price: parseNum(r[10]),
    });
  }
  console.log(`📚 Reference data: ${refRows.length} ASINs`);
}

// ─── 3. Import Royal Mail Rates (NEW rate card) ───

const rmSheet = wb.Sheets['New Royal Mail Rate Card'];
let rmRows = [];
if (rmSheet) {
  const rmData = XLSX.utils.sheet_to_json(rmSheet, { header: 1, range: 0 });
  // Headers: Route, Weight From, Weight To, Service Name, Price/Item, Price/kg, Fuel Surcharge %, Duty Handling Fee
  for (let i = 1; i < rmData.length; i++) {
    const r = rmData[i];
    const route = parseText(r && r[0]);
    if (!route) continue;
    rmRows.push({
      route,
      weight_from: parseNum(r[1], 0),
      weight_to: parseNum(r[2], 0),
      service_name: parseText(r[3]),
      price_per_item: parseNum(r[4], 0),
      price_per_kg: parseNum(r[5], 0),
      fuel_surcharge: parseNum(r[6], 0),
      duty_handling_fee: parseNum(r[7], 0),
    });
  }
  console.log(`📮 Royal Mail rates: ${rmRows.length} bands`);
}

// ─── 4. Import Exchange Rates ───

const fxSheet = wb.Sheets['FX_RATES'];
let gbpUsdRate = 1.34; // default
if (fxSheet) {
  const fxData = XLSX.utils.sheet_to_json(fxSheet, { header: 1, range: 0 });
  for (let i = 1; i < fxData.length; i++) {
    const r = fxData[i];
    if (parseText(r && r[0]) === 'UK') {
      gbpUsdRate = parseNum(r[1], 1.34);
      console.log(`💱 GBP→USD rate from Excel: ${gbpUsdRate}`);
    }
  }
}

// ─── Execute DB Reset ───

console.log('\n🔄 Resetting database...');

const tx = db.transaction(() => {
  // Clear existing data
  db.exec('DELETE FROM orders');
  db.exec('DELETE FROM reference_data');
  db.exec('DELETE FROM royal_mail_rates');
  console.log('🗑️  Cleared orders, reference_data, royal_mail_rates');

  // Insert orders
  const insertOrder = db.prepare(`
    INSERT INTO orders (
      sheet_row, order_id, order_date, product_name, total_sell_price,
      total_buy_price_inc_vat, total_buy_price_exc_vat, shipping_cost_gbp,
      expected_profit, weight, label_printed, status, is_dhl, po_id,
      s_qty, b_qty, qty_received, discrepancy, exception_reason,
      exception_stock_solution, exception_po_created, goods_not_available,
      is_multi_po, ship_by_date, purchased_by, checked_by, buy_link,
      asin, sku, unit_buy_price_inc_vat, delivery_fee_per_line, vat_status,
      supplier_order_date, supplier_order_ref, expected_delivery_date,
      expected_delivery_time, marked_dispatched_on, refunded, refund_date,
      rate_date, updated_at, updated_by
    ) VALUES (
      @sheet_row, @order_id, @order_date, @product_name, @total_sell_price,
      @total_buy_price_inc_vat, @total_buy_price_exc_vat, @shipping_cost_gbp,
      @expected_profit, @weight, @label_printed, 'pending', @is_dhl, @po_id,
      @s_qty, @b_qty, @qty_received, @discrepancy, @exception_reason,
      @exception_stock_solution, @exception_po_created, @goods_not_available,
      @is_multi_po, @ship_by_date, @purchased_by, @checked_by, @buy_link,
      @asin, @sku, @unit_buy_price_inc_vat, @delivery_fee_per_line, @vat_status,
      @supplier_order_date, @supplier_order_ref, @expected_delivery_date,
      @expected_delivery_time, @marked_dispatched_on, @refunded, @refund_date,
      @rate_date, datetime('now'), 'excel-import'
    )
  `);

  let orderCount = 0;
  for (const o of orders) {
    insertOrder.run(o);
    orderCount++;
  }
  console.log(`✅ Inserted ${orderCount} orders`);

  // Insert reference data
  if (refRows.length > 0) {
    const insertRef = db.prepare(`
      INSERT OR REPLACE INTO reference_data (
        asin, weight_kg, vetted_supplier, buy_price_inc_vat, vat_status,
        sourced_by, handling_time, min_sell_price, buy_box_sell_price, active_sell_price
      ) VALUES (
        @asin, @weight_kg, @vetted_supplier, @buy_price_inc_vat, @vat_status,
        @sourced_by, @handling_time, @min_sell_price, @buy_box_sell_price, @active_sell_price
      )
    `);
    let refCount = 0;
    for (const r of refRows) {
      insertRef.run(r);
      refCount++;
    }
    console.log(`✅ Inserted ${refCount} reference data rows`);
  }

  // Insert Royal Mail rates
  if (rmRows.length > 0) {
    const insertRM = db.prepare(`
      INSERT INTO royal_mail_rates (
        route, weight_from, weight_to, service_name,
        price_per_item, price_per_kg, fuel_surcharge, duty_handling_fee
      ) VALUES (
        @route, @weight_from, @weight_to, @service_name,
        @price_per_item, @price_per_kg, @fuel_surcharge, @duty_handling_fee
      )
    `);
    let rmCount = 0;
    for (const r of rmRows) {
      insertRM.run(r);
      rmCount++;
    }
    console.log(`✅ Inserted ${rmCount} Royal Mail rate bands`);
  }

  // Upsert today's exchange rate
  const today = getTodayDateString();
  db.prepare('INSERT OR REPLACE INTO exchange_rates (date, gbp_usd_rate, source) VALUES (?, ?, ?)').run(today, gbpUsdRate, 'excel-import');
  console.log(`✅ Exchange rate set: ${today} → ${gbpUsdRate}`);
});

tx();

// Verify
const count = db.prepare('SELECT COUNT(*) as c FROM orders').get();
const refCount = db.prepare('SELECT COUNT(*) as c FROM reference_data').get();
const rmCount = db.prepare('SELECT COUNT(*) as c FROM royal_mail_rates').get();

console.log('\n📊 Final DB state:');
console.log(`   Orders: ${count.c}`);
console.log(`   Reference data: ${refCount.c}`);
console.log(`   Royal Mail rates: ${rmCount.c}`);
console.log('\n✅ Database reset complete!');

db.close();
