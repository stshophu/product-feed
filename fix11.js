const fs = require('fs');
let code = fs.readFileSync('sync.js', 'utf8');
code = code.replace(
  'if (sizeValue) payload.values.size = [{ data: sizeValue }];',
  'if (sizeValue) payload.values.size = [{ data: sizeValue.replace(/,/g, ".") }];'
);
fs.writeFileSync('sync.js', code);
console.log('Done');
