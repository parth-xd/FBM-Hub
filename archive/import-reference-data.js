// Import Reference Data + Royal Mail Rate Card into SQLite
// Run once: node import-reference-data.js

const XLSX = require('xlsx');
const Database = require('better-sqlite3');
const path = require('path');

const DB_PATH = path.join(__dirname, 'fbm_hub.db');
const XLSX_PATH = path.join(__dirname, 'UK-US FBM Expenses DB.xlsx');

const db = new Database(DB_PATH);
db.pragma('journal_mode = WAL');

// Create tables
db.exec(`
  CREATE TABLE IF NOT EXISTS reference_data (
    asin TEXT PRIMARY KEY,
    weight_kg REAL,
    vetted_supplier TEXT,
    buy_price_inc_vat REAL,
    vat_status TEXT,
    sourced_by TEXT,
    handling_time TEXT,
    min_sell_price REAL,
    buy_box_sell_price REAL,
    active_sell_price REAL
  );

  CREATE TABLE IF NOT EXISTS royal_mail_rates (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    route TEXT,
    weight_from REAL,
    weight_to REAL,
    service_name TEXT,
    price_per_item REAL,
    price_per_kg REAL,
    fuel_surcharge REAL,
    duty_handling_fee REAL
  );
`);

console.log('Reading Excel file...');
const wb = XLSX.readFile(XLSX_PATH);

// === Import Reference Data ===
console.log('\n--- Importing Reference Data ---');
const refWs = wb.Sheets['Reference Data'];
if (!refWs) { console.error('Reference Data sheet not found'); process.exit(1); }

const refData = XLSX.utils.sheet_to_json(refWs, { header: 1 });
console.log(`Total rows in sheet: ${refData.length}`);

db.exec('DELETE FROM reference_data');

const insertRef = db.prepare(`
  INSERT OR REPLACE INTO reference_data (asin, weight_kg, vetted_supplier, buy_price_inc_vat, vat_status, sourced_by, handling_time, min_sell_price, buy_box_sell_price, active_sell_price)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
`);

const insertRefMany = db.transaction((rows) => {
  let imported = 0, skipped = 0;
  for (let i = 1; i < rows.length; i++) {
    const row = rows[i];
    const asin = row[0];
    if (!asin || typeof asin !== 'string' || !asin.startsWith('B')) { skipped++; continue; }
    
    insertRef.run(
      asin.trim(),
      typeof row[1] === 'number' ? row[1] : null,
      row[3] || null,  // Col D = Vetted Supplier
      typeof row[4] === 'number' ? row[4] : null,  // Col E = Buy price inc VAT
      row[5] || null,  // Col F = Vatable? (YES/NO)
      row[6] || null,  // Col G = Sourced By
      row[7] || null,  // Col H = Handling Time
      typeof row[8] === 'number' ? row[8] : null,   // Col I = Min Sell Price
      typeof row[9] === 'number' ? row[9] : null,   // Col J = Buy Box Sell Price
      typeof row[10] === 'number' ? row[10] : null   // Col K = Active Sell Price
    );
    imported++;
  }
  return { imported, skipped };
});

const refResult = insertRefMany(refData);
console.log(`Reference Data: ${refResult.imported} ASINs imported, ${refResult.skipped} skipped`);

// === Import Royal Mail Rate Card ===
console.log('\n--- Importing Royal Mail Rate Card ---');
const rmWs = wb.Sheets['New Royal Mail Rate Card'] || wb.Sheets['Royal Mail Rate Card'];
if (!rmWs) { console.error('Royal Mail Rate Card sheet not found'); process.exit(1); }

const rmData = XLSX.utils.sheet_to_json(rmWs, { header: 1 });

db.exec('DELETE FROM royal_mail_rates');

const insertRM = db.prepare(`
  INSERT INTO royal_mail_rates (route, weight_from, weight_to, service_name, price_per_item, price_per_kg, fuel_surcharge, duty_handling_fee)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?)
`);

let rmCount = 0;
for (let i = 1; i < rmData.length; i++) {
  const row = rmData[i];
  if (!row[0]) continue; // skip empty rows
  insertRM.run(row[0], row[1], row[2], row[3], row[4], row[5], row[6], row[7]);
  rmCount++;
}
console.log(`Royal Mail Rates: ${rmCount} rate bands imported`);

// Verify
const refCount = db.prepare('SELECT COUNT(*) as c FROM reference_data').get();
const rmVerify = db.prepare('SELECT COUNT(*) as c FROM royal_mail_rates').get();
console.log(`\n✅ Done. Reference data: ${refCount.c} ASINs, Rate bands: ${rmVerify.c}`);

// Show sample
const sample = db.prepare('SELECT * FROM reference_data LIMIT 3').all();
console.log('\nSample reference data:');
sample.forEach(r => console.log(`  ${r.asin}: weight=${r.weight_kg}kg, VAT=${r.vat_status}, price=${r.buy_price_inc_vat}`));

const rates = db.prepare('SELECT * FROM royal_mail_rates').all();
console.log('\nAll rate bands:');
rates.forEach(r => console.log(`  ${r.weight_from}-${r.weight_to}kg: £${r.price_per_item} + £${r.price_per_kg}/kg, fuel=${r.fuel_surcharge*100}%, duty=£${r.duty_handling_fee}`));

db.close();
