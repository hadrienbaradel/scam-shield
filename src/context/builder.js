// Builds a user's personal context ("is this real FOR YOU?") from their
// own mailbox: providers and the addresses they really write from, recent
// orders and their carriers, paid subscriptions, and the people the user
// actually writes to. Same shape as lib/context.js.
//
// Only mail that authenticates AND the detector already judges safe may
// teach the context, so a scam cannot plant a fake "order" or provider.
// Link domains are learned only from authenticated brand mail.

import { emptyContext, learnFromLegitEmails } from "../../lib/context.js";
import { BRANDS, belongsTo, domainOf } from "../../lib/brands.js";
import { detect } from "../../lib/detector.js";

const PROVIDER_TYPES = {
  Chase: "bank", "Bank of America": "bank", "Wells Fargo": "bank", "Société Générale": "bank", PayPal: "bank",
  "Bouygues Telecom": "telecom", "E-ZPass": "toll", Medicare: "health", Ameli: "health",
  IRS: "government", "Social Security": "government", ANTAI: "government",
  Amazon: "retail", Apple: "retail", Netflix: "retail", Microsoft: "retail",
  USPS: "carrier", FedEx: "carrier", UPS: "carrier", Chronopost: "carrier",
};

// Data breaches the user can tick in settings. Only well-documented ones:
// what leaked decides which "real data" in a scam we explain away.
export const KNOWN_BREACHES = [
  { id: "bouygues-2025", source: "Bouygues Telecom", date: "2025", country: "FR", leaked: ["name", "address", "IBAN", "BIC"] },
  { id: "free-2024", source: "Free", date: "2024", country: "FR", leaked: ["name", "address", "IBAN"] },
  { id: "france-travail-2024", source: "France Travail", date: "2024", country: "FR", leaked: ["name", "address", "phone", "email", "social security number"] },
  { id: "viamedis-almerys-2024", source: "Viamedis / Almerys", date: "2024", country: "FR", leaked: ["name", "date of birth", "social security number", "health insurer"] },
  { id: "att-2024", source: "AT&T", date: "2024", country: "US", leaked: ["name", "address", "phone", "Social Security number"] },
  { id: "npd-2024", source: "National Public Data", date: "2024", country: "US", leaked: ["name", "address", "phone", "Social Security number"] },
  { id: "change-healthcare-2024", source: "Change Healthcare", date: "2024", country: "US", leaked: ["name", "address", "health data", "Social Security number"] },
  { id: "ticketmaster-2024", source: "Ticketmaster", date: "2024", country: "US", leaked: ["name", "email", "phone", "partial card number"] },
  { id: "old-password", source: "a website you used", date: "unknown", country: null, leaked: ["old password", "email"] },
];

const ORDER_WORDS = /\b(order|shipped|shipment|delivery|delivered|tracking|package|commande|expédi|livraison|colis|suivi)/i;
const BILLING_WORDS = /\b(receipt|invoice|payment|renewal|renews|membership|subscription|billing|facture|abonnement|prélèvement|reçu)\b/i;
const CARRIERS = [
  { carrier: "UPS", re: /\b1Z[0-9A-Z]{16}\b/ },
  { carrier: "Amazon Logistics", re: /\bTBA\d{12}\b/ },
  { carrier: "USPS", re: /\b9[2-5]\d{2}\s?\d{4}\s?\d{4}\s?\d{4}\s?\d{4}\s?\d{2,4}\b/ },
  { carrier: "Chronopost", re: /\b[A-Z]{2}\d{9}[A-Z]{2}\b/, needs: /chronopost/i },
  { carrier: "Colissimo", re: /\b(\d[A-Z]\d{11}|[A-Z]{2}\d{9}FR)\b/, needs: /colissimo|la poste/i },
  { carrier: "FedEx", re: /\b(\d{12}|\d{15})\b/, needs: /fedex/i },
  { carrier: "DHL", re: /\b(\d{10}|JJD\d{10,})\b/, needs: /\bdhl\b/i },
];
const CARRIER_NAMES = ["Chronopost", "Colissimo", "USPS", "FedEx", "UPS", "DHL", "Amazon Logistics"];

export const brandForSender = (email) => BRANDS.find((b) => belongsTo(domainOf(email), b)) || null;
const authOk = (auth) => /(spf|dkim)=pass/.test(auth || "") && !/dmarc=fail/.test(auth || "");

export function extractOrder(m) {
  const text = `${m.subject || ""}\n${m.body || ""}`;
  if (!ORDER_WORDS.test(text)) return null;
  const brand = brandForSender(m.from);
  let carrier = null;
  let tracking = null;
  for (const c of CARRIERS) {
    const hit = text.match(c.re);
    if (hit && (!c.needs || c.needs.test(text))) { carrier = c.carrier; tracking = hit[0].replace(/\s+/g, ""); break; }
  }
  carrier ||= CARRIER_NAMES.find((n) => new RegExp(`\\b${n}\\b`, "i").test(text)) || null;
  if (!carrier && brand?.name === "Amazon") carrier = "Amazon Logistics";
  if (!carrier) return null;
  return {
    merchant: brand?.name || m.fromName || domainOf(m.from),
    carrier, tracking,
    items: String(m.subject || "").slice(0, 80),
    date: String(m.date || "").slice(0, 10),
  };
}

function subscriptionsFrom(m, brand) {
  const text = `${m.subject || ""} ${m.body || ""}`;
  if (!BILLING_WORDS.test(text)) return [];
  const named = [...text.matchAll(/\b([A-Z][A-Za-z]+ ?(?:Pro|Plus|Premium|Prime))\b/g)].map((x) => x[1]);
  return [...new Set([...(brand ? [brand.name] : []), ...named])];
}

// People the user writes to (Sent mail To/Cc), counted. Two or more
// messages in a year makes someone a contact we can recognise.
export function correspondents(sentMessages, selfEmail) {
  const counts = new Map();
  for (const m of sentMessages) {
    const hs = m.payload?.headers || [];
    const raw = hs.filter((h) => /^(to|cc)$/i.test(h.name)).map((h) => h.value).join(",");
    for (const part of raw.split(/,(?=(?:[^"]*"[^"]*")*[^"]*$)/)) {
      const mm = part.match(/^\s*"?([^"<]*?)"?\s*<([^>]+)>\s*$/) || [null, "", part.trim()];
      const email = String(mm[2] || "").trim().toLowerCase();
      if (!email.includes("@") || email === selfEmail || /no-?reply|notifications?@|mailer-daemon/.test(email)) continue;
      const c = counts.get(email) || { email, name: mm[1].trim(), count: 0 };
      c.count++;
      if (!c.name && mm[1]) c.name = mm[1].trim();
      counts.set(email, c);
    }
  }
  return [...counts.values()].filter((c) => c.count >= 2 && !brandForSender(c.email)).sort((a, b) => b.count - a.count);
}

const keyOf = {
  sender: (s) => `sender:${s.email}`, contact: (c) => `contact:${c.email}`, order: (o) => `order:${o.tracking || `${o.merchant}|${o.date}`}`,
  provider: (p) => `provider:${p.name}`, subscription: (s) => `subscription:${s}`, link: (d) => `link:${d}`,
};

function uniqueBy(items, key) {
  const seen = new Set();
  return items.filter((i) => (seen.has(key(i)) ? false : seen.add(key(i))));
}

// messages: normalized recent mail (src/google/gmail.js normalizeMessage)
// sent: raw Gmail metadata messages from the Sent folder
export function buildContext({ userName, selfEmail, messages = [], sent = [], previous = null }) {
  const base = previous ? structuredClone(previous) : emptyContext(userName);
  const removed = new Set(base.removed || []);
  const probe = { ...emptyContext(userName), orders: base.orders || [], providers: base.providers || [] };

  const teach = [];
  for (const m of messages) {
    if (!authOk(m.auth) || m.from === selfEmail) continue;
    if (detect({ message: m, personalContext: probe, locale: "en-US" }).verdict !== "safe") continue;
    const brand = brandForSender(m.from);
    const order = extractOrder(m);
    teach.push({
      ...m, brand: brand?.name || null, order,
      links: brand ? m.links : [],
      provider: brand && PROVIDER_TYPES[brand.name] ? { type: PROVIDER_TYPES[brand.name], name: brand.name } : null,
    });
    base.subscriptions = [...(base.subscriptions || []), ...subscriptionsFrom(m, brand)];
  }
  const learned = learnFromLegitEmails(base, teach);

  const contacts = correspondents(sent, selfEmail).slice(0, 25).map((c) => ({
    name: c.name || c.email.split("@")[0], email: c.email, phone: null, relation: "someone you write to", normalTopics: [],
  }));
  const keep = (kind) => (x) => !removed.has(keyOf[kind](x));
  const sixtyDaysAgo = new Date(Date.now() - 60 * 86400000).toISOString().slice(0, 10);

  return {
    ...learned,
    userName: userName || learned.userName,
    knownSenders: uniqueBy(learned.knownSenders, keyOf.sender).filter(keep("sender")).slice(-400),
    knownLinkDomains: [...new Set(learned.knownLinkDomains)].filter((d) => !removed.has(keyOf.link(d))).slice(-300),
    providers: uniqueBy(learned.providers, keyOf.provider).filter(keep("provider")),
    orders: uniqueBy(learned.orders.filter((o) => !o.date || o.date >= sixtyDaysAgo), keyOf.order).filter(keep("order"))
      .sort((a, b) => String(a.date).localeCompare(String(b.date))).slice(-20),
    trustedContacts: uniqueBy([...(learned.trustedContacts || []), ...contacts], keyOf.contact).filter(keep("contact")),
    subscriptions: [...new Set(learned.subscriptions || [])].filter(keep("subscription")),
    breaches: learned.breaches || [],
    removed: [...removed],
  };
}

// Guardians are trusted contacts by definition; merged at check time so
// an invitation accepted later is recognised immediately.
export function withGuardians(ctx, guardianships = []) {
  const extra = guardianships.filter((g) => g.status === "active").map((g) => ({
    name: g.guardian_name, email: g.guardian_email, phone: null, relation: `${g.relation || "trusted person"} (guardian)`, normalTopics: ["family"],
  }));
  return { ...ctx, trustedContacts: uniqueBy([...extra, ...(ctx.trustedContacts || [])], keyOf.contact) };
}

export function forgetItem(ctx, kind, item) {
  const key = keyOf[kind](item);
  return { ...ctx, removed: [...new Set([...(ctx.removed || []), key])] };
}

// --- Breach lookup (_product/specs/breach-exposure.md) ---
// What a breach leaked, in the words the detector and the card use:
// lib/context.js breachLeaking matches on them (the detector reads "IBAN"
// and "old password"). Have I Been Pwned and XposedOrNot share this
// vocabulary of data classes; a class not listed here is left out rather
// than shown to the senior as jargon.
const DATA_CLASS_WORDS = {
  Passwords: "old password", "Password hints": "old password", "Bank account numbers": "IBAN",
  "Physical addresses": "address", Names: "name", "Phone numbers": "phone", "Email addresses": "email",
  "Dates of birth": "date of birth", "Government issued IDs": "social security number",
  "Social security numbers": "social security number", "Credit cards": "card number",
  "Partial credit card data": "partial card number", "Health insurance information": "health data",
  "Historical health records": "health data", Purchases: "purchases", Usernames: "username",
};
export const leakedWords = (classes) => [...new Set((classes || []).map((c) => DATA_CLASS_WORDS[String(c).trim()]).filter(Boolean))];
const UA = "Prudence/1.0 (scam protection; breach lookup on the person's request)";
// "BouyguesTelecom" reads "Bouygues Telecom" when the catalogue has no title for it.
const readableName = (name) => String(name || "").replace(/[-_]+/g, " ").replace(/([a-z])([A-Z])/g, "$1 $2").trim();
const normName = (name) => String(name || "").toLowerCase().replace(/[^a-z0-9]/g, "");
// Looked-up breaches carry their list as a prefix; the curated ones do not.
export const lookedUp = (b) => /^(hibp|xon)-/.test(String(b?.id || ""));

// Have I Been Pwned's search by email: needs a paid key (Core 1: 10 requests a minute).
export async function hibpBreaches(email, apiKey, { fetchImpl = fetch } = {}) {
  if (!apiKey) return [];
  const res = await fetchImpl(`https://haveibeenpwned.com/api/v3/breachedaccount/${encodeURIComponent(email)}?truncateResponse=false`, {
    headers: { "hibp-api-key": apiKey, "user-agent": UA }, signal: AbortSignal.timeout(10000),
  });
  if (res.status === 404) return [];
  if (res.status === 429) throw new Error("busy");
  if (!res.ok) throw new Error(`HIBP ${res.status}`);
  return (await res.json()).map((b) => ({
    id: `hibp-${b.Name}`, source: b.Title || readableName(b.Name), domain: b.Domain || null,
    date: String(b.BreachDate || "").slice(0, 4), leaked: leakedWords(b.DataClasses),
  }));
}

// XposedOrNot's free list: no key; 2 a second, 25 an hour, 100 a day per
// server address. A 200 with nothing exposed is "not found" too.
export async function xposedOrNotBreaches(email, { fetchImpl = fetch } = {}) {
  const res = await fetchImpl(`https://api.xposedornot.com/v1/breach-analytics?email=${encodeURIComponent(email)}`, {
    headers: { "user-agent": UA }, signal: AbortSignal.timeout(10000),
  });
  if (res.status === 404) return [];
  if (res.status === 429) throw new Error("busy");
  if (!res.ok) throw new Error(`XposedOrNot ${res.status}`);
  const body = await res.json().catch(() => ({}));
  return (body?.ExposedBreaches?.breaches_details || []).map((b) => ({
    id: `xon-${b.breach}`, source: readableName(b.breach), domain: b.domain || null,
    date: String(b.xposed_date || "").slice(0, 4), leaked: leakedWords(String(b.xposed_data || "").split(";")),
  }));
}

// Have I Been Pwned's breach catalogue is free and keyless: it names each
// breach ("Bouygues Telecom") and knows what leaked (bank account numbers
// for Bouygues 2025, which XposedOrNot's entry lacks). Once a day per process.
let catalogue = { at: 0, byName: new Map(), byDomain: new Map() };
export async function breachCatalogue({ fetchImpl = fetch, now = Date.now() } = {}) {
  if (catalogue.at > now - 86400000) return catalogue;
  const res = await fetchImpl("https://haveibeenpwned.com/api/v3/breaches", { headers: { "user-agent": UA }, signal: AbortSignal.timeout(15000) });
  if (!res.ok) throw new Error(`HIBP catalogue ${res.status}`);
  const byName = new Map(); const byDomain = new Map();
  for (const b of await res.json()) {
    const entry = { title: b.Title || readableName(b.Name), date: String(b.BreachDate || "").slice(0, 4), leaked: leakedWords(b.DataClasses) };
    byName.set(normName(b.Name), entry);
    if (b.Domain) byDomain.set(String(b.Domain).toLowerCase(), entry);
  }
  catalogue = { at: now, byName, byDomain };
  return catalogue;
}
export function resetBreachCatalogue() { catalogue = { at: 0, byName: new Map(), byDomain: new Map() }; }

function withCatalogue(b, cat) {
  const entry = cat?.byName.get(normName(b.id.replace(/^xon-/, ""))) || (b.domain && cat?.byDomain.get(b.domain.toLowerCase())) || null;
  if (!entry) return b;
  return { ...b, source: entry.title || b.source, date: b.date || entry.date, leaked: [...new Set([...b.leaked, ...entry.leaked])] };
}

// The lookup the senior asks for, never run on its own: Have I Been Pwned
// with a key, XposedOrNot plus HIBP's catalogue without. The catalogue
// being down only costs the nicer names and the extra data classes.
export async function lookupBreaches(email, { hibpKey = "", fetchImpl = fetch } = {}) {
  if (hibpKey) return { source: "hibp", breaches: await hibpBreaches(email, hibpKey, { fetchImpl }) };
  const found = await xposedOrNotBreaches(email, { fetchImpl });
  let cat = null;
  if (found.length) { try { cat = await breachCatalogue({ fetchImpl }); } catch { cat = null; } }
  return { source: "xposedornot", breaches: found.map((b) => withCatalogue(b, cat)) };
}
