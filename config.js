module.exports = {
  locations: {
    "3171 Warehouse": { markup: 0, shipping: 15 },
    // 3170 Warehouse (Loxuno) switched from cost-based to pass-through
    // pricing - sends Shopify's own Variant Price / Compare At Price as-is,
    // same as 3171/3140. Low-margin products are filtered out live by
    // sync.js's profit check (see pricing.js meetsMinProfit), not by
    // recalculating price from cost anymore.
    "3170 Warehouse": { markup: 0, shipping: 15 },
    // 3140 Warehouse (Tluxy/Channable) is back in scope for WSNL - we no
    // longer blanket-exclude the whole location. Pass-through pricing like
    // the others. Low-margin products are filtered out live by sync.js's
    // profit check (see pricing.js meetsMinProfit).
    "3140 Warehouse": { markup: 0, shipping: 15 },
  },
  shopifyApiVersion: "2025-01",
  defaultLocale: "nl_NL",
  secondaryLocale: "en_US",
};
