require("dotenv").config();
const {
  getAllProductsLight,
  getInventoryLevelsForLocations,
  buildLocationMap,
} = require("./shopify");
const { updateStock, deleteProduct } = require("./marketplace");

// Optional backstop only: sync.js now computes profit live against current
// Shopify price/cost every run, so it needs no static list and automatically
// catches new products. This light job still checks excluded_skus.json (if
// present) since it doesn't fetch cost and can't compute profit itself -
// it just avoids re-enabling stock on a SKU sync.js already excluded live.
// Safe to leave this file stale or delete it; nothing here depends on it
// being current.
let excludedSkus = new Set();
try {
  excludedSkus = new Set(require("./excluded_skus.json").skus);
  console.log(`🚫 Loaded ${excludedSkus.size} SKUs from optional exclusion backstop`);
} catch (e) {
  console.log("No excluded_skus.json found - relying on sync.js's live profit check only");
}

// ─────────────────────────────────────────────────────────────────────────
// Light stock sync
//
// Scope: ONLY 3170 Warehouse (Loxuno) and 3171 Warehouse (Hanau/LH8).
// 3140 Warehouse (Tluxy/Channable, cost-based pricing) is intentionally
// untouched by this job - it's the full sync's (sync.js) responsibility.
//
// What it does, per variant:
//   - has stock at 3140?              -> SKIP entirely (not this job's listing)
//   - stock > 0 at 3170 and/or 3171?  -> PATCH quantity (Marketplace enabled: true)
//   - otherwise                       -> disable + delete the Marketplace listing
//
// What it deliberately does NOT do:
//   - never builds price/images/description/category/brand
//   - never creates a new Marketplace listing (404 on PATCH is left for full sync)
//
// This keeps the request tiny (one small PATCH per touched variant instead
// of a full payload) and avoids the Marketplace rate-limit issue noted in sync.js.
// ─────────────────────────────────────────────────────────────────────────

// 13 Nov 2026: WSNL = Rewix (3169) + Loxuno (3170) + Hanau (3171). Tluxy
// (3140) is no longer on WSNL, so there is no "owned by the full sync"
// exclusion any more: anything without stock here is deleted.
const LIGHT_SYNC_LOCATIONS = ["3170 Warehouse", "3169 Warehouse", "3171 Warehouse"];
const EXCLUDED_LOCATION = null;

const MARKETPLACE_PACING_MS = 50;

// Changes-only mode (14 Nov 2026). Going through all ~10,000 variants every
// run took 60-100 min, which kept the shared "marketplace-api" queue blocked
// so most catalog syncs were cancelled while waiting. Now a run only touches
// variants whose stock level (Shopify inventory_level.updated_at) or product
// (status/variants -> product.updated_at) changed in the last LOOKBACK_HOURS.
// Once a night (03:00-03:29 UTC run), or with LIGHT_FULL=1, it does the old
// complete pass as a safety net.
const LOOKBACK_HOURS = parseFloat(process.env.LIGHT_LOOKBACK_HOURS || "3");
function isFullPass() {
  if (process.env.LIGHT_FULL === "1") return true;
  const now = new Date();
  return now.getUTCHours() === 3 && now.getUTCMinutes() < 30;
}
async function paced(fn) {
  await new Promise((r) => setTimeout(r, MARKETPLACE_PACING_MS));
  return fn();
}

async function syncStockLight() {
  console.log("═══════════════════════════════════════════════════");
  console.log("🔄 LIGHT stock sync started (3169 Rewix + 3170 Loxuno + 3171 Hanau)");
  console.log(`⏰ ${new Date().toISOString()}`);
  console.log("═══════════════════════════════════════════════════");

  const startTime = Date.now();
  const stats = { updated: 0, disabled: 0, skippedOther: 0, errors: 0 };

  const locationMap = await buildLocationMap();

  const nameToId = {};
  for (const [id, name] of Object.entries(locationMap)) nameToId[name] = String(id);

  const lightLocationIds = LIGHT_SYNC_LOCATIONS.map((name) => nameToId[name]).filter(Boolean);
  const excludedLocationId = nameToId[EXCLUDED_LOCATION];

  if (lightLocationIds.length !== LIGHT_SYNC_LOCATIONS.length) {
    throw new Error(
      `Could not resolve all light-sync locations in Shopify. Found: ${JSON.stringify(nameToId)}`
    );
  }

  const allRelevantIds = excludedLocationId
    ? lightLocationIds.concat([excludedLocationId])
    : lightLocationIds;

  console.log(`📍 Light locations: ${LIGHT_SYNC_LOCATIONS.join(", ")} (ids: ${lightLocationIds.join(", ")})`);
  console.log(`🚫 Excluded (full sync's domain): ${EXCLUDED_LOCATION} (id: ${excludedLocationId || "not found"})`);

  const [products, levels] = await Promise.all([
    getAllProductsLight(),
    getInventoryLevelsForLocations(allRelevantIds),
  ]);

  console.log(`📦 ${products.length} products to check`);
  console.log(`📊 ${levels.length} inventory levels fetched`);

  const fullPass = isFullPass();
  const since = Date.now() - LOOKBACK_HOURS * 3600 * 1000;
  const changed = (ts) => ts && new Date(ts).getTime() >= since;
  console.log(fullPass
    ? "🌙 Complete pass (all variants)"
    : `⚡ Changes only: stock or product updated in the last ${LOOKBACK_HOURS}h`);

  // inventory_item_id -> { light: bestAvailableQty, excluded: hasStockAt3140, recent }
  const stockByItem = new Map();
  for (const lvl of levels) {
    const key = String(lvl.inventory_item_id);
    const entry = stockByItem.get(key) || { light: 0, excluded: false, recent: false };
    if (changed(lvl.updated_at)) entry.recent = true;
    if (String(lvl.location_id) === excludedLocationId) {
      if (lvl.available > 0) entry.excluded = true;
    } else if (lightLocationIds.includes(String(lvl.location_id))) {
      if (lvl.available > entry.light) entry.light = lvl.available;
    }
    stockByItem.set(key, entry);
  }

  let skippedUnchanged = 0;
  for (const product of products) {
    const productChanged = changed(product.updated_at);
    for (const variant of product.variants) {
      const identifier = `shopify_variant_${variant.id}`;
      const entry = stockByItem.get(String(variant.inventory_item_id));

      if (!fullPass && !productChanged && !(entry && entry.recent) && !changed(variant.updated_at)) {
        skippedUnchanged++;
        continue;
      }

      try {
        if (product.status !== "active") {
          await paced(() => deleteProduct(identifier));
          stats.disabled++;
          continue;
        }

        if (entry && entry.excluded) {
          // Also in stock at 3140 - not this job's listing to manage.
          stats.skippedOther++;
          continue;
        }

        if (variant.sku && excludedSkus.has(variant.sku)) {
          await paced(() => deleteProduct(identifier));
          stats.disabled++;
          continue;
        }

        const qty = entry ? entry.light : 0;
        if (qty > 0) {
          await paced(() => updateStock(identifier, qty));
          stats.updated++;
        } else {
          await paced(() => deleteProduct(identifier));
          stats.disabled++;
        }
      } catch (e) {
        console.error(`  ❌ ${product.title} variant ${variant.id}:`, e.response?.data || e.message);
        stats.errors++;
      }
    }
  }

  const duration = ((Date.now() - startTime) / 1000).toFixed(1);
  console.log("═══════════════════════════════════════════════════");
  console.log(
    `✅ Done in ${duration}s | Updated: ${stats.updated} | Disabled: ${stats.disabled} | ` +
      `Skipped (3140-owned): ${stats.skippedOther} | Unchanged: ${skippedUnchanged} | Errors: ${stats.errors}`
  );
  console.log("═══════════════════════════════════════════════════");
}

syncStockLight().catch((e) => {
  console.error("💥 Light stock sync failed:", e.message);
  process.exit(1);
});
