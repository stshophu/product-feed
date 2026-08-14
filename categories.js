// categories.js — resolve a marketplace category code.
//
// v2: the Shopify catalog now carries a real taxonomy (Category / Subcategory
// product metafields + a gender signal), so that is the primary input and
// product_type is demoted to a fallback. The old signature is preserved so
// nothing that still calls getCategoryCode(product_type, tags) breaks.
//
// Precedence for the *type* signal:   subcategory > category > product_type > title
// Precedence for the *gender* signal: gender metafield > category metafield > tags > title
//
// The matcher stays substring-based on purpose. It means the exact vocabulary
// used in the metafields ("Coats", "Coats & Jackets", "Outerwear – Coats",
// "Mäntel") does not have to be enumerated in advance — anything containing
// "coat" lands on the coats code. Add exact-match overrides in TYPE_OVERRIDES
// only where a value would otherwise match the wrong rule.

// ── Gender ────────────────────────────────────────────────────────────────
// Word-boundary matching, so "women" no longer accidentally satisfies the
// "men" test (the old code worked around this with a !includes("women")
// guard, which broke on strings containing both, e.g. "menswear, womenswear").
function detectGenderFrom(sources) {
  const t = sources
    .filter(Boolean)
    .map((s) => (Array.isArray(s) ? s.join(",") : String(s)))
    .join(" , ")
    .toLowerCase();
  if (!t.trim()) return null;

  const has = (re) => re.test(t);

  if (has(/\b(boys?|jongens)\b/) && !has(/\b(girls?|meisjes)\b/)) return "kids_boys";
  if (has(/\b(girls?|meisjes)\b/) && !has(/\b(boys?|jongens)\b/)) return "kids_girls";
  if (has(/\b(kids?|children|kinder|baby|babies|junior)\b/)) return "kids";

  const women = has(/\b(women|womens|women'?s|woman|dames|damen|female|donna|femme|mujer|w)\b/);
  const men = has(/\b(men|mens|men'?s|man|heren|herren|male|uomo|homme|hombre|m)\b/);
  if (women && !men) return "women";
  if (men && !women) return "men";
  // Both present (e.g. a "Men" product tagged "womenswear-adjacent") or neither:
  // prefer the earliest explicit token so an explicit metafield wins over noise.
  if (women && men) {
    const wi = t.search(/\b(women|womens|women'?s|woman|dames|damen|female|donna)\b/);
    const mi = t.search(/\b(men|mens|men'?s|man|heren|herren|male|uomo)\b/);
    return wi <= mi ? "women" : "men";
  }
  return null;
}

// Backwards-compatible export
function detectGender(tags) {
  return detectGenderFrom([tags]) || "women";
}

// ── Type → code ───────────────────────────────────────────────────────────
// Exact-value overrides, checked before the substring rules. Use these for
// taxonomy values that would otherwise match a broader rule first.
const TYPE_OVERRIDES = {
  women: {
    "shorts": "108",
    "jumpsuits": "215",
    "blazers": "189",
  },
  men: {
    "shorts": "19",
    "polo shirts": "23",
    "suits": "74",
  },
};

const WOMEN_RULES = [
  [/\b(pant|trouser|broek|short|legging|hose)/, "108"],
  [/\b(coat|jacket|jas|parka|trench|outerwear|mantel|blouson|puffer)/, "114"],
  [/\b(jean|denim)/, "116"],
  [/\b(dress|jurk|kleid|abito|robe)/, "118"],
  [/\b(top|t-shirt|tshirt|tee|shirt|maglia)/, "120"],
  [/\b(sweater|sweatshirt|hoodie|cardigan|trui|knit|jumper|pullover|maglione)/, "126"],
  [/\b(skirt|rok|rock|gonna|jupe)/, "128"],
  [/\b(bag|tas|purse|clutch|tote|backpack|handbag|borsa)/, "140"],
  [/\b(blazer|suit)/, "189"],
  [/\b(shoe|boot|sneaker|heel|flat|sandal|loafer|pump|footwear|schoen|scarpa|mule|espadrille|ballerina)/, "199"],
  [/\b(jumpsuit|romper|playsuit|overall|tuta)/, "215"],
  [/\b(accessoir|accessory|accessories|belt|scarf|hat|cap|glove|jewel|jewellery|jewelry|watch|sunglass|wallet|riem|sjaal)/, "219"],
  [/\b(blouse|camicia)/, "7441"],
  [/\b(swim|bikini|badkleding|beachwear|costume)/, "7770"],
  [/\b(sport|activ|gym|yoga|running|track)/, "7792"],
];

const MEN_RULES = [
  [/\b(pant|trouser|broek|short|chino|hose)/, "19"],
  [/\b(jean|denim)/, "20"],
  [/\b(sweater|sweatshirt|hoodie|trui|knit|jumper|pullover|maglione)/, "21"],
  [/\b(shirt|top|t-shirt|tshirt|tee|polo|camicia)/, "23"],
  [/\b(coat|jacket|jas|parka|trench|outerwear|mantel|blouson|puffer)/, "24"],
  [/\b(swim|badkleding|beachwear|costume)/, "26"],
  [/\b(blazer|vest|suit|gilet)/, "74"],
  [/\b(cardigan)/, "82"],
  [/\b(accessoir|accessory|accessories|belt|scarf|hat|cap|glove|watch|sunglass|wallet|tie|riem|sjaal)/, "253"],
  [/\b(shoe|boot|sneaker|loafer|sandal|footwear|schoen|scarpa|derby|oxford|moccasin)/, "255"],
  [/\b(bag|tas|backpack|briefcase|borsa)/, "678"],
  [/\b(sport|activ|gym|running|track)/, "7793"],
];

const DEFAULTS = { women: "120", men: "23", kids_boys: "7804", kids_girls: "7815", kids: "7803" };

function matchRules(rules, text) {
  for (const [re, code] of rules) if (re.test(text)) return code;
  return null;
}

// Values so generic they carry no type information. If the subcategory is one
// of these we fall through to the next signal instead of defaulting blindly —
// this is the same failure that put 36% of the Allegro feed in one bucket.
const GENERIC = /^(clothing|kleding|bekleidung|apparel|fashion|other|overig|sonstiges|misc|general|uncategorized|-|n\/a)$/i;

function resolveCategory({ gender, category, subcategory, productType, tags, title }) {
  const g =
    detectGenderFrom([gender]) ||
    detectGenderFrom([category]) ||
    detectGenderFrom([tags]) ||
    detectGenderFrom([title]) ||
    "women";

  const candidates = [subcategory, category, productType, title]
    .filter((v) => v && !GENERIC.test(String(v).trim()));

  const rules = g === "men" ? MEN_RULES : WOMEN_RULES;
  const overrides = TYPE_OVERRIDES[g === "men" ? "men" : "women"] || {};

  for (const raw of candidates) {
    const text = String(raw).toLowerCase().trim();
    if (overrides[text]) return { code: overrides[text], gender: g, matchedOn: raw, confident: true };
    const code = matchRules(rules, text);
    if (code) return { code, gender: g, matchedOn: raw, confident: true };
  }

  // Kids have no type-level breakdown in the marketplace taxonomy here.
  if (g.startsWith("kids")) return { code: DEFAULTS[g], gender: g, matchedOn: null, confident: true };

  return { code: DEFAULTS[g], gender: g, matchedOn: null, confident: false };
}

// Old signature — still used by fix16.js and any legacy caller.
function getCategoryCode(productType, tags) {
  return resolveCategory({ productType, tags }).code;
}

module.exports = { getCategoryCode, detectGender, detectGenderFrom, resolveCategory, GENERIC };
