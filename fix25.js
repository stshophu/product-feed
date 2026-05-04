const fs = require('fs');
let code = fs.readFileSync('sync.js', 'utf8');

// Skip products that require EAN but don't have one
// Categories that require EAN on Winkelstraat: jackets, shoes, etc.
const eanRequiredCategories = ['609', '24', '114', '199', '255', '92', '618', '612', '615', '617'];

code = code.replace(
  '        const brandCode = findBrandCode(product.vendor);',
  `        const brandCode = findBrandCode(product.vendor);`
);

// Add EAN check before upsert
code = code.replace(
  `        try {
          await upsertProduct(payload);`,
  `        // Skip if EAN required but missing
        const eanRequired = ["609","24","114","199","255","92","618","612","615","617"].includes(payload.category);
        const hasEan = payload.values.ean && payload.values.ean[0]?.data;
        if (eanRequired && !hasEan) {
          stats.skipped++;
          continue;
        }
        try {
          await upsertProduct(payload);`
);

fs.writeFileSync('sync.js', code);
console.log('Done');
