// Known brands, their real website addresses, and what the real
// company never does. Shared by rules, detector and pattern-card checks
// (a card may never flag a brand's real address — PRD safeguard).

export const BRANDS = [
  { name: "PayPal", domains: ["paypal.com", "paypal.fr", "paypalobjects.com", "paypal-community.com"], never: "PayPal never asks you to confirm your password by email." },
  { name: "Chase", domains: ["chase.com", "jpmorganchase.com", "chasecdn.com"], never: "Chase never asks you to move money to protect it." },
  { name: "Bank of America", aliases: ["BofA"], domains: ["bankofamerica.com", "bofa.com"], never: "Bank of America never asks for your password by email." },
  { name: "Wells Fargo", domains: ["wellsfargo.com"], never: "Wells Fargo never asks you to send money to yourself." },
  { name: "Amazon", anyCountry: true, domains: ["amazon.com", "amazon.fr", "amazon.co.uk", "amazon.de", "amazonaws.com", "media-amazon.com", "ssl-images-amazon.com"], never: "Amazon never asks you to pay a redelivery fee by text message." },
  { name: "Apple", domains: ["apple.com", "icloud.com"], never: "Apple never asks for gift-card codes as payment." },
  // linksAnywhere: the brand's own mail (Google Alerts, Groups) points to
  // pages all over the web, so a link elsewhere proves nothing by itself.
  // runsHosting: free page services the brand itself operates.
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
  // Most targeted in the OpenPhish sample (Oct 2026).
  { name: "Roblox", domains: ["roblox.com", "rbxcdn.com"], never: "Roblox never asks for your password through a link sent to you." },
  { name: "Xfinity", aliases: ["Comcast"], domains: ["xfinity.com", "comcast.net", "comcast.com"], never: "Xfinity never asks you to sign in through a link to keep your email." },
  { name: "Google", anyCountry: true, domains: ["google.com", "google.fr"], owned: ["googlegroups.com", "youtube.com", "gstatic.com", "googleusercontent.com", "withgoogle.com", "googlemail.com", "gmail.com", "blogger.com", "googlecode.com", "googlepages.com"], runsHosting: [".blogspot.com"], linksAnywhere: true, never: "Google never asks for your password by email." },
  { name: "Facebook", aliases: ["Meta for Business"], domains: ["facebook.com", "facebookmail.com", "fb.com"], owned: ["meta.com", "instagram.com"], never: "Facebook never threatens to delete your page by email." },
  { name: "Instagram", domains: ["instagram.com"], never: null },
  { name: "WhatsApp", domains: ["whatsapp.com", "whatsapp.net"], never: "WhatsApp never asks for your 6-digit code." },
  { name: "Discord", domains: ["discord.com", "discord.gg", "discordapp.com"], never: null },
  { name: "TikTok", domains: ["tiktok.com"], never: null },
  { name: "Okta", domains: ["okta.com", "oktacdn.com"], never: null },
  { name: "AT&T", aliases: ["ATT"], domains: ["att.com", "att.net"], never: "AT&T never asks for your password by email." },
  { name: "DPD", aliases: ["MyDPD"], domains: ["dpd.com", "dpd.fr", "dpd.co.uk", "dpd.de", "dpdgroup.com"], never: "DPD ne demande jamais de frais de livraison par SMS." },
  { name: "DHL", domains: ["dhl.com", "dhl.fr", "dhl.de"], never: "DHL never asks for a customs fee by text message." },
  { name: "Etsy", domains: ["etsy.com"], never: null },
  { name: "Airbnb", domains: ["airbnb.com", "airbnb.fr"], never: "Airbnb never asks you to pay outside its own website." },
  { name: "Booking.com", domains: ["booking.com"], never: "Booking.com never asks for card details through a link in a message." },
  { name: "Coinbase", domains: ["coinbase.com"], never: "Coinbase never asks for your recovery phrase." },
  { name: "Binance", domains: ["binance.com"], never: "Binance never asks for your recovery phrase." },
  { name: "Ledger", exactName: true, domains: ["ledger.com"], never: "Ledger never asks for your 24-word recovery phrase." },
  { name: "Trezor", domains: ["trezor.io"], never: "Trezor never asks for your recovery seed." },
  { name: "MetaMask", domains: ["metamask.io"], never: "MetaMask never asks for your secret recovery phrase." },
  { name: "Trust Wallet", domains: ["trustwallet.com"], never: "Trust Wallet never asks for your recovery phrase." },
  { name: "Exodus", exactName: true, domains: ["exodus.com"], never: "Exodus never asks for your secret phrase." },
  { name: "MoonPay", domains: ["moonpay.com"], never: null },
  { name: "Charles Schwab", aliases: ["Schwab"], kind: "bank", domains: ["schwab.com"], never: "Schwab never asks for your password by email." },
  { name: "E*TRADE", aliases: ["ETRADE", "E-Trade"], kind: "bank", domains: ["etrade.com"], never: null },
  { name: "Bancolombia", kind: "bank", domains: ["bancolombia.com"], never: null },
  { name: "Banco de Venezuela", aliases: ["BDV"], kind: "bank", domains: ["bancodevenezuela.com"], never: null },
  { name: "Adobe", domains: ["adobe.com"], never: null },
  { name: "Orange", exactName: true, aliases: ["Orange France"], domains: ["orange.fr", "orange.com"], never: "Orange ne vous demande jamais vos identifiants par e-mail." },
  { name: "Kleinanzeigen", domains: ["kleinanzeigen.de"], never: null },
  { name: "Allegro", exactName: true, domains: ["allegro.pl"], never: null },
  { name: "Steam", exactName: true, domains: ["steampowered.com", "steamcommunity.com"], never: null },
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

// Free website builders and hosting where anyone can publish a page in
// minutes (most of the OpenPhish sample, Oct 2026, sat on these).
export const FREE_HOSTING_SUFFIXES = [
  ".bolt.host", ".vercel.app", ".netlify.app", ".web.app", ".firebaseapp.com", ".github.io", ".gitlab.io",
  ".weebly.com", ".wixsite.com", ".wordpress.com", ".blogspot.com", ".jimdofree.com", ".jimdosite.com",
  ".pages.dev", ".workers.dev", ".r2.dev", ".trycloudflare.com", ".replit.app", ".repl.co", ".glitch.me",
  ".typedream.app", ".teleporthq.app", ".framer.app", ".framer.website", ".square.site", ".zapier.app",
  ".amplifyapp.com", ".wasmer.app", ".discloud.dev", ".craftum.io", ".4everland.app", ".dynv6.net",
  ".backblazeb2.com", ".azurefd.net", ".grigora.app", ".kalit.ai", ".cloudworkstations.dev", ".webflow.io",
  ".carrd.co", ".godaddysites.com", ".ngrok-free.app", ".ngrok.io", ".onrender.com", ".fly.dev",
  ".herokuapp.com", ".surge.sh", ".edgeone.app", ".edgeone.cool", ".eu.org", ".ktempurl.com", ".sharemyhtml.com",
];
export const SHORTENERS = ["bit.ly", "bitly.cx", "tinyurl.com", "t.co", "goo.gl", "rb.gy", "cutt.ly", "is.gd", "ow.ly", "buff.ly",
  "shorturl.at", "tiny.cc", "1url.at", "u.to", "tr.ee", "urlz.li", "urlz.fr", "bom.so", "4-y.cc", "nlink.at", "s4w.in", "to.lk",
  "rebrand.ly", "t.ly", "shorturl.gg", "v.gd", "qr.co", "lnkd.in"];
// Endings most abused for throwaway phishing sites (weak evidence alone).
export const RISKY_TLDS = ["top", "xyz", "shop", "sbs", "cfd", "click", "lol", "help", "icu", "cyou", "bond", "rest", "buzz",
  "monster", "quest", "cc", "work", "beer", "cool", "live", "pro"];

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
// anyCountry: the brand holds its name under every country ending
// (google.co.uk, amazon.ca), so those count as its own addresses too.
const countryVariant = (domain, brand) => brand?.anyCountry && (brand.domains || []).some((d) =>
  new RegExp(`(^|\\.)${d.split(".")[0]}\\.(com?\\.)?[a-z]{2}$`).test(domain));
export const belongsTo = (domain, brand) => Boolean(domain && ([...(brand?.domains || []), ...(brand?.owned || [])].some((d) => sameOrSub(domain, d)) || countryVariant(domain, brand)));

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

// Brands whose names are ordinary words (Ledger, Orange, Exodus, Allegro,
// Steam) are claimed only by a sender that calls itself exactly that, e.g.
// "Ledger" or "Ledger Support" — never "The Ledger" or "Orange County".
export function claimedBrands(text = "", explicit = "") {
  const t = `${explicit} ${text}`;
  return BRANDS.filter((b) => (b.exactName
    ? [b.name, ...(b.aliases || [])].some((w) => new RegExp(`^\\W*${plain(w).replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(\\s+(support|team|service|security|wallet|live|official|help|customer care))?\\W*$`, "i").test(plain(t).trim()))
    : brandWords(b).some((w) => mentions(t, w))));
}

// One letter added, dropped, swapped or replaced: robiox for roblox,
// g0gle for google, xfinlty for xfinity. Only for names of 6+ letters
// (shorter ones collide with ordinary words: apply/apple).
function editDistance(a, b, max) {
  // Damerau–Levenshtein (adjacent swaps count as one edit), stops early past max.
  if (Math.abs(a.length - b.length) > max) return max + 1;
  let prev2 = null;
  let prev = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    const cur = [i];
    let best = i;
    for (let j = 1; j <= b.length; j++) {
      let v = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
      if (prev2 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) v = Math.min(v, prev2[j - 2] + 1);
      cur[j] = v;
      best = Math.min(best, v);
    }
    if (best > max) return max + 1;
    prev2 = prev;
    prev = cur;
  }
  return prev[b.length];
}
export { editDistance };
// Where a misspelling counts: the name the owner picked (the registrable
// label, or the first label on a free hosting service). A subdomain of
// someone else's site (finance.yahoo.com) only counts when it uses a
// look-alike character (g0gle) or carries a sign-in word.
export function typosquatOf(domain = "", url = "") {
  const d = String(domain).toLowerCase();
  const all = d.split(".").slice(0, -1);
  const hosted = FREE_HOSTING_SUFFIXES.some((s) => d.endsWith(s));
  const regCount = ["co", "com", "gouv", "org", "ac", "net"].includes(all.at(-1)) && all.length > 1 ? 2 : 1;
  const owned = hosted ? all.slice(0, 1) : all.slice(-regCount);
  const subs = hosted ? [] : all.slice(0, -regCount);
  const lure = /(secure|login|signin|sign-in|verif|account|update|support|billing|auth|wallet|invite|meet)/.test(`${d} ${String(url).toLowerCase()}`);
  const expand = (l) => { const p = l.split(/[-_]/); return [...p, ...p.slice(1).map((x, i) => p[i] + x)]; };
  const candidates = [
    ...owned.flatMap(expand).map((p) => ({ p, ok: true })),
    ...subs.flatMap(expand).map((p) => ({ p, ok: lure || skeleton(p) !== plain(p) })),
  ].filter((c) => c.ok).map((c) => skeleton(c.p).replace(/[^a-z0-9]/g, "")).filter((p) => p.length >= 5);
  const parts = candidates;
  for (const b of BRANDS) {
    if (belongsTo(d, b)) continue;
    const words = [b.name, ...(b.aliases || []), ...b.domains.map((x) => x.split(".")[0])].map((w) => skeleton(w).replace(/[^a-z0-9]/g, "")).filter((w) => w.length >= 6);
    for (const w of words) {
      const allowed = w.length >= 8 ? 2 : 1;
      if (parts.some((p) => p !== w && !p.includes(w) && editDistance(p, w, allowed) <= allowed)) return b;
    }
  }
  return null;
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
export function brandInDomain(domain = "", url = "") {
  const d = String(domain).toLowerCase();
  if (!d.includes(".") || FREEMAIL.includes(d.split(".").slice(-2).join("."))) return null;
  // The registrable name (adecco-hrjobs in calendar.adecco-hrjobs.com) may
  // borrow a brand freely; a subdomain (chase.secure-login.top) only counts
  // when the address also carries a lure word, so apple.slashdot.org is fine.
  const labels = d.split(".").slice(0, -1);
  const regCount = ["co", "com", "gouv", "org", "ac"].includes(labels.at(-1)) && labels.length > 1 ? 2 : 1;
  const lure = /(secure|login|log-in|signin|sign-in|verif|account|update|support|billing|auth|confirm|service|alert|unlock|recover|wallet|webscr|track|profile|users)/.test(`${d} ${String(url).toLowerCase()}`);
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
