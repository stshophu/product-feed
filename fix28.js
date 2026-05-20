const fs = require('fs');
let code = fs.readFileSync('winkelstraat.js', 'utf8');

// Add disableBeforeDelete function
code = code.replace(
  'async function deleteProduct(identifier) {',
  `async function disableBeforeDelete(identifier) {
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
  await disableBeforeDelete(identifier);`
);

fs.writeFileSync('winkelstraat.js', code);
console.log('Done');
