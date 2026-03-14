const Database = require("better-sqlite3");
const db = new Database("fbm_hub.db");
db.pragma("journal_mode = WAL");
db.pragma("foreign_keys = OFF");

const tableInfo = db.prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name='orders'").get();
if (tableInfo && tableInfo.sql.includes("sheet_row INTEGER UNIQUE")) {
  console.log("Removing UNIQUE constraint from sheet_row...");
  // Clean up any leftover temp table from a failed previous attempt
  db.exec("DROP TABLE IF EXISTS orders_new");
  db.exec("CREATE TABLE orders_new AS SELECT * FROM orders");
  db.exec("DROP TABLE orders");
  db.exec("ALTER TABLE orders_new RENAME TO orders");
  db.exec("CREATE INDEX IF NOT EXISTS idx_order_id ON orders(order_id)");
  db.exec("CREATE INDEX IF NOT EXISTS idx_status ON orders(status)");
  db.exec("CREATE INDEX IF NOT EXISTS idx_sheet_row ON orders(sheet_row)");
  db.exec("CREATE INDEX IF NOT EXISTS idx_updated_at ON orders(updated_at DESC)");
  console.log("Done! UNIQUE constraint removed.");
} else {
  console.log("sheet_row already does not have UNIQUE constraint.");
}

// Verify
const newInfo = db.prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name='orders'").get();
console.log("Current schema:", newInfo.sql.substring(0, 120));
db.close();
