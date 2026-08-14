require("dotenv").config();
const config = require("./config");
const { getAllProducts, getRecentlyUpdatedProducts, getInventoryLevels, getInventoryCost, buildLocationMap, formatManufacturer } = require("./shopify");
const { upsertProduct, deleteProduct } = require("./marketplace");
const { calculatePrice, meetsMinProfit, calculateWsnlDiscountPrice, getWsnlPriceOverride, MIN_PROFIT_EUR, MIN_WSNL_DISCOUNT_PROFIT_EUR, FIXED_COST_EUR, WSNL_COMMISSION } = require("./pricing");
const { getCategoryCode, resolveCategory } = require("./categories");
const { buildMetafieldIndex } = require("./metafields");
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
  const sizeCandidates = [
    vMeta.size,                       // variant metafield — preferred
    variant.option1,
    variant.option2,
    variant.option3,
  ];
  let cleanSize = null;
  let sizeFromMetafield = false;
  for (let i = 0; i < sizeCandidates.length; i++) {
    const resolvedSize = resolveSize(sizeCandidates[i]);
    if (resolvedSize) {
      cleanSize = resolvedSize;
      sizeFromMetafield = i === 0;
      break;
    }
  }

  // These categories don't reliably carry a size option in Shopify. Suppression
  // still applies ONLY when no genuine size was found — a real size (including
  // one_size) must always be sent, or the API returns "must be unspecified"
  // errors on every bag/hat/belt/wallet product.
  const noSizeCategories = ["219", "253", "140", "678", "7850", "7851"];
  if (cleanSize && (sizeFromMetafield || !noSizeCategories.includes(resolved.code))) {
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

  const [locationMap, products, meta] = await Promise.all([
    buildLocationMap(),
    isFullSync ? getAllProducts() : getRecentlyUpdatedProducts(120),
    buildMetafieldIndex(),
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

        // ── WSNL sale-period brand discount (Aug 2026) ───────────────────────
        // Only applies to the 7 approved brands (see pricing.js), and NEVER
        // for items stocked at "3171 Warehouse". Falls back to calculatePrice()
        // for every other case. Items that can't clear €20 profit even at 0%
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

          // ── 3170 Warehouse: minimum profitable price ────────────────────────
          // For 3170 (Loxuno) items not covered by a brand discount, calculate
          // the minimum WSNL price that yields €20 profit after 26% commission,
          // 19% DE VAT, and €15 fixed cost:
          //
          //   min_price = (cost + €15 + €20) / KEEP_RATE
          //   KEEP_RATE = 1 - 0.26 - (0.19/1.19) = 0.58034
          //
          // Rules:
          //   1. If min_price > compareAt (RRP) → exclude: can't price above RRP
          //   2. If min_price > current price  → use min_price as the WSNL price
          //   3. If current price already ≥ min_price → keep current price (more profit)
          //
          // compareAt always passes through unchanged as the crossed-out was-price.
          // Only applies to 3170 non-discounted items.
          if (!wsnlDiscount && (stockLocationName === "3170 Warehouse" || stockLocationName === "3140 Warehouse") && cost && cost > 0) {
            const WSNL_KEEP = 1 - WSNL_COMMISSION - (0.19 / 1.19);
            const minPrice = parseFloat(((cost + FIXED_COST_EUR + MIN_PROFIT_EUR) / WSNL_KEEP).toFixed(2));
            const rrp = compareAt || null;

            if (rrp && minPrice > rrp) {
              // Can't sell profitably below RRP — exclude from WSNL
              try { await deleteProduct(`shopify_variant_${variant.id}`); stats.disabled++; } catch (_) {}
              stats.skippedLowMargin++;
              console.log(`  🚫 ${product.title} | ${variant.sku || variant.id} | min price €${minPrice} > RRP €${rrp} — excluded from WSNL`);
              continue;
            }

            const currentSalePrice = parseFloat(specialPrice ?? price);
            if (minPrice > currentSalePrice) {
              // Lift price to the profitable floor
              if (specialPrice) {
                specialPrice = minPrice;
              } else {
                // Use compareAt as the was-price, minPrice as the sale price
                price = rrp || price;
                specialPrice = minPrice;
              }
              console.log(`  💹 ${product.title} | ${variant.sku || variant.id} | lifted €${currentSalePrice} → €${minPrice} (RRP €${rrp}) profit ≥€${MIN_PROFIT_EUR}`);
            } else {
              // Already profitable — use compareAt as was-price if available
              if (rrp && !specialPrice) {
                price = rrp;
                specialPrice = currentSalePrice;
              }
              console.log(`  ✅ ${product.title} | ${variant.sku || variant.id} | €${currentSalePrice} already profitable (min €${minPrice})`);
            }
          }
        }

        const { ok: profitOk, profit } = meetsMinProfit(price, specialPrice, cost);
        if (!profitOk && stockLocationName !== "3171 Warehouse") {
          try { await deleteProduct(`shopify_variant_${variant.id}`); stats.disabled++; } catch (_) {}
          stats.skippedLowMargin++;
          console.log(`  ⏸️  ${product.title} | ${variant.sku || variant.id} | profit €${profit} < €${MIN_PROFIT_EUR} min - excluded from WSNL`);
          continue;
        }
        if (!profitOk && stockLocationName === "3171 Warehouse") {
          console.log(`  📦 ${product.title} | ${variant.sku || variant.id} | profit €${profit} below €${MIN_PROFIT_EUR} min, but listing anyway - 3171 office stock, always imported as-is`);
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
