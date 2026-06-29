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

async function getAllProducts() {
  return fetchProducts({});
}

async function getRecentlyUpdatedProducts(minutes) {
  var since = new Date(Date.now() - minutes * 60 * 1000).toISOString();
  console.log("Incremental sync since: " + since);
  return fetchProducts({ updated_at_min: since });
}

async function fetchProducts(extraParams) {
  if (!extraParams) extraParams = {};
  var products = [];
  var page_info = null;
  do {
    var params = Object.assign({ limit: 250, fields: "id,title,body_html,variants,images,status,vendor,product_type,updated_at" }, page_info ? {} : extraParams);
    if (page_info) params.page_info = page_info;
    var result = await shopify.get("/products.json", { params });
    products.push.apply(products, result.data.products);
    page_info = parseLinkHeader(result.headers.link);
  } while (page_info);
  return products;
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

module.exports = { getAllProducts, getRecentlyUpdatedProducts, getInventoryLevels, getInventoryCost, buildLocationMap, formatManufacturer };
