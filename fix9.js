const fs = require('fs');
let code = fs.readFileSync('sync.js', 'utf8');

// Add HTML stripping function after requires
code = code.replace(
  'const isFullSync = process.argv.includes("--full");',
  `const isFullSync = process.argv.includes("--full");

function stripHtml(html) {
  if (!html) return "";
  return html
    .replace(/<br\s*\/?>/gi, "\\n")
    .replace(/<\/p>/gi, "\\n")
    .replace(/<\/div>/gi, "\\n")
    .replace(/<\/li>/gi, "\\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/\\n\\n+/g, "\\n")
    .trim();
}`
);

// Use stripHtml for description
code = code.replace(
  /description: \[\s*\{ data: product\.body_html \|\| product\.title, locale: config\.defaultLocale \},\s*\{ data: product\.body_html \|\| product\.title, locale: config\.secondaryLocale \}\s*\]/,
  'description: [\n        { data: stripHtml(product.body_html) || product.title, locale: config.defaultLocale },\n        { data: stripHtml(product.body_html) || product.title, locale: config.secondaryLocale }\n      ]'
);

fs.writeFileSync('sync.js', code);
console.log('Done');
