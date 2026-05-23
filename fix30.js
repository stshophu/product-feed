const fs = require('fs');

// Remove 3170 from config.js
let config = fs.readFileSync('config.js', 'utf8');
config = config.replace(/\s*"3170 Warehouse":\s*\{[^}]+\},?\n?/g, '\n');
fs.writeFileSync('config.js', config);
console.log('Removed 3170 from config.js');

// Remove supplier blacklist from sync.js
let sync = fs.readFileSync('sync.js', 'utf8');
sync = sync.replace(/const supplierBlacklist.*\n/g, '');
sync = sync.replace(/\/\/ Skip products in supplier.*\n.*inSupplierFeed.*\n.*supplierBlacklist.*\n.*\n.*stats\.skipped\+\+.*\n.*continue.*\n.*\}/g, '');
fs.writeFileSync('sync.js', sync);
console.log('Removed supplier blacklist from sync.js');

console.log('Done');
