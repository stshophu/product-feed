const fs = require('fs');
let code = fs.readFileSync('sync.js', 'utf8');

// Only set color if it looks like a color (not a size like XL, S, M, etc.)
code = code.replace(
  "if (variant.option2) payload.values.color = [{ data: variant.option2.replace(/[_-]/g, \" \") }];",
  `const sizePattern = /^(xs|s|m|l|xl|xxl|xxxl|xxxxxl|xxxxl|xxxs|xxs|one size|\\d+|\\d+\\.\\d+)$/i;
  if (variant.option2 && !sizePattern.test(variant.option2.trim())) {
    payload.values.color = [{ data: variant.option2.replace(/[_-]/g, " ") }];
  }`
);

fs.writeFileSync('sync.js', code);
console.log('Done');
