/**
 * Reactivate In-Stock Products on WSNL
 * =====================================
 * Fixes the specific case found in the "Jouw actuele voorraad" export:
 * products that genuinely have stock in Shopify (at a recognized WSNL
 * location) but are showing "GEEN VOORRAAD" (no stock) on WSNL.
 *
 * This does NOT touch:
 *   - Products deleted from Shopify entirely (separate cleanup - these need
 *     to be DELETED from WSNL, not reactivated; see cleanup_ghost_listings.js)
 *   - Products that are genuinely out of stock everywhere (left alone, the
 *     "GEEN VOORRAAD" status is correct for those)
 *
 * For every candidate, it checks live Shopify stock at your three
 * recognized WSNL locations (3140/3170/3171 Warehouse) and, if real stock
 * exists, calls updateStock() - a lightweight PATCH that just fixes
 * quantity/enabled on the EXISTING WSNL listing, without touching price,
 * images, or any other field.
 *
 * USAGE
 * -----
 *   node reactivate_instock_products.js geen_voorraad.csv
 *
 * Input CSV must have at least a SHOPIFY_ID column in the form
 * "shopify_product_<id>" (exactly what the WSNL stock export provides).
 * Optional MERK/PRODUCT columns are used only for logging.
 *
 * Set DRY_RUN=1 to see what WOULD be reactivated without calling the WSNL
 * API - always run this first.
 */

const fs = require("fs");
const path = require("path");
const config = require("./config");
const { getProduct, buildLocationMap } = require("./shopify");
const { updateStock } = require("./marketplace");

const DRY_RUN = process.env.DRY_RUN === "1";

function parseCsv(filePath) {
  const lines = fs.readFileSync(filePath, "utf-8").split(/\r?\n/).filter(Boolean);
  const header = lines[0].split(",").map((h) => h.trim());
  return lines.slice(1).map((line) => {
    // simple CSV split good enough for this export (no embedded commas in these columns)
    const cols = line.split(",");
    const row = {};
    header.forEach((h, i) => { row[h] = (cols[i] || "").trim(); });
    return row;
  });
}

async function main() {
  const inputPath = process.argv[2];
  if (!inputPath) {
    console.error("Usage: node reactivate_instock_products.js <geen_voorraad.csv>");
    process.exit(1);
  }

  const rows = parseCsv(path.resolve(inputPath));
  console.log(`📄 ${rows.length} candidate rows loaded from ${inputPath}`);
  if (DRY_RUN) console.log("🔎 DRY RUN - no WSNL calls will be made\n");

  const locationMap = await buildLocationMap();
  const allowedLocationIds = new Set(
    Object.entries(locationMap)
      .filter(([, name]) => config.locations[name])
      .map(([id]) => String(id))
  );

  const stats = { reactivated: 0, ghost: 0, genuinelyOutOfStock: 0, errors: 0 };
  const ghostList = [];
  const reactivatedList = [];

  for (const row of rows) {
    const rawId = (row.SHOPIFY_ID || "").replace("shopify_product_", "").trim();
    if (!rawId) continue;
    const label = `${row.MERK || ""} | ${row.PRODUCT || rawId}`;

    try {
      const product = await getProduct(rawId);

      if (!product) {
        stats.ghost++;
        ghostList.push({ id: rawId, label });
        console.log(`  👻 ${label} | deleted from Shopify - needs separate WSNL cleanup, not reactivation`);
        continue;
      }

      if (product.status !== "active") {
        stats.genuinelyOutOfStock++;
        console.log(`  ⏸️  ${label} | Shopify status is "${product.status}" - leaving as-is`);
        continue;
      }

      let anyReactivated = false;
      for (const variant of product.variants) {
        // Reuse the same inventory-levels lookup the main sync uses
        const { getInventoryLevels } = require("./shopify");
        const levels = await getInventoryLevels(variant.inventory_item_id);

        let stockQuantity = 0;
        for (const level of levels) {
          if (!allowedLocationIds.has(String(level.location_id))) continue;
          if (level.available <= 0) continue;
          stockQuantity = level.available;
          break;
        }

        if (stockQuantity > 0) {
          anyReactivated = true;
          const identifier = `shopify_variant_${variant.id}`;
          if (DRY_RUN) {
            console.log(`  ✅ [DRY RUN] would reactivate ${label} | ${variant.sku || variant.id} | qty ${stockQuantity}`);
          } else {
            await updateStock(identifier, stockQuantity);
            console.log(`  ✅ Reactivated ${label} | ${variant.sku || variant.id} | qty ${stockQuantity}`);
          }
        }
      }

      if (anyReactivated) {
        stats.reactivated++;
        reactivatedList.push(label);
      } else {
        stats.genuinelyOutOfStock++;
      }
    } catch (e) {
      stats.errors++;
      console.log(`  ⚠️  ${label} | error: ${e.message}`);
    }
  }

  console.log("\n" + "=".repeat(60));
  console.log(DRY_RUN ? "DRY RUN SUMMARY" : "SUMMARY");
  console.log("=".repeat(60));
  console.log(`Reactivated (real stock, now fixed on WSNL): ${stats.reactivated}`);
  console.log(`Ghost listings (deleted from Shopify, need separate cleanup): ${stats.ghost}`);
  console.log(`Genuinely out of stock (left as-is): ${stats.genuinelyOutOfStock}`);
  console.log(`Errors: ${stats.errors}`);

  // Write ghost list out separately so it's ready for the cleanup script
  if (ghostList.length) {
    const outPath = path.resolve(path.dirname(inputPath), "ghost_listings.csv");
    fs.writeFileSync(outPath, "SHOPIFY_ID,LABEL\n" + ghostList.map(g => `shopify_product_${g.id},"${g.label}"`).join("\n"));
    console.log(`\n👻 Ghost listing IDs written to ${outPath} for separate cleanup`);
  }
}

main().catch((e) => { console.error(e); process.exit(1); });
