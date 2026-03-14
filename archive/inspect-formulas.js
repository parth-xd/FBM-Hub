const XLSX = require('xlsx');
const path = require('path');

const file = path.join(__dirname, 'UK-US FBM Expenses DB.xlsx');
const wb = XLSX.readFile(file);

// === REFERENCE DATA SHEET ===
console.log('=== REFERENCE DATA SHEET ===');
const refWs = wb.Sheets['Reference Data'];
if (refWs) {
  const refRange = XLSX.utils.decode_range(refWs['!ref']);
  console.log('Range:', refWs['!ref']);
  
  // Headers
  console.log('\nHeaders:');
  for (let c = refRange.s.c; c <= Math.min(refRange.e.c, 10); c++) {
    const addr = XLSX.utils.encode_cell({ r: 0, c });
    const cell = refWs[addr];
    console.log('  ' + XLSX.utils.encode_col(c) + ': ' + (cell ? cell.v : '(empty)'));
  }
  
  // Get all non-empty rows
  const refData = XLSX.utils.sheet_to_json(refWs, { header: 1 });
  let count = 0;
  for (let i = 0; i < refData.length; i++) {
    const row = refData[i];
    if (row && row[0]) {
      count++;
      if (count <= 30) {
        console.log('  Row ' + (i+1) + ': ASIN=' + row[0] + ', Weight=' + row[1] + ', Col3=' + row[2] + ', Col4=' + row[3] + ', Col5=' + row[4] + ', Col6(VAT)=' + row[5]);
      }
    }
  }
  console.log('  Total non-empty rows: ' + count);
} else {
  console.log('NOT FOUND');
}

process.exit(0);

// === ROYAL MAIL RATE CARD SHEET ===
console.log('\n=== ROYAL MAIL RATE CARD SHEET ===');
const rmWs = wb.Sheets['Royal Mail Rate Card'];
if (rmWs) {
  const rmRange = XLSX.utils.decode_range(rmWs['!ref']);
  console.log('Range:', rmWs['!ref']);
  
  // Headers
  console.log('\nHeaders:');
  for (let c = rmRange.s.c; c <= Math.min(rmRange.e.c, 10); c++) {
    const addr = XLSX.utils.encode_cell({ r: 0, c });
    const cell = rmWs[addr];
    console.log(`  ${XLSX.utils.encode_col(c)}: ${cell ? cell.v : '(empty)'}`);
  }
  
  // ALL data rows (rate card is usually small)
  console.log('\nAll Data:');
  const rmData = XLSX.utils.sheet_to_json(rmWs, { header: 1 });
  for (let i = 0; i < rmData.length; i++) {
    console.log(`  Row ${i+1}: ${JSON.stringify(rmData[i])}`);
  }
} else {
  console.log('NOT FOUND');
}

process.exit(0);

const ws = wb.Sheets['Main STB Expenses'];
if (!ws) { console.log('Sheet not found'); process.exit(1); }

const range = XLSX.utils.decode_range(ws['!ref']);
console.log('Sheet range:', ws['!ref']);
console.log('');

// Row 2 = headers (0-indexed row 1)
console.log('=== COLUMN HEADERS (Row 2) ===');
for (let c = range.s.c; c <= range.e.c; c++) {
  const addr = XLSX.utils.encode_cell({ r: 1, c });
  const cell = ws[addr];
  const colLetter = XLSX.utils.encode_col(c);
  console.log(`  ${colLetter} (col ${c}): ${cell ? cell.v : '(empty)'}`);
}

console.log('\n=== FORMULA ANALYSIS (Rows 3-6) ===');
for (let r = 2; r <= 5; r++) {
  console.log(`\n--- Row ${r + 1} ---`);
  for (let c = range.s.c; c <= range.e.c; c++) {
    const addr = XLSX.utils.encode_cell({ r, c });
    const cell = ws[addr];
    const colLetter = XLSX.utils.encode_col(c);
    if (cell && cell.f) {
      console.log(`  ${colLetter} [FORMULA]: =${cell.f}  (value: ${cell.v})`);
    }
  }
}

// Identify all formula columns across first 20 data rows
console.log('\n=== FORMULA COLUMNS SUMMARY (sampled from rows 3-22) ===');
const formulaCols = {};
for (let r = 2; r <= Math.min(21, range.e.r); r++) {
  for (let c = range.s.c; c <= range.e.c; c++) {
    const addr = XLSX.utils.encode_cell({ r, c });
    const cell = ws[addr];
    if (cell && cell.f) {
      const colLetter = XLSX.utils.encode_col(c);
      if (!formulaCols[colLetter]) {
        formulaCols[colLetter] = { header: '', formulas: [], count: 0 };
        const hAddr = XLSX.utils.encode_cell({ r: 1, c });
        const hCell = ws[hAddr];
        formulaCols[colLetter].header = hCell ? hCell.v : '(no header)';
      }
      formulaCols[colLetter].count++;
      if (formulaCols[colLetter].formulas.length < 3) {
        formulaCols[colLetter].formulas.push({ row: r + 1, formula: '=' + cell.f, value: cell.v });
      }
    }
  }
}

for (const [col, info] of Object.entries(formulaCols)) {
  console.log(`\n  Column ${col}: "${info.header}" (${info.count} formula cells found)`);
  info.formulas.forEach(f => {
    console.log(`    Row ${f.row}: ${f.formula}  →  ${f.value}`);
  });
}

// Also check manual entry columns
console.log('\n=== MANUAL ENTRY COLUMNS (no formulas in rows 3-22) ===');
for (let c = range.s.c; c <= range.e.c; c++) {
  const colLetter = XLSX.utils.encode_col(c);
  if (!formulaCols[colLetter]) {
    const hAddr = XLSX.utils.encode_cell({ r: 1, c });
    const hCell = ws[hAddr];
    console.log(`  ${colLetter}: "${hCell ? hCell.v : '(no header)'}"`);
  }
}
