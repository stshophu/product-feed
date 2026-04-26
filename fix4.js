const fs = require('fs');
let code = fs.readFileSync('sync.js', 'utf8');

// Add colormap require
code = code.replace(
  'const { findBrandCode } = require("./brandmap");',
  'const { findBrandCode } = require("./brandmap");\nconst { findColor } = require("./colormap");'
);

// Replace the color detection block
code = code.replace(
  `const sizePattern = /^(xs|s|m|l|xl|xxl|xxxl|xxxxxl|xxxxl|xxxs|xxs|one size|\\d+|\\d+\\.\\d+)$/i;
  const colorValue = (variant.option2 && !sizePattern.test(variant.option2.trim()))
    ? variant.option2.replace(/[_-]/g, " ")
    : (variant.option1 && !sizePattern.test(variant.option1.trim()) ? variant.option1.replace(/[_-]/g, " ") : "other");
  payload.values.color = [{ data: colorValue }];`,
  'payload.values.color = [{ data: findColor(variant, product.tags) }];'
);

fs.writeFileSync('sync.js', code);
console.log('Done');
