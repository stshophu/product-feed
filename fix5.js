const fs = require('fs');
let code = fs.readFileSync('sync.js', 'utf8');
code = code.replace(
  "payload.values.color = [{ data: variant.option2.replace(/[_-]/g, \" \") }];",
  "payload.values.color = [{ data: findColor(variant, product.tags) }];"
);
fs.writeFileSync('sync.js', code);
console.log('Done');
