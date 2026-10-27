// Known brands, their real website addresses, and what the real
// company never does. Shared by rules, detector and pattern-card checks
// (a card may never flag a brand's real address — PRD safeguard).

export const BRANDS = [
  { name: "PayPal", domains: ["paypal.com", "paypal.fr", "paypalobjects.com", "paypal-community.com"], never: "PayPal never asks you to confirm your password by email." },
  { name: "Chase", domains: ["chase.com", "jpmorganchase.com", "chasecdn.com"], never: "Chase never asks you to move money to protect it." },
  { name: "Bank of America", aliases: ["BofA"], domains: ["bankofamerica.com", "bofa.com"], never: "Bank of America never asks for your password by email." },
  { name: "Wells Fargo", domains: ["wellsfargo.com"], never: "Wells Fargo never asks you to send money to yourself." },
  { name: "Amazon", domains: ["amazon.com", "amazon.fr", "amazon.co.uk", "amazon.de", "amazonaws.com", "media-amazon.com", "ssl-images-amazon.com"], never: "Amazon never asks you to pay a redelivery fee by text message." },
  { name: "Apple", domains: ["apple.com", "icloud.com"], never: "Apple never asks for gift-card codes as payment." },
  // owned: real addresses of the brand whose names are ordinary words
  // ("live", "office", "outlook"): they count as the brand's own, but are
  // never used to recognise a claim ("Live Nation" is not Microsoft).
  { name: "Microsoft", domains: ["microsoft.com", "microsoftonline.com"], owned: ["office.com", "office365.com", "live.com", "outlook.com", "msn.com", "passport.net", "windows.com", "bing.com", "skype.com", "xbox.com"], never: "Microsoft never puts a phone number in a security warning." },
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
  // Impersonated in 2025-2026 campaigns (IC3, cybermalveillance.gouv.fr,
  // callback-phishing and job-offer reports). Bare surnames ("Norton") are
  // deliberately not names: a friend called Norton is not a brand claim.
  // Banks most impersonated in the US and France (FBI IC3, cybermalveillance.gouv.fr).
  { name: "USAA", kind: "bank", domains: ["usaa.com"], never: "USAA never asks for your password or PIN by email." },
  { name: "Citibank", kind: "bank", aliases: ["Citi"], domains: ["citi.com", "citibank.com"], never: "Citi never asks for your password or PIN by email." },
  { name: "Capital One", kind: "bank", domains: ["capitalone.com"], never: "Capital One never asks for your password by email." },
  { name: "Navy Federal", kind: "bank", aliases: ["Navy Federal Credit Union"], domains: ["navyfederal.org"], never: null },
  { name: "RBC", kind: "bank", aliases: ["Royal Bank of Canada", "RBC Royal Bank"], domains: ["rbc.com", "rbcroyalbank.com"], never: null },
  { name: "HSBC", kind: "bank", domains: ["hsbc.com", "hsbc.fr", "hsbc.co.uk"], never: null },
  { name: "Barclays", kind: "bank", domains: ["barclays.com", "barclays.co.uk"], never: null },
  { name: "BNP Paribas", kind: "bank", aliases: ["BNP"], domains: ["bnpparibas.com", "bnpparibas.net", "mabanque.bnpparibas"], never: "BNP Paribas ne vous demande jamais vos codes par e-mail ou SMS." },
  { name: "Crédit Agricole", kind: "bank", domains: ["credit-agricole.fr", "credit-agricole.com"], never: "Le Crédit Agricole ne vous demande jamais vos codes par e-mail ou SMS." },
  { name: "LCL", kind: "bank", domains: ["lcl.fr"], never: "LCL ne vous demande jamais vos codes par e-mail ou SMS." },
  { name: "La Banque Postale", kind: "bank", domains: ["labanquepostale.fr"], never: "La Banque Postale ne vous demande jamais vos codes par e-mail ou SMS." },
  { name: "Caisse d'Épargne", kind: "bank", aliases: ["Caisse d'Epargne"], domains: ["caisse-epargne.fr"], never: "La Caisse d'Épargne ne vous demande jamais vos codes par e-mail ou SMS." },
  { name: "Crédit Mutuel", kind: "bank", domains: ["creditmutuel.fr"], never: "Le Crédit Mutuel ne vous demande jamais vos codes par e-mail ou SMS." },
  { name: "Boursorama", kind: "bank", aliases: ["BoursoBank"], domains: ["boursorama.com", "boursobank.com"], never: null },
  { name: "Adecco", domains: ["adecco.com", "adecco.fr", "adeccogroup.com", "adeccousa.com"], never: "Adecco never asks you to book a job interview through a link sent from an invoicing service." },
  { name: "Randstad", domains: ["randstad.com", "randstad.fr", "randstadusa.com"], never: null },
  { name: "LinkedIn", domains: ["linkedin.com", "licdn.com"], never: null },
  { name: "DocuSign", domains: ["docusign.com", "docusign.net"], never: "DocuSign never asks you to call a phone number to cancel a charge." },
  { name: "QuickBooks", aliases: ["Intuit"], domains: ["intuit.com", "quickbooks.com", "quickbooks.intuit.com"], never: null },
  { name: "Xero", domains: ["xero.com"], never: null },
  { name: "Geek Squad", domains: ["geeksquad.com", "bestbuy.com"], never: "Geek Squad never emails surprise renewal invoices asking you to call to cancel." },
  { name: "McAfee", domains: ["mcafee.com"], never: "McAfee never asks you to call a number from an email to stop a renewal." },
  { name: "Norton LifeLock", noStems: true, aliases: ["NortonLifeLock", "Norton 360", "Norton Security", "Norton Antivirus", "Norton Support"], domains: ["norton.com", "nortonlifelock.com", "gen.digital"], never: "Norton never asks you to call a number from an email to stop a renewal." },
  { name: "Impôts", aliases: ["impots.gouv", "DGFiP", "Finances publiques"], domains: ["impots.gouv.fr", "dgfip.finances.gouv.fr"], never: "Les impôts ne vous demandent jamais vos coordonnées bancaires par e-mail ou SMS pour un remboursement." },
  { name: "CAF", aliases: ["Caisse d'allocations familiales"], domains: ["caf.fr"], never: "La CAF ne demande jamais vos coordonnées bancaires par e-mail ou SMS." },
  { name: "France Travail", aliases: ["Pôle emploi"], domains: ["francetravail.fr", "pole-emploi.fr"], never: "France Travail ne demande jamais de paiement ni vos codes par message." },
  { name: "Mon Compte Formation", aliases: ["CPF"], domains: ["moncompteformation.gouv.fr"], never: "Vos droits CPF n'expirent jamais à la date annoncée dans un SMS." },
  { name: "La Poste", aliases: ["Colissimo"], domains: ["laposte.fr", "colissimo.fr", "lapostegroupe.com"], never: "La Poste ne demande jamais de frais de livraison par SMS." },
  { name: "EDF", domains: ["edf.fr", "edf.com"], never: "EDF ne vous demande jamais vos coordonnées bancaires par e-mail pour un remboursement." },
  { name: "Engie", domains: ["engie.fr", "engie.com"], never: "Engie ne vous demande jamais vos coordonnées bancaires par e-mail pour un remboursement." },
  { name: "Crit'Air", aliases: ["Critair", "vignette Crit'Air"], domains: ["certificat-air.gouv.fr"], never: "La vignette Crit'Air se commande uniquement sur certificat-air.gouv.fr." },
];

// Services that send mail on behalf of their customers from their own
// domain: authentication proves the platform, never the person writing.
// `when`: only some of the platform's mail carries customer-written text.
export const SENDING_PLATFORMS = [
  { name: "Xero", domains: ["xero.com"], kind: ["invoicing", "de facturation"] },
  { name: "QuickBooks", domains: ["intuit.com", "quickbooks.com"], kind: ["invoicing", "de facturation"], when: /invoice|payment|facture|paiement/i },
  { name: "DocuSign", domains: ["docusign.net"], kind: ["e-signature", "de signature électronique"] },
  { name: "PayPal", domains: ["paypal.com"], kind: ["invoice", "de factures"], when: /\b(invoice|money request|request(ed)? (a )?payment|facture|demande (de paiement|d'argent))\b/i },
  { name: "Square", domains: ["squareup.com", "square.com"], kind: ["invoicing", "de facturation"], when: /invoice|facture/i },
  { name: "Google Calendar", domains: ["google.com"], kind: ["calendar invitation", "d'invitations d'agenda"], from: /^calendar-notification@/i },
  { name: "Google Forms", domains: ["google.com"], kind: ["forms", "de formulaires"], from: /^forms-receipts-noreply@/i },
  { name: "Google Drive", domains: ["google.com"], kind: ["file-sharing", "de partage de fichiers"], from: /^drive-shares(-dm)?-noreply@/i },
  { name: "Dropbox", domains: ["dropbox.com", "dropboxmail.com"], kind: ["file-sharing", "de partage de fichiers"], when: /shared|partagé/i },
];
export function platformFor(fromAddress = "", text = "") {
  const d = domainOf(fromAddress);
  return SENDING_PLATFORMS.find((p) => p.domains.some((pd) => sameOrSub(d, pd))
    && (!p.from || p.from.test(String(fromAddress))) && (!p.when || p.when.test(text))) || null;
}

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
export const belongsTo = (domain, brand) => Boolean(domain && [...(brand?.domains || []), ...(brand?.owned || [])].some((d) => sameOrSub(domain, d)));

// Names are compared on a "skeleton": accents folded and look-alike
// characters mapped to the letter they imitate (capital I and 1 -> l,
// 0 -> o, rn -> m, Cyrillic а/е/о/р/с -> a/e/o/p/c). "Societe GeneraIe"
// and "Société Générale" share a skeleton; only one of them is honest.
// Invisible characters (zero-width, joiners, Unicode tags) are removed
// before comparing: "P\u200bayPal" is PayPal wearing a disguise.
const INVISIBLE = /[\u00ad\u034f\u061c\u115f\u1160\u17b4\u17b5\u180e\u200b-\u200f\u202a-\u202e\u2060-\u2064\u206a-\u206f\ufeff\u{e0000}-\u{e007f}]/gu;
export const stripInvisible = (s = "") => String(s).replace(INVISIBLE, "");
const CONFUSABLES = [[/rn/g, "m"], [/vv/g, "w"], [/[I1|]/g, "l"], [/0/g, "o"], [/[аА]/g, "a"], [/[еЕ]/g, "e"], [/[оО]/g, "o"],
  [/[рР]/g, "p"], [/[сС]/g, "c"], [/[хХ]/g, "x"], [/[іІ]/g, "i"], [/[ѕЅ]/g, "s"]];
export const foldAccents = (s = "") => String(s).normalize("NFKD").replace(/[\u0300-\u036f]/g, "");
export function skeleton(s = "") {
  let out = foldAccents(stripInvisible(s));
  for (const [re, to] of CONFUSABLES) out = out.replace(re, to);
  return out.toLowerCase();
}
const plain = (s = "") => foldAccents(s).toLowerCase();

// Whole words only: "purchase" must not claim Chase, "Google Groups" must
// not claim UPS, "first" must not claim the IRS.
const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const wordIn = (t, w) => new RegExp(`(^|[^\\p{L}\\p{N}])${escapeRe(w)}($|[^\\p{L}\\p{N}])`, "iu").test(t);
export const mentions = (text, word) => wordIn(skeleton(text), skeleton(word));

const brandWords = (b) => [b.name, ...(b.aliases || []), ...(b.noStems ? [] : b.domains.map((d) => d.split(".")[0]).filter((stem) => stem.length >= 4))];

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

// A website address that borrows a brand's name without being the brand:
// adecco-hrjobs.com, hrteamadecco.com, chase.secure-login.top. The brand
// word must be a whole hyphen-separated part of a label (3+ letters:
// edf-remboursement, irs-refund), or for words of 6+ letters begin or end
// a part (mypaypal-secure), so "purchase" never borrows Chase.
export function brandInDomain(domain = "") {
  const d = String(domain).toLowerCase();
  if (!d.includes(".") || FREEMAIL.includes(d.split(".").slice(-2).join("."))) return null;
  // The registrable name (adecco-hrjobs in calendar.adecco-hrjobs.com) may
  // borrow a brand freely; a subdomain (chase.secure-login.top) only counts
  // when the address also carries a lure word, so apple.slashdot.org is fine.
  const labels = d.split(".").slice(0, -1);
  const regCount = ["co", "com", "gouv", "org", "ac"].includes(labels.at(-1)) && labels.length > 1 ? 2 : 1;
  const lure = /(secure|login|log-in|signin|sign-in|verif|account|update|support|billing|auth|confirm|service|alert|unlock|recover|wallet|webscr)/.test(d);
  const split = (label) => {
    const p = label.split(/[-_]/);
    // Neighbouring parts joined too: credit-agricole-secure -> creditagricole.
    return [...p, ...p.slice(1).map((x, i) => p[i] + x), ...p.slice(2).map((x, i) => p[i] + p[i + 1] + x)];
  };
  const parts = [...labels.slice(-regCount).flatMap(split), ...(lure ? labels.slice(0, -regCount).flatMap(split) : [])];
  const squash = (w) => w.replace(/[^a-z0-9]/g, "");
  return BRANDS.find((b) => {
    if (belongsTo(d, b)) return false;
    // Names, aliases and every domain stem (surnames are only a concern in
    // display names; "norton-secure.com" is borrowing).
    const raw = [b.name, ...(b.aliases || []), ...b.domains.map((x) => x.split(".")[0])];
    const plainWords = raw.map((w) => squash(plain(w))).filter((w) => w.length >= 3);
    const skelWords = raw.map((w) => squash(skeleton(w))).filter((w) => w.length >= 3);
    const hit = (part, words) => words.some((w) => part === w || (w.length >= 6 && part !== w && (part.startsWith(w) || part.endsWith(w))));
    return parts.some((part) => hit(part, plainWords) || hit(squash(skeleton(part)), skelWords));
  }) || null;
}
