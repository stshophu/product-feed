const fs = require('fs');

// Build supplier SKU blacklist from overlap analysis
const overlapProducts = JSON.parse(fs.readFileSync('3170_overlap_products.json', 'utf8'));
const supplierSkus = new Set(overlapProducts.map(p => p.sku).filter(Boolean));
const supplierBarcodes = new Set(overlapProducts.map(p => p.barcode).filter(Boolean));
console.log('Supplier blacklist - SKUs:', supplierSkus.size, '| Barcodes:', supplierBarcodes.size);

// Save blacklist
fs.writeFileSync('supplier_blacklist.json', JSON.stringify({
  skus: [...supplierSkus],
  barcodes: [...supplierBarcodes]
}, null, 2));
console.log('Saved supplier_blacklist.json');

// Update config.js to add 3170 back
let config = fs.readFileSync('config.js', 'utf8');
config = config.replace(
  '"3171 Warehouse": { markup: 0, shipping: 15 },',
  '"3171 Warehouse": { markup: 0, shipping: 15 },\n    "3170 Warehouse": { markup: 0, shipping: 15 },'
);
fs.writeFileSync('config.js', config);
console.log('Added 3170 Warehouse back to config.js');

// Update sync.js to filter supplier blacklist
let sync = fs.readFileSync('sync.js', 'utf8');

// Add blacklist require
sync = sync.replace(
  'const { findBrandCode } = require("./brandmap");',
  'const { findBrandCode } = require("./brandmap");\nconst supplierBlacklist = require("./supplier_blacklist.json");'
);

// Add blacklist check after brandCode check
sync = sync.replace(
  '        const brandCode = findBrandCode(product.vendor);\n        if (!brandCode) {\n          stats.skipped++;\n          continue;\n        }',
  `        const brandCode = findBrandCode(product.vendor);
        if (!brandCode) {
          stats.skipped++;
          continue;
        }
        // Skip products in supplier's Channable feed (they undercut us)
        const inSupplierFeed = (variant.sku && supplierBlacklist.skus.includes(variant.sku)) ||
                               (variant.barcode && supplierBlacklist.barcodes.includes(variant.barcode));
        if (inSupplierFeed) {
          stats.skipped++;
          continue;
        }`
);

fs.writeFileSync('sync.js', sync);
console.log('Done - sync.js updated with supplier blacklist filter');
