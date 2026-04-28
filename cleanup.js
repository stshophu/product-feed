require('dotenv').config();
const axios = require('axios');

async function cleanup() {
  const creds = Buffer.from(process.env.WSNL_CLIENT_ID + ':' + process.env.WSNL_CLIENT_SECRET).toString('base64');
  const { data: auth } = await axios.post('https://content.winkelstraat.nl/api/oauth/v1/retailer/token', {}, {
    headers: { 'Authorization': 'Basic ' + creds, 'Content-Type': 'application/json' }
  });
  const token = auth.access_token;
  const headers = { Authorization: 'Bearer ' + token };

  let page = 1, deleted = 0, checked = 0;
  console.log('Starting cleanup of zero-stock products...');

  while (true) {
    const { data } = await axios.get(
      'https://content.winkelstraat.nl/api/rest/v1/retailer/products?limit=100&page=' + page,
      { headers }
    );
    const items = data._embedded?.items || [];
    if (items.length === 0) break;

    for (const item of items) {
      checked++;
      const qty = item.values?.quantity?.[0]?.data;
      if (qty === 0 || qty === null || qty === undefined) {
        try {
          await axios.delete(
            'https://content.winkelstraat.nl/api/rest/v1/retailer/products/' + item.identifier,
            { headers }
          );
          console.log('Deleted:', item.identifier, item.values?.name?.[0]?.data);
          deleted++;
          await new Promise(r => setTimeout(r, 200));
        } catch(e) {
          console.log('Failed to delete', item.identifier, e.response?.data);
        }
      }
    }
    console.log('Page', page, '- checked:', checked, 'deleted:', deleted);
    page++;
    if (!data._links?.next) break;
  }

  console.log('Cleanup done! Checked:', checked, 'Deleted:', deleted);
}

cleanup().catch(console.error);
