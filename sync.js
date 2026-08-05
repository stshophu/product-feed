require("dotenv").config();
const config = require("./config");
const { getAllProducts, getRecentlyUpdatedProducts, getInventoryLevels, getInventoryCost, buildLocationMap, formatManufacturer } = require("./shopify");
const { upsertProduct, deleteProduct } = require("./marketplace");
const { calculatePrice, meetsMinProfit, calculateWsnlDiscountPrice, MIN_PROFIT_EUR, MIN_WSNL_DISCOUNT_PROFIT_EUR } = require("./pricing");
const { getCategoryCode } = require("./categories");
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

function buildPayload({ product, variant, images, price, specialPrice, quantity, brandCode }) {
  const payload = {
    identifier: `shopify_variant_${variant.id}`,
    parent: `shopify_product_${product.id}`,
    enabled: true,
    category: getCategoryCode(product.product_type, product.tags),
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
  const sizePattern = /^(xs|s|m|l|xl|xxl|xxxl|xxxxl|xxxxxl|3xl|4xl|5xl|xxxs|xxs|os|one.?size|one_size|uni|unica|taille.?unique|\d+[yY]|\d+[mM]|\d+[\/\-]\d+|\d+[\.\,]?\d*|one_size)$/i;
  const colorWords = /^(black|white|blue|red|green|gray|grey|beige|brown|pink|orange|yellow|purple|gold|silver|navy|nude|nero|bianco|rosso|verde|blu|rosa|arancione|giallo|viola|marrone|beige|camel|cream|ivory|coral|taupe|khaki|olive|mint|teal|cyan|metallic|multicolor|multi|print|animal)$/i;
  // Any of these mean "one size" in some source feed's convention (Loxuno uses
  // "OS", others use "UNI"/"Unica"/"One Size"). Marketplace only accepts a single
  // canonical token for this, so every synonym must collapse to it -
  // sending the raw synonym (e.g. "uni") gets a "not supported/disabled"
  // error, and sending nothing at all (e.g. "OS" wasn't even recognized as
  // a size before) gets a "must be unspecified" error demanding some value.
  const oneSizeSynonyms = /^(os|uni|unica|one.?size|taille.?unique)$/i;
  const option1isSze = variant.option1 && sizePattern.test(variant.option1.trim()) && !colorWords.test(variant.option1.trim());
  const option2isSze = variant.option2 && sizePattern.test(variant.option2.trim());
  const sizeValue = option1isSze ? variant.option1 : (option2isSze ? variant.option2 : (variant.option1 || null));
  let cleanSize = sizeValue ? sizeValue.replace(/,/g, ".").replace(/^one size$/i, "one_size") : null;
  if (cleanSize && oneSizeSynonyms.test(cleanSize.trim())) {
    cleanSize = "one_size";
  }
  if (cleanSize && /^\d+\.5$/.test(cleanSize)) {
    cleanSize = String(Math.floor(parseFloat(cleanSize)));
  }
  // These categories don't reliably carry a size *option* in Shopify - many of
  // their products only have a single "Colore" option and no size option at
  // all, which used to leak the raw (often untranslated, e.g. "Avorio") color
  // through as a fake size value. That's what this suppression is for.
  // It must NOT apply when a size was genuinely detected on the variant
  // (option1isSze / option2isSze true, including one-size markers like OS/UNI)
  // - Marketplace's schema for these categories does require a size value, and
  // suppressing a real one is what was causing "must be unspecified" errors
  // on every bag/hat/belt/wallet product in this category, one-size or not.
  const noSizeCategories = ["219", "253", "140", "678", "7850", "7851"];
  const productCategory = getCategoryCode(product.product_type, product.tags);
  const hasGenuineSize = option1isSze || option2isSze;
  const looksLikeSize = cleanSize && (sizePattern.test(cleanSize) || /^(one_size|xxs|xs|s|m|l|xl|xxl|xxxl|xxxxl|xxxxxl)$/i.test(cleanSize));
  if (looksLikeSize && !colorWords.test(cleanSize) && (hasGenuineSize || !noSizeCategories.includes(productCategory))) {
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
          continue;
        }

        const originalPrice = parseFloat(variant.price);
        const compareAt = variant.compare_at_price ? parseFloat(variant.compare_at_price) : null;
        const brandCode = findBrandCode(product.vendor);
        if (!brandCode) { stats.skipped++; continue; }

        // Cost is needed for every location now, not just cost-based ones:
        // cost-based locations use it to derive the price itself, and
        // pass-through locations (3140/3171) need it for the live minimum-
        // profit check below even though their listed price ignores it.
        const cost = await getInventoryCost(variant.inventory_item_id);

        // WSNL sale-period brand discount (Aug 2026) - only applies to the 7
        // approved brands (see pricing.js), and NEVER for items stocked at
        // "3171 Warehouse" - that location keeps its existing pass-through
        // pricing unchanged, regardless of vendor/brand. Falls back to the
        // normal calculatePrice() path for every other case. Items in the
        // 7-brand deal (at 3140/3170) that can't clear €20 profit even at 0%
        // discount are excluded from WSNL entirely.
        const wsnlDiscount = stockLocationName === "3171 Warehouse"
          ? null
          : calculateWsnlDiscountPrice(product.vendor, originalPrice, compareAt, cost);
        if (wsnlDiscount && wsnlDiscount.excluded) {
          try { await deleteProduct(`shopify_variant_${variant.id}`); stats.disabled++; } catch (_) {}
          stats.skippedLowMargin++;
          console.log(`  ⏸️  ${product.title} | ${variant.sku || variant.id} | ${wsnlDiscount.brand} profit €${wsnlDiscount.profit} < €${MIN_WSNL_DISCOUNT_PROFIT_EUR} min (even at ${wsnlDiscount.appliedPct}% discount) - excluded from WSNL`);
          continue;
        }
        let price, specialPrice;
        if (wsnlDiscount) {
          ({ price, specialPrice } = wsnlDiscount);
          if (wsnlDiscount.capped) {
            console.log(`  ✂️  ${product.title} | ${wsnlDiscount.brand} capped at ${wsnlDiscount.appliedPct}% (requested ${wsnlDiscount.requestedPct}%) to stay above cost`);
          }
        } else {
          ({ price, specialPrice } = calculatePrice(
            originalPrice, compareAt, markupRate,
            locationConfig.costBased ? cost : null,
            locationConfig.costBased ? locationConfig.shipping : undefined
          ));
        }

        const { ok: profitOk, profit } = meetsMinProfit(price, specialPrice, cost);
        if (!profitOk) {
          try { await deleteProduct(`shopify_variant_${variant.id}`); stats.disabled++; } catch (_) {}
          stats.skippedLowMargin++;
          console.log(`  ⏸️  ${product.title} | ${variant.sku || variant.id} | profit €${profit} < €${MIN_PROFIT_EUR} min - excluded from WSNL`);
          continue;
        }

        const payload = buildPayload({ product, variant, images, price, specialPrice, quantity: stockQuantity, brandCode });
        const eanRequired = ["609","24","114","199","255","92","618","612","615","617"].includes(payload.category);
        const hasEan = payload.values.ean && payload.values.ean[0]?.data;
        if (eanRequired && !hasEan) {
          stats.skipped++;
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
