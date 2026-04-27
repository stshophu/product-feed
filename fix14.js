const fs = require('fs');
let code = fs.readFileSync('sync.js', 'utf8');
code = code.replace(
  'const cleanSize = sizeValue ? sizeValue.replace(/,/g, ".").replace(/^one size$/i, "one_size") : null;',
  `let cleanSize = sizeValue ? sizeValue.replace(/,/g, ".").replace(/^one size$/i, "one_size") : null;
  // Round half sizes down (42.5 -> 42)
  if (cleanSize && /^\\d+\\.5$/.test(cleanSize)) {
    cleanSize = String(Math.floor(parseFloat(cleanSize)));
  }`
);
fs.writeFileSync('sync.js', code);
console.log('Done');
