const WSNL_COMMISSION = 0.74;
const TARGET_MARGIN = 1.40;

function calculatePrice(originalPrice, compareAt, markupRate, cost, shipping) {
  // Cost-based pricing (3140 Warehouse)
  if (cost && cost > 0 && shipping !== undefined) {
    const targetPrice = parseFloat(((cost + shipping) * TARGET_MARGIN / WSNL_COMMISSION).toFixed(2));
    if (compareAt && compareAt > targetPrice) {
      return { price: parseFloat(compareAt.toFixed(2)), specialPrice: targetPrice };
    }
    return { price: targetPrice, specialPrice: null };
  }

  // Pass-through pricing (3171, RewixSync)
  const marked = parseFloat((originalPrice * (1 + markupRate)).toFixed(2));
  if (!compareAt || compareAt <= 0) {
    return { price: marked.toFixed(2), specialPrice: null };
  }
  if (marked >= compareAt) {
    return { price: compareAt.toFixed(2), specialPrice: null };
  }
  return { price: compareAt.toFixed(2), specialPrice: marked.toFixed(2) };
}

module.exports = { calculatePrice };
