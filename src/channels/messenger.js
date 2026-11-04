// Facebook and Messenger channel ("send it to Prudence"): the senior sends
// the Prudence Page anything (forwarded messages, pasted words, screenshots
// of a chat or of a profile, a voice message); what arrives within a few
// seconds is judged as one conversation and gets one reply in the chat
// (_product/specs/messenger-channel.md). Same engine and wordings as the
// WhatsApp channel (src/channels/whatsapp.js), whose pieces are reused.
// A video is judged on what is said in it and what it shows, together: its
// sound through Muse Voice Transcribe, four frames through Muse Spark, one
// verdict (line 16).
// Pure logic: the Graph API and Meta's CDN go through an injectable fetch,
// ffmpeg through an injectable transcoder and video reader, the grouping
// window through an injectable timer, so tests run with the mock LLM and
// no network. Nothing is stored (not the messages, the pictures, the
// recordings, the videos, nor the verdict); the sender is a Page-scoped
// id, not an account, so the check uses the pattern cards and no personal
// context.
// Payload and endpoint shapes follow Meta's Messenger Platform docs
// (webhook "messages" event, Send API, checked 2026-11-04), unverified live
// until the first delivery; every such assumption is a named constant below.
// Fail closed: a delivery is handled only with a valid X-Hub-Signature-256
// (src/routes/messenger.js); the Page token goes only to the Graph API,
// never to an attachment URL.

import { checkMessage, extractFromImage, museConfigured, transcribeVoice, voiceConfigured } from "../../lib/muse.js";
import { emptyContext } from "../../lib/context.js";
import { linksFromText } from "../google/gmail.js";
import { inspectMessageLinks } from "../links/resolver.js";
import {
  GRAPH_URL, IMAGE_TYPES, MAX_AUDIO_BYTES, MAX_IMAGE_BYTES, createLimiter, createSeen, detectLanguage, ffmpegToWav, ffmpegVideo, formatReply,
  shippedCards, wordsFor,
} from "./whatsapp.js";

export { verificationChallenge, verifySignature } from "./whatsapp.js";

// Assumption (Meta's docs, Nov 2026): the current Graph API version.
export const DEFAULT_GRAPH_VERSION = "v26.0";
// Assumption: the Send API takes 2,000 characters of text; we stay under it.
export const MAX_REPLY_CHARS = 1900;
// Assumption: a few seconds cover a chat forwarded message by message
// (spec line 2); MESSENGER_GROUP_MS overrides it.
export const DEFAULT_GROUP_MS = 3000;
// A group is judged at once past this many items, whatever the window says.
export const MAX_GROUP_ITEMS = 20;
// A video longer or bigger than this gets "too long" (spec line 16).
export const MAX_VIDEO_BYTES = 25 * 1024 * 1024;
export const MAX_VIDEO_SECONDS = 180;
// Assumption: a video comes as type "video" with its url on video.xx.fbcdn.net
// (or another Meta CDN host below), checked on the first live delivery.
// Assumption: attachment URLs are on Meta's CDN, seen as scontent.xx.fbcdn.net,
// video.xx.fbcdn.net, cdn.fbsbx.com and lookaside.fbsbx.com. Anything else,
// plain http, or a redirect is refused; no token is ever attached.
export const ATTACHMENT_HOSTS = ["lookaside.fbsbx.com", "cdn.fbsbx.com"];
export const ATTACHMENT_HOST_SUFFIXES = [".fbcdn.net", ".fbsbx.com"];
// Assumption: the CDN names the type in content-type; the url's extension
// is the fallback.
const EXTENSION_TYPES = { jpg: "image/jpeg", jpeg: "image/jpeg", png: "image/png", webp: "image/webp" };
// Attachment types as the webhook names them (Aug 2026: a sticker is its own
// type, with payload.sticker_id; before, an image with a sticker_id).
// Image, audio and video are read; the rest is "only texts, pictures, voice notes and videos".
const ATTACHMENT_TYPES = { image: "image", audio: "audio", video: "video", file: "file", sticker: "sticker", fallback: "link" };

export function messengerConfig(env = process.env) {
  const groupMs = env.MESSENGER_GROUP_MS ? Number(env.MESSENGER_GROUP_MS) : NaN;
  return {
    token: env.MESSENGER_PAGE_ACCESS_TOKEN || "",
    pageId: env.MESSENGER_PAGE_ID || "",
    appSecret: env.MESSENGER_APP_SECRET || "",
    verifyToken: env.MESSENGER_VERIFY_TOKEN || "",
    pageLink: env.MESSENGER_PAGE_LINK || "",
    graphVersion: env.MESSENGER_GRAPH_VERSION || DEFAULT_GRAPH_VERSION,
    groupMs: Number.isFinite(groupMs) && groupMs >= 0 ? groupMs : DEFAULT_GROUP_MS,
    ffmpegPath: env.FFMPEG_PATH || "ffmpeg",
  };
}

// The channel needs the Page token and the Page id to answer; the webhook
// also needs the app secret (every delivery is signature-checked, never
// skipped) and the verify token for Meta's handshake.
export function messengerConfigured(env = process.env) {
  const c = messengerConfig(env);
  return Boolean(c.token && c.pageId);
}
export const webhookActive = (env = process.env) => messengerConfigured(env) && Boolean(messengerConfig(env).appSecret);

// The m.me address Settings shows ("Open Messenger"): only an https link,
// and only while the Page answers; null otherwise.
export function messengerLink(env = process.env) {
  if (!messengerConfigured(env)) return null;
  try {
    const u = new URL(messengerConfig(env).pageLink);
    return u.protocol === "https:" && !u.username && !u.password ? u.href : null;
  } catch { return null; }
}

// Every message of a delivery, one item per text and per attachment (a
// message with three pictures gives three items, ids <mid>, <mid>#2, <mid>#3).
// Events without a message (delivery, read, postback, reaction) are counted
// and ignored; an echo of the Page's own reply is kept with echo: true so
// the channel can drop it.
export function parseWebhook(body) {
  const messages = [];
  let ignored = 0;
  if (body?.object && body.object !== "page") return { messages, ignored };
  for (const entry of body?.entry || []) {
    for (const ev of entry?.messaging || []) {
      const m = ev?.message;
      if (!m || typeof m !== "object") { ignored++; continue; }
      const base = { from: String(ev.sender?.id || ""), timestamp: Number(ev.timestamp) || 0, echo: m.is_echo === true };
      const mid = String(m.mid || "");
      const items = [];
      if (typeof m.text === "string" && m.text.trim()) items.push({ type: "text", text: m.text, media: null });
      for (const a of Array.isArray(m.attachments) ? m.attachments : []) {
        const url = typeof a?.payload?.url === "string" ? a.payload.url : "";
        // Before Aug 2026 a sticker came as an image with a sticker_id.
        const type = a?.payload?.sticker_id ? "sticker" : ATTACHMENT_TYPES[a?.type] || "unknown";
        items.push({ type, text: "", media: url ? { url } : null });
      }
      if (!items.length) items.push({ type: "unknown", text: "", media: null });
      items.forEach((it, i) => messages.push({ id: mid && i ? `${mid}#${i + 1}` : mid, ...base, ...it }));
    }
  }
  return { messages, ignored };
}

class Expected extends Error {
  constructor(key) { super(key); this.replyKey = key; }
}

// The attachment URL from the payload, or an error naming what was wrong
// with it: https only, on Meta's CDN, no credentials, the default port.
export function attachmentUrl(raw, { hosts = ATTACHMENT_HOSTS, suffixes = ATTACHMENT_HOST_SUFFIXES } = {}) {
  let u;
  try { u = new URL(String(raw || "")); } catch { throw new Error("attachment url unreadable"); }
  if (u.protocol !== "https:") throw new Error(`attachment url not https (${u.protocol})`);
  const host = u.hostname.toLowerCase();
  if (!hosts.includes(host) && !suffixes.some((s) => host.endsWith(s))) throw new Error(`attachment host ${host} is not Meta's CDN`);
  if (u.username || u.password) throw new Error("attachment url carries credentials");
  if (u.port) throw new Error(`attachment url on port ${u.port}`);
  return u.href;
}

// The type the CDN names; the url's extension only when it names none (or
// a generic octet-stream).
function imageMime(contentType, url) {
  const ct = String(contentType || "").split(";")[0].trim().toLowerCase();
  if (ct && !/^(application|binary)\/octet-stream$/.test(ct)) return ct;
  const ext = (new URL(url).pathname.match(/\.([a-z0-9]+)$/i) || [])[1]?.toLowerCase();
  return EXTENSION_TYPES[ext] || ct;
}

// The bytes, never more than max (the download stops there); over it, the
// reply named by tooBig.
async function readCapped(res, max, tooBig = "tooBig") {
  if (Number(res.headers.get("content-length")) > max) throw new Expected(tooBig);
  if (!res.body) {
    const buffer = Buffer.from(await res.arrayBuffer());
    if (buffer.length > max) throw new Expected(tooBig);
    return buffer;
  }
  const chunks = [];
  let size = 0;
  for await (const chunk of res.body) {
    size += chunk.length;
    if (size > max) throw new Expected(tooBig);
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}

// Who said a turn, as the model reads it in thread_history.
const speakerOf = (t) => (t.who === "you" ? "You" : t.name || (t.who === "them" ? "The other person" : "Unknown"));

const defaultTimer = (fn, ms) => { const t = setTimeout(fn, ms); return () => clearTimeout(t); };

export function createMessengerChannel({
  env = process.env,
  fetchImpl = (...args) => globalThis.fetch(...args),
  transcode = (buffer) => ffmpegToWav(buffer, { ffmpegPath: messengerConfig(env).ffmpegPath }),
  readVideo = (buffer, opts) => ffmpegVideo(buffer, { ffmpegPath: messengerConfig(env).ffmpegPath, ...opts }),
  patternCards = shippedCards,
  inspectLinks = (message) => inspectMessageLinks(message, emptyContext(""), { resolve: false, fetchImpl }),
  now = Date.now,
  limiter = createLimiter({ now }),
  seen = createSeen(),
  log = console,
  groupMs,
  setTimer = defaultTimer,
  attachmentHosts = { hosts: ATTACHMENT_HOSTS, suffixes: ATTACHMENT_HOST_SUFFIXES },
  maxGroupItems = MAX_GROUP_ITEMS,
  maxImageBytes = MAX_IMAGE_BYTES,
  maxAudioBytes = MAX_AUDIO_BYTES,
  maxVideoBytes = MAX_VIDEO_BYTES,
  maxVideoSeconds = MAX_VIDEO_SECONDS,
  maxReplyChars = MAX_REPLY_CHARS,
} = {}) {
  const cfg = () => messengerConfig(env);
  const windowMs = () => (groupMs ?? cfg().groupMs);
  const groups = new Map();
  const inflight = new Set();
  const track = (p) => { inflight.add(p); p.catch(() => {}).finally(() => inflight.delete(p)); return p; };

  // The Send API. Meta documents the Page token as an access_token query
  // parameter; the Graph API also takes it as an OAuth Bearer header, which
  // keeps it out of URLs (and so out of proxy and error logs).
  async function send(payload) {
    const res = await fetchImpl(`${GRAPH_URL}/${cfg().graphVersion}/${encodeURIComponent(cfg().pageId)}/messages`, {
      method: "POST", headers: { authorization: `Bearer ${cfg().token}`, "content-type": "application/json" },
      body: JSON.stringify(payload), signal: AbortSignal.timeout(15000),
    });
    const out = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(`Messenger send ${res.status}: ${String(out.error?.message || "").slice(0, 200)}`);
    return out;
  }
  async function sendText(to, text) {
    const out = await send({ recipient: { id: to }, messaging_type: "RESPONSE", message: { text: String(text).slice(0, maxReplyChars) } });
    return { id: out.message_id || null };
  }
  // The typing dots while Prudence works; a failure here changes nothing.
  const typingOn = (to) => send({ recipient: { id: to }, sender_action: "typing_on" }).catch((e) => log.warn?.({ err: e.message }, "messenger typing failed"));

  // Downloaded at once (the URLs expire), with no token, never following a redirect.
  async function download(media, maxBytes, tooBig = "tooBig") {
    const url = attachmentUrl(media?.url, attachmentHosts);
    const res = await fetchImpl(url, { redirect: "manual", signal: AbortSignal.timeout(30000) });
    if (res.status >= 300 && res.status < 400) throw new Error(`attachment redirected (${res.status}), not followed`);
    if (!res.ok) throw new Error(`attachment download ${res.status}`);
    const buffer = await readCapped(res, maxBytes, tooBig);
    return { buffer, mime: imageMime(res.headers.get("content-type"), url) };
  }

  async function judge({ message, threadHistory = [], socialProfile = null, lang }) {
    const cards = await Promise.resolve().then(patternCards).catch(() => []);
    const linkInspection = await Promise.resolve().then(() => inspectLinks(message)).catch(() => ({}));
    return checkMessage({
      locale: lang === "fr" ? "fr-FR" : "en-US", message, personalContext: emptyContext(""), patternCards: cards,
      threadHistory, mockLinkInspection: linkInspection, linkInspection, socialProfile,
    });
  }

  // A video as one turn: what its four frames show (Muse Spark) and what
  // is said in it (Muse Voice Transcribe, when voice is on), read together
  // from one temporary file; null when neither has anything. stats gets
  // its length and size for the log, never its words.
  async function readVideoTurn(media, stats) {
    const { buffer } = await download(media, maxVideoBytes, "videoTooLong");
    const clip = await readVideo(buffer, { maxSeconds: maxVideoSeconds });
    (stats.videos ||= []).push({ seconds: Math.round(clip.durationSec * 10) / 10, bytes: buffer.length });
    if (clip.tooLong || clip.durationSec > maxVideoSeconds) throw new Expected("videoTooLong");
    const [shown, heard] = await Promise.all([
      clip.sheet ? extractFromImage({ imageBase64: clip.sheet.toString("base64"), mime: "image/jpeg" }) : null,
      clip.wav && voiceConfigured() ? transcribeVoice({ wav: clip.wav, fetchImpl }).then((r) => r.text) : "",
    ]);
    const screen = shown?.isMessage ? String(shown.message?.body || "").trim() : "";
    const said = String(heard || "").trim();
    if (!screen && !said) return null;
    const text = [screen && `What the video shows:\n${screen}`, said && `What is said in it:\n${said}`].filter(Boolean).join("\n\n");
    const links = [...(screen ? shown.message.links || [] : []), ...linksFromText(said)];
    return { who: "them", name: (screen && shown.message.fromName) || "", text, raw: [screen, said].filter(Boolean).join("\n"), links, setting: "video", said };
  }

  // One reply for a group of items: { text, lang, verdict? }. Texts are the
  // other person's turns; a picture gives one turn, a chat's turns, a
  // profile's facts, or a list of conversations (an inbox, judged as its
  // own message with its rows); a voice message gives its words; a video
  // one turn with what it shows and what is said in it. The last turn is
  // judged, the earlier ones are its thread history.
  async function answer(items, lang = "en", stats = {}) {
    const W = () => wordsFor(lang);
    const readable = items.filter((i) => (i.type === "text" && i.text.trim()) || (["image", "audio", "video"].includes(i.type) && i.media?.url));
    if (!readable.length) return { text: W().onlyTypesVideo, lang };
    if ((readable.some((i) => i.type === "image" || i.type === "video") && !museConfigured()) || (readable.some((i) => i.type === "audio") && !voiceConfigured())) {
      return { text: W().needsMuse, lang };
    }
    const turns = [];
    const transcripts = [];
    let profile = null;
    let profileMessage = null;
    let blankPicture = false;
    let silentVoice = false;
    let emptyVideo = false;
    let videoWords = false;
    for (const it of readable) {
      if (it.type === "text") turns.push({ who: "them", name: "", text: it.text.trim() });
      else if (it.type === "image") {
        const { buffer, mime } = await download(it.media, maxImageBytes);
        if (!IMAGE_TYPES.includes(mime)) continue;
        const read = await extractFromImage({ imageBase64: buffer.toString("base64"), mime });
        if (read.kind === "conversation" && read.turns?.length) turns.push(...read.turns);
        else if (read.kind === "inbox" && read.isMessage) {
          turns.push({ who: "them", name: read.message.fromName || "", text: read.message.body, links: read.message.links, inbox: read.message });
        } else if (read.kind === "profile") {
          profile = { platform: read.platform || profile?.platform || null, facts: [...(profile?.facts || []), ...(read.profileFacts || [])].slice(0, 12) };
          profileMessage = read.message;
        } else if (read.isMessage && read.message?.body) {
          turns.push({ who: "them", name: read.message.fromName || "", text: read.message.body, links: read.message.links });
        } else blankPicture = true;
      } else if (it.type === "video") {
        const turn = await readVideoTurn(it.media, stats);
        if (!turn) { emptyVideo = true; continue; }
        if (turn.said) { transcripts.push(turn.said); videoWords = true; }
        turns.push(turn);
      } else {
        const { buffer } = await download(it.media, maxAudioBytes);
        const wav = await transcode(buffer);
        const { text: heard } = await transcribeVoice({ wav, fetchImpl });
        if (!heard) { silentVoice = true; continue; }
        transcripts.push(heard);
        turns.push({ who: "them", name: "", text: heard });
      }
    }
    if (!turns.length && !profileMessage) {
      return { text: emptyVideo ? W().videoNothing : blankPicture ? W().noMessage : silentVoice ? W().noWords : W().onlyTypesVideo, lang };
    }
    // A video's own words, not the labels its turn is framed with.
    const words = [...turns.map((t) => t.raw ?? t.text), ...(profile?.facts || [])].join("\n");
    lang = detectLanguage(words, "");
    const last = turns.at(-1);
    const message = last?.inbox ? { ...last.inbox, channel: "messenger" }
      : last ? {
        channel: "messenger", from: "", fromName: last.who === "you" ? "You" : last.name || "", subject: "", body: last.text.slice(0, 6000),
        links: last.links || linksFromText(last.text), auth: "", ...(last.setting ? { setting: last.setting } : {}),
      }
      : { ...profileMessage, channel: "messenger" };
    const threadHistory = turns.slice(0, -1).slice(-30).map((t) => ({ from: speakerOf(t), date: null, body: t.text }));
    const verdict = await judge({ message, threadHistory, socialProfile: profile?.facts.length ? profile : null, lang });
    const reply = formatReply(verdict, { lang, transcript: transcripts.join(" "), saysKey: videoWords ? "saysVideo" : "says" }).slice(0, maxReplyChars);
    return { text: reply, lang, verdict };
  }

  async function runGroup(g) {
    const started = now();
    const items = [...g.items].sort((a, b) => a.timestamp - b.timestamp);
    let lang = detectLanguage(items.map((i) => i.text).join(" "), "");
    const ids = items.map((i) => i.id);
    // A video's length and size only, never its words or what it shows.
    const stats = {};
    try {
      const out = await answer(items, lang, stats);
      lang = out.lang;
      const sent = await sendText(g.from, out.text);
      log.info?.({ ids, types: items.map((i) => i.type), lang, verdict: out.verdict?.verdict || null, source: out.verdict?.source || null, ms: now() - started, ...stats }, "messenger check answered");
      return { ids, lang, verdict: out.verdict?.verdict || null, reply: out.text, sent };
    } catch (e) {
      const key = e.replyKey || "failed";
      log.error?.({ ids, types: items.map((i) => i.type), err: e.message, ms: now() - started, ...stats }, "messenger check failed");
      await sendText(g.from, wordsFor(lang)[key]).catch((e2) => log.error?.({ ids, err: e2.message }, "messenger reply failed"));
      return { ids, lang, error: e.message, reply: wordsFor(lang)[key] };
    }
  }

  // A sender's group opens on their first message (the typing dots go out
  // then), and is judged groupMs after the last one arrives.
  function enqueue(m) {
    let g = groups.get(m.from);
    if (!g) {
      g = { from: m.from, items: [], cancel: null };
      const ready = new Promise((resolve) => { g.fire = resolve; });
      const typing = typingOn(m.from);
      g.done = track((async () => {
        await ready;
        groups.delete(g.from); // a message from now on opens the next group
        await typing;
        return runGroup(g);
      })());
      groups.set(m.from, g);
    }
    g.items.push(m);
    g.cancel?.();
    if (g.items.length >= maxGroupItems) { g.cancel = null; g.fire(); return; }
    g.cancel = setTimer(() => g.fire(), windowMs());
  }

  // One message as it arrives: dropped (echo, duplicate, malformed), held
  // back (over the limit: one "please wait", then silence), or queued.
  async function arrive(m) {
    if (m.echo) return { id: m.id, skipped: "echo" };
    if (!m.id || !m.from) return { id: m.id, skipped: "malformed" };
    if (seen.has(m.id)) return { id: m.id, skipped: "duplicate" };
    seen.add(m.id);
    const gate = limiter.take(m.from);
    if (gate !== "ok") {
      if (gate === "warn") await sendText(m.from, wordsFor(detectLanguage(m.text, "")).wait).catch((e) => log.error?.({ id: m.id, err: e.message }, "messenger reply failed"));
      return { id: m.id, skipped: "rate_limited" };
    }
    enqueue(m);
    return { id: m.id, type: m.type, queued: true };
  }

  // One delivery (the webhook body): every message takes its place. The
  // route does not await it; idle() waits for the groups and their replies.
  function handle(body) {
    return track((async () => {
      const results = [];
      for (const m of parseWebhook(body).messages) results.push(await arrive(m));
      return results;
    })());
  }

  // Judge every waiting group now (shutdown), without waiting for its window.
  function flush() {
    for (const g of groups.values()) { g.cancel?.(); g.fire(); }
  }

  // Resolves once no delivery is being read and no group is waiting or
  // being judged (a group still in its window is waited for).
  async function idle() {
    while (inflight.size || groups.size) {
      await Promise.allSettled([...inflight, ...[...groups.values()].map((g) => g.done)]);
    }
  }

  return { configured: () => messengerConfigured(env), handle, arrive, answer, judge, sendText, download, flush, idle };
}
