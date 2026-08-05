const axios = require("axios");
const config = require("./config");

const shopify = axios.create({
  baseURL: `https://${process.env.SHOPIFY_DOMAIN}/admin/api/${config.shopifyApiVersion}`,
  headers: {
    "X-Shopify-Access-Token": process.env.SHOPIFY_TOKEN,
    "Content-Type": "application/json",
  },
});

// Retry on Shopify rate limits (429) and transient server errors (5xx).
// Without this a single 429 during a long full sync aborts the whole run.
const MAX_RETRIES = 6;
shopify.interceptors.response.use(null, async (error) => {
  const cfg = error.config;
  if (!cfg) throw error;
  const status = error.response ? error.response.status : null;
  const retriable = status === 429 || (status >= 500 && status < 600) || !error.response;
  cfg.__retryCount = cfg.__retryCount || 0;
  if (!retriable || cfg.__retryCount >= MAX_RETRIES) throw error;
  cfg.__retryCount += 1;
  // Shopify sends Retry-After (seconds) on 429; otherwise exponential backoff.
  let waitMs;
  const ra = error.response && error.response.headers && error.response.headers["retry-after"];
  if (ra) waitMs = parseFloat(ra) * 1000;
  else waitMs = Math.min(1000 * Math.pow(2, cfg.__retryCount), 16000);
  console.log(`  ⏳ Shopify ${status || "network error"}, retry ${cfg.__retryCount}/${MAX_RETRIES} in ${Math.round(waitMs)}ms`);
  await new Promise((r) => setTimeout(r, waitMs));
  return shopify(cfg);
});

async function getProduct(productId) {
  try {
    const { data } = await shopify.get(`/products/${productId}.json`);
    return data.product;
  } catch (e) {
    if (e.response && e.response.status === 404) return null; // deleted from Shopify
    throw e;
  }
}

async function getLocations() {
  const { data } = await shopify.get("/locations.json");
  return data.locations;
}

async function getInventoryLevels(inventoryItemId) {
  const { data } = await shopify.get("/inventory_levels.json", {
    params: { inventory_item_ids: inventoryItemId },
  });
  return data.inventory_levels;
}

async function getInventoryCost(inventoryItemId) {
  const { data } = await shopify.get(`/inventory_items/${inventoryItemId}.json`);
  return parseFloat(data.inventory_item.cost || 0);
}

async function getVariantInventoryItemId(variantId) {
  const { data } = await shopify.get(`/variants/${variantId}.json`, {
    params: { fields: "id,inventory_item_id" },
  });
  return data.variant.inventory_item_id;
}

async function getAllProducts() {
  return fetchProducts({});
}

async function getRecentlyUpdatedProducts(minutes) {
  var since = new Date(Date.now() - minutes * 60 * 1000).toISOString();
  console.log("Incremental sync since: " + since);
  return fetchProducts({ updated_at_min: since });
}

// Minimal-field product fetch for the stock-only light sync — skips
// body_html/images/product_type/updated_at since that job never builds a
// full Marketplace payload, only patches quantity or disables a listing.
async function getAllProductsLight() {
  return fetchProducts({}, "id,title,variants,status");
}

async function fetchProducts(extraParams, fieldsOverride) {
  if (!extraParams) extraParams = {};
  var fields = fieldsOverride || "id,title,body_html,variants,images,status,vendor,product_type,updated_at";
  var products = [];
  var page_info = null;
  do {
    var params = Object.assign({ limit: 250, fields: fields }, page_info ? {} : extraParams);
    if (page_info) params.page_info = page_info;
    var result = await shopify.get("/products.json", { params });
    products.push.apply(products, result.data.products);
    page_info = parseLinkHeader(result.headers.link);
  } while (page_info);
  return products;
}

// Bulk inventory levels for a fixed set of locations, paginated - used by
// the light stock sync so it doesn't need one Shopify call per variant.
// Shopify's inventory_levels.json accepts a comma-separated location_ids
// filter and is paginated the same way as products.json.
async function getInventoryLevelsForLocations(locationIds) {
  var levels = [];
  var page_info = null;
  do {
    var params = page_info
      ? { limit: 250, page_info: page_info }
      : { limit: 250, location_ids: locationIds.join(",") };
    var result = await shopify.get("/inventory_levels.json", { params });
    levels.push.apply(levels, result.data.inventory_levels);
    page_info = parseLinkHeader(result.headers.link);
  } while (page_info);
  return levels;
}

async function buildLocationMap() {
  var locations = await getLocations();
  var map = {};
  for (var i = 0; i < locations.length; i++) {
    map[locations[i].id] = locations[i].name;
  }
  return map;
}

function parseLinkHeader(header) {
  if (!header) return null;
  var match = header.match(/page_info=([^&>]+)[^>]*>; rel="next"/);
  return match ? match[1] : null;
}

function formatManufacturer(raw) {
  if (!raw) return "Unknown";
  return raw.split(/[-_]/).map(function(w) {
    return w.charAt(0).toUpperCase() + w.slice(1);
  }).join(" ");
}

module.exports = { getAllProducts, getAllProductsLight, getRecentlyUpdatedProducts, getProduct, getInventoryLevels, getInventoryLevelsForLocations, getInventoryCost, getVariantInventoryItemId, buildLocationMap, formatManufacturer };
