const fs = require('fs');
let code = fs.readFileSync('sync.js', 'utf8');

// Don't send size for categories where size is not applicable
code = code.replace(
  'if (cleanSize && !colorWords.test(cleanSize)) payload.values.size = [{ data: cleanSize }];',
  `const noSizeCategories = ["219", "253", "140", "678", "7850", "7851"]; // accessories, bags
  const productCategory = getCategoryCode(product.product_type, product.tags);
  if (cleanSize && !colorWords.test(cleanSize) && !noSizeCategories.includes(productCategory)) {
    payload.values.size = [{ data: cleanSize }];
  }`
);

fs.writeFileSync('sync.js', code);
console.log('Done');
