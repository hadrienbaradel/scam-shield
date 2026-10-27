// Known brands, their real website addresses, and what the real
// company never does. Shared by rules, detector and pattern-card checks
// (a card may never flag a brand's real address — PRD safeguard).

export const BRANDS = [
  { name: "PayPal", domains: ["paypal.com"], never: "PayPal never asks you to confirm your password by email." },
  { name: "Chase", domains: ["chase.com", "jpmorganchase.com"], never: "Chase never asks you to move money to protect it." },
  { name: "Bank of America", aliases: ["BofA"], domains: ["bankofamerica.com", "bofa.com"], never: "Bank of America never asks for your password by email." },
  { name: "Wells Fargo", domains: ["wellsfargo.com"], never: "Wells Fargo never asks you to send money to yourself." },
  { name: "Amazon", domains: ["amazon.com"], never: "Amazon never asks you to pay a redelivery fee by text message." },
  { name: "Apple", domains: ["apple.com", "icloud.com"], never: "Apple never asks for gift-card codes as payment." },
  { name: "Microsoft", domains: ["microsoft.com"], never: "Microsoft never puts a phone number in a security warning." },
  { name: "Netflix", domains: ["netflix.com"], never: null },
  { name: "IRS", domains: ["irs.gov"], never: "The IRS never threatens arrest by email or asks for gift cards." },
  { name: "Social Security", aliases: ["SSA"], domains: ["ssa.gov"], never: "Social Security never suspends benefits by email." },
  { name: "Medicare", domains: ["medicare.gov", "cms.gov"], never: "Medicare never asks you to pay to keep your coverage by email." },
  { name: "USPS", domains: ["usps.com"], never: "USPS never texts you to pay a redelivery fee." },
  { name: "FedEx", domains: ["fedex.com"], never: "FedEx never asks for delivery fees by text message." },
  { name: "UPS", domains: ["ups.com"], never: null },
  { name: "E-ZPass", domains: ["e-zpassny.com", "ezdrivema.com", "bayareafastrak.org"], never: "Your toll agency never threatens big late fees by text message." },
  { name: "Bouygues Telecom", aliases: ["Bbox"], domains: ["bouyguestelecom.fr", "bouygues-telecom.fr", "bouygues.com"], never: "Bouygues Telecom ne vous demandera jamais vos codes bancaires par e-mail." },
  { name: "Société Générale", aliases: ["SG"], domains: ["societegenerale.fr", "sg.fr", "societegenerale.com"], never: "Société Générale ne vous demandera jamais vos codes par e-mail." },
  { name: "Chronopost", domains: ["chronopost.fr"], never: "Chronopost ne demande jamais de frais de livraison par SMS." },
  { name: "Ameli", domains: ["ameli.fr", "assurance-maladie.fr"], never: "Ameli ne fait jamais payer une nouvelle carte Vitale." },
  { name: "ANTAI", domains: ["antai.gouv.fr", "amendes.gouv.fr"], never: "Les amendes ne se paient jamais en scannant un QR code sur l'avis papier." },
];

export const FREE_HOSTING_SUFFIXES = [
  ".bolt.host", ".vercel.app", ".netlify.app", ".web.app", ".github.io",
  ".weebly.com", ".wixsite.com", ".wordpress.com", ".blogspot.com",
];

export function domainOf(value = "") {
  const s = String(value).toLowerCase().trim();
  // A phone number or short code is not a website address ("5551234" would
  // otherwise parse as the IP 0.84.180.130).
  if (!s || /^[+\d\s().-]+$/.test(s)) return "";
  const m = s.match(/@([a-z0-9.-]+\.[a-z]{2,})/);
  if (m) return m[1].replace(/[>)\]]+$/, "");
  try { return new URL(s.startsWith("http") ? s : `https://${s}`).hostname; } catch { return ""; }
}

export const sameOrSub = (domain, real) => domain === real || domain.endsWith(`.${real}`);
export const belongsTo = (domain, brand) => Boolean(domain && brand?.domains.some((d) => sameOrSub(domain, d)));

// Names are compared on a "skeleton": accents folded and look-alike
// characters mapped to the letter they imitate (capital I and 1 -> l,
// 0 -> o, rn -> m, Cyrillic а/е/о/р/с -> a/e/o/p/c). "Societe GeneraIe"
// and "Société Générale" share a skeleton; only one of them is honest.
const CONFUSABLES = [[/rn/g, "m"], [/vv/g, "w"], [/[I1|]/g, "l"], [/0/g, "o"], [/[аА]/g, "a"], [/[еЕ]/g, "e"], [/[оО]/g, "o"],
  [/[рР]/g, "p"], [/[сС]/g, "c"], [/[хХ]/g, "x"], [/[іІ]/g, "i"], [/[ѕЅ]/g, "s"]];
export const foldAccents = (s = "") => String(s).normalize("NFKD").replace(/[\u0300-\u036f]/g, "");
export function skeleton(s = "") {
  let out = foldAccents(s);
  for (const [re, to] of CONFUSABLES) out = out.replace(re, to);
  return out.toLowerCase();
}
const plain = (s = "") => foldAccents(s).toLowerCase();

// Whole words only: "purchase" must not claim Chase, "Google Groups" must
// not claim UPS, "first" must not claim the IRS.
const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const wordIn = (t, w) => new RegExp(`(^|[^\\p{L}\\p{N}])${escapeRe(w)}($|[^\\p{L}\\p{N}])`, "iu").test(t);
export const mentions = (text, word) => wordIn(skeleton(text), skeleton(word));

const brandWords = (b) => [b.name, ...(b.aliases || []), ...b.domains.map((d) => d.split(".")[0]).filter((stem) => stem.length >= 4)];

export function claimedBrands(text = "", explicit = "") {
  const t = `${explicit} ${text}`;
  return BRANDS.filter((b) => brandWords(b).some((w) => mentions(t, w)));
}

// The text names the brand only once look-alike letters are undone:
// a deliberate disguise, never a typo a real company makes.
export function lookalikeOf(text = "", brand) {
  if (!brand) return false;
  const words = brandWords(brand);
  return words.some((w) => mentions(text, w)) && !words.some((w) => wordIn(plain(text), plain(w)));
}

// Personal mailbox providers: no bank, carrier or agency writes from these.
export const FREEMAIL = ["gmail.com", "googlemail.com", "yahoo.com", "yahoo.fr", "aol.com", "aol.fr", "hotmail.com", "hotmail.fr",
  "outlook.com", "outlook.fr", "live.com", "live.fr", "msn.com", "icloud.com", "me.com", "orange.fr", "wanadoo.fr", "free.fr",
  "laposte.net", "sfr.fr", "gmx.com", "gmx.fr", "proton.me", "protonmail.com", "mail.com", "yandex.com", "yandex.ru"];

// Country of a sender address, from its country-code ending. Endings used
// as generic brands (.co, .io, .me, .ai, .tv, .ly) are ignored.
const COUNTRIES = { br: ["Brazil", "Brésil"], ru: ["Russia", "Russie"], cn: ["China", "Chine"], in: ["India", "Inde"], ng: ["Nigeria", "Nigeria"],
  vn: ["Vietnam", "Vietnam"], id: ["Indonesia", "Indonésie"], tr: ["Turkey", "Turquie"], ar: ["Argentina", "Argentine"], mx: ["Mexico", "Mexique"],
  pl: ["Poland", "Pologne"], ua: ["Ukraine", "Ukraine"], za: ["South Africa", "Afrique du Sud"], my: ["Malaysia", "Malaisie"], ph: ["the Philippines", "les Philippines"],
  pk: ["Pakistan", "Pakistan"], th: ["Thailand", "Thaïlande"], kr: ["South Korea", "Corée du Sud"], jp: ["Japan", "Japon"], cl: ["Chile", "Chili"],
  pe: ["Peru", "Pérou"], ro: ["Romania", "Roumanie"], bg: ["Bulgaria", "Bulgarie"], ma: ["Morocco", "Maroc"], ci: ["Côte d'Ivoire", "Côte d'Ivoire"],
  sn: ["Senegal", "Sénégal"], cm: ["Cameroon", "Cameroun"], de: ["Germany", "Allemagne"], es: ["Spain", "Espagne"], it: ["Italy", "Italie"],
  nl: ["the Netherlands", "les Pays-Bas"], be: ["Belgium", "Belgique"], uk: ["the United Kingdom", "le Royaume-Uni"], ca: ["Canada", "Canada"],
  fr: ["France", "France"], us: ["the United States", "les États-Unis"] };
const GENERIC_CC = ["co", "io", "me", "ai", "tv", "ly", "fm", "gg", "sh", "to", "ws", "cc", "app"];
export function countryOf(domain = "") {
  const cc = String(domain).toLowerCase().split(".").pop();
  if (!cc || cc.length !== 2 || GENERIC_CC.includes(cc)) return null;
  return COUNTRIES[cc] ? { code: cc, en: COUNTRIES[cc][0], fr: COUNTRIES[cc][1] } : { code: cc, en: `another country (.${cc})`, fr: `un autre pays (.${cc})` };
}
export function brandCountry(brand) {
  const ccs = new Set((brand?.domains || []).map((d) => countryOf(d)?.code).filter(Boolean));
  return ccs.size === 1 ? [...ccs][0] : ccs.size === 0 ? "generic" : null;
}

export function brandByName(name) {
  return BRANDS.find((b) => b.name.toLowerCase() === String(name || "").toLowerCase()) || null;
}
