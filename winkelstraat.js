const axios = require("axios");
let cachedToken = null, tokenExpiry = null;

async function getToken() {
  if (cachedToken && Date.now() < tokenExpiry) return cachedToken;
  const { data } = await axios.post(
    "https://content.winkelstraat.nl/oauth/token",
    new URLSearchParams({
      grant_type: "client_credentials",
      client_id: process.env.WSNL_CLIENT_ID,
      client_secret: process.env.WSNL_CLIENT_SECRET,
    }),
    { headers: { "Content-Type": "application/x-www-form-urlencoded" } }
  );
  cachedToken = data.access_token;
  tokenExpiry = Date.now() + (data.expires_in - 60) * 1000;
  console.log("🔑 Winkelstraat token refreshed");
  return cachedToken;
}

async function upsertProduct(productData) {
  const token = await getToken();
  const headers = { Authorization: `Bearer ${token}`, "Content-Type": "application/json" };
  const url = `https://content.winkelstraat.nl/api/rest/v1/retailer/products/${productData.identifier}`;
  try {
    await axios.patch(url, productData, { headers });
  } catch (e) {
    if (e.response?.status === 404) {
      await axios.post("https://content.winkelstraat.nl/api/rest/v1/retailer/products", productData, { headers });
    } else throw e;
  }
}

async function deleteProduct(identifier) {
  const token = await getToken();
  try {
    await axios.delete(
      `https://content.winkelstraat.nl/api/rest/v1/retailer/products/${identifier}`,
      { headers: { Authorization: `Bearer ${token}` } }
    );
    console.log(`  🗑️  Deleted: ${identifier}`);
  } catch (e) {
    // Product doesn't exist on WSNL — that's fine, nothing to delete
    if (e.response?.status !== 404) throw e;
  }
}

module.exports = { upsertProduct, deleteProduct };
