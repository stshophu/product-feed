require("dotenv").config();
const config = require("./config");
const { getAllProducts, getRecentlyUpdatedProducts, getInventoryLevels, buildLocationMap, formatManufacturer } = require("./shopify");
const { upsertProduct, disableProduct } = require("./winkelstraat");
const { calculatePrice } = require("./pricing");

const isFullSync = process.argv.includes("--full");

function getCategoryCode(productType) {
  const categoryMap = {
    "T-shirt": "7460", "Sneakers": "92", "Dress": "120",
    "Jacket": "200", "Pants": "300", "Shoes": "92",
    "Bag": "400", "Accessory": "500",
  };
  if (categoryMap[productType]) return categoryMap[productType];
  const key = Object.keys(categoryMap).find((k) => productType?.toLowerCase().includes(k.toLowerCase()));
  return categoryMap[key] || "120";
}

function cleanImages(product) {
  return (product.images || []).map((img) => img.src).filter((url) => {
    const filename = url.split("/").pop().toLowerCase();
    return !filename.includes("bildschirmfoto") && !filename.includes("screenshot") && !filename.includes("screen_shot");
  });
}

function buildPayload({ product, variant, images, price, specialPrice, quantity }) {
  const payload = {
    identifier: `shopify_variant_${variant.id}`,
    parent: `shopify_product_${product.id}`,
    enabled: true,
    category: getCategoryCode(product.product_type),
    values: {
      name: [{ data: product.title, locale: config.defaultLocale }, { data: product.title, locale: config.secondaryLocale }],
      description: [{ data: product.body_html || product.title, locale: config.defaultLocale }, { data: product.body_html || product.title, locale: config.secondaryLocale }],
      price: [{ data: [{ amount: price, currency: "EUR" }] }],
      manufacturer: [{ data: formatManufacturer(product.vendor) }],
      manufacturer_product_number: [{ data: String(variant.id) }],
      retailer_manufacturer_product_number: [{ data: variant.sku || String(variant.id) }],
      quantity: [{ data: quantity }],
    },
  };
  if (specialPrice) payload.values.special_price = [{ data: [{ amount: specialPrice, currency: "EUR" }] }];
  if (variant.option1) payload.values.size = [{ data: variant.option1 }];
  if (variant.option2) payload.values.color = [{ data: variant.option2.replace(/[_-]/g, " ") }];
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
        try { await disableProduct(`shopify_variant_${variant.id}`); stats.disabled++; } catch (_) {}
      }
      continue;
    }
    const images = cleanImages(product);
    for (const variant of product.variants) {
      try {
        const inventoryLevels = await getInventoryLevels(variant.inventory_item_id);
        await new Promise((r) => setTimeout(r, 150));

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
          try { await disableProduct(`shopify_variant_${variant.id}`); stats.disabled++; } catch (_) {}
          stats.skipped++;
          continue;
        }

        const originalPrice = parseFloat(variant.price);
        const compareAt = variant.compare_at_price ? parseFloat(variant.compare_at_price) : null;
        const { price, specialPrice } = calculatePrice(originalPrice, compareAt, markupRate);

        const payload = buildPayload({ product, variant, images, price, specialPrice, quantity: stockQuantity });
        await upsertProduct(payload);
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
