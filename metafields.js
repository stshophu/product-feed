// metafields.js — build an in-memory index of Shopify metafields.
//
// Why this exists: the REST products.json endpoint used by shopify.js does NOT
// return metafields, so the taxonomy work done in Shopify (Category /
// Subcategory product metafields, Size variant metafield) was completely
// invisible to the sync. This module pulls them once per run via GraphQL and
// hands sync.js a plain lookup:
//
//   index.product[<numeric product id>]  -> { category, subcategory, gender, ... }
//   index.variant[<numeric variant id>]  -> { size, ... }
//
// It deliberately does NOT hard-code a namespace. Metafield definitions get
// created with whatever namespace the Shopify UI/app picked ("custom",
// "my_fields", "shopify", an app reserved one...), and guessing wrong would
// silently produce an empty index — the exact failure mode we're fixing. So it
// reads every metafield on the object and matches on the KEY name instead.

const axios = require("axios");
const config = require("./config");

const KEY_MATCHERS = {
  // order matters: subcategory must be tested before category, otherwise
  // "subcategory" also matches the /categor/ pattern.
  subcategory: /^(sub[_\-\s]?categor(y|ie)|unter[_\-\s]?kategorie)/i,
  category: /^(categor(y|ie)|kategorie|product[_\-\s]?categor(y|ie))/i,
  gender: /^(gender|geschlecht|sex|target[_\-\s]?(group|audience)|doelgroep)/i,
  size: /^(size|maat|groesse|größe|grootte|taglia)/i,
};

function gqlClient() {
  return axios.create({
    baseURL: `https://${process.env.SHOPIFY_DOMAIN}/admin/api/${config.shopifyApiVersion}`,
    headers: {
      "X-Shopify-Access-Token": process.env.SHOPIFY_TOKEN,
      "Content-Type": "application/json",
    },
    timeout: 60000,
  });
}

// Shopify GraphQL returns HTTP 200 with a THROTTLED error in the body rather
// than a 429, so the axios interceptor in shopify.js would not catch it.
async function gql(query, variables, attempt = 1) {
  const client = gqlClient();
  let res;
  try {
    res = await client.post("/graphql.json", { query, variables });
  } catch (e) {
    if (attempt <= 5) {
      const wait = Math.min(1000 * Math.pow(2, attempt), 16000);
      console.log(`  ⏳ GraphQL network/${e.response?.status || "?"} error, retry ${attempt}/5 in ${wait}ms`);
      await new Promise((r) => setTimeout(r, wait));
      return gql(query, variables, attempt + 1);
    }
    throw e;
  }
  const errors = res.data.errors;
  if (errors) {
    const throttled = errors.some((x) => x.extensions && x.extensions.code === "THROTTLED");
    if (throttled && attempt <= 8) {
      const wait = Math.min(2000 * attempt, 20000);
      console.log(`  ⏳ GraphQL throttled, retry ${attempt}/8 in ${wait}ms`);
      await new Promise((r) => setTimeout(r, wait));
      return gql(query, variables, attempt + 1);
    }
    throw new Error("GraphQL error: " + JSON.stringify(errors));
  }
  return res.data.data;
}

function numericId(gid) {
  if (!gid) return null;
  const m = String(gid).match(/(\d+)$/);
  return m ? m[1] : null;
}

// Metafield values are strings. list.* types arrive as a JSON array string
// (e.g. '["Coats","Jackets"]'); take the first entry so downstream code always
// sees a plain string.
function readValue(mf) {
  if (!mf || mf.value === null || mf.value === undefined) return null;
  let v = String(mf.value).trim();
  if (!v) return null;
  if (v.startsWith("[")) {
    try {
      const arr = JSON.parse(v);
      if (Array.isArray(arr) && arr.length) v = String(arr[0]).trim();
    } catch (_) { /* leave as-is */ }
  }
  // metaobject references can't be resolved to a label here — flag rather than
  // silently feeding "gid://shopify/Metaobject/123" into the category matcher.
  if (/^gid:\/\/shopify\//.test(v)) return { unresolved: v };
  return v;
}

// The audit found THREE competing namespaces per field, e.g.
//   category:    custom.category, filter.category, gs1.category_gpc
//   subcategory: rewix.subcategory, filter.subcategory, custom.subcategory
//   gender:      google.gender, rewix.gender, custom.gender
// Without an explicit ranking, whichever one GraphQL happened to return first
// won — a non-deterministic choice that would silently vary between products
// and between runs. gs1.category_gpc in particular is a GS1 GPC brick term,
// not a wearable-type name, so letting it win would poison the match.
// Lower number = preferred. Unlisted namespaces rank last.
const NAMESPACE_PRIORITY = { custom: 0, rewix: 1, filter: 2, google: 3, shopify: 4, gs1: 9 };

function rank(ns) {
  return NAMESPACE_PRIORITY[ns] !== undefined ? NAMESPACE_PRIORITY[ns] : 8;
}

function collect(metafieldNodes) {
  const out = {};
  const chosenRank = {};
  const nodes = (metafieldNodes || []).slice().sort((a, b) => rank(a.namespace) - rank(b.namespace));
  for (const mf of nodes) {
    for (const [field, re] of Object.entries(KEY_MATCHERS)) {
      if (out[field] !== undefined && chosenRank[field] <= rank(mf.namespace)) continue;
      if (re.test(mf.key)) {
        chosenRank[field] = rank(mf.namespace);
        const val = readValue(mf);
        if (val && val.unresolved) {
          out[field + "_unresolved"] = val.unresolved;
        } else if (val) {
          out[field] = val;
          out[field + "_source"] = `${mf.namespace}.${mf.key}`;
        }
        break;
      }
    }
  }
  return out;
}

const PRODUCT_QUERY = `
query($cursor: String) {
  products(first: 50, after: $cursor) {
    pageInfo { hasNextPage endCursor }
    nodes {
      id
      metafields(first: 20) { nodes { namespace key value type } }
    }
  }
}`;

const VARIANT_QUERY = `
query($cursor: String) {
  productVariants(first: 100, after: $cursor) {
    pageInfo { hasNextPage endCursor }
    nodes {
      id
      metafields(first: 10) { nodes { namespace key value type } }
    }
  }
}`;

async function buildMetafieldIndex() {
  const index = { product: {}, variant: {} };

  let cursor = null, pages = 0;
  do {
    const data = await gql(PRODUCT_QUERY, { cursor });
    for (const node of data.products.nodes) {
      const id = numericId(node.id);
      if (id) index.product[id] = collect(node.metafields.nodes);
    }
    cursor = data.products.pageInfo.hasNextPage ? data.products.pageInfo.endCursor : null;
    pages++;
  } while (cursor);
  console.log(`🏷️  Product metafields indexed: ${Object.keys(index.product).length} products (${pages} pages)`);

  cursor = null; pages = 0;
  do {
    const data = await gql(VARIANT_QUERY, { cursor });
    for (const node of data.productVariants.nodes) {
      const id = numericId(node.id);
      if (id) index.variant[id] = collect(node.metafields.nodes);
    }
    cursor = data.productVariants.pageInfo.hasNextPage ? data.productVariants.pageInfo.endCursor : null;
    pages++;
  } while (cursor);
  console.log(`🏷️  Variant metafields indexed: ${Object.keys(index.variant).length} variants (${pages} pages)`);

  // Coverage warning: if the taxonomy fields aren't landing, say so loudly at
  // the start of the run instead of quietly falling back for 3000 products.
  const prods = Object.values(index.product);
  const withCat = prods.filter((p) => p.category || p.subcategory).length;
  const vars = Object.values(index.variant);
  const withSize = vars.filter((v) => v.size).length;
  const pct = (n, d) => (d ? Math.round((n / d) * 100) : 0);
  console.log(`🏷️  Coverage: category/subcategory on ${withCat}/${prods.length} products (${pct(withCat, prods.length)}%), size on ${withSize}/${vars.length} variants (${pct(withSize, vars.length)}%)`);
  if (prods.length && pct(withCat, prods.length) < 50) {
    console.log("  ⚠️  Fewer than half the products expose a Category/Subcategory metafield to the API.");
    console.log("      Most likely cause: the metafield definition is not marked as readable by this");
    console.log("      access token's app scopes, or the values sit on a metaobject reference.");
  }

  return index;
}

module.exports = { buildMetafieldIndex, KEY_MATCHERS };
