const Database = require("better-sqlite3");
const db = new Database("fbm_hub.db");
db.pragma("journal_mode = WAL");
db.pragma("foreign_keys = OFF");

console.log("Regenerating id column with proper auto-increment...");

db.exec(`
  CREATE TABLE orders_fixed (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    sheet_row INTEGER,
    order_id TEXT,
    order_date TEXT,
    product_name TEXT,
    total_sell_price REAL,
    total_buy_price_inc_vat REAL,
    total_buy_price_exc_vat REAL,
    shipping_cost_gbp REAL,
    expected_profit REAL,
    weight REAL,
    suggested_weight REAL,
    label_printed INTEGER DEFAULT 0,
    status TEXT DEFAULT 'pending',
    is_dhl INTEGER DEFAULT 0,
    po_id TEXT,
    s_qty REAL,
    b_qty REAL,
    qty_received REAL,
    discrepancy REAL,
    exception_reason TEXT,
    exception_stock_solution TEXT,
    exception_po_created INTEGER DEFAULT 0,
    goods_not_available INTEGER DEFAULT 0,
    is_multi_po INTEGER DEFAULT 0,
    ship_by_date TEXT,
    expected_delivery_date TEXT,
    purchased_by TEXT,
    checked_by TEXT,
    buy_link TEXT,
    asin TEXT,
    sku TEXT,
    shipstation_link TEXT,
    unit_buy_price_inc_vat REAL,
    delivery_fee_per_line REAL,
    vat_status TEXT,
    supplier_order_date TEXT,
    supplier_order_ref TEXT,
    expected_delivery_time TEXT,
    marked_dispatched_on TEXT,
    refunded INTEGER DEFAULT 0,
    refund_date TEXT,
    rate_date TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_by TEXT,
    locked_by TEXT,
    locked_at DATETIME
  );

  INSERT INTO orders_fixed SELECT 
    rowid,
    sheet_row, order_id, order_date, product_name, total_sell_price,
    total_buy_price_inc_vat, total_buy_price_exc_vat, shipping_cost_gbp,
    expected_profit, weight, suggested_weight, label_printed, status,
    is_dhl, po_id, s_qty, b_qty, qty_received, discrepancy,
    exception_reason, exception_stock_solution, exception_po_created,
    goods_not_available, is_multi_po, ship_by_date, expected_delivery_date,
    purchased_by, checked_by, buy_link, asin, sku, shipstation_link,
    unit_buy_price_inc_vat, delivery_fee_per_line, vat_status,
    supplier_order_date, supplier_order_ref, expected_delivery_time,
    marked_dispatched_on, refunded, refund_date, rate_date,
    created_at, updated_at, updated_by, locked_by, locked_at
  FROM orders;

  DROP TABLE orders;
  ALTER TABLE orders_fixed RENAME TO orders;

  CREATE INDEX IF NOT EXISTS idx_order_id ON orders(order_id);
  CREATE INDEX IF NOT EXISTS idx_status ON orders(status);
  CREATE INDEX IF NOT EXISTS idx_sheet_row ON orders(sheet_row);
  CREATE INDEX IF NOT EXISTS idx_updated_at ON orders(updated_at DESC);
`);

const count = db.prepare("SELECT COUNT(*) as c FROM orders").get();
const firstId = db.prepare("SELECT id, order_id FROM orders LIMIT 1").get();

console.log(`✅ Done! ${count.c} orders now have proper IDs\nFirst order: id=${firstId.id}, order_id=${firstId.order_id}`);

db.close();
