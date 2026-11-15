// ---------------------------------------------------------------------------
// Core constants
// ---------------------------------------------------------------------------
const WSNL_COMMISSION     = 0.26;   // WSNL takes 26% of the selling price
const NL_VAT_RATE         = 0.21;   // Dutch consumer VAT (OSS obligation)
const NL_VAT_FRACTION     = NL_VAT_RATE / (1 + NL_VAT_RATE); // 17.355% of gross
const WSNL_KEEP_RATE      = 1 - WSNL_COMMISSION - NL_VAT_FRACTION; // 0.56645

const MARKETPLACE_COMMISSION = 1 - WSNL_COMMISSION; // kept for legacy callers (0.74)
const TARGET_MARGIN           = 1.40;
const MIN_PROFIT_EUR          = 50;   // minimum profit per item on WSNL (13 Nov 2026: raised from 20 - returns)
const FIXED_COST_EUR          = 15;   // flat per-item handling cost (regular listings)
const FIXED_COST_CLEARANCE    = 0;    // no fixed cost for clearance/override-priced items

// ---------------------------------------------------------------------------
// WSNL SKU price overrides (clearance / sell-out pricing)
// ---------------------------------------------------------------------------
// These are WSNL-specific prices, pushed only to WSNL — Shopify prices are
// unchanged. Calculated as: cost / WSNL_KEEP_RATE (break-even, no fixed cost).
// To update: add or change a SKU entry below and re-run sync.
// Generated: Aug 2026 clearance analysis (39 LH8 products).
// ---------------------------------------------------------------------------
const WSNL_PRICE_OVERRIDES = {
  // Clearance batch — Aug 2026. 42 LH8 SKUs.
  // Formula: cost / 0.56645  (break-even, €0 profit, no fixed shipping cost).
  // Shopify prices are NOT changed — these prices go to WSNL only.
  "a03594-sleenker-blue-LH8":           143.53,
  "d515-lh8":                            344.25,
  "FIPS214_C60FAE5-LH8":                 58.26,
  "23saxp72-lh8":                         38.84,
  "lp-polo-lana-bluette-M-LH8":          308.94,
  "ice3mbm12-lh8":                        45.90,  // already viable — floor price
  "mpf25-jts001-09bianco-LH8":           121.81,
  "S6QUEENS01NUB_BLNVYBRW_43-lh8":        79.44,
  "46418-LH8":                            511.96,
  "np0a4hl8-lh8":                          79.44,
  "REWIXSYNCRM-32968-LH8":               123.58,
  "35802-LH8":                            116.52,
  "35803-LH8":                            116.52,
  "12966 T_UNI - LH8":                   677.91,
  "REWIXSYNCRM-44885-LH":               1802.47,
  "JKT3478-LH8":                          496.08,
  "TSH90053-Lh8":                         157.12,
  "TSH90054-LH8":                         157.12,
  "TSH91219-LH8":                         218.03,
  "38428-LH8":                             26.48,
  "SYNCRM-44694-LH8":                     229.50,
  "SYNCRM-44695-LH8":                     229.50,
  "FW2736-153943-LH8":                    122.69,
  "CRM-35625-LH8":                        348.67,
  "331515-LH":                            643.43,
  "315387-LH":                           1170.46,
  "o045_m8ou-0710-LH":                     70.62,
  "67821_1273-LH":                        618.21,
  "87480U_PISANO_1030BluScuro-LH":        294.38,
  "fw23ho-LH8":                           398.43,
  "DOLT4050-LH":                         2358.56,
  "LH8-36399-LH-M":                        35.31,
  "PAN74567-LH":                           190.70,
  "316903-LH":                             561.39,  // Jimmy Choo — viable at current price too
  // "TSH84558-LH" excluded — D&G polo stays at current Shopify price (€719)
  "DW0DW14661-LH":                         176.54,
  "YZ-36247-LH":                            95.33,
  "BY-CE1878723-LH":                       194.19,
  "CLEVELANDPARKA_BL3989-LH":             741.46,
  "F84458-LH":                           1428.20,
  "LH8-26779":                             129.65,
  "BEL9459-LH":                            215.38,
};

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
  "balmain":          35,
  "balenciaga":       35,
  "dolce & gabbana":  50,
  "off-white":        50,
  "dsquared2":        50,
  "maison margiela":  50,
  "bally":            50,
};

const WSNL_DISCOUNT_VENDOR_ALIASES = {
  "balmain":          "balmain",
  "balenciaga":       "balenciaga",
  "dolce & gabbana":  "dolce & gabbana",
  "off-white":        "off-white",
  "off white":        "off-white",
  "dsquared2":        "dsquared2",
  "maison margiela":  "maison margiela",
  "bally":            "bally",
};

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

const MIN_WSNL_DISCOUNT_PROFIT_EUR = MIN_PROFIT_EUR; // legacy name

// ---------------------------------------------------------------------------
// getWsnlPriceOverride(sku)
// ---------------------------------------------------------------------------
// Returns the clearance override price for a SKU if one exists, else null.
// When a non-null price is returned, sync.js should use it directly as the
// WSNL selling price and skip the normal calculatePrice() path.
// The override price already covers cost + commission + VAT at break-even.
function getWsnlPriceOverride(sku) {
  if (!sku) return null;
  return WSNL_PRICE_OVERRIDES[sku] ?? null;
}

// ---------------------------------------------------------------------------
// calculateWsnlDiscountPrice
// ---------------------------------------------------------------------------
function calculateWsnlDiscountPrice(vendor, originalPrice, compareAt, cost) {
  const brand = findWsnlDiscountBrand(vendor);
  if (!brand) return null;
  if (cost === null || cost === undefined || cost <= 0) return null;

  const requestedPct = WSNL_BRAND_DISCOUNTS[brand];
  const hasRrp = compareAt && compareAt > originalPrice;
  const rrp = hasRrp ? compareAt : originalPrice;
  if (!rrp || rrp <= 0) return null;

  // Breakeven uses the correct VAT-aware keep rate
  const breakevenPct = Math.max(0, (1 - cost / (rrp * WSNL_KEEP_RATE)) * 100);
  const appliedPct   = Math.min(requestedPct, breakevenPct);
  const capped       = appliedPct < requestedPct;

  const specialPrice = parseFloat((rrp * (1 - appliedPct / 100)).toFixed(2));
  const price        = parseFloat(rrp.toFixed(2));
  const profit       = parseFloat((specialPrice * WSNL_KEEP_RATE - cost).toFixed(2));

  if (profit < MIN_WSNL_DISCOUNT_PROFIT_EUR) {
    return { excluded: true, brand, profit, requestedPct, appliedPct: parseFloat(appliedPct.toFixed(1)) };
  }

  return { price, specialPrice, brand, requestedPct, appliedPct: parseFloat(appliedPct.toFixed(1)), capped, profit };
}


// ---------------------------------------------------------------------------
// computeWsnlListing  (Rewix 3169 + Loxuno 3170, from 13 Nov 2026)
// ---------------------------------------------------------------------------
// Every item goes to WSNL at full price (RRP = Shopify compare-at, or the
// Shopify price if there is none) with a sale price on top:
//
//   target discount = brand discount (WSNL_BRAND_DISCOUNTS) or DEFAULT 30%,
//                     + BF extra 5% for WSNL's requested brands until BF_END
//   floor price     = (cost + FIXED_COST_EUR + MIN_PROFIT_EUR) / WSNL_KEEP_RATE
//   applied         = min(target, the discount that still keeps the floor)
//   applied < MIN_DISCOUNT_PCT  -> excluded (would barely show a discount)
//   no cost price               -> excluded (profit can't be checked)
//
// So the profit check runs on the final discounted price, after commission,
// NL VAT and the fixed per-item cost. Hanau (3171) does not use this.
const DEFAULT_DISCOUNT_PCT = 30;
const MIN_DISCOUNT_PCT     = 10;
// Lift locations (Loxuno/Tluxy): WSNL price may be at most this much above
// the shop price; cheap items that would need more are not listed.
const MAX_LIFT_PCT         = 30;
const BF_EXTRA_PCT         = 5;
const BF_END               = new Date("2026-12-01T00:00:00+01:00"); // extra 5% until end of 30 Nov (NL time)
const BF_EXTRA_BRANDS      = new Set([
  "palm angels", "dsquared2", "balenciaga", "saint laurent", "dolce & gabbana", "marc jacobs",
]);

function computeWsnlListing({ vendor, shopPrice, compareAt, cost, now = new Date(), minProfit = MIN_PROFIT_EUR, lift = false }) {
  if (!cost || cost <= 0) return { excluded: true, reason: "no cost price in Shopify" };
  const rrp = compareAt && compareAt > shopPrice ? compareAt : shopPrice;
  if (!rrp || rrp <= 0) return { excluded: true, reason: "no price" };

  const v = (vendor || "").toLowerCase().trim();
  const brand = findWsnlDiscountBrand(vendor);
  let targetPct = brand ? WSNL_BRAND_DISCOUNTS[brand] : DEFAULT_DISCOUNT_PCT;
  const bfExtra = now < BF_END && !WSNL_DISCOUNT_EXCLUDED_VENDORS.has(v) && BF_EXTRA_BRANDS.has(v);
  if (bfExtra) targetPct += BF_EXTRA_PCT;

  const floorPrice = (cost + FIXED_COST_EUR + minProfit) / WSNL_KEEP_RATE;
  const maxPct = (1 - floorPrice / rrp) * 100;
  const appliedPct = Math.min(targetPct, maxPct);
  if (appliedPct < MIN_DISCOUNT_PCT) {
    if (lift) {
      // No room for a real discount (Loxuno/Tluxy have no true RRP): list at
      // the price that clears minProfit, never below the shop price. Show the
      // shop price/RRP as was-price only if it is still above that.
      const liftPrice = Math.ceil(Math.max(floorPrice, shopPrice) * 100) / 100;
      if (liftPrice > shopPrice * (1 + MAX_LIFT_PCT / 100)) {
        return { excluded: true, reason: `needs €${liftPrice} for €${minProfit} profit = +${((liftPrice / shopPrice - 1) * 100).toFixed(0)}% over shop price (max +${MAX_LIFT_PCT}%)` };
      }
      const wasPrice = rrp > liftPrice ? parseFloat(rrp.toFixed(2)) : liftPrice;
      const profit = parseFloat((liftPrice * WSNL_KEEP_RATE - cost - FIXED_COST_EUR).toFixed(2));
      return {
        price: wasPrice, specialPrice: wasPrice > liftPrice ? liftPrice : null, profit,
        targetPct, appliedPct: wasPrice > liftPrice ? parseFloat(((1 - liftPrice / wasPrice) * 100).toFixed(1)) : 0,
        capped: true, bfExtra: false, lifted: liftPrice > shopPrice,
        liftPct: parseFloat(((liftPrice / shopPrice - 1) * 100).toFixed(1)),
      };
    }
    return { excluded: true, reason: `max ${Math.max(0, maxPct).toFixed(1)}% off RRP at €${minProfit} profit (min ${MIN_DISCOUNT_PCT}%)` };
  }
  // round the sale price UP to the cent so rounding never dips below the floor
  const specialPrice = Math.ceil(rrp * (1 - appliedPct / 100) * 100) / 100;
  const profit = parseFloat((specialPrice * WSNL_KEEP_RATE - cost - FIXED_COST_EUR).toFixed(2));
  return {
    price: parseFloat(rrp.toFixed(2)), specialPrice, profit,
    targetPct, appliedPct: parseFloat(appliedPct.toFixed(1)),
    capped: appliedPct < targetPct, bfExtra,
  };
}

// ---------------------------------------------------------------------------
// calculatePrice  (pass-through and cost-based)
// ---------------------------------------------------------------------------
function calculatePrice(originalPrice, compareAt, markupRate, cost, shipping) {
  // Cost-based pricing (3170 Warehouse)
  if (cost && cost > 0 && shipping !== undefined) {
    const targetPrice = parseFloat(((cost + shipping) * TARGET_MARGIN / WSNL_KEEP_RATE).toFixed(2));
    if (compareAt && compareAt > targetPrice) {
      return { price: parseFloat(compareAt.toFixed(2)), specialPrice: targetPrice };
    }
    return { price: targetPrice, specialPrice: null };
  }

  // Pass-through pricing (3171, 3140)
  const marked = parseFloat((originalPrice * (1 + markupRate)).toFixed(2));
  if (compareAt && compareAt > marked) {
    return { price: compareAt.toFixed(2), specialPrice: marked.toFixed(2) };
  }
  return { price: marked.toFixed(2), specialPrice: null };
}

// ---------------------------------------------------------------------------
// meetsMinProfit
// ---------------------------------------------------------------------------
// Uses the correct VAT-aware keep rate: price × WSNL_KEEP_RATE - cost - fixed.
// Override-priced items pass their own threshold check in sync.js separately.
function meetsMinProfit(price, specialPrice, cost) {
  const effectivePrice = parseFloat(specialPrice ?? price);
  const profit = parseFloat(
    (effectivePrice * WSNL_KEEP_RATE - (cost || 0) - FIXED_COST_EUR).toFixed(2)
  );
  return { ok: profit >= MIN_PROFIT_EUR, profit };
}

module.exports = {
  computeWsnlListing,
  calculatePrice,
  meetsMinProfit,
  calculateWsnlDiscountPrice,
  findWsnlDiscountBrand,
  getWsnlPriceOverride,
  MARKETPLACE_COMMISSION,
  WSNL_COMMISSION,
  WSNL_KEEP_RATE,
  NL_VAT_FRACTION,
  MIN_PROFIT_EUR,
  MIN_WSNL_DISCOUNT_PROFIT_EUR,
  FIXED_COST_EUR,
};
