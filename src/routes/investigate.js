// Look closer (_product/specs/investigate.md): Muse Spark checks a message
// again with Prudence's own tools (lib/investigate.js).
//   POST /api/check/investigate  signed in: { checkId, message, threadHistory }
//     with the message exactly as the check judged it (the `judged` part of
//     the /api/check/* answer: every field the rules read, attachments,
//     hidden text, a chat's full text and earlier turns, an inbox's rows);
//     the first verdict is the check's own row, the context and cards are
//     the person's and the links are inspected again, as runCheck does, so
//     the look's rules see what the first check's rules saw.
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
import { contextFor, linkFactsFor, needsLandingLook } from "../sync/checker.js";
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

// The message as the page sends it back: every field the rules read
// (lib/detector.js), each cut to the size the check routes allow; links in
// the words are found again, so a pasted link is never lost.
const clip = (v, n) => String(v ?? "").slice(0, n);
export function messageFrom(input) {
  const m = input && typeof input === "object" ? input : {};
  // One rule for every optional text: kept only when it holds more than spaces, then cut to size.
  const named = (k, n) => (typeof m[k] === "string" && m[k].trim() ? { [k]: m[k].slice(0, n) } : {});
  const body = clip(m.body, 6000);
  const { fullText } = named("fullText", 6000);
  // At most 40 links, read from at most 200 sent ones, de-duplicated in one pass.
  const links = [];
  const hrefs = new Set();
  for (const l of [...(Array.isArray(m.links) ? m.links.slice(0, 200) : []), ...linksFromText(fullText || body)]) {
    if (links.length >= 40) break;
    const href = clip(l?.href, 2000);
    if (!/^https?:\/\//i.test(href) || hrefs.has(href)) continue;
    hrefs.add(href);
    links.push({ href, text: clip(l.text || l.href, 300) });
  }
  const attachments = (Array.isArray(m.attachments) ? m.attachments : []).slice(0, 20)
    .map((a) => ({ filename: clip(a?.filename, 200), mimeType: clip(a?.mimeType, 100), ...(Number.isFinite(a?.size) ? { size: a.size } : {}) }));
  const threads = m.inbox && Array.isArray(m.threads) ? m.threads.slice(0, 30)
    .map((t) => ({ name: clip(t?.name, 80), preview: clip(t?.preview, 300), date: clip(t?.date, 40), section: clip(t?.section, 20) })) : null;
  return {
    channel: /^[a-z_]{2,20}$/.test(String(m.channel || "")) ? m.channel : "email",
    from: clip(m.from, 200), fromName: clip(m.fromName, 200), replyTo: clip(m.replyTo, 200),
    subject: clip(m.subject, 300), body, links,
    auth: typeof m.auth === "string" ? clip(m.auth, 1000) : "",
    attachments,
    ...(m.date ? { date: clip(m.date, 40) } : {}),
    ...named("fullText", 6000), ...named("hiddenText", 6000), ...named("claimedBrand", 100), ...named("claimedContact", 100),
    ...(threads ? { inbox: true, threads } : {}),
    ...(["bank", "company", "known"].includes(m.claimedSender) ? { claimedSender: m.claimedSender } : {}),
  };
}
// A chat's earlier turns, as /api/check/text judged them: every turn, in order,
// the whole conversation bounded at 6000 characters as that route bounds the
// pasted chat (the first turns are where an opener sits: lib/detector.js).
export function historyFrom(input) {
  const turns = [];
  let room = 6000;
  for (const t of Array.isArray(input) ? input.slice(0, 1000) : []) {
    if (room <= 0) break;
    if (!t || typeof t !== "object") continue;
    const body = clip(t.body, room);
    room -= body.length;
    turns.push({ from: clip(t.from, 200), date: t.date ? clip(t.date, 40) : null, body });
  }
  return turns;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const demoLooks = new Map(); // example id -> the look running or kept for it (a promise)

export default async function investigateRoutes(app) {
  const unavailable = (reply) => reply.code(503).send({ error: "investigate_unavailable", message: "Looking closer needs Muse Spark, which is not switched on here." });
  // One plain sentence, never the model's or the network's own words.
  const failed = (reply) => reply.code(502).send({ error: "investigate_failed", message: "Prudence could not look closer right now. Please try again in a minute." });
  // The look, or null once the 502 is sent.
  const look = async (request, reply, args) => {
    try { return await investigate(args); } catch (e) {
      request.log.warn({ err: String(e?.message || e).slice(0, 200), code: e?.code || null }, "look closer failed");
      failed(reply);
      return null;
    }
  };

  app.post("/api/check/investigate", { preHandler: requireUser, config: { rateLimit: { max: 10, timeWindow: "1 minute" } } }, async (request, reply) => {
    if (!investigateConfigured()) return unavailable(reply);
    const { checkId = null, message: provided = null, threadHistory = [] } = request.body || {};
    // The person's own check first: nothing in the body is read for anyone else.
    const check = UUID.test(String(checkId || "")) ? await one("SELECT verdict FROM checks WHERE id = $1 AND user_id = $2", [checkId, request.user.id]) : null;
    if (!check) return reply.code(404).send({ error: "check_not_found", message: "Check this message first." });
    const message = messageFrom(provided);
    if (!message.body.trim() && !message.subject.trim()) return reply.code(400).send({ error: "message_required", message: "Check this message first." });
    // The context, the cards and the link facts through the very helpers runCheck uses
    // (src/sync/checker.js): the links' age and listings, and where they land when the
    // first check looked (a Be careful verdict with links had its landing look).
    const { ctx, cards } = await contextFor(request.user, message);
    const linkInspection = await linkFactsFor(message, ctx, { resolve: needsLandingLook(check.verdict, message) });
    const out = await look(request, reply, {
      message, threadHistory: historyFrom(threadHistory), linkInspection, locale: request.user.locale || "en-US",
      personalContext: ctx, patternCards: cards, first: check.verdict, deps: investigateDeps(),
    });
    return out ?? reply; // the 502 already went out
  });

  // One look per example, shared: the pending look is kept at once, so a second
  // viewer tapping during its 10 to 25 seconds waits for it instead of paying
  // another. It is dropped when it fails or ends without a verdict, or when it
  // stands on the rules' answer for a failing model (degraded, not kept by the
  // demo check either), so the next tap tries again.
  const demoLook = async (e, log) => {
    const first = await demoVerdict(e);
    try {
      const out = await investigate({
        message: e, threadHistory: e.threadHistory || [], linkInspection: e.mockLinkInspection || {}, locale: e.locale,
        personalContext: demoProfile(e), patternCards: DEMO_CARDS,
        first, deps: investigateDeps({ exampleFacts: e.mockLinkInspection || null }),
      });
      return { out, keep: Boolean(out.verdict) && !first?.degraded };
    } catch (err) {
      log.warn({ err: String(err?.message || err).slice(0, 200), code: err?.code || null }, "look closer failed");
      return { failed: true, keep: false };
    }
  };

  app.post("/api/demo/investigate", { config: { rateLimit: { max: 20, timeWindow: "1 minute" } } }, async (request, reply) => {
    const e = demoExample(request.body?.id);
    if (!e) return reply.code(404).send({ error: "unknown example" });
    if (!investigateConfigured()) return unavailable(reply);
    let job = demoLooks.get(e.id);
    if (!job) {
      job = demoLook(e, request.log);
      demoLooks.set(e.id, job);
      job.then((r) => { if (!r.keep && demoLooks.get(e.id) === job) demoLooks.delete(e.id); });
    }
    const r = await job;
    if (r.failed) return failed(reply);
    return r.out;
  });
}
