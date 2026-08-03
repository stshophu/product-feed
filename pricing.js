const MARKETPLACE_COMMISSION = 0.76; // retailer keeps 76% of the sale price - WSNL takes 24% (lowered from 26% Aug 2026)
const TARGET_MARGIN = 1.40;
const MIN_PROFIT_EUR = 25;   // WSNL "makes sense to sell" threshold, adjust here if it changes
const FIXED_COST_EUR = 15;   // flat per-item cost (packaging/handling/etc) deducted from profit

// ---------------------------------------------------------------------------
// WSNL negotiated sale-period brand discounts (Aug 2026)
// ---------------------------------------------------------------------------
// Applies ONLY to these 7 brands, agreed with WSNL after the pricing review.
// Jacquemus, Saint Laurent, Chloé, and Burberry were excluded from this deal
// - their margins can't sustain a brand-wide discount at 24% commission, see
// the analysis from the pricing negotiation for details.
//
// Discount is off RRP (Shopify's Compare At Price, falling back to Variant
// Price when no Compare At is set), capped per item so it never sells below
// cost - the brand-wide % is only a ceiling, not a fixed price cut.
const WSNL_BRAND_DISCOUNTS = {
  "balmain": 35,
  "balenciaga": 35,
  "dolce & gabbana": 50,
  "off-white": 50,
  "dsquared2": 50,
  "maison margiela": 50,
  "bally": 50,
};

// Vendor-string variants (as they appear in Shopify's Vendor field) mapped to
// the canonical WSNL_BRAND_DISCOUNTS key. Add new variants here as they show
// up - case differences, apostrophes, etc. Sub-lines that should NOT get the
// brand discount (different pricing tier) are intentionally left unmapped.
const WSNL_DISCOUNT_VENDOR_ALIASES = {
  "balmain": "balmain",
  "balenciaga": "balenciaga",
  "dolce & gabbana": "dolce & gabbana",
  "off-white": "off-white",
  "off white": "off-white",
  "dsquared2": "dsquared2",
  "maison margiela": "maison margiela",
  "bally": "bally",
};
// Vendor strings that look like one of the 7 brands but are a different
// pricing tier / collab and must NOT get the brand discount.
const WSNL_DISCOUNT_EXCLUDED_VENDORS = new Set([
  "balenciaga x adidas",
  "dsquared2 2°choice",
  "mm6 maison margiela",
]);

function findWsnlDiscountBrand(vendor) {
  if (!vendor) return null;
  const v = vendor.toLowerCase().trim();
  if (WSNL_DISCOUNT_EXCLUDED_VENDORS.has(v)) return null;
  return WSNL_DISCOUNT_VENDOR_ALIASES[v] || null;
}

const MIN_WSNL_DISCOUNT_PROFIT_EUR = 20; // items in the 7-brand deal below this profit (even at 0% discount) are excluded from WSNL entirely, not just capped

// Formula (see the Aug 2026 WSNL pricing negotiation):
//   RRP                = Compare At Price (if set and > Variant Price), else Variant Price
//   Breakeven Discount = max(0, 1 - Cost / (RRP * (1 - Commission)))
//   Applied Discount   = min(Brand Requested Discount, Breakeven Discount)
//   New WSNL Price     = RRP * (1 - Applied Discount)
//   Net Revenue        = New WSNL Price * (1 - Commission)
//   Profit             = Net Revenue - Cost
//
// Returns null if this vendor isn't one of the 7 approved brands, so callers
// can fall back to the normal calculatePrice() path unchanged.
// Returns { excluded: true, ... } if it IS one of the 7 brands but even the
// capped (breakeven-safe) price doesn't clear MIN_WSNL_DISCOUNT_PROFIT_EUR -
// callers should skip/disable the listing entirely rather than fall back to
// normal pricing, since the item genuinely isn't worth listing on WSNL.
function calculateWsnlDiscountPrice(vendor, originalPrice, compareAt, cost) {
  const brand = findWsnlDiscountBrand(vendor);
  if (!brand) return null;
  if (cost === null || cost === undefined || cost <= 0) return null;

  const requestedPct = WSNL_BRAND_DISCOUNTS[brand];
  const hasRrp = compareAt && compareAt > originalPrice;
  const rrp = hasRrp ? compareAt : originalPrice;
  if (!rrp || rrp <= 0) return null;

  const breakevenPct = Math.max(0, (1 - cost / (rrp * MARKETPLACE_COMMISSION)) * 100);
  const appliedPct = Math.min(requestedPct, breakevenPct);
  const capped = appliedPct < requestedPct;

  const specialPrice = parseFloat((rrp * (1 - appliedPct / 100)).toFixed(2));
  const price = parseFloat(rrp.toFixed(2));
  const profit = parseFloat((specialPrice * MARKETPLACE_COMMISSION - cost).toFixed(2));

  if (profit < MIN_WSNL_DISCOUNT_PROFIT_EUR) {
    return { excluded: true, brand, profit, requestedPct, appliedPct: parseFloat(appliedPct.toFixed(1)) };
  }

  return {
    price,
    specialPrice,
    brand,
    requestedPct,
    appliedPct: parseFloat(appliedPct.toFixed(1)),
    capped,
    profit,
  };
}


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

module.exports = {
  calculatePrice,
  meetsMinProfit,
  calculateWsnlDiscountPrice,
  findWsnlDiscountBrand,
  MARKETPLACE_COMMISSION,
  MIN_PROFIT_EUR,
  MIN_WSNL_DISCOUNT_PROFIT_EUR,
  FIXED_COST_EUR,
};
