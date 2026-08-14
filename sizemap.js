// sizemap.js — resolve any incoming size string to a size code the marketplace
// actually accepts.
//
// sizes.json is the marketplace's own size attribute vocabulary (456 codes).
// Until now sync.js never consulted it: it guessed with a regex, sent the raw
// string, and hoped. Two consequences worth naming:
//
//   1. Half sizes were destroyed. The old code did
//        if (/^\d+\.5$/.test(cleanSize)) cleanSize = String(Math.floor(...))
//      so a 10,5 shoe was listed as a 10 — even though sizes.json has a real
//      "10_5" code. That is a wrong-size shipment waiting to happen, not just
//      an import error.
//   2. Anything outside the vocabulary was sent anyway and rejected by the API.
//
// Resolution order: exact code -> normalised code -> label match -> null.
// Returning null is deliberate: sync.js then omits the size rather than sending
// a value the API will reject.

const SIZES = require("./sizes.json");

const CODES = new Set(SIZES.map((s) => s.code));

// label ("10,5", "104 (4YR)", "1/3 M") -> code, normalised for lookup
const LABEL_TO_CODE = {};
for (const s of SIZES) {
  for (const label of Object.values(s.labels || {})) {
    LABEL_TO_CODE[normalise(label)] = s.code;
  }
  LABEL_TO_CODE[normalise(s.code)] = s.code;
}

function normalise(raw) {
  return String(raw)
    .toLowerCase()
    .trim()
    .replace(/\s+/g, " ")
    .replace(/[.,]/g, ",");
}

const ONE_SIZE = /^(os|o\/s|uni|unica|uni\.?ca|one[\s._-]?size|onesize|taille[\s._-]?unique|tu|einheitsgroesse|einheitsgröße|única|unic)$/i;

// Colour words that used to leak through as sizes when a product had only a
// "Colore" option and no size option. Kept as a guard on the fallback path.
const COLOR_WORDS = /^(black|white|blue|red|green|gray|grey|beige|brown|pink|orange|yellow|purple|gold|silver|navy|nude|nero|bianco|rosso|verde|blu|rosa|arancione|giallo|viola|marrone|camel|cream|ivory|coral|taupe|khaki|olive|mint|teal|cyan|metallic|multicolor|multi|print|animal|avorio|panna|grigio|argento|oro)$/i;

function resolveSize(raw) {
  if (raw === null || raw === undefined) return null;
  let v = String(raw).trim();
  if (!v) return null;

  if (ONE_SIZE.test(v)) return CODES.has("one_size") ? "one_size" : null;
  if (COLOR_WORDS.test(v)) return null;

  // exact code as stored in Shopify (best case — the taxonomy work may already
  // be writing marketplace codes directly)
  if (CODES.has(v)) return v;
  const lower = v.toLowerCase();
  if (CODES.has(lower)) return lower;

  // label match: "10,5" / "10.5" -> 10_5,  "0/3" -> 0_3,  "104 (4YR)" -> 104_4yr
  const byLabel = LABEL_TO_CODE[normalise(v)];
  if (byLabel) return byLabel;

  // structural normalisation: separators -> underscore, drop spaces
  const structural = lower
    .replace(/[\s]+/g, "")
    .replace(/[.,]/g, "_")
    .replace(/[/\\-]/g, "_")
    .replace(/_+/g, "_")
    .replace(/^_|_$/g, "");
  if (CODES.has(structural)) return structural;

  // trailing unit noise: "42 IT", "M / EU", "US 8"
  const stripped = structural
    .replace(/_(it|eu|uk|us|fr|de|int|intl)$/i, "")
    .replace(/^(it|eu|uk|us|fr|de|int|intl)_/i, "");
  if (CODES.has(stripped)) return stripped;

  return null;
}

// Does this category's schema require a size at all? Bags/accessories/shoes
// behave differently per marketplace category — sync.js keeps that decision,
// this module only answers "is this a valid size value".
function isValidCode(code) {
  return CODES.has(code);
}

module.exports = { resolveSize, isValidCode, CODES };
