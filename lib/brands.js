// Known brands, their real website addresses, and what the real
// company never does. Shared by rules, detector and pattern-card checks
// (a card may never flag a brand's real address — PRD safeguard).

export const BRANDS = [
  { name: "PayPal", domains: ["paypal.com"], never: "PayPal never asks you to confirm your password by email." },
  { name: "Chase", domains: ["chase.com", "jpmorganchase.com"], never: "Chase never asks you to move money to protect it." },
  { name: "Bank of America", domains: ["bankofamerica.com", "bofa.com"], never: "Bank of America never asks for your password by email." },
  { name: "Wells Fargo", domains: ["wellsfargo.com"], never: "Wells Fargo never asks you to send money to yourself." },
  { name: "Amazon", domains: ["amazon.com"], never: "Amazon never asks you to pay a redelivery fee by text message." },
  { name: "Apple", domains: ["apple.com", "icloud.com"], never: "Apple never asks for gift-card codes as payment." },
  { name: "Microsoft", domains: ["microsoft.com"], never: "Microsoft never puts a phone number in a security warning." },
  { name: "Netflix", domains: ["netflix.com"], never: null },
  { name: "IRS", domains: ["irs.gov"], never: "The IRS never threatens arrest by email or asks for gift cards." },
  { name: "Social Security", domains: ["ssa.gov"], never: "Social Security never suspends benefits by email." },
  { name: "Medicare", domains: ["medicare.gov", "cms.gov"], never: "Medicare never asks you to pay to keep your coverage by email." },
  { name: "USPS", domains: ["usps.com"], never: "USPS never texts you to pay a redelivery fee." },
  { name: "FedEx", domains: ["fedex.com"], never: "FedEx never asks for delivery fees by text message." },
  { name: "UPS", domains: ["ups.com"], never: null },
  { name: "E-ZPass", domains: ["e-zpassny.com", "ezdrivema.com", "bayareafastrak.org"], never: "Your toll agency never threatens big late fees by text message." },
  { name: "Bouygues Telecom", domains: ["bouyguestelecom.fr", "bouygues-telecom.fr", "bouygues.com"], never: "Bouygues Telecom ne vous demandera jamais vos codes bancaires par e-mail." },
  { name: "Société Générale", domains: ["societegenerale.fr", "sg.fr"], never: "Société Générale ne vous demandera jamais vos codes par e-mail." },
  { name: "Chronopost", domains: ["chronopost.fr"], never: "Chronopost ne demande jamais de frais de livraison par SMS." },
  { name: "Ameli", domains: ["ameli.fr", "assurance-maladie.fr"], never: "Ameli ne fait jamais payer une nouvelle carte Vitale." },
  { name: "ANTAI", domains: ["antai.gouv.fr", "amendes.gouv.fr"], never: "Les amendes ne se paient jamais en scannant un QR code sur l'avis papier." },
];

export const FREE_HOSTING_SUFFIXES = [
  ".bolt.host", ".vercel.app", ".netlify.app", ".web.app", ".github.io",
  ".weebly.com", ".wixsite.com", ".wordpress.com", ".blogspot.com",
];

export function domainOf(value = "") {
  const s = String(value).toLowerCase();
  const m = s.match(/@([a-z0-9.-]+\.[a-z]{2,})/);
  if (m) return m[1].replace(/[>)\]]+$/, "");
  try { return new URL(s.startsWith("http") ? s : `https://${s}`).hostname; } catch { return ""; }
}

export const sameOrSub = (domain, real) => domain === real || domain.endsWith(`.${real}`);
export const belongsTo = (domain, brand) => Boolean(domain && brand?.domains.some((d) => sameOrSub(domain, d)));

// Whole words only: "purchase" must not claim Chase, "Google Groups" must
// not claim UPS, "first" must not claim the IRS.
const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const wordIn = (t, w) => new RegExp(`(^|[^\\p{L}\\p{N}])${escapeRe(w)}($|[^\\p{L}\\p{N}])`, "iu").test(t);

export function claimedBrands(text = "", explicit = "") {
  const t = `${explicit} ${text}`.toLowerCase();
  return BRANDS.filter((b) => {
    if (wordIn(t, b.name.toLowerCase())) return true;
    return b.domains.some((d) => {
      const stem = d.split(".")[0];
      return stem.length >= 4 && wordIn(t, stem);
    });
  });
}

export function brandByName(name) {
  return BRANDS.find((b) => b.name.toLowerCase() === String(name || "").toLowerCase()) || null;
}
