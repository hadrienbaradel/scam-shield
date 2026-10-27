// Threat-feed pattern cards. PRD safeguards enforced here:
// - an unconfirmed ("candidate") card can only push a verdict to be_careful
// - a card may never flag a brand's real website addresses
// - cards retire after 90 days without a sighting

import { brandByName, belongsTo, domainOf, mentions } from "./brands.js";

export function activeCards(cards, now = new Date()) {
  return (cards || []).filter((c) => {
    if (!c.last_seen) return true;
    const ageDays = (now - new Date(c.last_seen)) / 86400000;
    return ageDays <= 90;
  });
}

export function cardIsSafe(card) {
  // A card that lists a brand's real domain as a red flag is rejected.
  const brands = card.impersonated_brands || [];
  return brands.every((name) => {
    const brand = brandByName(name);
    if (!brand) return true;
    return !(card.red_flag_domains || []).some((d) => belongsTo(domainOf(d), brand));
  });
}

export function matchCards(message, cards) {
  const text = `${message.fromName || ""} ${message.claimedBrand || ""} ${message.subject || ""} ${message.body || ""}`.toLowerCase();
  const channel = (message.channel || "email").toLowerCase();
  return activeCards(cards).filter((c) => {
    if (!cardIsSafe(c)) return false;
    if (c.channels?.length && !c.channels.includes(channel)) return false;
    const brandHit = (c.impersonated_brands || []).some((b) => mentions(text, b) || (brandByName(b)?.aliases || []).some((a) => mentions(text, a)));
    const lureHit = c.lure ? text.includes(c.lure.toLowerCase().split(" ")[0]) : false;
    const flagHit = (c.red_flags || []).some((f) =>
      text.includes(f.toLowerCase().split(" ").slice(0, 3).join(" ")));
    // Brand alone is never enough: a real bill from that brand must not
    // match its own scam campaign. Need the lure or a red flag too.
    return brandHit && (lureHit || flagHit);
  });
}

export const cardCap = (card) => (card.status === "active" ? "scam" : "be_careful");
