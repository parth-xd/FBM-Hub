const XLSX = require('xlsx');
const wb = XLSX.readFile('UK-US FBM Expenses DB.xlsx');
console.log('Sheet names:', wb.SheetNames);
for (const name of wb.SheetNames) {
  const ws = wb.Sheets[name];
  const ref = ws['!ref'] || 'A1';
  const range = XLSX.utils.decode_range(ref);
  console.log(name, '→ rows:', range.e.r+1, 'cols:', range.e.c+1);
  // Print first 3 rows as JSON
  const data = XLSX.utils.sheet_to_json(ws, { header: 1, range: 0 });
  console.log('  Headers:', JSON.stringify(data[0]));
  if (data[1]) console.log('  Row 1:', JSON.stringify(data[1]));
  if (data[2]) console.log('  Row 2:', JSON.stringify(data[2]));
  console.log('---');
}
