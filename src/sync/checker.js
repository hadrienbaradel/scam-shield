// One check, whatever the channel (Gmail, pasted text, screenshot, phone):
// load the user's context and the live pattern cards, inspect links, ask
// Muse Spark (detector fallback), record the verdict — never the body.

import { checkMessage } from "../../lib/muse.js";
import { domainOf } from "../../lib/brands.js";
import { emptyContext } from "../../lib/context.js";
import { many, one, q } from "../db/pool.js";
import { withGuardians } from "../context/builder.js";
import { inspectMessageLinks } from "../links/resolver.js";

export async function loadContext(user) {
  const row = await one("SELECT data FROM contexts WHERE user_id = $1", [user.id]);
  const guardians = await many("SELECT * FROM guardianships WHERE senior_id = $1", [user.id]);
  return withGuardians(row?.data || emptyContext(user.name || ""), guardians);
}

export async function liveCards() {
  return (await many("SELECT card, status FROM pattern_cards WHERE status IN ('active', 'candidate')")).map((r) => ({ ...r.card, status: r.status }));
}

export async function runCheck({ user, message, threadHistory = [], resolveLinks = false }) {
  // (resolveLinks: follow redirects too, only when the person asks)
  const ctx = await loadContext(user);
  const linkInspection = await inspectMessageLinks(message, ctx, { resolve: resolveLinks });
  const verdict = await checkMessage({
    locale: user.locale || "en-US", message, personalContext: ctx, patternCards: await liveCards(),
    threadHistory, mockLinkInspection: linkInspection, linkInspection,
  }, { cache: llmCacheFor(user.id) });
  return { verdict, ctx, linkInspection };
}

// The insert is also the claim: of two workers checking the same message,
// only one gets a row back and may touch Gmail.
// The same request is never paid for twice (30 days, per user, deleted
// with the account).
export const llmCacheFor = (userId) => ({
  get: async (key) => (await one("SELECT verdict FROM llm_cache WHERE key = $1 AND created_at > now() - interval '30 days'", [key]))?.verdict || null,
  set: (key, verdict) => q("INSERT INTO llm_cache (key, user_id, verdict) VALUES ($1, $2, $3) ON CONFLICT (key) DO NOTHING", [key, userId, verdict]),
});

export async function recordCheck({ userId, message, verdict, channel = "email", action = "none", planned = null }) {
  return one(`INSERT INTO checks (user_id, gmail_message_id, gmail_thread_id, channel, sender_domain, verdict, verdict_value, source, latency_ms, action, planned)
              VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
              ON CONFLICT (user_id, gmail_message_id) DO NOTHING RETURNING *`,
  [userId, message.id && channel === "email" ? message.id : null, message.threadId || null, channel,
    domainOf(message.from || "") || null, verdict, verdict.verdict, verdict.source || null, verdict.latency_ms || null, action, planned]);
}
