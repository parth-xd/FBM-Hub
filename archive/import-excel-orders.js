// Import orders from UK-US FBM Expenses DB.xlsx into SQLite
// Replaces all existing orders in the database

const XLSX = require('xlsx');
const Database = require('better-sqlite3');
const path = require('path');

const DB_PATH = path.join(__dirname, 'fbm_hub.db');
const XLSX_PATH = path.join(__dirname, 'UK-US FBM Expenses DB.xlsx');

// Excel serial date to ISO string
function excelDateToISO(serial) {
  if (!serial || typeof serial !== 'number') return null;
  // Excel epoch is 1900-01-01, but has the 1900 leap year bug (off by 1 for dates after Feb 28 1900)
  const epoch = new Date(Date.UTC(1899, 11, 30));
  const ms = serial * 86400000;
  const d = new Date(epoch.getTime() + ms);
  return d.toISOString();
}

function parseNum(val, fallback = null) {
  if (val === null || val === undefined || val === '') return fallback;
  const n = Number(val);
  return isNaN(n) ? fallback : n;
}

function parseBoolean(val) {
  if (val === true || val === 1 || val === 'TRUE' || val === 'true' || val === 'Yes' || val === 'YES') return 1;
  return 0;
}

function cleanStr(val) {
  if (val === null || val === undefined) return null;
  const s = String(val).trim();
  return s === '' ? null : s;
}

console.log('Reading Excel file...');
const wb = XLSX.readFile(XLSX_PATH);

// ========== Parse Main STB Expenses ==========
console.log('\n--- Parsing Main STB Expenses ---');
const mainWs = wb.Sheets['Main STB Expenses'];
const mainData = XLSX.utils.sheet_to_json(mainWs, { header: 1 });
console.log(`Total rows in sheet: ${mainData.length}`);

// Headers at row index 1:
// 0: 🔗 (shipstation link), 1: Order Date, 2: Order ID, 3: Multi-PO Order?, 4: ASIN, 5: SKU
// 6: S-Qty, 7: Product Name, 8: Others, 9: Total Sell Price (USD), 10: Ship By Date
// 11: Purchased By, 12: Checked By, 13: Buy Link, 14: PO ID, 15: B-Qty
// 16: Unit Buy Price inc. VAT, 17: Delivery Fee Per Line, 18: Total Buy Price inc. VAT
// 19: VAT Status, 20: Total Buy Price exc. VAT, 21: Order Weight (kg), 22: Shipping Cost (GBP)
// 23: Expected Order Profit, 24: Order Date (supplier), 25: Supplier Order Reference
// 26: Expected Delivery Date, 27: Expected Delivery Time, 28: Quantity Received
// 29: Discrepancy, 30: 📦, 31: Shipping Label Generated, 32: Order Exception Reason
// 33: Exception Stock Solution, 34: Exception PO Created?, 35: Goods Not Available
// 36: Marked As Dispatched On, 37: Order Refunded?, 38: Order Refund Date

// Extract hyperlinks from column A for ShipStation links
const shipstationLinks = {};
for (const cellAddr of Object.keys(mainWs)) {
  if (cellAddr.startsWith('A') && mainWs[cellAddr].l) {
    const rowNum = parseInt(cellAddr.slice(1), 10);
    shipstationLinks[rowNum] = mainWs[cellAddr].l.Target || mainWs[cellAddr].l.target || null;
  }
}
console.log(`Found ${Object.keys(shipstationLinks).length} ShipStation hyperlinks`);

const orders = [];
let skippedEmpty = 0;

for (let i = 2; i < mainData.length; i++) {
  const row = mainData[i];
  const orderId = cleanStr(row[2]);
  // Skip rows without order ID
  if (!orderId) { skippedEmpty++; continue; }

  const isDhl = orderId.toLowerCase().includes('dhl') || 
    (cleanStr(row[5]) && String(row[5]).toLowerCase().includes('dhl')) ? 1 : 0;

  orders.push({
    sheet_row: i + 1, // 1-based sheet row (Excel row number)
    order_id: orderId,
    order_date: excelDateToISO(row[1]),
    product_name: cleanStr(row[7]),
    total_sell_price: parseNum(row[9]),
    total_buy_price_inc_vat: parseNum(row[18]),
    total_buy_price_exc_vat: parseNum(row[20]),
    shipping_cost_gbp: parseNum(row[22]),
    expected_profit: parseNum(row[23]),
    weight: parseNum(row[21]),
    is_dhl: isDhl,
    po_id: cleanStr(row[14]),
    s_qty: parseNum(row[6]),
    b_qty: parseNum(row[15]),
    qty_received: parseNum(row[28]),
    discrepancy: parseNum(row[29]),
    exception_reason: cleanStr(row[32]),
    exception_stock_solution: cleanStr(row[33]),
    exception_po_created: parseBoolean(row[34]),
    goods_not_available: parseBoolean(row[35]),
    is_multi_po: parseBoolean(row[3]),
    ship_by_date: excelDateToISO(row[10]),
    expected_delivery_date: excelDateToISO(row[26]),
    purchased_by: cleanStr(row[11]),
    checked_by: cleanStr(row[12]),
    buy_link: cleanStr(row[13]),
    asin: cleanStr(row[4]),
    sku: cleanStr(row[5]),
    shipstation_link: shipstationLinks[i + 1] || null, // Excel row is i+1
    unit_buy_price_inc_vat: parseNum(row[16]),
    delivery_fee_per_line: parseNum(row[17]),
    vat_status: cleanStr(row[19]),
    supplier_order_date: excelDateToISO(row[24]),
    supplier_order_ref: cleanStr(row[25]),
    expected_delivery_time: cleanStr(row[27]),
    marked_dispatched_on: excelDateToISO(row[36]),
    refunded: parseBoolean(row[37]),
    refund_date: excelDateToISO(row[38]),
    label_printed: parseBoolean(row[31]),
    source: 'main',
  });
}
console.log(`Main: ${orders.length} orders with Order ID, ${skippedEmpty} empty rows skipped`);
console.log(`\nTotal orders to import: ${orders.length}`);

// ========== Import into Database ==========
if (process.argv.includes('--dry-run')) {
  console.log('\n[DRY RUN] Would delete all existing orders and insert', orders.length, 'orders');
  // Show some samples
  console.log('\nSample orders:');
  orders.slice(0, 3).forEach((o, i) => {
    console.log(`  ${i + 1}. ${o.order_id} | ${o.product_name} | sell=$${o.total_sell_price} | asin=${o.asin}`);
  });
  process.exit(0);
}

console.log('\nOpening database...');
const db = new Database(DB_PATH);
db.pragma('journal_mode = WAL');

// Clear existing orders and audit logs
console.log('Clearing existing orders...');
const existingCount = db.prepare('SELECT COUNT(*) as c FROM orders').get().c;
console.log(`Removing ${existingCount} existing orders...`);
db.exec('DELETE FROM orders');
db.exec('DELETE FROM audit_logs');
// Reset autoincrement
db.exec("DELETE FROM sqlite_sequence WHERE name='orders'");
db.exec("DELETE FROM sqlite_sequence WHERE name='audit_logs'");

// Insert orders
const insertStmt = db.prepare(`
  INSERT INTO orders (
    sheet_row, order_id, order_date, product_name, total_sell_price,
    total_buy_price_inc_vat, total_buy_price_exc_vat, shipping_cost_gbp,
    expected_profit, weight, is_dhl, po_id, s_qty, b_qty,
    qty_received, discrepancy, exception_reason, exception_stock_solution,
    exception_po_created, goods_not_available, is_multi_po, ship_by_date,
    expected_delivery_date, purchased_by, checked_by, buy_link, asin, sku,
    shipstation_link, unit_buy_price_inc_vat, delivery_fee_per_line,
    vat_status, supplier_order_date, supplier_order_ref,
    expected_delivery_time, marked_dispatched_on, refunded, refund_date,
    label_printed, status
  ) VALUES (
    @sheet_row, @order_id, @order_date, @product_name, @total_sell_price,
    @total_buy_price_inc_vat, @total_buy_price_exc_vat, @shipping_cost_gbp,
    @expected_profit, @weight, @is_dhl, @po_id, @s_qty, @b_qty,
    @qty_received, @discrepancy, @exception_reason, @exception_stock_solution,
    @exception_po_created, @goods_not_available, @is_multi_po, @ship_by_date,
    @expected_delivery_date, @purchased_by, @checked_by, @buy_link, @asin, @sku,
    @shipstation_link, @unit_buy_price_inc_vat, @delivery_fee_per_line,
    @vat_status, @supplier_order_date, @supplier_order_ref,
    @expected_delivery_time, @marked_dispatched_on, @refunded, @refund_date,
    @label_printed, @status
  )
`);

const insertAll = db.transaction((rows) => {
  let count = 0;
  for (const row of rows) {
    insertStmt.run({
      ...row,
      status: 'pending',
    });
    count++;
  }
  return count;
});

console.log('Inserting orders...');
const inserted = insertAll(orders);
console.log(`✅ Inserted ${inserted} orders`);

// Verify
const finalCount = db.prepare('SELECT COUNT(*) as c FROM orders').get().c;
console.log(`\nVerification: ${finalCount} total orders`);

// Sample
const samples = db.prepare('SELECT id, order_id, product_name, total_sell_price, asin FROM orders LIMIT 5').all();
console.log('\nSample orders:');
samples.forEach(s => console.log(`  id=${s.id}: ${s.order_id} | ${s.product_name} | $${s.total_sell_price} | ${s.asin}`));

db.close();
console.log('\nDone!');
