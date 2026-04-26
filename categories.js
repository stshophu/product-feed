// categories.js — Map Shopify product_type + gender tag → Winkelstraat category code

function detectGender(tags) {
  if (!tags) return "women"; // default
  const t = (Array.isArray(tags) ? tags.join(",") : tags).toLowerCase();
  if (t.includes("men") && !t.includes("women")) return "men";
  if (t.includes("heren") && !t.includes("dames")) return "men";
  if (t.includes("male") && !t.includes("female")) return "men";
  if (t.includes("boy") && !t.includes("girl")) return "kids_boys";
  if (t.includes("girl")) return "kids_girls";
  if (t.includes("kids") || t.includes("baby") || t.includes("children")) return "kids";
  if (t.includes("women") || t.includes("dames") || t.includes("female")) return "women";
  return "women"; // default to women
}

function getCategoryCode(productType, tags) {
  const gender = detectGender(tags);
  const t = (productType || "").toLowerCase();

  // ── WOMEN (parent: 104) ──────────────────────────────────
  if (gender === "women") {
    if (t.includes("pant") || t.includes("trouser") || t.includes("broek") || t.includes("short")) return "108";
    if (t.includes("coat") || t.includes("jacket") || t.includes("jas")) return "114";
    if (t.includes("jean") || t.includes("denim")) return "116";
    if (t.includes("dress") || t.includes("jurk")) return "118";
    if (t.includes("top") || t.includes("t-shirt") || t.includes("tshirt") || t.includes("shirt")) return "120";
    if (t.includes("sweater") || t.includes("sweatshirt") || t.includes("hoodie") || t.includes("cardigan") || t.includes("trui")) return "126";
    if (t.includes("skirt") || t.includes("rok")) return "128";
    if (t.includes("bag") || t.includes("tas") || t.includes("purse") || t.includes("clutch")) return "140";
    if (t.includes("blazer")) return "189";
    if (t.includes("shoe") || t.includes("boot") || t.includes("sneaker") || t.includes("heel") || t.includes("flat") || t.includes("sandal") || t.includes("loafer") || t.includes("pump")) return "199";
    if (t.includes("jumpsuit") || t.includes("romper") || t.includes("playsuit")) return "215";
    if (t.includes("accessoir") || t.includes("accessory") || t.includes("belt") || t.includes("scarf") || t.includes("hat") || t.includes("jewelry") || t.includes("watch")) return "219";
    if (t.includes("blouse")) return "7441";
    if (t.includes("swim") || t.includes("bikini") || t.includes("badkleding")) return "7770";
    if (t.includes("sport") || t.includes("activ") || t.includes("gym") || t.includes("yoga")) return "7792";
    return "120"; // default women: Tops
  }

  // ── MEN (parent: 17) ────────────────────────────────────
  if (gender === "men") {
    if (t.includes("pant") || t.includes("trouser") || t.includes("broek") || t.includes("short")) return "19";
    if (t.includes("jean") || t.includes("denim")) return "20";
    if (t.includes("sweater") || t.includes("sweatshirt") || t.includes("hoodie") || t.includes("trui")) return "21";
    if (t.includes("shirt") || t.includes("top") || t.includes("t-shirt") || t.includes("tshirt") || t.includes("polo")) return "23";
    if (t.includes("coat") || t.includes("jacket") || t.includes("jas")) return "24";
    if (t.includes("swim") || t.includes("badkleding")) return "26";
    if (t.includes("blazer") || t.includes("vest") || t.includes("suit")) return "74";
    if (t.includes("cardigan")) return "82";
    if (t.includes("accessoir") || t.includes("accessory") || t.includes("belt") || t.includes("scarf") || t.includes("hat") || t.includes("watch")) return "253";
    if (t.includes("shoe") || t.includes("boot") || t.includes("sneaker") || t.includes("loafer") || t.includes("sandal")) return "255";
    if (t.includes("bag") || t.includes("tas")) return "678";
    if (t.includes("sport") || t.includes("activ") || t.includes("gym")) return "7793";
    return "23"; // default men: Shirts
  }

  // ── KIDS ────────────────────────────────────────────────
  if (gender === "kids_boys") return "7804";
  if (gender === "kids_girls") return "7815";
  if (gender === "kids") return "7803";

  return "120"; // final fallback: Women Tops
}

module.exports = { getCategoryCode, detectGender };
