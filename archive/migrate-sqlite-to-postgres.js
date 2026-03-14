#!/usr/bin/env node
/**
 * Migrate data from SQLite to PostgreSQL
 * Reads from fbm_hub.db and inserts into pg database
 */

const sqlite3 = require('sqlite3').verbose();
const { Pool } = require('pg');
const path = require('path');

const SQLITE_PATH = path.join(__dirname, 'fbm_hub.db');

// PostgreSQL connection
const pool = new Pool({
  connectionString: process.env.DATABASE_URL || 'postgres://localhost/fbm_hub_dev'
});

// Helper to convert SQLite values to PostgreSQL
function convertValue(val, colName) {
  if (val === null || val === undefined) return null;
  
  // For boolean columns, convert 0/1 to false/true
  if (['label_printed', 'is_dhl', 'exception_po_created', 'goods_not_available', 'is_multi_po', 'refunded'].includes(colName)) {
    return val ? true : false;
  }
  
  return val;
}

async function main() {
  try {
    console.log('📖 Opening SQLite database:', SQLITE_PATH);
    
    const sqlite = new sqlite3.Database(SQLITE_PATH, (err) => {
      if (err) {
        console.error('❌ Cannot connect to SQLite:', err);
        process.exit(1);
      }
    });

    // Get all rows from SQLite
    sqlite.all('SELECT * FROM orders ORDER BY id', async (err, rows) => {
      if (err) {
        console.error('❌ Error reading SQLite:', err);
        sqlite.close();
        await pool.end();
        process.exit(1);
      }

      console.log(`✓ Loaded ${rows.length} rows from SQLite`);

      if (rows.length === 0) {
        console.log('⚠️  No data to migrate');
        sqlite.close();
        await pool.end();
        return;
      }

      let inserted = 0;
      let errors = 0;

      for (let i = 0; i < rows.length; i++) {
        const row = rows[i];

        // Build INSERT query
        const columns = Object.keys(row);
        const values = columns.map((col, idx) => {
          const val = convertValue(row[col], col);
          return val !== null ? val : null;
        });

        const placeholders = columns.map((_, idx) => `$${idx + 1}`).join(', ');
        const query = `
          INSERT INTO orders (${columns.map(c => `"${c}"`).join(', ')})
          VALUES (${placeholders})
        `;

        try {
          await pool.query(query, values);
          inserted++;
          if (inserted % 500 === 0) {
            console.log(`  ✓ Inserted ${inserted}/${rows.length} rows...`);
          }
        } catch (err) {
          errors++;
          if (errors <= 5) {
            console.error(`Error inserting row ${i}:`, err.message);
          }
        }
      }

      sqlite.close();
      await pool.end();

      console.log(`\n✅ Migration complete!`);
      console.log(`   Inserted: ${inserted} orders`);
      console.log(`   Errors: ${errors}`);
      
      if (errors === 0) {
        console.log(`\n🎉 All data successfully migrated from SQLite to PostgreSQL!`);
      }
    });

  } catch (err) {
    console.error('❌ Migration failed:', err.message);
    await pool.end();
    process.exit(1);
  }
}

main();
