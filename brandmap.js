const brands = require('./brands.json');

// Build lookup map: normalized name → wsnl code
const brandMap = {};
brands.forEach(b => {
  // Store by code
  brandMap[b.code.toLowerCase()] = b.code;
  // Store by label
  const label = (b.labels.en_US || '').toLowerCase().trim();
  if (label) brandMap[label] = b.code;
});

function normalizeBrand(vendor) {
  if (!vendor) return null;
  return vendor.toLowerCase().trim()
    .replace(/\s+/g, ' ')
    .replace(/[&]/g, 'and')
    .replace(/[^a-z0-9\s]/g, '');
}

function findBrandCode(vendor) {
  if (!vendor) return null;
  const v = vendor.toLowerCase().trim();

  // 1. Exact match on label
  if (brandMap[v]) return brandMap[v];

  // 2. Normalized match
  const norm = normalizeBrand(v);
  if (brandMap[norm]) return brandMap[norm];

  // 3. Partial match — vendor contains brand name or vice versa
  for (const [key, code] of Object.entries(brandMap)) {
    if (key.length > 3 && (v.includes(key) || key.includes(v))) return code;
  }

  return null;
}

module.exports = { findBrandCode };
