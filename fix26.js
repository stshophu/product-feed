const fs = require('fs');
let code = fs.readFileSync('sync.js', 'utf8');

code = code.replace(
  /const sizePattern = \/\^.*?\$\/i;/,
  'const sizePattern = /^(xs|s|m|l|xl|xxl|xxxl|xxxxl|xxxxxl|3xl|4xl|5xl|xxxs|xxs|one.?size|one_size|uni|unica|taille.?unique|\\d+[yY]|\\d+[mM]|\\d+[\\/\\-]\\d+|\\d+[\\.\\,]?\\d*|one_size)$/i;'
);

fs.writeFileSync('sync.js', code);
console.log('Done');
