require('dotenv').config();
const axios = require('axios');
const { getInventoryLevels } = require('./shopify');

const ALLOWED_LOCATIONS = new Set([
  '107924324692', // 3171 Warehouse
  '113070440788', // 3140 Warehouse
]);

const sleep = ms => new Promise(r => setTimeout(r, ms));

const TRANSIENT_CODES = new Set(['ECONNRESET', 'ETIMEDOUT', 'ECONNABORTED', 'EAI_AGAIN', 'EPIPE']);
async function withRetry(fn, label, attempts = 3) {
  for (let i = 1; ; i++) {
    try { return await fn(); }
    catch (e) {
      const status = e.response?.status;
      const transient = TRANSIENT_CODES.has(e.code) || status === 429 || (status >= 500 && status < 600);
      if (!transient || i >= attempts) throw e;
      const wait = i * 2000;
      console.log(`  ↻ ${label}: ${e.code || status}, retrying (${i}/${attempts - 1}) in ${wait / 1000}s`);
      await sleep(wait);
    }
  }
}

let cachedToken = null, tokenExpiry = null;

async function getToken() {
  if (cachedToken && Date.now() < tokenExpiry) return cachedToken;
  const credentials = Buffer.from(
    process.env.WSNL_CLIENT_ID + ':' + process.env.WSNL_CLIENT_SECRET
  ).toString('base64');
  const { data } = await axios.post(
    'https://content.winkelstraat.nl/api/oauth/v1/retailer/token',
    {},
    { headers: { Authorization: 'Basic ' + credentials, 'Content-Type': 'application/json' } }
  );
  cachedToken = data.access_token;
  tokenExpiry = Date.now() + (data.expires_in - 60) * 1000;
  console.log('🔑 Token refreshed');
  return cachedToken;
}

async function wsnlGet(url) {
  const token = await getToken();
  try {
    const { data } = await axios.get(url, { headers: { Authorization: 'Bearer ' + token } });
    return data;
  } catch(e) {
    if (e.response?.status === 401) {
      cachedToken = null;
      const t = await getToken();
      const { data } = await axios.get(url, { headers: { Authorization: 'Bearer ' + t } });
      return data;
    }
    throw e;
  }
}

async function getAllWsnlProducts() {
  const products = [];
  const seen = new Set();
  let page = 1, totalCount = null, fetched = 0;
  while (true) {
    const url = `https://content.winkelstraat.nl/api/rest/v1/retailer/products?limit=100&with_count=true&pagination_type=page&page=${page}`;
    const data = await wsnlGet(url);
    if (totalCount === null) {
      totalCount = data.items_count ?? null;
      console.log(`  WSNL reports ${totalCount} total listings`);
    }
    const items = data._embedded?.items || [];
    if (items.length === 0) break;

    // Guard: if the API ignores the page param and re-serves the same items, stop.
    const newItems = items.filter(p => !seen.has(p.identifier));
    if (newItems.length === 0) {
      console.log(`  ⚠️  Page ${page} returned only already-seen items — API may ignore page param. Stopping.`);
      break;
    }
    for (const p of newItems) seen.add(p.identifier);
    fetched += newItems.length;

    const enabled = newItems.filter(p => p.enabled);
    products.push(...enabled);
    console.log(`  Page ${page}: ${newItems.length} new items, ${enabled.length} enabled (fetched ${fetched}/${totalCount ?? '?'})`);

    if (totalCount !== null && fetched >= totalCount) break;
    page++;
    await sleep(500);
  }
  if (totalCount !== null && fetched < totalCount) {
    console.log(`  ⚠️  Only fetched ${fetched} of ${totalCount} listings — pagination incomplete!`);
  }
  return products;
}

async function safeDeleteFromWsnl(identifier) {
  const token = await getToken();
  const url = 'https://content.winkelstraat.nl/api/rest/v1/retailer/products/' + identifier;

  // Step 1: GET full product
  const { data: full } = await axios.get(url, { headers: { Authorization: 'Bearer ' + token } });

  const category = full.category || (full.categories || []).find(c => c !== 'master' && c !== '104');
  const skip = new Set(['image_1','image_2','image_3','image_4','image_5','image_default']);

  const cleanValues = {};
  for (const [k, v] of Object.entries(full.values || {})) {
    if (skip.has(k)) continue;
    cleanValues[k] = Array.isArray(v) ? v.map(e => { const { _links, ...r } = e; return r; }) : v;
  }
  cleanValues.quantity = [{ data: 0 }];

  // Step 2: Try PATCH with quantity 0 + disabled
  try {
    await axios.patch(url, { identifier: full.identifier, enabled: false, category, values: cleanValues }, {
      headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' }
    });
    await sleep(300);
  } catch(patchErr) {
    // If PATCH fails (missing required fields like EAN), skip straight to DELETE
    // Product was likely never properly live, safe to delete directly
    console.log(`  ⚠️  PATCH failed for ${identifier}, deleting directly: ${patchErr.response?.data?.message || patchErr.message}`);
  }

  // Step 3: DELETE regardless
  await axios.delete(url, { headers: { Authorization: 'Bearer ' + token } });
}

async function run() {
  const DRY_RUN = process.argv.includes('--dry-run');
  console.log(`Mode: ${DRY_RUN ? 'DRY RUN' : 'LIVE'}`);
  console.log('Allowed locations: 3171 + 3140');
  console.log('Fetching all enabled WSNL products...\n');

  const wsnlProducts = await getAllWsnlProducts();
  console.log(`\nTotal enabled WSNL products: ${wsnlProducts.length}\n`);

  let kept = 0, deleted = 0, errors = 0;

  for (const p of wsnlProducts) {
    const match = p.identifier.match(/shopify_variant_(\d+)/);
    if (!match) { console.log(`⚠️  Skipping: ${p.identifier}`); continue; }
    const variantId = match[1];

    try {
      let vdata;
      try {
        const resp = await withRetry(() => axios.get(
          `https://${process.env.SHOPIFY_DOMAIN}/admin/api/2025-01/variants/${variantId}.json?fields=id,inventory_item_id`,
          { headers: { 'X-Shopify-Access-Token': process.env.SHOPIFY_TOKEN } }
        ), p.identifier);
        vdata = resp.data;
      } catch (shopifyErr) {
        if (shopifyErr.response?.status === 404) {
          // Variant no longer exists in Shopify -> true orphan, remove from WSNL
          process.stdout.write('\n');
          if (DRY_RUN) {
            console.log(`[DRY] Orphan (deleted in Shopify), would delete: ${p.identifier}`);
          } else {
            await withRetry(() => safeDeleteFromWsnl(p.identifier), p.identifier + " delete");
            console.log(`🗑️  Orphan deleted: ${p.identifier}`);
          }
          deleted++;
          await sleep(300);
          continue;
        }
        throw shopifyErr;
      }
      await sleep(300);

      const levels = await withRetry(() => getInventoryLevels(vdata.variant.inventory_item_id), p.identifier + ' inventory');
      await sleep(500);

      const hasAllowedStock = levels.some(l =>
        ALLOWED_LOCATIONS.has(String(l.location_id)) && l.available > 0
      );

      if (hasAllowedStock) {
        kept++;
        process.stdout.write('.');
        continue;
      }

      process.stdout.write('\n');
      if (DRY_RUN) {
        console.log(`[DRY] Would delete: ${p.identifier}`);
      } else {
        await withRetry(() => safeDeleteFromWsnl(p.identifier), p.identifier + " delete");
        console.log(`🗑️  Deleted: ${p.identifier}`);
      }
      deleted++;
      await sleep(300);

    } catch(e) {
      if (e.response?.status === 404) {
        deleted++;
        process.stdout.write('\n');
        console.log(`⏭️  Already gone: ${p.identifier}`);
      } else {
        errors++;
        console.log(`❌ ${p.identifier}:`, e.response?.data || e.message);
      }
    }
  }

  console.log(`\n\n=== DONE ===`);
  console.log(`Kept (3171 or 3140 stock): ${kept}`);
  console.log(`Deleted:                   ${deleted}`);
  console.log(`Errors:                    ${errors}`);
}

run().catch(e => console.log(e.message));
