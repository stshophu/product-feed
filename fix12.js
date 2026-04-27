const fs = require('fs');
let code = fs.readFileSync('sync.js', 'utf8');
code = code.replace(
  'if (sizeValue) payload.values.size = [{ data: sizeValue.replace(/,/g, ".") }];',
  'if (sizeValue) payload.values.size = [{ data: sizeValue.replace(/,/g, ".").replace(/^one size$/i, "one_size") }];'
);
fs.writeFileSync('sync.js', code);
console.log('Done');
