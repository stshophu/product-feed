function calculatePrice(originalPrice, compareAt, markupRate) {
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
