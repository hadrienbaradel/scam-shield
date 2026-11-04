// The senior's mail: inbox and Prudence folders read live from Gmail
// (bodies are never stored), verdicts from our checks table, undo, the
// "check something else" paths (pasted text, screenshot) and "Ask my
// trusted person".

import { requireUser } from "../auth.js";
import { many, one } from "../db/pool.js";
import { normalizeMessage, header, parseAddress, linksFromText } from "../google/gmail.js";
import { parseEml } from "../google/eml.js";
import { extractFromImage, museConfigured, transcribeVoice, voiceConfigured } from "../../lib/muse.js";
import { inspectWav } from "../../lib/llm/audio.js";
import { clientFor, mapLimit, sharedFrom, finishAction } from "../sync/worker.js";
import { runCheck, recordCheck, loadContext } from "../sync/checker.js";
import { callBackFor } from "../../lib/context.js";
import { splitTurns, conversationInput } from "../../lib/conversation.js";
import { putBack, fileAsScam, undoThrow, undoKeep, decideAction } from "../sync/actions.js";
import { alertGuardians, answersForSenior } from "../guardians.js";
import { ReauthNeeded } from "../google/oauth.js";
import { tokenStatus } from "../google/tokens.js";

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
    // Gmail allows a limited cost per user per minute: even a "fresh" list
    // is reused for 10 s, and a plain one for 20 s.
    if (hit && hit.at > Date.now() - (request.query.fresh ? 10000 : 20000)) return hit.data;
    // No Google token at all (a local sign-in, _product/specs/developer-sign-in.md):
    // there is no Gmail to read, so nothing to refresh and nothing to
    // reconnect. A token Google refused (reauth_needed) still answers 409.
    if (!(await tokenStatus(request.user.id))) return { box, messages: [] };
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
    } catch (e) {
      // Over Gmail's per-minute quota: show the last list we had rather than an error.
      if (hit && /quota|rate limit|429/i.test(`${e.status || ""} ${e.message || ""}`)) return { ...hit.data, stale: true };
      return gmailError(reply, e);
    }
  });

  app.get("/api/messages/:id", async (request, reply) => {
    try {
      const raw = await clientFor(request.user.id).getMessage(request.params.id);
      const message = normalizeMessage(raw);
      const check = await one("SELECT * FROM checks WHERE user_id = $1 AND gmail_message_id = $2", [request.user.id, message.id]);
      const answers = check ? await many(`SELECT a.answer, a.answered_at, a.created_at, g.guardian_name FROM alerts a
                                         JOIN guardianships g ON g.id = a.guardianship_id WHERE a.check_id = $1 ORDER BY a.created_at`, [check.id]) : [];
      return { message, check: check && { id: check.id, verdict: check.verdict, action: check.action, restored: Boolean(check.restored_at), feedback: check.user_feedback }, answers,
        callBack: callBackFor(await loadContext(request.user), message) };
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
        // A re-check updates the explanation; it never moves mail on its own.
        check = await one("UPDATE checks SET verdict = $2, verdict_value = $3, source = $4 WHERE id = $1 RETURNING *", [check.id, verdict, verdict.verdict, verdict.source]);
      } else {
        const labels = await labelsFor(request.user.id);
        const decision = labels.scam ? decideAction({ verdict, message, ctx, actMode: request.user.act_mode, moveConsent: Boolean(request.user.move_consent_at) }) : { label: null };
        check = await recordCheck({ userId: request.user.id, message, verdict, action: decision.label ? "pending" : "none", planned: decision.label ? decision : null });
        if (check && decision.label) check.action = await finishAction({ client, labels, check, decision, userId: request.user.id });
        if (!check) check = await one("SELECT * FROM checks WHERE user_id = $1 AND gmail_message_id = $2", [request.user.id, message.id]);
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

  app.post("/api/messages/:id/undo-throw", async (request, reply) => {
    const check = await one("SELECT * FROM checks WHERE user_id = $1 AND gmail_message_id = $2", [request.user.id, request.params.id]);
    if (!check) return reply.code(404).send({ error: "Nothing to undo for this message." });
    try {
      await undoThrow({ client: clientFor(request.user.id), userId: request.user.id, check, labels: await labelsFor(request.user.id) });
      cache.clear();
      return { ok: true };
    } catch (e) { return gmailError(reply, e); }
  });

  app.post("/api/messages/:id/undo-keep", async (request, reply) => {
    const check = await one("SELECT * FROM checks WHERE user_id = $1 AND gmail_message_id = $2 AND user_feedback = 'not_scam'", [request.user.id, request.params.id]);
    if (!check) return reply.code(404).send({ error: "Nothing to undo for this message." });
    try {
      await undoKeep({ client: clientFor(request.user.id), userId: request.user.id, check, labels: await labelsFor(request.user.id) });
      cache.clear();
      return { ok: true };
    } catch (e) { return gmailError(reply, e); }
  });

  // "Check something else": pasted text from any channel. Words that hold
  // several turns ("Daniel: …" / "Me: …") are a conversation, judged as a
  // whole (_product/specs/messenger-channel.md, line 15): the other person's
  // last turn is the message, the turns before it its thread history, and
  // every link in the chat is looked at. An email stays one message.
  app.post("/api/check/text", checkLimit, async (request, reply) => {
    const { from = "", fromName = "", subject = "", body = "", channel = "email" } = request.body || {};
    if (!String(body).trim() && !String(subject).trim()) return reply.code(400).send({ error: "Paste the message text first." });
    const kind = ["email", "sms", "whatsapp", "social"].includes(channel) ? channel : "email";
    const words = String(body).slice(0, 6000);
    const turns = kind === "email" ? null : splitTurns(words, { selfNames: [request.user.name] });
    const chat = turns && conversationInput(turns, { channel: "social" });
    const message = chat
      ? { ...chat.message, from: String(from).slice(0, 200), fromName: String(fromName).slice(0, 200) || chat.message.fromName,
        subject: String(subject).slice(0, 300), links: linksFromText(words), auth: "" }
      : { channel: kind, from: String(from).slice(0, 200), fromName: String(fromName).slice(0, 200), subject: String(subject).slice(0, 300),
        body: words, links: linksFromText(body), auth: "" };
    const { verdict, ctx } = await runCheck({ user: request.user, message, threadHistory: chat?.threadHistory || [] });
    const check = await recordCheck({ userId: request.user.id, message, verdict, channel: "pasted" });
    // The answer carries the whole conversation, so "Ask my trusted person"
    // can share all of it (it is never stored).
    return { checkId: check.id, verdict, message: chat ? { ...message, body: words } : message, callBack: callBackFor(ctx, message) };
  });

  // Screenshot or photo of a message: read by Muse Spark, never stored.
  app.post("/api/check/image", { config: { rateLimit: { max: 10, timeWindow: "1 minute" } } }, async (request, reply) => {
    if (!museConfigured()) return reply.code(503).send({ error: "screenshots_need_muse", message: "Checking pictures needs Muse Spark. Paste the text instead." });
    const file = await request.file();
    if (!file || !["image/png", "image/jpeg", "image/webp"].includes(file.mimetype)) return reply.code(400).send({ error: "Please choose a PNG or JPEG picture." });
    const buf = await file.toBuffer();
    const { isMessage, message } = await extractFromImage({ imageBase64: buf.toString("base64"), mime: file.mimetype });
    if (!isMessage || !message.body) return reply.code(422).send({ error: "no_message", message: "We could not find a message in this picture." });
    const { verdict, ctx } = await runCheck({ user: request.user, message });
    const check = await recordCheck({ userId: request.user.id, message, verdict, channel: "screenshot" });
    return { checkId: check.id, verdict, message, callBack: callBackFor(ctx, message) };
  });

  // A voice note or voicemail: the recording becomes words (Muse Voice
  // Transcribe by default, see transcribeVoice), then it is judged like any
  // message. The page sends 16 kHz mono 16-bit WAV of at most 4 minutes;
  // anything else is refused here, before it leaves the server. The
  // recording is never stored, only the check (verdict, no audio, no words).
  app.post("/api/check/voice", { config: { rateLimit: { max: 10, timeWindow: "1 minute" } } }, async (request, reply) => {
    if (!voiceConfigured()) return reply.code(503).send({ error: "voice_needs_muse", message: "Checking voice messages needs Meta's Muse Voice Transcribe, which is not switched on here yet." });
    let file;
    let wav = null;
    try {
      file = await request.file();
      wav = file ? await file.toBuffer() : null;
    } catch (e) {
      if (e.code === "FST_REQ_FILE_TOO_LARGE") return reply.code(413).send({ error: "voice_too_large", message: "This recording is over 8 MB: please choose one of 4 minutes or less." });
      throw e;
    }
    if (!wav) return reply.code(400).send({ error: "no_recording", message: "Please choose a voice recording." });
    const format = inspectWav(wav);
    if (!format.ok) return reply.code(400).send({ error: format.error, message: format.message });
    let transcript;
    try { ({ text: transcript } = await transcribeVoice({ wav })); } catch (e) {
      request.log.warn({ err: e.message }, "voice transcription failed");
      return reply.code(502).send({ error: "voice_failed", message: "We could not listen to this recording right now. Please try again in a minute." });
    }
    if (!transcript) return reply.code(422).send({ error: "no_speech", message: "We could not hear any words in this recording." });
    const caller = String(file.fields?.from?.value || "").slice(0, 200);
    const message = { channel: "voice_transcript", from: caller, fromName: caller || "Voice message", subject: "", body: transcript, links: linksFromText(transcript), auth: "" };
    const { verdict, ctx } = await runCheck({ user: request.user, message });
    const check = await recordCheck({ userId: request.user.id, message, verdict, channel: "voice" });
    return { checkId: check.id, verdict, message, transcript, callBack: callBackFor(ctx, message) };
  });

  // An email file (.eml): downloaded from a webmail or forwarded as an
  // attachment. Parsed in memory, never stored.
  app.post("/api/check/eml", { config: { rateLimit: { max: 20, timeWindow: "1 minute" } } }, async (request, reply) => {
    const file = await request.file();
    if (!file || !/\.eml$/i.test(file.filename || "") && !/message\/rfc822/i.test(file.mimetype)) return reply.code(400).send({ error: "Please choose an email file (.eml)." });
    const message = await parseEml(await file.toBuffer());
    if (!message.from && !message.body) return reply.code(422).send({ error: "no_message", message: "We could not read an email in this file." });
    const { verdict, ctx } = await runCheck({ user: request.user, message });
    const check = await recordCheck({ userId: request.user.id, message, verdict, channel: "email_file" });
    return { checkId: check.id, verdict, message: { ...message, body: message.body.slice(0, 2000) } };
  });

  // "Ask my trusted person". For Gmail messages the server fetches what to
  // share; for pasted text or screenshots (never stored) the page sends it.
  app.post("/api/ask", async (request, reply) => {
    const { checkId, guardianshipIds = null, includeText = false, message: provided = null, via = "email" } = request.body || {};
    const check = checkId && await one("SELECT * FROM checks WHERE id = $1 AND user_id = $2", [checkId, request.user.id]);
    if (!check) return reply.code(404).send({ error: "Check this message first." });
    let message = provided;
    if (check.gmail_message_id) {
      try { message = normalizeMessage(await clientFor(request.user.id).getMessage(check.gmail_message_id)); } catch (e) { return gmailError(reply, e); }
    }
    if (!message) return reply.code(400).send({ error: "message required" });
    const active = await many("SELECT id, guardian_name FROM guardianships WHERE senior_id = $1 AND status = 'active'", [request.user.id]);
    if (!active.length) return reply.code(409).send({ error: "no_guardian", message: "Add a trusted person first." });
    const texts = [];
    const sentTo = await alertGuardians({ senior: request.user, checkId: check.id, shared: sharedFrom(message, check.verdict, Boolean(includeText)), guardianshipIds,
      via: via === "text" ? "text" : "email", texts });
    return { sentTo, alreadyAsked: sentTo.length === 0, texts };
  });

  app.get("/api/answers", async (request) => ({ answers: await answersForSenior(request.user.id, request.query.since || null) }));

  app.get("/api/checks", async (request) => ({
    checks: await many(`SELECT id, channel, sender_domain, verdict_value, verdict->>'headline' AS headline, action, restored_at, created_at
                        FROM checks WHERE user_id = $1 ORDER BY created_at DESC LIMIT 100`, [request.user.id]),
  }));

}
