require("dotenv").config();
const config = require("./config");
const { getAllProducts, getRecentlyUpdatedProducts, getInventoryLevels, getInventoryCost, buildLocationMap, formatManufacturer } = require("./shopify");
const { upsertProduct, deleteProduct } = require("./marketplace");
const { computeWsnlListing, calculatePrice, meetsMinProfit, calculateWsnlDiscountPrice, getWsnlPriceOverride, MIN_PROFIT_EUR, MIN_WSNL_DISCOUNT_PROFIT_EUR, FIXED_COST_EUR, WSNL_COMMISSION } = require("./pricing");
const { getCategoryCode, resolveCategory } = require("./categories");
const { buildMetafieldIndex, buildMetafieldIndexForProducts } = require("./metafields");
const { resolveSize } = require("./sizemap");
const { findBrandCode } = require("./brandmap");

// The full-catalog run on 2026-06-29 produced 10,292 errors, almost all
// "[API] Invalid API key or access token". The token WAS being refreshed
// correctly (confirmed in logs), and there is no pacing at all between
// the thousands of upsertProduct calls in a full sync — strong signal this
// is Marketplace rate-limiting the connection and returning a misleading
// auth-style error rather than a proper 429. Two changes to compensate:
//   1. A small pacing delay before every Marketplace upsert (not just Shopify calls).
//   2. Retry with backoff specifically when the error LOOKS like an auth
//      failure but follows a recent successful token refresh — since a
//      genuinely bad credential would fail immediately and consistently,
//      not intermittently after thousands of successful calls.
// If this remains the root cause, also ask Marketplace support for the documented
// rate limit on the retailer products endpoint so the delay can be tuned
// precisely instead of guessed.
const MARKETPLACE_PACING_MS = 50;
async function marketplaceUpsertWithRetry(payload, attempt = 1) {
  await new Promise((r) => setTimeout(r, MARKETPLACE_PACING_MS));
  try {
    await upsertProduct(payload);
  } catch (err) {
    const msg = err.response ? JSON.stringify(err.response.data) : err.message;
    const looksLikeAuthOrRateLimit =
      msg.includes("Invalid API key") || msg.includes("access token") ||
      (err.response && (err.response.status === 401 || err.response.status === 429));
    if (looksLikeAuthOrRateLimit && attempt < 5) {
      const wait = 1000 * Math.pow(2, attempt); // 2s, 4s, 8s, 16s
      console.log(`  ⏳ Marketplace auth/rate-limit-style error, retrying in ${wait / 1000}s (attempt ${attempt})`);
      await new Promise((r) => setTimeout(r, wait));
      return marketplaceUpsertWithRetry(payload, attempt + 1);
    }
    throw err;
  }
}

// Minimum-profit filtering is done live per variant now (see meetsMinProfit
// below, right after price/cost are computed) - no static SKU list to keep
// in sync, so newly imported products get evaluated automatically too.
const { findColor } = require("./colormap");
const { stripHtml } = require("./striphtml");


const isFullSync = process.argv.includes("--full");

function cleanImages(product) {
  return (product.images || []).map((img) => img.src).filter((url) => {
    const filename = url.split("/").pop().toLowerCase();
    return !filename.includes("bildschirmfoto") && !filename.includes("screenshot") && !filename.includes("screen_shot");
  });
}

function buildPayload({ product, variant, images, price, specialPrice, quantity, brandCode, meta }) {
  const pMeta = (meta && meta.product[String(product.id)]) || {};
  const vMeta = (meta && meta.variant[String(variant.id)]) || {};

  // Taxonomy now comes from the Shopify metafields first; product_type and the
  // product title are fallbacks only.
  const resolved = resolveCategory({
    gender: pMeta.gender,
    category: pMeta.category,
    subcategory: pMeta.subcategory,
    productType: product.product_type,
    tags: product.tags,
    title: product.title,
  });

  const payload = {
    identifier: `shopify_variant_${variant.id}`,
    parent: `shopify_product_${product.id}`,
    enabled: true,
    category: resolved.code,
    values: {
      name: [{ data: product.title, locale: config.defaultLocale }, { data: product.title, locale: config.secondaryLocale }],
      description: [
        { data: stripHtml(product.body_html) || product.title, locale: config.defaultLocale },
        { data: stripHtml(product.body_html) || product.title, locale: config.secondaryLocale }
      ],
      price: [{ data: [{ amount: price, currency: "EUR" }] }],
      manufacturer: [{ data: brandCode }],
      manufacturer_product_number: [{ data: String(product.id) }],
      retailer_manufacturer_product_number: [{ data: variant.sku || String(variant.id) }],
      quantity: [{ data: quantity }],
      ...(variant.barcode && /^[0-9]{12,13}$/.test(variant.barcode.trim()) ? { ean: [{ data: variant.barcode.trim() }] } : {}),
    },
  };
  if (specialPrice) payload.values.special_price = [{ data: [{ amount: specialPrice, currency: "EUR" }] }];

  // ── Size ────────────────────────────────────────────────────────────────
  // Source of truth is now the variant Size metafield. Option positions are a
  // fallback for variants the taxonomy pass hasn't reached yet.
  //
  // Every candidate is resolved against sizes.json (the marketplace's own 456-
  // code vocabulary) via sizemap.resolveSize. That fixes two things the old
  // regex did wrong: half sizes were floored (10,5 -> "10", i.e. the customer
  // gets the wrong shoe), and unrecognised values were sent anyway and bounced
  // by the API. resolveSize returns null for anything not in the vocabulary,
  // and null means we omit the field rather than send garbage.
  // The variant's own option value is the real size and wins. The size
  // metafield (custom.size / poizon.size) is only a fallback for variants
  // with no recognisable size option. filter.size is never read: it is a
  // storefront filter bucket (IT58 suit = "4XL"), not the size.
  const sizeCandidates = [
    variant.option1,
    variant.option2,
    variant.option3,
    vMeta.size,
  ];
  let cleanSize = null;
  let sizeFromMetafield = false;
  for (let i = 0; i < sizeCandidates.length; i++) {
    const resolvedSize = resolveSize(sizeCandidates[i]);
    if (resolvedSize) {
      cleanSize = resolvedSize;
      sizeFromMetafield = i === 3;
      break;
    }
  }
  const sizeFromOption = Boolean(cleanSize) && !sizeFromMetafield;

  // These categories don't reliably carry a size option in Shopify. Suppression
  // still applies ONLY when no genuine size was found — a real size (including
  // one_size) must always be sent, or the API returns "must be unspecified"
  // errors on every bag/hat/belt/wallet product.
  const noSizeCategories = ["219", "253", "140", "678", "7850", "7851"];
  if (cleanSize && (sizeFromOption || sizeFromMetafield || !noSizeCategories.includes(resolved.code))) {
    payload.values.size = [{ data: cleanSize }];
  }

  payload.values.color = [{ data: findColor(variant, product.tags) }];
  if (images.length > 0) {
    payload.values.image_default = [{ data: images[0] }];
    images.slice(0, 5).forEach((url, i) => { payload.values[`image_${i + 1}`] = [{ data: url }]; });
  }
  return payload;
}

async function sync() {
  console.log("═══════════════════════════════════════════════════");
  console.log(`🔄 ${isFullSync ? "FULL" : "INCREMENTAL"} sync started`);
  console.log(`⏰ ${new Date().toISOString()}`);
  console.log(`📍 Locations: ${Object.keys(config.locations).join(", ")}`);
  console.log("═══════════════════════════════════════════════════");

  const startTime = Date.now();
  const stats = { synced: 0, skipped: 0, skippedLowMargin: 0, disabled: 0, errors: 0 };

  const [locationMap, products] = await Promise.all([
    buildLocationMap(),
    isFullSync ? getAllProducts() : getRecentlyUpdatedProducts(120),
  ]);

  // Full sync pages the whole catalog; incremental fetches only what changed.
  // On a typical hourly run that is one request instead of ~172.
  const meta = isFullSync
    ? await buildMetafieldIndex()
    : await buildMetafieldIndexForProducts(products.map((p) => p.id));

  console.log(`📦 ${products.length} products to process`);

  const allowedLocationIds = new Set(
    Object.entries(locationMap)
      .filter(([, name]) => config.locations[name])
      .map(([id]) => String(id))
  );

  for (const product of products) {
    if (product.status !== "active") {
      for (const variant of product.variants) {
        try { await deleteProduct(`shopify_variant_${variant.id}`); stats.disabled++; } catch (_) {}
      }
      continue;
    }
    const images = cleanImages(product);
    for (const variant of product.variants) {
      try {
        const inventoryLevels = await getInventoryLevels(variant.inventory_item_id);

        let stockQuantity = 0, markupRate = null, stockLocationName = null, locationConfig = null;
        for (const level of inventoryLevels) {
          if (!allowedLocationIds.has(String(level.location_id))) continue;
          if (level.available <= 0) continue;
          const locName = locationMap[level.location_id];
          stockQuantity = level.available;
          locationConfig = config.locations[locName];
          markupRate = locationConfig.markup;
          stockLocationName = locName;
          break;
        }

        if (!stockLocationName) {
          try { await deleteProduct(`shopify_variant_${variant.id}`); stats.disabled++; } catch (_) {}
          stats.skipped++;
          const seenLocations = inventoryLevels.map(l => `${locationMap[l.location_id] || l.location_id}:${l.available}`).join(", ") || "none";
          console.log(`  🚫 ${product.title} | ${variant.sku || variant.id} | no stock at a recognized location - has: [${seenLocations}]`);
          continue;
        }

        const originalPrice = parseFloat(variant.price);
        const compareAt = variant.compare_at_price ? parseFloat(variant.compare_at_price) : null;
        const brandCode = findBrandCode(product.vendor);
        if (!brandCode) {
          stats.skipped++;
          console.log(`  🚫 ${product.title} | ${variant.sku || variant.id} | vendor "${product.vendor}" has no matching brand code`);
          continue;
        }

        // Cost is needed for every location now, not just cost-based ones:
        // cost-based locations use it to derive the price itself, and
        // pass-through locations (3140/3171) need it for the live minimum-
        // profit check below even though their listed price ignores it.
        const cost = await getInventoryCost(variant.inventory_item_id);

        // ── WSNL price override (clearance / sell-out pricing) ──────────────
        // Checked first, before brand-discount and calculatePrice logic.
        // Override price is set in pricing.js WSNL_PRICE_OVERRIDES, keyed by
        // SKU. It is a WSNL-only price — Shopify's own price is never touched.
        // Override price is calculated at break-even (cost / WSNL_KEEP_RATE),
        // so the profit check is skipped for these items.
        const priceOverride = getWsnlPriceOverride(variant.sku);
        if (priceOverride !== null) {
          // Use the clearance override as the sale price, and pass Shopify's
          // compareAt through unchanged as the crossed-out "was" price on WSNL.
          const price = compareAt || originalPrice;  // compare-at (RRP) as the display price
          const specialPrice = priceOverride;         // override = the sale price shown
          console.log(`  💰 ${product.title} | ${variant.sku} | WSNL sale €${priceOverride} was €${price} (compareAt: €${compareAt})`);
          const payload = buildPayload({ product, variant, images, price, specialPrice, quantity: stockQuantity, brandCode, meta });
          const eanRequired = ["609","24","114","199","255","92","618","612","615","617"].includes(payload.category);
          const hasEan = payload.values.ean && payload.values.ean[0]?.data;
          if (eanRequired && !hasEan) {
            stats.skipped++;
            console.log(`  🚫 ${product.title} | ${variant.sku} | category ${payload.category} requires EAN but none is set`);
            continue;
          }
          try {
            await marketplaceUpsertWithRetry(payload);
          } catch(upsertErr) {
            const msg = upsertErr.response ? JSON.stringify(upsertErr.response.data) : upsertErr.message;
            if (msg.includes('Cursor not valid')) {
              await deleteProduct(payload.identifier);
              await marketplaceUpsertWithRetry(payload);
            } else {
              throw upsertErr;
            }
          }
          stats.synced++;
          continue;
        }

        // ── WSNL price (13 Nov 2026) ─────────────────────────────────────────
        // Hanau (3171): office stock, unchanged - Shopify price passed through
        // (compare-at as was-price) and always listed, even below the profit
        // minimum, so it sells off.
        // Rewix (3169) + Loxuno (3170): full price (RRP) as the was-price plus
        // a discount (brand / default / Black Friday), capped so the final
        // sale price still clears MIN_PROFIT_EUR after commission, VAT and the
        // fixed per-item cost - see pricing.js computeWsnlListing().
        let price, specialPrice;
        if (stockLocationName === "3171 Warehouse") {
          ({ price, specialPrice } = calculatePrice(originalPrice, compareAt, markupRate, null, undefined));
          const { ok: profitOk, profit } = meetsMinProfit(price, specialPrice, cost);
          if (!profitOk) {
            console.log(`  📦 ${product.title} | ${variant.sku || variant.id} | profit €${profit} below €${MIN_PROFIT_EUR} min, but listing anyway - 3171 office stock`);
          }
        } else {
          const listing = computeWsnlListing({ vendor: product.vendor, shopPrice: originalPrice, compareAt, cost });
          if (listing.excluded) {
            try { await deleteProduct(`shopify_variant_${variant.id}`); stats.disabled++; } catch (_) {}
            stats.skippedLowMargin++;
            console.log(`  ⏸️  ${product.title} | ${variant.sku || variant.id} | ${stockLocationName} | ${listing.reason} - excluded from WSNL`);
            continue;
          }
          ({ price, specialPrice } = listing);
          console.log(`  🏷️  ${product.title} | ${variant.sku || variant.id} | RRP €${listing.price} → €${listing.specialPrice} (-${listing.appliedPct}%${listing.capped ? `, capped from ${listing.targetPct}%` : ""}${listing.bfExtra ? ", BF +5%" : ""}) profit €${listing.profit}`);
        }


        const payload = buildPayload({ product, variant, images, price, specialPrice, quantity: stockQuantity, brandCode, meta });
        const eanRequired = ["609","24","114","199","255","92","618","612","615","617"].includes(payload.category);
        const hasEan = payload.values.ean && payload.values.ean[0]?.data;
        if (eanRequired && !hasEan) {
          stats.skipped++;
          console.log(`  🚫 ${product.title} | ${variant.sku || variant.id} | category ${payload.category} requires EAN but none is set`);
          continue;
        }
        try {
          await marketplaceUpsertWithRetry(payload);
        } catch(upsertErr) {
          const msg = upsertErr.response ? JSON.stringify(upsertErr.response.data) : upsertErr.message;
          if (msg.includes('Cursor not valid')) {
            await deleteProduct(payload.identifier);
            await marketplaceUpsertWithRetry(payload);
          } else {
            throw upsertErr;
          }
        }
        stats.synced++;
        console.log(`  ✅ ${product.title} | ${variant.option1 || "-"} | €${price} | ${stockLocationName} | qty: ${stockQuantity}`);
      } catch (e) {
        console.error(`  ❌ ${product.title} variant ${variant.id}:`, e.response?.data || e.message);
        stats.errors++;
      }
    }
  }

  const duration = ((Date.now() - startTime) / 1000).toFixed(1);
  console.log("═══════════════════════════════════════════════════");
  console.log(`✅ Done in ${duration}s | Synced: ${stats.synced} | Skipped: ${stats.skipped} | Low margin: ${stats.skippedLowMargin} | Disabled: ${stats.disabled} | Errors: ${stats.errors}`);
  console.log("═══════════════════════════════════════════════════");
}

sync().catch((e) => { console.error("💥 Sync failed:", e.message); process.exit(1); });
