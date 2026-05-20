const axios = require("axios");
let cachedToken = null, tokenExpiry = null;

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
    await axios.patch(url, productData, { headers });
  } catch (e) {
    if (e.response && e.response.status === 404) {
      await axios.post("https://content.winkelstraat.nl/api/rest/v1/retailer/products", productData, { headers });
    } else throw e;
  }
}

async function disableBeforeDelete(identifier) {
  const token = await getToken();
  const headers = { Authorization: "Bearer " + token, "Content-Type": "application/json" };
  try {
    await axios.patch(
      "https://content.winkelstraat.nl/api/rest/v1/retailer/products/" + identifier,
      { enabled: false, values: { quantity: [{ data: 0 }] } },
      { headers }
    );
    console.log("  ⏸️  Disabled: " + identifier);
  } catch(e) { /* product may not exist, ignore */ }
}

async function deleteProduct(identifier) {
  await disableBeforeDelete(identifier);
  const token = await getToken();
  try {
    await axios.delete(
      "https://content.winkelstraat.nl/api/rest/v1/retailer/products/" + identifier,
      { headers: { Authorization: "Bearer " + token } }
    );
    console.log("  🗑️  Deleted: " + identifier);
  } catch (e) {
    if (!e.response || e.response.status !== 404) throw e;
  }
}

module.exports = { upsertProduct, deleteProduct };
