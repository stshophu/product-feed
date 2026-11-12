// audit_taxonomy.js — READ ONLY. Touches Shopify, never the marketplace.
//
// Run this before the first real sync after the taxonomy change:
//   node audit_taxonomy.js
//
// It writes taxonomy_audit.csv (one row per variant) and prints a summary of:
//   - which metafield namespace.key each signal was actually read from
//   - how many products fall back to a default category (the dangerous bucket)
//   - which size values could not be resolved to a valid marketplace code
//   - the distinct Category/Subcategory/Gender values in the catalog
//
// The distinct-value list is the thing to eyeball: any value that appears in
// "UNMATCHED VALUES" needs a rule added to categories.js.

require("dotenv").config();
const fs = require("fs");
const { getAllProducts } = require("./shopify");
const { buildMetafieldIndex } = require("./metafields");
const { resolveCategory } = require("./categories");
const { resolveSize } = require("./sizemap");

function csvCell(v) {
  const s = v === null || v === undefined ? "" : String(v);
  return /[",\n;]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
}

async function main() {
  console.log("🔍 Taxonomy audit (read-only, no marketplace writes)\n");
  const [products, meta] = await Promise.all([getAllProducts(), buildMetafieldIndex()]);
  console.log(`\n📦 ${products.length} products\n`);

  const rows = [[
    "product_id", "variant_id", "sku", "title", "vendor", "product_type",
    "mf_category", "mf_subcategory", "mf_gender", "mf_size",
    "resolved_gender", "resolved_category", "matched_on", "confident",
    "resolved_size", "size_source", "issue",
  ]];

  const sourceKeys = {};           // which namespace.key each field came from
  const distinct = { category: {}, subcategory: {}, gender: {} };
  const unmatchedTypes = {};       // values that produced a default category
  const unresolvedSizes = {};
  let defaulted = 0, noSize = 0, total = 0;

  for (const product of products) {
    if (product.status !== "active") continue;
    const pMeta = meta.product[String(product.id)] || {};

    for (const f of ["category", "subcategory", "gender"]) {
      if (pMeta[f + "_source"]) sourceKeys[f] = (sourceKeys[f] || new Set()).add(pMeta[f + "_source"]);
      if (pMeta[f]) distinct[f][pMeta[f]] = (distinct[f][pMeta[f]] || 0) + 1;
    }

    const resolved = resolveCategory({
      gender: pMeta.gender,
      category: pMeta.category,
      subcategory: pMeta.subcategory,
      productType: product.product_type,
      tags: product.tags,
      title: product.title,
    });
    if (!resolved.confident) {
      defaulted++;
      const key = pMeta.subcategory || pMeta.category || product.product_type || "(empty)";
      unmatchedTypes[key] = (unmatchedTypes[key] || 0) + 1;
    }

    for (const variant of product.variants) {
      total++;
      const vMeta = meta.variant[String(variant.id)] || {};
      const candidates = [vMeta.size, variant.option1, variant.option2, variant.option3];
      let size = null, source = null;
      const labels = ["metafield", "option1", "option2", "option3"];
      for (let i = 0; i < candidates.length; i++) {
        const r = resolveSize(candidates[i]);
        if (r) { size = r; source = labels[i]; break; }
      }
      if (!size) {
        noSize++;
        const raw = vMeta.size || variant.option1 || "(none)";
        unresolvedSizes[raw] = (unresolvedSizes[raw] || 0) + 1;
      }

      const issues = [];
      if (!resolved.confident) issues.push("DEFAULT_CATEGORY");
      if (!size) issues.push("NO_VALID_SIZE");
      if (!pMeta.category && !pMeta.subcategory) issues.push("NO_TAXONOMY_METAFIELD");
      if (pMeta.category_unresolved || pMeta.subcategory_unresolved) issues.push("METAOBJECT_REF");
      if (size && source !== "metafield" && vMeta.size) issues.push("METAFIELD_SIZE_INVALID");

      rows.push([
        product.id, variant.id, variant.sku, product.title, product.vendor, product.product_type,
        pMeta.category, pMeta.subcategory, pMeta.gender, vMeta.size,
        resolved.gender, resolved.code, resolved.matchedOn, resolved.confident,
        size, source, issues.join("|"),
      ]);
    }
  }

  fs.writeFileSync("taxonomy_audit.csv", rows.map((r) => r.map(csvCell).join(",")).join("\n"));

  const top = (obj, n) => Object.entries(obj).sort((a, b) => b[1] - a[1]).slice(0, n);
  console.log("═══════════════════════════════════════════════");
  console.log("METAFIELDS READ FROM:");
  for (const [f, set] of Object.entries(sourceKeys)) console.log(`  ${f}: ${[...set].join(", ")}`);
  if (!Object.keys(sourceKeys).length) console.log("  ⚠️  NONE — no Category/Subcategory/Gender metafield was visible to the API.");
  console.log("");
  console.log(`CATEGORY: ${defaulted} products fell back to a default code (no type match).`);
  console.log("  Top unmatched values — each of these needs a rule in categories.js:");
  for (const [v, n] of top(unmatchedTypes, 25)) console.log(`    ${String(n).padStart(5)}  ${v}`);
  console.log("");
  console.log(`SIZE: ${noSize} of ${total} variants have no valid marketplace size code.`);
  for (const [v, n] of top(unresolvedSizes, 25)) console.log(`    ${String(n).padStart(5)}  ${v}`);
  console.log("");
  for (const f of ["gender", "category", "subcategory"]) {
    const vals = Object.entries(distinct[f]);
    console.log(`DISTINCT ${f.toUpperCase()} VALUES (${vals.length}):`);
    for (const [v, n] of top(distinct[f], 40)) console.log(`    ${String(n).padStart(5)}  ${v}`);
    console.log("");
  }
  console.log("📄 Full detail written to taxonomy_audit.csv");
  console.log("═══════════════════════════════════════════════");
}

main().catch((e) => { console.error("💥", e.message); process.exit(1); });
