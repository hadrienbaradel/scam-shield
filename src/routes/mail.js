// The senior's mail: inbox and Scam Shield folders read live from Gmail
// (bodies are never stored), verdicts from our checks table, undo, the
// "check something else" paths (pasted text, screenshot) and "Ask my
// trusted person".

import { requireUser } from "../auth.js";
import { many, one } from "../db/pool.js";
import { normalizeMessage, header, parseAddress, linksFromText } from "../google/gmail.js";
import { parseEml } from "../google/eml.js";
import { extractFromImage, museConfigured } from "../../lib/muse.js";
import { clientFor, mapLimit, sharedFrom } from "../sync/worker.js";
import { runCheck, recordCheck } from "../sync/checker.js";
import { putBack, fileAsScam, decideAction, applyDecision } from "../sync/actions.js";
import { alertGuardians, answersForSenior } from "../guardians.js";
import { ReauthNeeded } from "../google/oauth.js";

const cache = new Map(); // `${userId}:${box}` -> { at, data }

async function labelsFor(userId) {
  const s = await one("SELECT label_scam, label_careful FROM gmail_state WHERE user_id = $1", [userId]);
  return { scam: s?.label_scam, careful: s?.label_careful };
}

function gmailError(reply, e) {
  if (e instanceof ReauthNeeded) return reply.code(409).send({ error: "reconnect", message: "Please reconnect your Gmail." });
  throw e;
}

export default async function mailRoutes(app) {
  app.addHook("preHandler", requireUser);
  const checkLimit = { config: { rateLimit: { max: 30, timeWindow: "1 minute" } } };

  app.get("/api/inbox", async (request, reply) => {
    const box = ["inbox", "scam", "careful"].includes(request.query.box) ? request.query.box : "inbox";
    const key = `${request.user.id}:${box}`;
    const hit = cache.get(key);
    if (hit && hit.at > Date.now() - 20000 && !request.query.fresh) return hit.data;
    const labels = await labelsFor(request.user.id);
    const labelId = box === "inbox" ? "INBOX" : labels[box];
    if (!labelId) return { box, messages: [] };
    try {
      const client = clientFor(request.user.id);
      const list = await client.listMessages({ labelIds: [labelId], maxResults: 30 });
      const metas = await mapLimit(list.messages || [], 8, (m) => client.getMessage(m.id, "metadata", ["From", "Subject", "Date"]).catch(() => null));
      const ids = metas.filter(Boolean).map((m) => m.id);
      const checks = new Map((await many(`SELECT id, gmail_message_id, verdict, verdict_value, action, restored_at, user_feedback
                                          FROM checks WHERE user_id = $1 AND gmail_message_id = ANY($2)`, [request.user.id, ids]))
        .map((c) => [c.gmail_message_id, c]));
      const data = {
        box,
        messages: metas.filter(Boolean).map((m) => {
          const from = parseAddress(header(m.payload?.headers, "From"));
          const c = checks.get(m.id);
          return {
            id: m.id, threadId: m.threadId, fromName: from.name, from: from.email,
            subject: header(m.payload?.headers, "Subject"), date: new Date(Number(m.internalDate)).toISOString(),
            unread: (m.labelIds || []).includes("UNREAD"), snippet: m.snippet,
            check: c ? { id: c.id, verdict: c.verdict_value, headline: c.verdict.headline, action: c.action, restored: Boolean(c.restored_at), feedback: c.user_feedback } : null,
          };
        }),
      };
      cache.set(key, { at: Date.now(), data });
      return data;
    } catch (e) { return gmailError(reply, e); }
  });

  app.get("/api/messages/:id", async (request, reply) => {
    try {
      const raw = await clientFor(request.user.id).getMessage(request.params.id);
      const message = normalizeMessage(raw);
      const check = await one("SELECT * FROM checks WHERE user_id = $1 AND gmail_message_id = $2", [request.user.id, message.id]);
      const answers = check ? await many(`SELECT a.answer, a.answered_at, a.created_at, g.guardian_name FROM alerts a
                                         JOIN guardianships g ON g.id = a.guardianship_id WHERE a.check_id = $1 ORDER BY a.created_at`, [check.id]) : [];
      return { message, check: check && { id: check.id, verdict: check.verdict, action: check.action, restored: Boolean(check.restored_at), feedback: check.user_feedback }, answers };
    } catch (e) {
      if (e.status === 404) return reply.code(404).send({ error: "This message is no longer in your mailbox." });
      return gmailError(reply, e);
    }
  });

  // Check (or re-check) one message now. With links=1, also follows the
  // links' redirects ("where does this link really go?").
  app.post("/api/messages/:id/check", checkLimit, async (request, reply) => {
    try {
      const client = clientFor(request.user.id);
      const message = normalizeMessage(await client.getMessage(request.params.id));
      const { verdict, ctx, linkInspection } = await runCheck({ user: request.user, message, resolveLinks: Boolean(request.body?.links) });
      let check = await one("SELECT * FROM checks WHERE user_id = $1 AND gmail_message_id = $2", [request.user.id, message.id]);
      if (check) {
        check = await one("UPDATE checks SET verdict = $2, verdict_value = $3, source = $4 WHERE id = $1 RETURNING *", [check.id, verdict, verdict.verdict, verdict.source]);
      } else {
        const labels = await labelsFor(request.user.id);
        const action = labels.scam ? await applyDecision(client, labels, message.id, decideAction({ verdict, message, ctx, actMode: request.user.act_mode })) : "none";
        check = await recordCheck({ userId: request.user.id, message, verdict, action });
      }
      cache.clear();
      return { check: { id: check.id, verdict, action: check.action }, linkInspection };
    } catch (e) { return gmailError(reply, e); }
  });

  app.post("/api/messages/:id/put-back", async (request, reply) => {
    const check = await one("SELECT * FROM checks WHERE user_id = $1 AND gmail_message_id = $2", [request.user.id, request.params.id]);
    if (!check) return reply.code(404).send({ error: "Nothing to undo for this message." });
    try {
      const client = clientFor(request.user.id);
      const message = normalizeMessage(await client.getMessage(request.params.id));
      await putBack({ client, userId: request.user.id, check, labels: await labelsFor(request.user.id), message });
      cache.clear();
      return { ok: true };
    } catch (e) { return gmailError(reply, e); }
  });

  app.post("/api/messages/:id/file-as-scam", async (request, reply) => {
    const check = await one("SELECT * FROM checks WHERE user_id = $1 AND gmail_message_id = $2", [request.user.id, request.params.id]);
    if (!check) return reply.code(404).send({ error: "Check this message first." });
    try {
      await fileAsScam({ client: clientFor(request.user.id), userId: request.user.id, check, labels: await labelsFor(request.user.id) });
      cache.clear();
      return { ok: true };
    } catch (e) { return gmailError(reply, e); }
  });

  // "Check something else": pasted text from any channel.
  app.post("/api/check/text", checkLimit, async (request, reply) => {
    const { from = "", fromName = "", subject = "", body = "", channel = "email" } = request.body || {};
    if (!String(body).trim() && !String(subject).trim()) return reply.code(400).send({ error: "Paste the message text first." });
    const message = {
      channel: ["email", "sms", "whatsapp"].includes(channel) ? channel : "email",
      from: String(from).slice(0, 200), fromName: String(fromName).slice(0, 200), subject: String(subject).slice(0, 300),
      body: String(body).slice(0, 6000), links: linksFromText(body), auth: "",
    };
    const { verdict } = await runCheck({ user: request.user, message });
    const check = await recordCheck({ userId: request.user.id, message, verdict, channel: "pasted" });
    return { checkId: check.id, verdict, message };
  });

  // Screenshot or photo of a message: read by Muse Spark, never stored.
  app.post("/api/check/image", { config: { rateLimit: { max: 10, timeWindow: "1 minute" } } }, async (request, reply) => {
    if (!museConfigured()) return reply.code(503).send({ error: "screenshots_need_muse", message: "Checking pictures needs Muse Spark. Paste the text instead." });
    const file = await request.file();
    if (!file || !["image/png", "image/jpeg", "image/webp"].includes(file.mimetype)) return reply.code(400).send({ error: "Please choose a PNG or JPEG picture." });
    const buf = await file.toBuffer();
    const { isMessage, message } = await extractFromImage({ imageBase64: buf.toString("base64"), mime: file.mimetype });
    if (!isMessage || !message.body) return reply.code(422).send({ error: "no_message", message: "We could not find a message in this picture." });
    const { verdict } = await runCheck({ user: request.user, message });
    const check = await recordCheck({ userId: request.user.id, message, verdict, channel: "screenshot" });
    return { checkId: check.id, verdict, message };
  });

  // An email file (.eml): downloaded from a webmail or forwarded as an
  // attachment. Parsed in memory, never stored.
  app.post("/api/check/eml", { config: { rateLimit: { max: 20, timeWindow: "1 minute" } } }, async (request, reply) => {
    const file = await request.file();
    if (!file || !/\.eml$/i.test(file.filename || "") && !/message\/rfc822/i.test(file.mimetype)) return reply.code(400).send({ error: "Please choose an email file (.eml)." });
    const message = await parseEml(await file.toBuffer());
    if (!message.from && !message.body) return reply.code(422).send({ error: "no_message", message: "We could not read an email in this file." });
    const { verdict } = await runCheck({ user: request.user, message });
    const check = await recordCheck({ userId: request.user.id, message, verdict, channel: "email_file" });
    return { checkId: check.id, verdict, message: { ...message, body: message.body.slice(0, 2000) } };
  });

  // "Ask my trusted person". For Gmail messages the server fetches what to
  // share; for pasted text or screenshots (never stored) the page sends it.
  app.post("/api/ask", async (request, reply) => {
    const { checkId, guardianshipIds = null, includeText = false, message: provided = null } = request.body || {};
    const check = checkId && await one("SELECT * FROM checks WHERE id = $1 AND user_id = $2", [checkId, request.user.id]);
    if (!check) return reply.code(404).send({ error: "Check this message first." });
    let message = provided;
    if (check.gmail_message_id) {
      try { message = normalizeMessage(await clientFor(request.user.id).getMessage(check.gmail_message_id)); } catch (e) { return gmailError(reply, e); }
    }
    if (!message) return reply.code(400).send({ error: "message required" });
    const sentTo = await alertGuardians({ senior: request.user, checkId: check.id, shared: sharedFrom(message, check.verdict, Boolean(includeText)), guardianshipIds });
    if (!sentTo.length) return reply.code(409).send({ error: "no_guardian", message: "Add a trusted person first." });
    return { sentTo };
  });

  app.get("/api/answers", async (request) => ({ answers: await answersForSenior(request.user.id, request.query.since || null) }));

  app.get("/api/checks", async (request) => ({
    checks: await many(`SELECT id, channel, sender_domain, verdict_value, verdict->>'headline' AS headline, action, restored_at, created_at
                        FROM checks WHERE user_id = $1 ORDER BY created_at DESC LIMIT 100`, [request.user.id]),
  }));

}
