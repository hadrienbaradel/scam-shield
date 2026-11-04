// One check, whatever the channel (Gmail, pasted text, screenshot, phone):
// load the user's context and the live pattern cards, inspect links, ask
// Muse Spark (detector fallback), record the verdict — never the body.

import { checkMessage } from "../../lib/muse.js";
import { domainOf, orgOf } from "../../lib/brands.js";
import { emptyContext } from "../../lib/context.js";
import { many, one, q } from "../db/pool.js";
import { withGuardians } from "../context/builder.js";
import { inspectMessageLinks } from "../links/resolver.js";

export async function loadContext(user) {
  const [row, guardians] = await Promise.all([
    one("SELECT data FROM contexts WHERE user_id = $1", [user.id]),
    many("SELECT * FROM guardianships WHERE senior_id = $1", [user.id]),
  ]);
  return withGuardians(row?.data || emptyContext(user.name || ""), guardians);
}

export async function liveCards() {
  return (await many("SELECT card, status FROM pattern_cards WHERE status IN ('active', 'candidate')")).map((r) => ({ ...r.card, status: r.status }));
}

// Messages from the same organisation that Prudence already checked for this
// person: a dated count, split by verdict. It only says "we have seen mail
// from them before"; it never proves a request is legitimate (a scam that
// was never thrown away counts too) and never makes a sender "known".
export async function seenBeforeFor(userId, from, messageId = null) {
  const org = orgOf(domainOf(from || ""));
  if (!org || !org.includes(".")) return null;
  const like = `%.${org.replace(/[\\%_]/g, (c) => `\\${c}`)}`;
  const row = await one(`SELECT count(*)::int AS n, (count(*) FILTER (WHERE verdict_value = 'safe'))::int AS safe, min(created_at) AS first
    FROM checks WHERE user_id = $1 AND (sender_domain = $2 OR sender_domain LIKE $3) AND gmail_message_id IS DISTINCT FROM $4`,
  [userId, org, like, messageId]);
  return { organisation: org, messages: row.n, judged_safe: row.safe, first_seen: row.n ? new Date(row.first).toISOString().slice(0, 10) : null };
}

// "Be careful" is the unsure answer, and on real mail it is mostly a link
// whose address is hidden (an email service's tracker, a redirect). Before
// showing it, look once where the links really land and what the page asks
// for (src/links/resolver.js: no cookies, no private addresses, never an
// unsubscribe or delete link), then let the rules and Muse Spark decide
// again. Never for Scam: opening a scam's links only tells it the address
// is read.
export const needsLandingLook = (verdict, message, resolveLinks = false) =>
  !resolveLinks && verdict?.verdict === "be_careful" && (message.links || []).some((l) => /^https?:\/\//i.test(l.href || ""));

// What a check reads about the person for one message: their context with the
// earlier mail from the same organisation, and the live pattern cards, fetched
// at once. runCheck and Look closer (src/routes/investigate.js) both read them
// here, so a closer look's rules see what the first check's rules saw.
export async function contextFor(user, message) {
  const [base, seenBefore, cards] = await Promise.all([loadContext(user), seenBeforeFor(user.id, message.from, message.id || null), liveCards()]);
  return { ctx: { ...base, seenBefore }, cards };
}
// The links' facts for one message (age, listings, and where they land when resolve is on), for both too.
export const linkFactsFor = (message, ctx, { resolve = false } = {}) => inspectMessageLinks(message, ctx, { resolve });

export async function runCheck({ user, message, threadHistory = [], resolveLinks = false, cache = true }) {
  // (resolveLinks: follow every link, when the person asks; cache: false for a
  // conversation heard face to face, whose answer can repeat the other
  // person's words and is not kept in llm_cache: check-glasses.md, line 13)
  const { ctx, cards } = await contextFor(user, message);
  const judge = async (resolve) => {
    const linkInspection = await linkFactsFor(message, ctx, { resolve });
    const verdict = await checkMessage({
      locale: user.locale || "en-US", message, personalContext: ctx, patternCards: cards,
      threadHistory, mockLinkInspection: linkInspection, linkInspection,
    }, { cache: cache ? llmCacheFor(user.id) : null });
    return { verdict, linkInspection };
  };
  let out = await judge(resolveLinks);
  if (needsLandingLook(out.verdict, message, resolveLinks)) out = await judge(true);
  return { ...out, ctx };
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
