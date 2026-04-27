const fs = require('fs');
let code = fs.readFileSync('sync.js', 'utf8');

// Remove the broken stripHtml function if it exists
code = code.replace(/\nfunction stripHtml[\s\S]*?\n\}\n/, '\n');

// Add require for striphtml module
code = code.replace(
  'const { findColor } = require("./colormap");',
  'const { findColor } = require("./colormap");\nconst { stripHtml } = require("./striphtml");'
);

// Use stripHtml in description
code = code.replace(
  'data: product.body_html || product.title, locale: config.defaultLocale',
  'data: stripHtml(product.body_html) || product.title, locale: config.defaultLocale'
);
code = code.replace(
  'data: product.body_html || product.title, locale: config.secondaryLocale',
  'data: stripHtml(product.body_html) || product.title, locale: config.secondaryLocale'
);

fs.writeFileSync('sync.js', code);
console.log('Done');
