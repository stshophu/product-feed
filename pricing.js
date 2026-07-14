const MARKETPLACE_COMMISSION = 0.74; // retailer keeps 74% of the sale price - WSNL takes 26%
const TARGET_MARGIN = 1.40;
const MIN_PROFIT_EUR = 25;   // WSNL "makes sense to sell" threshold, adjust here if it changes
const FIXED_COST_EUR = 15;   // flat per-item cost (packaging/handling/etc) deducted from profit

function calculatePrice(originalPrice, compareAt, markupRate, cost, shipping) {
  // Cost-based pricing (3170 Warehouse)
  if (cost && cost > 0 && shipping !== undefined) {
    const targetPrice = parseFloat(((cost + shipping) * TARGET_MARGIN / MARKETPLACE_COMMISSION).toFixed(2));
    if (compareAt && compareAt > targetPrice) {
      return { price: parseFloat(compareAt.toFixed(2)), specialPrice: targetPrice };
    }
    return { price: targetPrice, specialPrice: null };
  }

  // Pass-through pricing (3171, 3140)
  const marked = parseFloat((originalPrice * (1 + markupRate)).toFixed(2));
  if (!compareAt || compareAt <= 0) {
    return { price: marked.toFixed(2), specialPrice: null };
  }
  if (marked >= compareAt) {
    return { price: compareAt.toFixed(2), specialPrice: null };
  }
  return { price: compareAt.toFixed(2), specialPrice: marked.toFixed(2) };
}

// Live margin check, run at sync time against whatever price/cost Shopify
// currently has - so new products get evaluated automatically, with no
// static list to keep in sync. Uses the actual price the customer would
// pay (specialPrice when one exists, otherwise price).
// Returns { ok, profit } so callers can log the reason for a skip.
function meetsMinProfit(price, specialPrice, cost) {
  const effectivePrice = parseFloat(specialPrice ?? price);
  const profit = parseFloat((effectivePrice * MARKETPLACE_COMMISSION - (cost || 0) - FIXED_COST_EUR).toFixed(2));
  return { ok: profit >= MIN_PROFIT_EUR, profit };
}

module.exports = { calculatePrice, meetsMinProfit, MARKETPLACE_COMMISSION, MIN_PROFIT_EUR, FIXED_COST_EUR };
