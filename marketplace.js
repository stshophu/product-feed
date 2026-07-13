const axios = require("axios");
let cachedToken = null, tokenExpiry = null;

// Retry wrapper for Marketplace API calls: handles 429 rate limits and transient
// 5xx/network errors so one blip doesn't abort a long full sync.
async function withRetry(fn, label) {
  const MAX = 6;
  for (let attempt = 0; attempt <= MAX; attempt++) {
    try {
      return await fn();
    } catch (e) {
      const status = e.response ? e.response.status : null;
      const retriable = status === 429 || (status >= 500 && status < 600) || !e.response;
      if (!retriable || attempt === MAX) throw e;
      let waitMs;
      const ra = e.response && e.response.headers && e.response.headers["retry-after"];
      if (ra) waitMs = parseFloat(ra) * 1000;
      else waitMs = Math.min(1000 * Math.pow(2, attempt + 1), 16000);
      console.log(`  ⏳ Marketplace ${status || "network error"} on ${label}, retry ${attempt + 1}/${MAX} in ${Math.round(waitMs)}ms`);
      await new Promise((r) => setTimeout(r, waitMs));
    }
  }
}

async function getToken() {
  if (cachedToken && Date.now() < tokenExpiry) return cachedToken;

  const credentials = Buffer.from(
    process.env.MARKETPLACE_CLIENT_ID + ":" + process.env.MARKETPLACE_CLIENT_SECRET
  ).toString("base64");

  const { data } = await axios.post(
    process.env.MARKETPLACE_API_BASE + "/api/oauth/v1/retailer/token",
    {},
    {
      headers: {
        "Authorization": "Basic " + credentials,
        "Content-Type": "application/json",
      },
    }
  );

  cachedToken = data.access_token;
  tokenExpiry = Date.now() + (data.expires_in - 60) * 1000;
  console.log("🔑 Marketplace token refreshed");
  return cachedToken;
}

async function upsertProduct(productData) {
  const token = await getToken();
  const headers = { Authorization: "Bearer " + token, "Content-Type": "application/json" };
  const url = process.env.MARKETPLACE_API_BASE + "/api/rest/v1/retailer/products/" + productData.identifier;
  try {
    await withRetry(() => axios.patch(url, productData, { headers }), "upsert-patch");
  } catch (e) {
    if (e.response && e.response.status === 404) {
      await withRetry(() => axios.post(process.env.MARKETPLACE_API_BASE + "/api/rest/v1/retailer/products", productData, { headers }), "upsert-post");
    } else throw e;
  }
}

// Stock-only update for the light sync. Only PATCHes quantity/enabled on an
// EXISTING listing - unlike upsertProduct, a 404 here is not turned into a
// POST, because the light sync has no full payload (images, category, brand,
// price, ean...) to create a listing with. New listings are still only ever
// created by the full sync (sync.js).
async function updateStock(identifier, quantity) {
  const token = await getToken();
  const headers = { Authorization: "Bearer " + token, "Content-Type": "application/json" };
  const url = process.env.MARKETPLACE_API_BASE + "/api/rest/v1/retailer/products/" + identifier;
  const payload = { enabled: true, values: { quantity: [{ data: quantity }] } };
  try {
    await withRetry(() => axios.patch(url, payload, { headers }), "stock-patch");
  } catch (e) {
    if (e.response && e.response.status === 404) {
      // Not on Marketplace yet - full sync's job to create it, not this one's.
      return;
    }
    throw e;
  }
}

async function disableBeforeDelete(identifier) {
  const token = await getToken();
  const headers = { Authorization: "Bearer " + token, "Content-Type": "application/json" };
  try {
    await withRetry(() => axios.patch(
      process.env.MARKETPLACE_API_BASE + "/api/rest/v1/retailer/products/" + identifier,
      { enabled: false, values: { quantity: [{ data: 0 }] } },
      { headers }
    ), "disable-patch");
    console.log("  ⏸️  Disabled: " + identifier);
  } catch(e) { /* product may not exist, ignore */ }
}

async function deleteProduct(identifier) {
  await disableBeforeDelete(identifier);
  const token = await getToken();
  try {
    await withRetry(() => axios.delete(
      process.env.MARKETPLACE_API_BASE + "/api/rest/v1/retailer/products/" + identifier,
      { headers: { Authorization: "Bearer " + token } }
    ), "delete");
    console.log("  🗑️  Deleted: " + identifier);
  } catch (e) {
    if (!e.response || e.response.status !== 404) throw e;
  }
}

module.exports = { upsertProduct, updateStock, deleteProduct };
