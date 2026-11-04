// Look closer (_product/specs/investigate.md): Muse Spark checks a message
// again with Prudence's own tools (lib/investigate.js).
//   POST /api/check/investigate  signed in: { checkId, message } with the
//     message as the card holds it (as /api/ask takes a provided one); the
//     first verdict is the check's own row, the context and cards are the
//     person's, as /api/check/text loads them.
//   POST /api/demo/investigate   no sign-in: { id } of a demo example, with
//     its persona, the shipped cards and the example's own link facts, as
//     /api/demo/check judges it; one answer kept per example.
// Answers: 200 with the look (verdict null when nothing usable was left),
// 503 investigate_unavailable without a model that can use tools, 502
// investigate_failed with one plain sentence when the look could not run.
// Nothing is stored: no check row, no model cache, no copy of the message.

import { requireUser } from "../auth.js";
import { one } from "../db/pool.js";
import { investigate } from "../../lib/investigate.js";
import { toolsConfigured } from "../../lib/llm/index.js";
import { loadContext, liveCards } from "../sync/checker.js";
import { registrationDate, resolveLink, urlhausHost, urlhausVerdict, urlhausState } from "../links/resolver.js";
import { linksFromText } from "../google/gmail.js";
import { config } from "../config.js";
import { demoExample, demoProfile, demoVerdict, DEMO_CARDS } from "./demo.js";

// A model is configured and its provider can call function tools (not Claude today).
export const investigateConfigured = () => toolsConfigured();

// The real lookups, the ones every check already uses (src/links/resolver.js).
export function investigateDeps(extra = {}) {
  return { registrationDate, resolveLink, urlhausHost, urlhausVerdict, blocklistKey: Boolean(config.abusechKey) && !urlhausState.off, ...extra };
}

// The message as the page sends it back: known fields only, cut to size;
// links in the words are found again, so a pasted link is never lost.
const clip = (v, n) => String(v ?? "").slice(0, n);
export function messageFrom(input) {
  const m = input && typeof input === "object" ? input : {};
  const body = clip(m.body, 6000);
  const links = [...(Array.isArray(m.links) ? m.links : []), ...linksFromText(body)]
    .filter((l) => l && /^https?:\/\//i.test(String(l.href || "")))
    .map((l) => ({ href: clip(l.href, 2000), text: clip(l.text || l.href, 300) }))
    .filter((l, i, all) => all.findIndex((x) => x.href === l.href) === i)
    .slice(0, 40);
  return {
    channel: /^[a-z_]{2,20}$/.test(String(m.channel || "")) ? m.channel : "email",
    from: clip(m.from, 200), fromName: clip(m.fromName, 200), replyTo: clip(m.replyTo, 200),
    subject: clip(m.subject, 300), body, links,
    auth: typeof m.auth === "string" ? clip(m.auth, 1000) : "",
    ...(m.date ? { date: clip(m.date, 40) } : {}),
    ...(["bank", "company", "known"].includes(m.claimedSender) ? { claimedSender: m.claimedSender } : {}),
  };
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const demoLooks = new Map(); // example id -> a look that came back with a verdict

export default async function investigateRoutes(app) {
  const unavailable = (reply) => reply.code(503).send({ error: "investigate_unavailable", message: "Looking closer needs Muse Spark, which is not switched on here." });
  // One plain sentence, never the model's or the network's own words.
  const look = async (request, reply, args) => {
    try { return await investigate(args); } catch (e) {
      request.log.warn({ err: String(e?.message || e).slice(0, 200), code: e?.code || null }, "look closer failed");
      return reply.code(502).send({ error: "investigate_failed", message: "Prudence could not look closer right now. Please try again in a minute." });
    }
  };

  app.post("/api/check/investigate", { preHandler: requireUser, config: { rateLimit: { max: 10, timeWindow: "1 minute" } } }, async (request, reply) => {
    if (!investigateConfigured()) return unavailable(reply);
    const { checkId = null, message: provided = null } = request.body || {};
    const message = messageFrom(provided);
    if (!message.body.trim() && !message.subject.trim()) return reply.code(400).send({ error: "message_required", message: "Check this message first." });
    const check = UUID.test(String(checkId || "")) ? await one("SELECT verdict FROM checks WHERE id = $1 AND user_id = $2", [checkId, request.user.id]) : null;
    if (!check) return reply.code(404).send({ error: "check_not_found", message: "Check this message first." });
    return look(request, reply, {
      message, locale: request.user.locale || "en-US", personalContext: await loadContext(request.user), patternCards: await liveCards(),
      first: check.verdict, deps: investigateDeps(),
    });
  });

  app.post("/api/demo/investigate", { config: { rateLimit: { max: 20, timeWindow: "1 minute" } } }, async (request, reply) => {
    const e = demoExample(request.body?.id);
    if (!e) return reply.code(404).send({ error: "unknown example" });
    if (!investigateConfigured()) return unavailable(reply);
    const hit = demoLooks.get(e.id);
    if (hit) return hit;
    const out = await look(request, reply, {
      message: e, locale: e.locale, personalContext: demoProfile(e), patternCards: DEMO_CARDS,
      first: await demoVerdict(e), deps: investigateDeps({ exampleFacts: e.mockLinkInspection || null }),
    });
    if (out?.verdict) demoLooks.set(e.id, out);
    return out;
  });
}
