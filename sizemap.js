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

const ONE_SIZE = /^(os|o\/s|u|uni|unica|uni\.?ca|one[\s._-]?size|onesize|no[\s._-]?size|taille[\s._-]?unique|tu|einheitsgroesse|einheitsgröße|única|unic)$/i;

// Colour words that used to leak through as sizes when a product had only a
// "Colore" option and no size option. Kept as a guard on the fallback path.
const COLOR_WORDS = /^(black|white|blue|red|green|gray|grey|beige|brown|pink|orange|yellow|purple|gold|silver|navy|nude|nero|bianco|rosso|verde|blu|rosa|arancione|giallo|viola|marrone|camel|cream|ivory|coral|taupe|khaki|olive|mint|teal|cyan|metallic|multicolor|multi|print|animal|avorio|panna|grigio|argento|oro)$/i;

// Aliases for values the audit found in the catalog that the vocabulary spells
// differently. All targets verified present in sizes.json.
const ALIASES = {
  // 3XL/4XL notation -> the vocabulary's repeated-X spelling (92 variants)
  "2xl": "xxl", "3xl": "xxxl", "4xl": "xxxxl", "5xl": "xxxxxl",
  "xxl": "xxl", "2 xl": "xxl", "3 xl": "xxxl", "4 xl": "xxxxl",
  // Kidswear year notation -> the vocabulary's "cm (nYR)" codes (53 variants)
  "4y": "104_4yr", "5y": "110_5yr", "6y": "116_6yr", "7y": "122_7yr",
  "8y": "128_8yr", "9y": "134_9yr", "10y": "140_10yr", "11y": "146_11yr",
  "12y": "152_12yr", "13y": "158_13yr", "14y": "164_14yr", "15y": "170_15yr",
  "16y": "176_16yr",
  // Infant month notation. Note 18M maps to the 1.5YR code, and 24M to 2YR —
  // the vocabulary has no separate 18/24-month entry.
  "3m": "62_4m", "6m": "68_6m", "9m": "74_9m", "12m": "80_1yr",
  "18m": "86_1_5yr", "24m": "92_2yr",
  // Patrizia Pepe (Rewix) writes its own numeric sizes 1-5 as Roman numerals.
  "i": "1", "ii": "2", "iii": "3", "iv": "4", "v": "5",
};

function resolveSize(raw) {
  if (raw === null || raw === undefined) return null;
  let v = String(raw).trim();
  if (!v) return null;

  if (ONE_SIZE.test(v)) return CODES.has("one_size") ? "one_size" : null;
  if (COLOR_WORDS.test(v)) return null;

  // Dual-region labels like "EU39/US9" — take the EU/IT figure, drop the rest.
  const dual = v.match(/^\s*(?:eu|it)\s*([0-9]+(?:[.,][0-9])?)\s*[/|]/i);
  if (dual) v = dual[1];

  const aliased = ALIASES[v.toLowerCase().replace(/\s+/g, "")];
  if (aliased && CODES.has(aliased)) return aliased;

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
  // Combined letter sizes are upper-case in the vocabulary: "S-M" -> S_M
  if (CODES.has(structural.toUpperCase())) return structural.toUpperCase();

  // trailing/leading region noise: "42 IT", "EU 39", "US 8"
  const stripped = structural
    .replace(/_(it|eu|uk|us|fr|de|int|intl)$/i, "")
    .replace(/^(it|eu|uk|us|fr|de|int|intl)_?/i, "");
  if (CODES.has(stripped)) return stripped;
  const strippedAlias = ALIASES[stripped.replace(/_/g, "")];
  if (strippedAlias && CODES.has(strippedAlias)) return strippedAlias;

  return null;
}

// Does this category's schema require a size at all? Bags/accessories/shoes
// behave differently per marketplace category — sync.js keeps that decision,
// this module only answers "is this a valid size value".
function isValidCode(code) {
  return CODES.has(code);
}

module.exports = { resolveSize, isValidCode, CODES };
