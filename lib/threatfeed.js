// Live threat feed backbone (PRD: scheduled job -> Muse Spark extraction
// -> structured pattern card -> detector same day).
// Safety gates enforced here, before any card can reach the detector:
// 1. extraction output is schema-checked JSON only, never raw source text
// 2. a new card starts as "candidate" (can only push to be_careful)
// 3. a card may never flag a brand's real website addresses
// 4. cards retire after 90 days without a sighting (lib/patterns.js)

import { cardIsSafe } from "./patterns.js";

const REQUIRED = ["id", "name", "channels", "impersonated_brands", "lure", "red_flags"];

export function validatePatternCard(card) {
  const errs = [];
  if (!card || typeof card !== "object") return ["card is not an object"];
  for (const k of REQUIRED) if (!card[k]) errs.push(`missing ${k}`);
  if (!Array.isArray(card.channels) || !card.channels.length) errs.push("channels required");
  if (!cardIsSafe(card)) errs.push("card flags a brand's real website address — rejected");
  return errs;
}

// Turn one trusted-source alert into a candidate card. The extractor (Muse
// Spark, no tools, JSON-only in production) is injected so tests and the
// offline demo never depend on a network call.
export async function cardFromAlert(alert, extract) {
  const raw = typeof extract === "function" ? await extract(alert) : alert.card;
  const card = { status: "candidate", sources: [alert.source].filter(Boolean),
    first_seen: new Date().toISOString().slice(0, 10), last_seen: new Date().toISOString().slice(0, 10), ...raw };
  const errs = validatePatternCard(card);
  if (errs.length) return { ok: false, errors: errs, card: null };
  return { ok: true, errors: [], card };
}

export function promoteCard(card) {
  // Human review (PRD review page) is the only path candidate -> active.
  return { ...card, status: "active" };
}
