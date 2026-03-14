const fs = require('fs');
const html = fs.readFileSync('public/index.html', 'utf8');
const start = html.indexOf('<script type="text/babel">');
const end = html.indexOf('</script>', start);
if (start === -1 || end === -1) { console.log('No babel script found'); process.exit(1); }
const js = html.substring(start + '<script type="text/babel">'.length, end);
try {
  const babel = require('@babel/standalone');
  babel.transform(js, {presets:['react']});
  console.log('OK - no syntax errors in', js.length, 'chars');
} catch(e) {
  console.log('BABEL ERROR:\n' + e.message);
}
