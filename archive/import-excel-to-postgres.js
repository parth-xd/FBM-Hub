#!/usr/bin/env node
/**
 * Import Excel data to PostgreSQL
 * Reads "Main STB Expenses" sheet from UK-US FBM Expenses DB.xlsx 
 * and populates financial columns in the orders table.
 * 
 * Usage: node import-excel-to-postgres.js
 * 
 * DATABASE_URL should be set or defaults to postgres://localhost/fbm_hub_dev
 */

const path = require('path');
const XLSX = require('xlsx');
const { Pool } = require('pg');

const EXCEL_PATH = path.join(__dirname, 'UK-US FBM Expenses DB.xlsx');

// PostgreSQL connection
const pool = new Pool({
  connectionString: process.env.DATABASE_URL || 'postgres://localhost/fbm_hub_dev'
});

// ─── Helpers ───

function excelDateToString(val) {
  if (val == null || val === '' || val === '-') return null;
  if (typeof val === 'string') {
    const d = new Date(val);
    if (!isNaN(d.getTime())) return d.toISOString().split('T')[0];
    return val;
  }
  if (typeof val === 'number') {
    // Excel serial date
    const date = new Date((val - 25569) * 86400 * 1000);
    return date.toISOString().split('T')[0];
  }
  return null;
}

function normalizePrice(val) {
  if (val == null || val === '' || val === '-') return null;
  const num = parseFloat(val);
  return isNaN(num) ? null : Math.round(num * 100) / 100;
}

function normalizeInt(val) {
  if (val == null || val === '' || val === '-') return null;
  const num = parseInt(val, 10);
  return isNaN(num) ? null : num;
}

function normalizeBoolean(val) {
  if (val == null || val === '') return false;
  if (typeof val === 'boolean') return val;
  if (typeof val === 'number') return val !== 0;
  return String(val).toLowerCase() === 'true' || String(val) === '1';
}

// ─── Main ───

async function main() {
  try {
    console.log('📖 Reading Excel file:', EXCEL_PATH);
    const workbook = XLSX.readFile(EXCEL_PATH);
    const sheetName = 'Main STB Expenses';
    
    if (!workbook.SheetNames.includes(sheetName)) {
      throw new Error(`Sheet "${sheetName}" not found. Available sheets: ${workbook.SheetNames.join(', ')}`);
    }

    const sheet = workbook.Sheets[sheetName];
    const rows = XLSX.utils.sheet_to_json(sheet);
    
    console.log(`✓ Loaded ${rows.length} rows from "${sheetName}"`);

    if (rows.length === 0) {
      console.log('⚠️  No data to import');
      await pool.end();
      return;
    }

    // Map Excel columns to DB columns (case-insensitive header matching)
    const headerMap = {};
    Object.keys(rows[0]).forEach(key => {
      const lower = key.toLowerCase();
      headerMap[lower] = key;
    });

    let updated = 0;
    let skipped = 0;

    for (let i = 0; i < rows.length; i++) {
      const row = rows[i];
      
      // Find order ID
      let orderId = row[headerMap['order id']] || row[headerMap['orderid']] || row[headerMap['order_id']];
      if (!orderId) {
        skipped++;
        continue;
      }
      
      orderId = String(orderId).trim();

      // Extract financial data
      const updates = {
        total_sell_price: normalizePrice(row[headerMap['sell price']] || row[headerMap['total sell price']] || row[headerMap['total_sell_price']]),
        total_buy_price_inc_vat: normalizePrice(row[headerMap['buy price inc vat']] || row[headerMap['total buy price inc vat']] || row[headerMap['total_buy_price_inc_vat']]),
        total_buy_price_exc_vat: normalizePrice(row[headerMap['buy price ex vat']] || row[headerMap['total buy price ex vat']] || row[headerMap['total_buy_price_exc_vat']]),
        shipping_cost_gbp: normalizePrice(row[headerMap['shipping cost']] || row[headerMap['shipping_cost_gbp']]),
        expected_profit: normalizePrice(row[headerMap['profit']] || row[headerMap['expected profit']] || row[headerMap['expected_profit']]),
        unit_buy_price_inc_vat: normalizePrice(row[headerMap['unit price inc vat']] || row[headerMap['unit_buy_price_inc_vat']]),
        s_qty: normalizeInt(row[headerMap['s qty']] || row[headerMap['s_qty']]),
        b_qty: normalizeInt(row[headerMap['b qty']] || row[headerMap['b_qty']]),
        qty_received: normalizeInt(row[headerMap['qty received']] || row[headerMap['qty_received']]),
        weight: normalizePrice(row[headerMap['weight']] || row[headerMap['weight (kg)']]),
        suggested_weight: normalizePrice(row[headerMap['suggested weight']] || row[headerMap['suggested_weight']]),
        is_dhl: normalizeBoolean(row[headerMap['is dhl']] || row[headerMap['dhl?']] || row[headerMap['is_dhl']]),
        expected_delivery_date: excelDateToString(row[headerMap['expected delivery date']] || row[headerMap['expected_delivery_date']]),
        supplier_order_date: excelDateToString(row[headerMap['supplier order date']] || row[headerMap['supplier_order_date']]),
        po_id: row[headerMap['po']] || row[headerMap['po id']] || row[headerMap['po_id']] || null,
      };

      // Build UPDATE query
      const setClauses = [];
      const values = [];
      let paramNum = 1;

      Object.entries(updates).forEach(([col, val]) => {
        if (val !== undefined) {
          setClauses.push(`${col} = $${paramNum}`);
          values.push(val);
          paramNum++;
        }
      });

      if (setClauses.length === 0) {
        skipped++;
        continue;
      }

      values.push(orderId);
      const query = `UPDATE orders SET ${setClauses.join(', ')} WHERE order_id = $${paramNum}`;

      try {
        const result = await pool.query(query, values);
        if (result.rowCount > 0) {
          updated++;
          if (updated % 100 === 0) console.log(`  ✓ Updated ${updated} orders...`);
        } else {
          skipped++;
        }
      } catch (err) {
        console.error(`Error updating order ${orderId}:`, err.message);
      }
    }

    console.log(`\n✅ Import complete!`);
    console.log(`   Updated: ${updated} orders`);
    console.log(`   Skipped: ${skipped} rows`);
    
    await pool.end();
  } catch (err) {
    console.error('❌ Import failed:', err.message);
    await pool.end();
    process.exit(1);
  }
}

main();
