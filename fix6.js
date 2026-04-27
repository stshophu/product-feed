const fs = require('fs');
let code = fs.readFileSync('sync.js', 'utf8');

// Replace the size assignment with smarter detection
code = code.replace(
  "if (variant.option1) payload.values.size = [{ data: variant.option1 }];",
  `const sizePattern = /^(xs|s|m|l|xl|xxl|xxxl|xxxxl|xxxxxl|xxxs|xxs|one.?size|\\d+[\\.,]?\\d*|\\d+\\/\\d+|one_size)$/i;
  const option1isSze = variant.option1 && sizePattern.test(variant.option1.trim());
  const option2isSze = variant.option2 && sizePattern.test(variant.option2.trim());
  const sizeValue = option1isSze ? variant.option1 : (option2isSze ? variant.option2 : (variant.option1 || null));
  if (sizeValue) payload.values.size = [{ data: sizeValue }];`
);

fs.writeFileSync('sync.js', code);
console.log('Done');
