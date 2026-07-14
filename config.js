module.exports = {
  locations: {
    "3171 Warehouse": { markup: 0, shipping: 15 },
    "3170 Warehouse": { markup: 0, shipping: 15, costBased: true },
    // 3140 Warehouse (Tluxy/Channable) intentionally removed - no longer
    // synced to Marketplace. Any variant whose only stock is at 3140 will
    // fall out of `allowedLocationIds` in sync.js and get disabled+removed
    // from Marketplace on the next full sync run.
  },
  shopifyApiVersion: "2025-01",
  defaultLocale: "nl_NL",
  secondaryLocale: "en_US",
};
