// Map common color words → Winkelstraat color codes
const colorKeywords = {
  'black': 'black', 'nero': 'black', 'schwarz': 'black', 'noir': 'black',
  'white': 'white', 'bianco': 'white', 'weiss': 'white', 'blanc': 'white', 'cream': 'white', 'ivory': 'white', 'off-white': 'white', 'offwhite': 'white',
  'blue': 'blue', 'blu': 'blue', 'blau': 'blue', 'bleu': 'blue', 'cobalt': 'blue', 'sapphire': 'blue', 'electric blue': 'blue',
  'darkblue': 'darkblue', 'dark blue': 'darkblue', 'navy': 'darkblue', 'marine': 'darkblue', 'midnight': 'darkblue', 'indigo': 'darkblue',
  'lightblue': 'lightblue', 'light blue': 'lightblue', 'sky': 'lightblue', 'sky blue': 'lightblue', 'powder blue': 'lightblue', 'baby blue': 'lightblue',
  'red': 'red', 'rosso': 'red', 'rot': 'red', 'rouge': 'red', 'burgundy': 'red', 'wine': 'red', 'cherry': 'red', 'scarlet': 'red', 'crimson': 'red',
  'green': 'green', 'verde': 'green', 'grun': 'green', 'vert': 'green', 'forest': 'green', 'forest green': 'green', 'olive': 'green', 'khaki': 'green', 'sage': 'green', 'mint': 'green',
  'darkgreen': 'darkgreen', 'dark green': 'darkgreen', 'bottle green': 'darkgreen', 'hunter green': 'darkgreen',
  'lightgreen': 'lightgreen', 'light green': 'lightgreen', 'lime': 'lightgreen', 'neon green': 'lightgreen',
  'gray': 'gray', 'grey': 'gray', 'grigio': 'gray', 'grau': 'gray', 'gris': 'gray',
  'darkgray': 'darkgray', 'dark gray': 'darkgray', 'dark grey': 'darkgray', 'charcoal': 'darkgray', 'anthracite': 'darkgray',
  'lightgray': 'lightgray', 'light gray': 'lightgray', 'light grey': 'lightgray', 'silver gray': 'lightgray',
  'beige': 'beige', 'sand': 'beige', 'camel': 'beige', 'caramel': 'beige', 'nude': 'beige', 'natural': 'beige', 'ecru': 'beige',
  'brown': 'brown', 'marrone': 'brown', 'braun': 'brown', 'brun': 'brown', 'chocolate': 'brown', 'cognac': 'brown', 'tan': 'brown', 'tobacco': 'brown', 'rust': 'brown',
  'pink': 'pink', 'rosa': 'pink', 'fuchsia': 'pink', 'blush': 'pink', 'rose': 'pink', 'salmon': 'pink', 'coral': 'pink', 'hot pink': 'pink',
  'orange': 'orange', 'arancione': 'orange', 'orange': 'orange', 'burnt orange': 'orange', 'terracotta': 'orange',
  'yellow': 'yellow', 'giallo': 'yellow', 'gelb': 'yellow', 'jaune': 'yellow', 'mustard': 'yellow', 'gold yellow': 'yellow',
  'purple': 'purple', 'viola': 'purple', 'lila': 'purple', 'violet': 'purple', 'lavender': 'purple', 'plum': 'purple', 'lilac': 'purple',
  'gold': 'gold', 'oro': 'gold', 'golden': 'gold',
  'silver': 'silver', 'argento': 'silver', 'silber': 'silver',
  'metallic': 'metallic', 'metal': 'metallic', 'chrome': 'metallic',
  'taupe': 'taupe', 'mocha': 'taupe', 'mushroom': 'taupe',
  'maroon': 'maroon', 'bordeaux': 'maroon', 'bordo': 'maroon',
  'neutral': 'neutral', 'multi': 'divers', 'multicolor': 'divers', 'multicolour': 'divers', 'mixed': 'divers', 'print': 'divers', 'pattern': 'divers',
  'animal': 'animal_print', 'animal print': 'animal_print', 'leopard': 'animal_print', 'zebra': 'animal_print', 'snake': 'animal_print', 'tiger': 'animal_print',
  'cyan': 'cyan', 'turquoise': 'cyan', 'teal': 'cyan', 'aqua': 'cyan',
};

function findColor(variant, tags) {
  const sources = [];

  // Check option1 and option2
  if (variant.option1) sources.push(variant.option1.toLowerCase().trim());
  if (variant.option2) sources.push(variant.option2.toLowerCase().trim());
  if (variant.option3) sources.push(variant.option3.toLowerCase().trim());

  // Check tags
  const tagList = (Array.isArray(tags) ? tags : (tags || '').split(',')).map(t => t.toLowerCase().trim());
  sources.push(...tagList);

  for (const source of sources) {
    // Exact match
    if (colorKeywords[source]) return colorKeywords[source];
    // Partial match
    for (const [keyword, code] of Object.entries(colorKeywords)) {
      if (source.includes(keyword)) return code;
    }
  }

  return 'divers'; // fallback
}

module.exports = { findColor };
