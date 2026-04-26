const axios = require("axios");
const config = require("./config");

const shopify = axios.create({
  baseURL: `https://${process.env.SHOPIFY_DOMAIN}/admin/api/${config.shopifyApiVersion}`,
  headers: {
    "X-Shopify-Access-Token": process.env.SHOPIFY_TOKEN,
    "Content-Type": "application/json",
  },
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

async function getAllProducts() {
  return fetchProducts({});
}

async function getRecentlyUpdatedProducts(minutes = 35) {
  const since = new Date(Date.now() - minutes * 60 * 1000).toISOString();
  console.log(`🕐 Incremental sync — updated since: ${since}`);
  return fetchProducts({ updated_at_min: since });
}

async function fetchProducts(extraParams = {}) {
  let products = [], page_info = null;
  do {
    const params = { limit: 250, fields: "id,title,body_html,variants,images,status,vendor,product_type,updated_at", ...extraParams };
    if (page_info) params.page_info = page_info;
    const { data, headers } = await shopify.get("/products.json", { params });
    products.push(...data.products);
    page_info = parseLinkHeader(headers.link);
  } while (page_info);
  return products;
}

async function buildLocationMap() {
  const locations = await getLocations();
  const map = {};
  for (const loc of locations) map[loc.id] = loc.name;
  return map;
}

function parseLinkHeader(header) {
  if (!header) return null;
  const match = header.match(/page_info=([^&>]+)[^>]*>; rel="next"/);
  return match ? match[1] : null;
}

function formatManufacturer(raw) {
  if (!raw) return "Unknown";
  return raw.replace(/[_-]/g, " ").replace(/\b\w/g, (c) => c.toUpperC
cat > .github/workflows/sync.yml << 'EOF'
name: Shopify → Winkelstraat Catalog Sync

on:
  schedule:
    - cron: "*/30 * * * *"
  workflow_dispatch:
    inputs:
      mode:
        description: "Sync mode"
        required: true
        default: "incremental"
        type: choice
        options:
          - incremental
          - full

jobs:
  sync:
    runs-on: ubuntu-latest
    timeout-minutes: 60
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: "20"
          cache: "npm"
      - run: npm ci
      - name: Run incremental sync (scheduled)
        if: github.event_name == 'schedule'
        env:
          SHOPIFY_DOMAIN: ${{ secrets.SHOPIFY_DOMAIN }}
          SHOPIFY_TOKEN: ${{ secrets.SHOPIFY_TOKEN }}
          WSNL_CLIENT_ID: ${{ secrets.WSNL_CLIENT_ID }}
          WSNL_CLIENT_SECRET: ${{ secrets.WSNL_CLIENT_SECRET }}
        run: node sync.js
      - name: Run sync (manual)
        if: github.event_name == 'workflow_dispatch'
        env:
          SHOPIFY_DOMAIN: ${{ secrets.SHOPIFY_DOMAIN }}
          SHOPIFY_TOKEN: ${{ secrets.SHOPIFY_TOKEN }}
          WSNL_CLIENT_ID: ${{ secrets.WSNL_CLIENT_ID }}
          WSNL_CLIENT_SECRET: ${{ secrets.WSNL_CLIENT_SECRET }}
        run: node sync.js ${{ github.event.inputs.mode == 'full' && '--full' || '' }}
