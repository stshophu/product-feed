require("dotenv").config();
const config = require("./config");
const { getAllProducts, getRecentlyUpdatedProducts, getInventoryLevels, buildLocationMap, formatManufacturer, getInventoryCost } = require("./shopify");
const { upsertProduct, deleteProduct } = require("./winkelstraat");
const { calculatePrice } = require("./pricing");
const { getCategoryCode } = require("./categories");
const { findBrandCode } = require("./brandmap");
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
      manufacturer_product_number: [{ data: String(variant.id) }],
      retailer_manufacturer_product_number: [{ data: variant.sku || String(variant.id) }],
      quantity: [{ data: quantity }],
      ...(variant.barcode && /^[0-9]{12,13}$/.test(variant.barcode.trim()) ? { ean: [{ data: variant.barcode.trim() }] } : {}),
    },
  };
  if (specialPrice) payload.values.special_price = [{ data: [{ amount: specialPrice, currency: "EUR" }] }];
  const sizePattern = /^(xs|s|m|l|xl|xxl|xxxl|xxxxl|xxxxxl|xxxs|xxs|one.?size|\d+[\.,]?\d*|\d+\/\d+|one_size)$/i;
  const colorWords = /^(black|white|blue|red|green|gray|grey|beige|brown|pink|orange|yellow|purple|gold|silver|navy|nude|nero|bianco|rosso|verde|blu|rosa|arancione|giallo|viola|marrone|beige|camel|cream|ivory|coral|taupe|khaki|olive|mint|teal|cyan|metallic|multicolor|multi|print|animal)$/i;
  const option1isSze = variant.option1 && sizePattern.test(variant.option1.trim()) && !colorWords.test(variant.option1.trim());
  const option2isSze = variant.option2 && sizePattern.test(variant.option2.trim());
  const sizeValue = option1isSze ? variant.option1 : (option2isSze ? variant.option2 : (variant.option1 || null));
  let cleanSize = sizeValue ? sizeValue.replace(/,/g, ".").replace(/^one size$/i, "one_size") : null;
  // Round half sizes down (42.5 -> 42)
  if (cleanSize && /^\d+\.5$/.test(cleanSize)) {
    cleanSize = String(Math.floor(parseFloat(cleanSize)));
  }
  const noSizeCategories = ["219", "253", "140", "678", "7850", "7851"]; // accessories, bags
  const productCategory = getCategoryCode(product.product_type, product.tags);
  const looksLikeSize = cleanSize && (sizePattern.test(cleanSize) || /^(one_size|xxs|xs|s|m|l|xl|xxl|xxxl|xxxxl|xxxxxl)$/i.test(cleanSize));
  if (looksLikeSize && !colorWords.test(cleanSize) && !noSizeCategories.includes(productCategory)) {
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
  const stats = { synced: 0, skipped: 0, disabled: 0, errors: 0 };

  const [locationMap, products] = await Promise.all([
    buildLocationMap(),
    isFullSync ? getAllProducts() : getRecentlyUpdatedProducts(35),
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
        await new Promise((r) => setTimeout(r, 600));

        let stockQuantity = 0, markupRate = null, stockLocationName = null;
        for (const level of inventoryLevels) {
          if (!allowedLocationIds.has(String(level.location_id))) continue;
          if (level.available <= 0) continue;
          const locName = locationMap[level.location_id];
          stockQuantity = level.available;
          markupRate = config.locations[locName].markup;
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
        const { price, specialPrice } = calculatePrice(originalPrice, compareAt, markupRate);

        const payload = buildPayload({ product, variant, images, price, specialPrice, quantity: stockQuantity, brandCode });
        try {
          await upsertProduct(payload);
        } catch(upsertErr) {
          const msg = upsertErr.response ? JSON.stringify(upsertErr.response.data) : upsertErr.message;
          if (msg.includes('Cursor not valid')) {
            // Delete and recreate
            await deleteProduct(payload.identifier);
            await upsertProduct(payload);
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
  console.log(`✅ Done in ${duration}s | Synced: ${stats.synced} | Skipped: ${stats.skipped} | Disabled: ${stats.disabled} | Errors: ${stats.errors}`);
  console.log("═══════════════════════════════════════════════════");
}

sync().catch((e) => { console.error("💥 Sync failed:", e.message); process.exit(1); });
