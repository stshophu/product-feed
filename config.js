module.exports = {
  locations: {
    // 13 Nov 2026: WSNL carries Rewix (3169), Loxuno (3170) and Hanau/LH8
    // (3171). Tluxy (3140) was removed on request - variants stocked only
    // there are deleted from WSNL by the next sync.
    //
    // Both are pass-through: Shopify's own Variant Price / Compare At Price
    // are sent as-is. Every variant must pass sync.js's live profit check
    // (pricing.js meetsMinProfit: >= MIN_PROFIT_EUR after WSNL commission,
    // VAT and fixed cost, using the Shopify cost price) before it is sent;
    // anything below is deleted from WSNL instead.
    "3169 Warehouse": { markup: 0, shipping: 15 },
    "3170 Warehouse": { markup: 0, shipping: 15 },
    // Hanau office stock: always listed, even below the profit minimum
    // (see sync.js), so it sells off.
    "3171 Warehouse": { markup: 0, shipping: 15 },
  },
  shopifyApiVersion: "2025-01",
  defaultLocale: "nl_NL",
  secondaryLocale: "en_US",
};
