const fs = require('fs');
let code = fs.readFileSync('shopify.js', 'utf8');
code = code.replace(
  'var params = Object.assign({ limit: 250, fields: "id,title,body_html,variants,images,status,vendor,product_type,updated_at" }, extraParams);',
  'var params = Object.assign({ limit: 250, fields: "id,title,body_html,variants,images,status,vendor,product_type,updated_at" }, page_info ? {} : extraParams);'
);
fs.writeFileSync('shopify.js', code);
console.log('Done');
