const fs = require('fs');
let code = fs.readFileSync('shopify.js', 'utf8');

// Fix: don't pass updated_at_min when page_info is present
code = code.replace(
  `    const params = {
      limit: 250,
      fields: "id,title,body_html,variants,images,status,vendor,product_type,updated_at",
      ...extraParams,
    };
    if (page_info) params.page_info = page_info;`,
  `    const params = {
      limit: 250,
      fields: "id,title,body_html,variants,images,status,vendor,product_type,updated_at",
      ...(page_info ? {} : extraParams),
    };
    if (page_info) params.page_info = page_info;`
);

fs.writeFileSync('shopify.js', code);
console.log('Done');
