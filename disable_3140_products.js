require("dotenv").config();
const { getInventoryLevels, getVariantInventoryItemId, buildLocationMap } = require("./shopify");
const { deleteProduct } = require("./marketplace");
const { getAllMarketplaceProducts } = require("./cleanup_marketplace");

// ─────────────────────────────────────────────────────────────────────────
// One-off targeted cleanup: disable + remove every Marketplace
// listing that currently has stock at 3140 Warehouse (Tluxy/Channable).
//
// This does NOT wait for the regular full sync (sync.js), which processes
// the entire catalog including images/price/description for all locations
// and has known Marketplace rate-limit sensitivity on big runs. This script only
// looks at 3140-stocked listings and only disables/removes them - it does
// not touch 3170/3171 listings at all.
//
// Run with --dry-run first to see what WOULD be disabled before doing it
// live.
// ─────────────────────────────────────────────────────────────────────────

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function run() {
  const DRY_RUN = process.argv.includes("--dry-run");
  console.log("═══════════════════════════════════════════════════");
  console.log(`🔄 Disable 3140 Marketplace listings — mode: ${DRY_RUN ? "DRY RUN" : "LIVE"}`);
  console.log(`⏰ ${new Date().toISOString()}`);
  console.log("═══════════════════════════════════════════════════");

  const locationMap = await buildLocationMap();
  const location3140Id = Object.entries(locationMap).find(([, name]) => name === "3140 Warehouse")?.[0];
  if (!location3140Id) {
    throw new Error(`Could not resolve "3140 Warehouse" location id from Shopify. Found: ${JSON.stringify(locationMap)}`);
  }
  console.log(`📍 3140 Warehouse location id: ${location3140Id}\n`);

  console.log("Fetching all enabled Marketplace listings...\n");
  const products = await getAllMarketplaceProducts();
  console.log(`\n📦 ${products.length} enabled Marketplace listings to check\n`);

  let checked = 0, matched = 0, disabled = 0, errors = 0;

  for (const p of products) {
    const match = p.identifier.match(/shopify_variant_(\d+)/);
    if (!match) { console.log(`⚠️  Skipping unrecognized identifier: ${p.identifier}`); continue; }
    const variantId = match[1];
    checked++;

    try {
      const inventoryItemId = await getVariantInventoryItemId(variantId);
      await sleep(300);

      const levels = await getInventoryLevels(inventoryItemId);
      await sleep(300);

      const hasStockAt3140 = levels.some(
        (l) => String(l.location_id) === location3140Id && l.available > 0
      );

      if (!hasStockAt3140) {
        process.stdout.write(".");
        continue;
      }

      matched++;
      process.stdout.write("\n");
      if (DRY_RUN) {
        console.log(`[DRY] Would disable+remove: ${p.identifier}`);
      } else {
        await deleteProduct(p.identifier);
        console.log(`🚫 Disabled+removed: ${p.identifier}`);
      }
      disabled++;
      await sleep(300);
    } catch (e) {
      if (e.response?.status === 404) {
        // Variant no longer exists in Shopify at all - not this script's
        // job (that's the weekly orphan cleanup's job) - just note it.
        process.stdout.write("\n");
        console.log(`⏭️  Variant ${variantId} not found in Shopify, skipping (orphan cleanup will handle it): ${p.identifier}`);
      } else {
        errors++;
        console.log(`\n❌ ${p.identifier}:`, e.response?.data || e.message);
      }
    }
  }

  console.log("\n\n═══════════════════════════════════════════════════");
  console.log(`✅ Done | Checked: ${checked} | Matched (3140 stock): ${matched} | Disabled/removed: ${disabled} | Errors: ${errors}`);
  console.log("═══════════════════════════════════════════════════");
}

run().catch((e) => {
  console.error("💥 Failed:", e.message);
  process.exit(1);
});
