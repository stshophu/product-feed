const fs = require('fs');
let code = fs.readFileSync('sync.js', 'utf8');

// Fix 1: replace remaining disableProduct calls with deleteProduct
code = code.replace(/disableProduct\(/g, 'deleteProduct(');

// Fix 2: validate EAN - only send if it's 12-13 digits
code = code.replace(
  '...(variant.barcode ? { ean: [{ data: variant.barcode }] } : {}),',
  '...(variant.barcode && /^[0-9]{12,13}$/.test(variant.barcode.trim()) ? { ean: [{ data: variant.barcode.trim() }] } : {}),'
);

fs.writeFileSync('sync.js', code);
console.log('Done');
