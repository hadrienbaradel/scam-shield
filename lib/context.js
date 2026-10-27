// Personal context: the facts that let us answer "is this real FOR YOU?"
// Built from the user's own legitimate mail (profiles are seed data today;
// lib/gmail.js + this builder produce the same shape from a real inbox).

import { domainOf, belongsTo, brandByName } from "./brands.js";

export function emptyContext(name = "") {
  return {
    userName: name,
    knownSenders: [],      // {name, email, brand?}
    knownLinkDomains: [],  // brand email-provider / tracker domains seen in legit mail
    providers: [],         // {type: bank|telecom|toll|utility|health, name, realDomains:[]}
    orders: [],            // {merchant, carrier, tracking, items, date}
    breaches: [],          // {source, date, leaked:[]}
    trustedContacts: [],   // {name, email, phone, relation, normalTopics:[]}
    subscriptions: [],     // names of services the user actually pays for
  };
}

// Learn known senders/providers/orders from emails already judged legit.
// Deliberately conservative: only auth-passing mail teaches the context.
export function learnFromLegitEmails(context, emails) {
  const ctx = structuredClone(context);
  for (const e of emails) {
    const auth = String(e.auth || "").toLowerCase();
    if (auth && !auth.includes("pass")) continue;
    const domain = domainOf(e.from || "");
    if (domain && !ctx.knownSenders.some((s) => s.email === e.from)) {
      ctx.knownSenders.push({ name: e.fromName || domain, email: e.from || "", brand: e.brand || null });
    }
    for (const link of e.links || []) {
      const d = domainOf(link.href || "");
      if (d && !ctx.knownLinkDomains.includes(d)) ctx.knownLinkDomains.push(d);
    }
    if (e.order) ctx.orders.push(e.order);
    if (e.provider) {
      const brand = brandByName(e.provider.name);
      ctx.providers.push({ ...e.provider, realDomains: brand?.domains || e.provider.realDomains || [] });
    }
  }
  return ctx;
}

export function providerFor(ctx, brandName) {
  return (ctx.providers || []).find((p) => p.name.toLowerCase() === String(brandName).toLowerCase()) || null;
}

export function isKnownSender(ctx, email) {
  return (ctx.knownSenders || []).some((s) => s.email?.toLowerCase() === String(email || "").toLowerCase());
}

// A trusted person only counts as the sender when the message comes from
// the email address or phone number saved for them. A display name is
// typed by whoever sends the message: "Ethan Miller <new@gmail.com>" or
// "it's Ethan, new number" is a claim, never proof.
const digits = (s) => String(s || "").replace(/\D/g, "");
export function trustedContactFor(ctx, from) {
  const f = String(from || "").toLowerCase();
  return (ctx.trustedContacts || []).find((c) =>
    (f && c.email && c.email.toLowerCase() === f) ||
    (c.phone && digits(c.phone).length >= 6 && digits(c.phone) === digits(f))) || null;
}

// The trusted person a message claims to come from (by name), when it
// does not come from their saved address or number.
export function claimedContactFor(ctx, message = {}) {
  if (trustedContactFor(ctx, message.from)) return null;
  const names = [message.fromName, message.claimedContact].filter(Boolean).map((n) => String(n).toLowerCase());
  return (ctx.trustedContacts || []).find((c) => c.name && names.includes(c.name.toLowerCase())) || null;
}

export function matchingOrder(ctx, { carrier, merchant } = {}) {
  return (ctx.orders || []).filter((o) =>
    (!carrier || o.carrier?.toLowerCase().includes(carrier.toLowerCase())) &&
    (!merchant || o.merchant?.toLowerCase().includes(merchant.toLowerCase())));
}

// Real data (IBAN, old password, address) only counts as a warning when a
// known breach leaked exactly that kind of data.
export function breachLeaking(ctx, dataKind) {
  return (ctx.breaches || []).find((b) => (b.leaked || []).some((l) => l.toLowerCase().includes(dataKind.toLowerCase()))) || null;
}

export { belongsTo };
