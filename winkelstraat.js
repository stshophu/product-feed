const axios = require("axios");
let cachedToken = null, tokenExpiry = null;

// Retry wrapper for WSNL API calls: handles 429 rate limits and transient
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
      console.log(`  ⏳ WSNL ${status || "network error"} on ${label}, retry ${attempt + 1}/${MAX} in ${Math.round(waitMs)}ms`);
      await new Promise((r) => setTimeout(r, waitMs));
    }
  }
}

async function getToken() {
  if (cachedToken && Date.now() < tokenExpiry) return cachedToken;

  const credentials = Buffer.from(
    process.env.WSNL_CLIENT_ID + ":" + process.env.WSNL_CLIENT_SECRET
  ).toString("base64");

  const { data } = await axios.post(
    "https://content.winkelstraat.nl/api/oauth/v1/retailer/token",
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
  console.log("🔑 Winkelstraat token refreshed");
  return cachedToken;
}

async function upsertProduct(productData) {
  const token = await getToken();
  const headers = { Authorization: "Bearer " + token, "Content-Type": "application/json" };
  const url = "https://content.winkelstraat.nl/api/rest/v1/retailer/products/" + productData.identifier;
  try {
    await withRetry(() => axios.patch(url, productData, { headers }), "upsert-patch");
  } catch (e) {
    if (e.response && e.response.status === 404) {
      await withRetry(() => axios.post("https://content.winkelstraat.nl/api/rest/v1/retailer/products", productData, { headers }), "upsert-post");
    } else throw e;
  }
}

async function disableBeforeDelete(identifier) {
  const token = await getToken();
  const headers = { Authorization: "Bearer " + token, "Content-Type": "application/json" };
  try {
    await withRetry(() => axios.patch(
      "https://content.winkelstraat.nl/api/rest/v1/retailer/products/" + identifier,
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
      "https://content.winkelstraat.nl/api/rest/v1/retailer/products/" + identifier,
      { headers: { Authorization: "Bearer " + token } }
    ), "delete");
    console.log("  🗑️  Deleted: " + identifier);
  } catch (e) {
    if (!e.response || e.response.status !== 404) throw e;
  }
}

module.exports = { upsertProduct, deleteProduct };
