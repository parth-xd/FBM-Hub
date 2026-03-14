#!/usr/bin/env node

/**
 * Migration Script: Google Sheets → SQLite
 * 
 * Usage:
 *   node migrate-sheets-to-sql.js
 * 
 * This script:
 * 1. Reads all orders from Google Sheets
 * 2. Transforms data to SQL format
 * 3. Inserts into SQLite
 * 4. Preserves conditional formatting rules
 */

require('dotenv').config();
const Database = require('better-sqlite3');
const { google } = require('googleapis');
const fs = require('fs');
const path = require('path');

const DB_PATH = path.join(__dirname, 'fbm_hub.db');
const db = new Database(DB_PATH);
db.pragma('journal_mode = WAL');

// ═══ GOOGLE SHEETS SETUP ═══

const CREDENTIALS_PATH = path.join(__dirname, 'credentials', 'service-account-key.json');

const getCredentials = () => {
  const credentialsJson = process.env.GOOGLE_APPLICATION_CREDENTIALS_JSON;

  if (credentialsJson) {
    try {
      return JSON.parse(credentialsJson);
    } catch (e) {
      throw new Error(`Invalid GOOGLE_APPLICATION_CREDENTIALS_JSON: ${e.message}`);
    }
  }

  if (fs.existsSync(CREDENTIALS_PATH)) {
    try {
      return JSON.parse(fs.readFileSync(CREDENTIALS_PATH, 'utf8'));
    } catch (e) {
      throw new Error(`Invalid credentials file: ${e.message}`);
    }
  }

  throw new Error(`Missing Google credentials. Provide either ${CREDENTIALS_PATH} or GOOGLE_APPLICATION_CREDENTIALS_JSON env var`);
};

const getSheetsClient = async () => {
  const credentials = getCredentials();
  const auth = new google.auth.GoogleAuth({
    credentials,
    scopes: ['https://www.googleapis.com/auth/spreadsheets.readonly'],
  });
  return google.sheets({ version: 'v4', auth });
};

// ═══ DATA TRANSFORMATION ═══

const parseNum = (val) => {
  if (!val) return null;
  const str = String(val);
  const cleaned = str.replace(/[£€$]/g, '').replace(/~~[^~]*~~/g, '').trim();
  const matches = cleaned.match(/[\d.]+/g);
  if (matches && matches.length > 0) {
    const nums = matches.map(Number).filter(n => !isNaN(n));
    return nums.length > 0 ? Math.max(...nums) : null;
  }
  return null;
};

const transformRow = (r, sheetRowIndex) => {
  return {
    sheet_row: sheetRowIndex,
    order_id: r[2] || null,
    order_date: r[1] || null,
    product_name: r[7] || null,
    total_sell_price: parseNum(r[9]),
    total_buy_price_inc_vat: parseNum(r[18]),
    total_buy_price_exc_vat: parseNum(r[20]),
    shipping_cost_gbp: parseNum(r[22]),
    expected_profit: parseNum(r[23]),
    weight: parseNum(r[19]),
    suggested_weight: parseNum(r[19]),
    label_printed: r[31] === 'TRUE' || r[31] === true,
    status: (r[31] === 'TRUE' || r[31] === true) ? 'packed' : 'pending',
    is_dhl: String(r[30] || '').toUpperCase() === 'DHL',
    po_id: r[14] || null,
    s_qty: parseNum(r[6]),
    b_qty: parseNum(r[15]),
    qty_received: parseNum(r[28]),
    discrepancy: parseNum(r[29]),
    exception_reason: r[32] || null,
    exception_stock_solution: r[33] || null,
    exception_po_created: r[34] === 'TRUE' || r[34] === true,
    goods_not_available: r[35] === 'TRUE' || r[35] === true,
    is_multi_po: (String(r[14] || '').split('/').length > 1),
    ship_by_date: r[10] || null,
    expected_delivery_date: r[26] || null,
    purchased_by: r[11] || null,
    checked_by: r[12] || null,
    buy_link: r[13] || null,
    asin: r[4] || null,
    sku: r[5] || null,
    shipstation_link: r[33] || null,
  };
};

// ═══ MIGRATION FUNCTION ═══

const migrateData = async () => {
  console.log('📊 Starting migration: Google Sheets → SQLite\n');

  try {
    // 1. Initialize database schema
    console.log('🔧 Initializing database schema...');
    db.exec(`
      CREATE TABLE IF NOT EXISTS orders (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        sheet_row INTEGER UNIQUE,
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
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_by TEXT,
        locked_by TEXT,
        locked_at DATETIME
      );

      CREATE INDEX IF NOT EXISTS idx_order_id ON orders(order_id);
      CREATE INDEX IF NOT EXISTS idx_status ON orders(status);
      CREATE INDEX IF NOT EXISTS idx_sheet_row ON orders(sheet_row);
      CREATE INDEX IF NOT EXISTS idx_updated_at ON orders(updated_at DESC);
    `);

    // 2. Read from Google Sheets
    console.log('📖 Reading from Google Sheets...');
    const sheets = await getSheetsClient();
    const spreadsheetId = process.env.GOOGLE_SHEETS_SPREADSHEET_ID || process.env.SPREADSHEET_ID;
    if (!spreadsheetId) throw new Error('GOOGLE_SHEETS_SPREADSHEET_ID or SPREADSHEET_ID not set');

    const range = 'Main STB Expenses!A3:AN';
    const response = await sheets.spreadsheets.values.get({ spreadsheetId, range });
    const rows = response.data.values || [];

    console.log(`✅ Read ${rows.length} rows from Google Sheets\n`);

    // 3. Transform data
    console.log('🔄 Transforming data...');
    const orders = rows
      .map((r, i) => transformRow(r, i + 3))
      .filter(o => o.product_name || o.order_id);

    console.log(`✅ Transformed ${orders.length} valid orders\n`);

    // 4. Insert into SQLite
    console.log('💾 Inserting into SQLite...');
    const insertStmt = db.prepare(`
      INSERT INTO orders (
        sheet_row, order_id, order_date, product_name, total_sell_price,
        total_buy_price_inc_vat, total_buy_price_exc_vat, shipping_cost_gbp,
        expected_profit, weight, suggested_weight, label_printed, status,
        is_dhl, po_id, s_qty, b_qty, qty_received, discrepancy,
        exception_reason, exception_stock_solution, exception_po_created,
        goods_not_available, is_multi_po, ship_by_date, expected_delivery_date,
        purchased_by, checked_by, buy_link, asin, sku, shipstation_link
      ) VALUES (
        ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 
        ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?
      )
    `);

    // Use transaction for faster inserts
    const transaction = db.transaction((orders) => {
      for (const order of orders) {
        insertStmt.run(
          order.sheet_row, order.order_id, order.order_date, order.product_name,
          order.total_sell_price, order.total_buy_price_inc_vat, order.total_buy_price_exc_vat,
          order.shipping_cost_gbp, order.expected_profit, order.weight, order.suggested_weight,
          order.label_printed ? 1 : 0, order.status, order.is_dhl ? 1 : 0, order.po_id, 
          order.s_qty, order.b_qty, order.qty_received, order.discrepancy,
          order.exception_reason, order.exception_stock_solution,
          order.exception_po_created ? 1 : 0, order.goods_not_available ? 1 : 0, 
          order.is_multi_po ? 1 : 0, order.ship_by_date, order.expected_delivery_date,
          order.purchased_by, order.checked_by, order.buy_link, order.asin, order.sku, order.shipstation_link
        );
      }
    });

    transaction(orders);

    console.log(`✅ Migration complete!`);
    console.log(`   📝 Inserted: ${orders.length} orders\n`);

    // 5. Verify
    const countStmt = db.prepare('SELECT COUNT(*) as count FROM orders');
    const { count } = countStmt.get();
    console.log(`✔️  Total orders in database: ${count}\n`);

    console.log('🎉 Migration successful! Your database is ready for real-time sync.\n');
  } catch (error) {
    console.error('❌ Migration failed:', error.message);
    process.exit(1);
  } finally {
    db.close();
  }
};

// ═══ RUN MIGRATION ═══

migrateData();
