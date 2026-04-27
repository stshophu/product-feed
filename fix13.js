const fs = require('fs');
let code = fs.readFileSync('sync.js', 'utf8');

// Add color check to size detection - if option1 is a color word, skip it as size
code = code.replace(
  `  const option1isSze = variant.option1 && sizePattern.test(variant.option1.trim());`,
  `  const colorWords = /^(black|white|blue|red|green|gray|grey|beige|brown|pink|orange|yellow|purple|gold|silver|navy|nude|nero|bianco|rosso|verde|blu|rosa|arancione|giallo|viola|marrone|beige|camel|cream|ivory|coral|taupe|khaki|olive|mint|teal|cyan|metallic|multicolor|multi|print|animal)$/i;
  const option1isSze = variant.option1 && sizePattern.test(variant.option1.trim()) && !colorWords.test(variant.option1.trim());`
);

// If no size found, don't send size field at all (some products like scarves/blankets have no size)
code = code.replace(
  'if (sizeValue) payload.values.size = [{ data: sizeValue.replace(/,/g, ".").replace(/^one size$/i, "one_size") }];',
  `const cleanSize = sizeValue ? sizeValue.replace(/,/g, ".").replace(/^one size$/i, "one_size") : null;
  if (cleanSize && !colorWords.test(cleanSize)) payload.values.size = [{ data: cleanSize }];`
);

fs.writeFileSync('sync.js', code);
console.log('Done');
