module.exports = {
  locations: {
    // WSNL locations (15 Nov 2026):
    //   3169 Rewix   - RRP (Italian retail price) as was-price + discount,
    //                  min EUR 50 profit, below 10% off RRP -> not listed.
    //   3170 Loxuno  - min EUR 30 profit. No real RRP in Shopify (compare-at
    //   3140 Tluxy     is empty or their own shop price), so the WSNL price is
    //                  raised to whatever clears EUR 30 - never below the
    //                  shop price - instead of being excluded ("lift").
    //   3171 Hanau   - office stock, always listed (see sync.js).
    // Profit = WSNL price x 0.56645 (26% commission, NL VAT) - cost - EUR 15.
    // maxCost (15 Nov 2026): Rewix is paid to the supplier when the order comes
    // in, WSNL pays out ~14 days later. To limit the cash tied up per order,
    // Rewix items with a cost price above EUR 600 are not listed on WSNL.
    "3169 Warehouse": { markup: 0, shipping: 15, minProfit: 50, maxCost: 600 },
    "3170 Warehouse": { markup: 0, shipping: 15, minProfit: 30, lift: true },
    "3140 Warehouse": { markup: 0, shipping: 15, minProfit: 30, lift: true },
    "3171 Warehouse": { markup: 0, shipping: 15 },
  },
  shopifyApiVersion: "2025-01",
  defaultLocale: "nl_NL",
  secondaryLocale: "en_US",
};
