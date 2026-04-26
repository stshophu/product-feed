const fs = require('fs');
let code = fs.readFileSync('sync.js', 'utf8');

// Fix 1: buildPayload accepts brandCode
code = code.replace(
  'function buildPayload({ product, variant, images, price, specialPrice, quantity }) {',
  'function buildPayload({ product, variant, images, price, specialPrice, quantity, brandCode }) {'
);

// Fix 2: insert brandCode check before calculatePrice and pass to buildPayload
code = code.replace(
  '        const { price, specialPrice } = calculatePrice(originalPrice, compareAt, markupRate);',
  '        const brandCode = findBrandCode(product.vendor);\n        if (!brandCode) { stats.skipped++; continue; }\n        const { price, specialPrice } = calculatePrice(originalPrice, compareAt, markupRate);'
);

// Fix 3: pass brandCode to buildPayload
code = code.replace(
  'const payload = buildPayload({ product, variant, images, price, specialPrice, quantity: stockQuantity });',
  'const payload = buildPayload({ product, variant, images, price, specialPrice, quantity: stockQuantity, brandCode });'
);

fs.writeFileSync('sync.js', code);
console.log('Done');
