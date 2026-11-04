// WhatsApp channel ("forward it to Prudence"): the senior forwards a text,
// a picture or a voice note to the Prudence number on the WhatsApp Cloud
// API; the same engine as "Check something else" judges it and the verdict
// goes back in the chat as one text message, quoted under the forward.
// Pure logic: the Graph API goes through an injectable fetch, ffmpeg
// through an injectable transcoder, so tests run with the mock LLM and no
// network. Nothing is stored (not the message, the media, nor the verdict)
// and the sender is a phone number, not an account: the check runs on the
// message alone, with the pattern cards and no personal context.
// Payload and endpoint shapes follow _product/research/detection-channels/
// ask-channels.md ("WhatsApp Cloud API" build sheet), unverified live.
// Fail closed: a delivery is handled only with a valid X-Hub-Signature-256
// (src/routes/whatsapp.js), and the bearer token is sent only to the Graph
// API and to a media URL it returned on Meta's own host (mediaUrl).

import { spawn } from "node:child_process";
import { createHmac, timingSafeEqual } from "node:crypto";
import { chmod, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { checkMessage, extractFromImage, museConfigured, museLabel, transcribeVoice, voiceConfigured } from "../../lib/muse.js";
import { emptyContext } from "../../lib/context.js";
import { linksFromText } from "../google/gmail.js";
import { inspectMessageLinks } from "../links/resolver.js";

export const DEFAULT_GRAPH_VERSION = "v22.0";
export const GRAPH_URL = "https://graph.facebook.com";
export const MAX_IMAGE_BYTES = 8 * 1024 * 1024;
export const MAX_AUDIO_BYTES = 16 * 1024 * 1024;
export const MAX_REPLY_CHARS = 4000; // the API takes 4096
export const TRANSCRIPT_QUOTE = 200;
export const IMAGE_TYPES = ["image/jpeg", "image/png", "image/webp"];
// The only host the bearer token may be sent to for media bytes: Meta's
// media CDN as its Cloud API examples show it (unverified live). A url
// anywhere else, or a redirect, is refused.
export const MEDIA_HOSTS = ["lookaside.fbsbx.com"];

export function whatsappConfig(env = process.env) {
  return {
    token: env.WHATSAPP_ACCESS_TOKEN || "",
    phoneNumberId: env.WHATSAPP_PHONE_NUMBER_ID || "",
    businessAccountId: env.WHATSAPP_BUSINESS_ACCOUNT_ID || "",
    verifyToken: env.WHATSAPP_VERIFY_TOKEN || "",
    appSecret: env.WHATSAPP_APP_SECRET || "",
    graphVersion: env.WHATSAPP_GRAPH_VERSION || DEFAULT_GRAPH_VERSION,
    ffmpegPath: env.FFMPEG_PATH || "ffmpeg",
  };
}

// The channel needs the token and the number to answer; the webhook also
// needs the app secret (every delivery is signature-checked, never
// skipped) and the verify token for Meta's handshake. The business account
// id is kept for later (QR deep links, templates).
export function whatsappConfigured(env = process.env) {
  const c = whatsappConfig(env);
  return Boolean(c.token && c.phoneNumberId);
}
export const webhookActive = (env = process.env) => whatsappConfigured(env) && Boolean(whatsappConfig(env).appSecret);

const same = (a, b) => {
  const x = Buffer.from(String(a)); const y = Buffer.from(String(b));
  return x.length === y.length && timingSafeEqual(x, y);
};

// Meta's verification handshake: the challenge to echo as plain text, or
// null (403) when the mode or the token is wrong or no token is set.
export function verificationChallenge(query = {}, verifyToken = "") {
  if (!verifyToken || query["hub.mode"] !== "subscribe" || !same(query["hub.verify_token"] || "", verifyToken)) return null;
  return String(query["hub.challenge"] ?? "");
}

// X-Hub-Signature-256: "sha256=" + HMAC-SHA256 of the raw body with the
// app secret. False without a secret: the caller decides whether to skip.
export function verifySignature(rawBody, header, secret) {
  if (!secret) return false;
  const m = String(header || "").match(/^sha256=([0-9a-f]{64})$/i);
  if (!m) return false;
  const expected = createHmac("sha256", secret).update(rawBody || "").digest();
  const given = Buffer.from(m[1], "hex");
  return expected.length === given.length && timingSafeEqual(expected, given);
}

// Every inbound message of a delivery, flattened; statuses (sent,
// delivered, read receipts) are counted and ignored.
export function parseWebhook(body) {
  const messages = [];
  let statuses = 0;
  for (const entry of body?.entry || []) {
    for (const change of entry.changes || []) {
      if (change.field && change.field !== "messages") continue;
      const v = change.value || {};
      if (v.messaging_product && v.messaging_product !== "whatsapp") continue;
      statuses += (v.statuses || []).length;
      const names = new Map((v.contacts || []).map((c) => [String(c.wa_id || ""), String(c.profile?.name || "")]));
      for (const m of v.messages || []) {
        const type = String(m.type || "unknown");
        const media = ["image", "audio", "document", "video", "sticker"].includes(type) ? m[type] || {} : null;
        messages.push({
          id: String(m.id || ""), from: String(m.from || ""), timestamp: Number(m.timestamp) || 0, type,
          profileName: names.get(String(m.from || "")) || "",
          text: type === "text" ? String(m.text?.body || "") : "",
          caption: media?.caption ? String(media.caption) : "",
          // No url from the payload: the bytes are fetched by id only (downloadMedia).
          media: media ? {
            id: String(media.id || ""), mime: String(media.mime_type || "").split(";")[0].trim().toLowerCase(),
            filename: String(media.filename || ""), voice: Boolean(media.voice),
          } : null,
          forwarded: m.context?.frequently_forwarded ? "many" : m.context?.forwarded ? "once" : null,
        });
      }
    }
  }
  return { messages, statuses };
}

// French when the words are French, English when they are English; a tie
// (or no words) falls back to the sender's country code: +33 is French.
// Everyday words of each language that are not words of the other ("son",
// "ton", "message" or "on" would count for both, so they are left out).
const FR_WORDS = /\b(le|la|les|des|du|une|votre|vos|vous|est|pas|sur|avec|pour|dans|chez|sans|rien|tout|tous|jamais|toujours|encore|je|tu|nous|ils|elle|ce|cette|mon|mes|tes|ses|et|ou|mais|donc|que|qui|quoi|bien|bon|bonne|faire|fais|fait|viens|demain|dimanche|coucou|salut|bisous|oui|bonjour|merci|colis|compte|carte|paiement|cliquez|ici|urgent|frais|euros?|facture|livraison|r[ée]glez|payer|attente|retenu|mamie|papi)\b|[àâçéèêëîïôûùœ]|€/gi;
const EN_WORDS = /\b(the|your|you|is|are|account|package|parcel|payment|click|here|please|fee|urgent|has|have|been|and|of|for|dollars?|hold|delivery|pay|now|today|verify|dear|this|grandma|grandpa|i|my|we|it|in|at|with|from|that|will|can|do|not|no|yes|hi|hello|thanks|sunday|tomorrow|coming|love|mom|dad|call|send|money|card|bank|link|text|phone|number)\b|\$/gi;
export function detectLanguage(text = "", from = "") {
  const fr = (String(text || "").match(FR_WORDS) || []).length;
  const en = (String(text || "").match(EN_WORDS) || []).length;
  if (fr > en) return "fr";
  if (en > fr) return "en";
  return /^\+?33\d/.test(String(from || "")) ? "fr" : "en";
}

// Per-sender limit: "ok", "warn" (the first refusal of the window, worth
// one reply) or "drop" (silence until the window passes).
export function createLimiter({ max = 10, windowMs = 60000, now = Date.now } = {}) {
  const hits = new Map();
  return {
    take(key) {
      const t = now();
      const h = hits.get(key) || { times: [], warned: false };
      h.times = h.times.filter((x) => x > t - windowMs);
      hits.delete(key);
      hits.set(key, h);
      if (hits.size > 10000) hits.delete(hits.keys().next().value);
      if (h.times.length < max) { h.times.push(t); h.warned = false; return "ok"; }
      const first = !h.warned;
      h.warned = true;
      return first ? "warn" : "drop";
    },
  };
}

// Message ids already answered: Meta redelivers for 36 hours.
export function createSeen({ cap = 5000 } = {}) {
  const ids = new Set();
  return {
    has: (id) => ids.has(id),
    add(id) { ids.add(id); if (ids.size > cap) ids.delete(ids.values().next().value); },
  };
}

export const WORDS = {
  en: {
    scam: "🔴 Scam", be_careful: "🟠 Be careful", safe: "🟢 Safe",
    why: "Why:", todo: "What to do:",
    forwardedOnce: "This message was forwarded to you.",
    forwardedMany: "This message has been forwarded many times. Chain messages like this are often scams.",
    labelOnce: "Forwarded message", labelMany: "Forwarded many times",
    says: "What the voice note says:",
    saysVideo: "What is said in the video:",
    checked: (label) => `Checked with ${label === "Muse Spark" ? "Meta's Muse Spark" : label}.`,
    checkedRules: (label) => `Checked with Prudence's rules (${label} was not available).`,
    onlyTypes: "I can only check texts, pictures and voice notes for now.",
    // Messenger reads videos too (messenger-channel.md line 16); WhatsApp does not.
    onlyTypesVideo: "I can only check texts, pictures, voice notes and videos for now.",
    videoTooLong: "This video is too long for me. Please send a shorter one, or a screenshot.",
    videoNothing: "I could not hear or read anything in this video. Please send a screenshot, or type the words.",
    noMessage: "I could not find a message in this picture.",
    noWords: "I could not hear any words in this voice note.",
    needsMuse: "Checking pictures and voice notes needs Meta's Muse Spark. Please type the words instead.",
    tooBig: "This file is too big for me. Please send a smaller picture, or type the words.",
    wait: "Please wait a minute before sending another message.",
    failed: "Something went wrong on our side. To be safe, do not click anything in the message.",
  },
  fr: {
    scam: "🔴 Arnaque", be_careful: "🟠 Attention", safe: "🟢 Rassurant",
    why: "Pourquoi :", todo: "Que faire :",
    forwardedOnce: "Ce message vous a été transféré.",
    forwardedMany: "Ce message a été transféré de nombreuses fois. Les messages en chaîne sont souvent des arnaques.",
    labelOnce: "Message transféré", labelMany: "Transféré de nombreuses fois",
    says: "Ce que dit le message vocal :",
    saysVideo: "Ce qui est dit dans la vidéo :",
    checked: (label) => `Vérifié avec ${label === "Muse Spark" ? "Muse Spark de Meta" : label}.`,
    checkedRules: (label) => `Vérifié avec les règles de Prudence (${label} n'était pas disponible).`,
    onlyTypes: "Je ne peux vérifier que des textes, des images et des messages vocaux pour l'instant.",
    onlyTypesVideo: "Je ne peux vérifier que des textes, des images, des messages vocaux et des vidéos pour l'instant.",
    videoTooLong: "Cette vidéo est trop longue pour moi. Envoyez-en une plus courte, ou une capture d'écran.",
    videoNothing: "Je n'ai rien entendu ni rien pu lire dans cette vidéo. Envoyez une capture d'écran, ou tapez les mots.",
    noMessage: "Je n'ai pas trouvé de message dans cette image.",
    noWords: "Je n'ai entendu aucun mot dans ce message vocal.",
    needsMuse: "Vérifier une image ou un message vocal demande Muse Spark de Meta. Tapez les mots du message à la place.",
    tooBig: "Ce fichier est trop gros pour moi. Envoyez une image plus petite, ou tapez les mots.",
    wait: "Attendez une minute avant d'envoyer un autre message.",
    failed: "Quelque chose s'est mal passé de notre côté. Par prudence, ne cliquez sur rien dans le message.",
  },
};
export const wordsFor = (lang) => WORDS[lang] || WORDS.en;

// The verdict's headline already opens with its own word ("Scam: do not
// click…"); the first line of the reply says it once.
const HEADLINE_PREFIX = /^(scam|be careful|safe|arnaque|attention|rassurez-vous|prudence)\s*[:!.\-–]\s*/i;
const sentence = (s) => { const t = String(s || "").trim(); return t ? t[0].toUpperCase() + t.slice(1) : ""; };

// One text message for the chat: verdict word, headline, up to three
// reasons, the next step, the forward note, the voice words (a video's
// under saysKey "saysVideo"), who checked.
export function formatReply(verdict, { lang = "en", forwarded = null, transcript = "", saysKey = "says", label = museLabel() } = {}) {
  const W = wordsFor(lang);
  const blocks = [`${W[verdict.verdict] || W.be_careful}\n${sentence(String(verdict.headline || "").replace(HEADLINE_PREFIX, ""))}`];
  const reasons = (verdict.reasons || []).map((r) => (typeof r === "string" ? r : r?.text)).filter(Boolean).slice(0, 3);
  if (reasons.length) blocks.push([W.why, ...reasons.map((r) => `• ${r}`)].join("\n"));
  if (verdict.action_text) blocks.push(`${W.todo} ${verdict.action_text}`);
  if (forwarded === "many") blocks.push(W.forwardedMany);
  else if (forwarded) blocks.push(W.forwardedOnce);
  if (transcript) {
    const t = String(transcript).trim();
    blocks.push(`${W[saysKey] || W.says} "${t.length > TRANSCRIPT_QUOTE ? `${t.slice(0, TRANSCRIPT_QUOTE - 1)}…` : t}"`);
  }
  blocks.push(/^detector\b/i.test(String(verdict.source || "")) ? W.checkedRules(label) : W.checked(label));
  return blocks.join("\n\n").slice(0, MAX_REPLY_CHARS);
}

// ffmpeg cannot seek back on a pipe, so it leaves the RIFF and data sizes
// at 0xFFFFFFFF; the whole file is in memory here, so write the real ones.
export function fixWavSizes(wav) {
  if (wav.length < 12 || wav.toString("ascii", 0, 4) !== "RIFF" || wav.toString("ascii", 8, 12) !== "WAVE") return wav;
  const out = Buffer.from(wav);
  out.writeUInt32LE(out.length - 8, 4);
  let pos = 12;
  while (pos + 8 <= out.length) {
    const tag = out.toString("ascii", pos, pos + 4);
    const size = out.readUInt32LE(pos + 4);
    if (tag === "data") { out.writeUInt32LE(out.length - pos - 8, pos + 4); break; }
    pos += 8 + size + (size % 2);
  }
  return out;
}

// A voice note (Ogg/Opus, or anything ffmpeg reads) to 16 kHz mono 16-bit
// WAV, the only input Muse Voice Transcribe takes. Nothing touches the disk.
export function ffmpegToWav(input, { ffmpegPath = process.env.FFMPEG_PATH || "ffmpeg", timeoutMs = 30000 } = {}) {
  return new Promise((resolve, reject) => {
    const args = ["-hide_banner", "-loglevel", "error", "-i", "pipe:0", "-vn", "-ac", "1", "-ar", "16000", "-c:a", "pcm_s16le", "-f", "wav", "pipe:1"];
    const p = spawn(ffmpegPath, args, { stdio: ["pipe", "pipe", "pipe"] });
    const out = [];
    const err = [];
    const timer = setTimeout(() => { p.kill("SIGKILL"); reject(new Error("ffmpeg timed out")); }, timeoutMs);
    p.stdout.on("data", (d) => out.push(d));
    p.stderr.on("data", (d) => err.push(d));
    p.on("error", (e) => { clearTimeout(timer); reject(new Error(`ffmpeg not available (${e.message}): install it or set FFMPEG_PATH`)); });
    p.on("close", (code) => {
      clearTimeout(timer);
      if (code !== 0) return reject(new Error(`ffmpeg exited ${code}: ${Buffer.concat(err).toString().trim().slice(0, 200)}`));
      resolve(fixWavSizes(Buffer.concat(out)));
    });
    p.stdin.on("error", () => {}); // EPIPE when ffmpeg stops early; "close" reports it
    p.stdin.end(input);
  });
}

// One ffmpeg or ffprobe run on files, its stdout as a Buffer. On a timeout
// the process is killed and the promise settles only once it has exited,
// so a caller's cleanup never races a process still writing.
function runTool(path, args, { timeoutMs, name }) {
  return new Promise((resolve, reject) => {
    const p = spawn(path, args, { stdio: ["ignore", "pipe", "pipe"] });
    const out = [];
    const err = [];
    let timedOut = false;
    let failed = null;
    const timer = setTimeout(() => { timedOut = true; p.kill("SIGKILL"); }, timeoutMs);
    p.stdout.on("data", (d) => out.push(d));
    p.stderr.on("data", (d) => err.push(d));
    p.on("error", (e) => { failed = new Error(`${name} not available (${e.message}): install it or set FFMPEG_PATH`); });
    p.on("close", (code) => {
      clearTimeout(timer);
      if (failed) return reject(failed);
      if (timedOut) return reject(new Error(`${name} timed out`));
      if (code !== 0) return reject(new Error(`${name} exited ${code}: ${Buffer.concat(err).toString().trim().slice(0, 200)}`));
      resolve(Buffer.concat(out));
    });
  });
}

// ffprobe sits beside ffmpeg (FFMPEG_PATH=/opt/bin/ffmpeg gives /opt/bin/ffprobe).
export const ffprobeBeside = (ffmpegPath) => (/ffmpeg(\.exe)?$/i.test(ffmpegPath) ? ffmpegPath.replace(/ffmpeg(\.exe)?$/i, "ffprobe$1") : "ffprobe");

// Where the four frames of a video are taken: at 1/8, 3/8, 5/8 and 7/8 of
// its length, so never its very first or last frame.
export const frameTimes = (seconds) => [1, 3, 5, 7].map((k) => Math.round(((seconds * k) / 8) * 1000) / 1000);

// A video (a screen recording, a clip filmed with a phone or Meta glasses)
// to what the models read: { durationSec, wav, sheet }. The sound as the
// same 16 kHz mono WAV as ffmpegToWav (null without an audio track); four
// frames spread over it tiled 2x2 into one JPEG, each tile at most 960 px
// wide so screen text stays readable (null without a picture). Over
// maxSeconds nothing is extracted: { durationSec, tooLong: true }. Phone
// MP4s often keep their index at the end, which ffmpeg cannot reach on a
// pipe, so the bytes go to a file in a fresh 0700 folder under the OS temp
// folder, removed whatever happens (read, failed or timed out).
export async function ffmpegVideo(input, {
  ffmpegPath = process.env.FFMPEG_PATH || "ffmpeg", ffprobePath = ffprobeBeside(ffmpegPath),
  maxSeconds = Infinity, timeoutMs = 30000, tmpRoot = tmpdir(),
} = {}) {
  const dir = await mkdtemp(join(tmpRoot, "prudence-video-"));
  try {
    await chmod(dir, 0o700);
    const file = join(dir, "clip");
    await writeFile(file, input, { mode: 0o600 });
    const probed = await runTool(ffprobePath, ["-v", "error", "-show_entries", "format=duration:stream=codec_type,duration", "-of", "json", file], { timeoutMs, name: "ffprobe" });
    let info;
    try { info = JSON.parse(probed.toString()); } catch { throw new Error("ffprobe answer unreadable"); }
    const durationSec = Number(info.format?.duration);
    if (!Number.isFinite(durationSec) || durationSec <= 0) throw new Error("video duration unreadable");
    if (durationSec > maxSeconds) return { durationSec, tooLong: true, wav: null, sheet: null };
    const streams = Array.isArray(info.streams) ? info.streams : [];
    const video = streams.find((s) => s.codec_type === "video");
    const hasAudio = streams.some((s) => s.codec_type === "audio");
    // The picture track can end before the sound: its own length places the frames.
    const pictureSec = Number(video?.duration) > 0 ? Number(video.duration) : durationSec;
    const base = ["-hide_banner", "-loglevel", "error", "-nostdin", "-y"];
    const wavFile = join(dir, "sound.wav");
    const sheetFile = join(dir, "frames.jpg");
    const tiles = frameTimes(pictureSec).map((_, i) => `[${i}:v:0]scale=w=min(960\\,iw):h=-2,setsar=1[f${i}]`).join(";");
    const jobs = [
      hasAudio ? runTool(ffmpegPath, [...base, "-i", file, "-vn", "-ac", "1", "-ar", "16000", "-c:a", "pcm_s16le", "-f", "wav", wavFile], { timeoutMs, name: "ffmpeg" })
        .then(() => readFile(wavFile)) : null,
      video ? runTool(ffmpegPath, [
        ...base, ...frameTimes(pictureSec).flatMap((t) => ["-ss", String(t), "-i", file]),
        "-filter_complex", `${tiles};[f0][f1][f2][f3]xstack=inputs=4:layout=0_0|w0_0|0_h0|w0_h0[sheet]`,
        "-map", "[sheet]", "-frames:v", "1", "-q:v", "3", sheetFile,
      ], { timeoutMs, name: "ffmpeg" }).then(() => readFile(sheetFile)) : null,
    ];
    // Both runs end before the folder goes, whichever fails first.
    const [wav, sheet] = await Promise.allSettled(jobs);
    for (const r of [wav, sheet]) if (r.status === "rejected") throw r.reason;
    return { durationSec, wav: wav.value ? fixWavSizes(wav.value) : null, sheet: sheet.value || null };
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

let shipped = null;
// The pattern cards shipped with the repo (data/patterns/cards.json): the
// default when no live cards are available.
export async function shippedCards() {
  if (!shipped) shipped = JSON.parse(await readFile(new URL("../../data/patterns/cards.json", import.meta.url), "utf8"));
  return shipped;
}

class Expected extends Error {
  constructor(key) { super(key); this.replyKey = key; }
}

// The download URL the Graph API returned, or an error naming what was
// wrong with it (the token is attached only to what passes here).
export function mediaUrl(raw, hosts = MEDIA_HOSTS) {
  let u;
  try { u = new URL(String(raw || "")); } catch { throw new Error("media url unreadable"); }
  if (u.protocol !== "https:") throw new Error(`media url not https (${u.protocol})`);
  if (!hosts.includes(u.hostname)) throw new Error(`media url host ${u.hostname} is not Meta's media CDN (${hosts.join(", ")})`);
  if (u.username || u.password) throw new Error("media url carries credentials");
  return u.href;
}

export function createWhatsAppChannel({
  env = process.env,
  fetchImpl = (...args) => globalThis.fetch(...args),
  transcode = (buffer) => ffmpegToWav(buffer, { ffmpegPath: whatsappConfig(env).ffmpegPath }),
  patternCards = shippedCards,
  inspectLinks = (message) => inspectMessageLinks(message, emptyContext(""), { resolve: false, fetchImpl }),
  limiter = createLimiter(),
  seen = createSeen(),
  log = console,
} = {}) {
  const cfg = () => whatsappConfig(env);
  const auth = () => ({ authorization: `Bearer ${cfg().token}` });
  const inflight = new Set();

  async function sendText(to, text, replyToId = null) {
    const body = { messaging_product: "whatsapp", recipient_type: "individual", to, type: "text", text: { preview_url: false, body: String(text).slice(0, MAX_REPLY_CHARS) } };
    if (replyToId) body.context = { message_id: replyToId };
    const post = async (payload) => {
      const res = await fetchImpl(`${GRAPH_URL}/${cfg().graphVersion}/${cfg().phoneNumberId}/messages`, {
        method: "POST", headers: { ...auth(), "content-type": "application/json" }, body: JSON.stringify(payload), signal: AbortSignal.timeout(15000),
      });
      const out = await res.json().catch(() => ({}));
      return { ok: res.ok, status: res.status, out };
    };
    let r = await post(body);
    // The quoted message may be gone: send the verdict unquoted rather than not at all.
    if (!r.ok && body.context) { delete body.context; r = await post(body); }
    if (!r.ok) throw new Error(`WhatsApp send ${r.status}: ${String(r.out.error?.message || "").slice(0, 200)}`);
    return { id: r.out.messages?.[0]?.id || null };
  }

  // Two steps, as documented: the media id gives a short-lived URL from
  // the Graph API, the URL gives the bytes; both with the bearer token.
  // A url written in the webhook payload is never fetched: the token goes
  // only to a URL the Graph API returned, over https, on Meta's media
  // host, and never follows a redirect.
  async function downloadMedia(media, maxBytes) {
    if (!media?.id) throw new Error("media without id");
    const res = await fetchImpl(`${GRAPH_URL}/${cfg().graphVersion}/${encodeURIComponent(media.id)}`, { headers: auth(), signal: AbortSignal.timeout(15000) });
    if (!res.ok) throw new Error(`media lookup ${res.status}`);
    const meta = await res.json();
    const mime = media.mime || String(meta.mime_type || "").split(";")[0].trim().toLowerCase();
    if (Number(meta.file_size) > maxBytes) throw new Expected("tooBig");
    const url = mediaUrl(meta.url);
    const get = await fetchImpl(url, { headers: auth(), redirect: "manual", signal: AbortSignal.timeout(30000) });
    if (!get.ok) throw new Error(`media download ${get.status}`);
    const buffer = Buffer.from(await get.arrayBuffer());
    if (buffer.length > maxBytes) throw new Expected("tooBig");
    return { buffer, mime };
  }

  async function judge({ message, lang }) {
    const cards = await Promise.resolve().then(patternCards).catch(() => []);
    const linkInspection = await Promise.resolve().then(() => inspectLinks(message)).catch(() => ({}));
    return checkMessage({
      locale: lang === "fr" ? "fr-FR" : "en-US", message, personalContext: emptyContext(""), patternCards: cards,
      threadHistory: [], mockLinkInspection: linkInspection, linkInspection,
    });
  }

  const label = (lang, forwarded) => (forwarded === "many" ? wordsFor(lang).labelMany : forwarded ? wordsFor(lang).labelOnce : "");

  // The reply for one message: { text, lang, verdict? }.
  async function answer(m, lang) {
    const W = () => wordsFor(lang);
    const isImage = m.type === "image" || (m.type === "document" && IMAGE_TYPES.includes(m.media?.mime));
    if (m.type === "text") {
      const body = m.text.trim();
      if (!body) return { text: W().onlyTypes, lang };
      lang = detectLanguage(body, m.from);
      const message = { channel: "whatsapp", from: "", fromName: "", subject: label(lang, m.forwarded), body: body.slice(0, 6000), links: linksFromText(body), auth: "" };
      const verdict = await judge({ message, lang });
      return { text: formatReply(verdict, { lang, forwarded: m.forwarded }), lang, verdict };
    }
    if ((isImage || m.type === "audio") && !m.media?.id) return { text: W().onlyTypes, lang };
    if (isImage) {
      if (!museConfigured()) return { text: W().needsMuse, lang };
      const { buffer, mime } = await downloadMedia(m.media, MAX_IMAGE_BYTES);
      if (!IMAGE_TYPES.includes(mime)) return { text: W().onlyTypes, lang };
      const { isMessage, message } = await extractFromImage({ imageBase64: buffer.toString("base64"), mime });
      if (!isMessage || !message.body) return { text: W().noMessage, lang };
      lang = detectLanguage(`${m.caption} ${message.body}`, m.from);
      const verdict = await judge({ message, lang });
      return { text: formatReply(verdict, { lang, forwarded: m.forwarded }), lang, verdict };
    }
    if (m.type === "audio") {
      if (!voiceConfigured()) return { text: W().needsMuse, lang };
      const { buffer } = await downloadMedia(m.media, MAX_AUDIO_BYTES);
      const wav = await transcode(buffer);
      const { text: transcript } = await transcribeVoice({ wav, fetchImpl });
      if (!transcript) return { text: W().noWords, lang };
      lang = detectLanguage(transcript, m.from);
      const message = { channel: "voice_transcript", from: "", fromName: "", subject: label(lang, m.forwarded), body: transcript, links: linksFromText(transcript), auth: "" };
      const verdict = await judge({ message, lang });
      return { text: formatReply(verdict, { lang, forwarded: m.forwarded, transcript }), lang, verdict };
    }
    return { text: W().onlyTypes, lang };
  }

  async function handleMessage(m) {
    if (!m.id || !m.from) return { id: m.id, skipped: "malformed" };
    if (["reaction", "system"].includes(m.type)) return { id: m.id, skipped: m.type };
    if (seen.has(m.id)) return { id: m.id, skipped: "duplicate" };
    seen.add(m.id);
    let lang = detectLanguage(m.text || m.caption, m.from);
    const gate = limiter.take(m.from);
    if (gate !== "ok") {
      if (gate === "warn") await sendText(m.from, wordsFor(lang).wait, m.id).catch(() => {});
      return { id: m.id, skipped: "rate_limited" };
    }
    const started = Date.now();
    try {
      const out = await answer(m, lang);
      lang = out.lang;
      const sent = await sendText(m.from, out.text, m.id);
      log.info?.({ id: m.id, type: m.type, lang, forwarded: m.forwarded, verdict: out.verdict?.verdict || null, source: out.verdict?.source || null, ms: Date.now() - started }, "whatsapp check answered");
      return { id: m.id, type: m.type, lang, verdict: out.verdict?.verdict || null, reply: out.text, sent };
    } catch (e) {
      const key = e.replyKey || "failed";
      log.error?.({ id: m.id, type: m.type, err: e.message, ms: Date.now() - started }, "whatsapp check failed");
      await sendText(m.from, wordsFor(lang)[key], m.id).catch((e2) => log.error?.({ id: m.id, err: e2.message }, "whatsapp reply failed"));
      return { id: m.id, type: m.type, lang, error: e.message, reply: wordsFor(lang)[key] };
    }
  }

  // One delivery (the webhook body): every message answered in turn. The
  // route does not await it; idle() does, for tests and shutdown.
  function handle(body) {
    const job = (async () => {
      const { messages } = parseWebhook(body);
      const results = [];
      for (const m of messages) results.push(await handleMessage(m));
      return results;
    })();
    inflight.add(job);
    job.catch(() => {}).finally(() => inflight.delete(job));
    return job;
  }

  return { configured: () => whatsappConfigured(env), handle, handleMessage, answer, judge, sendText, downloadMedia, idle: () => Promise.allSettled([...inflight]) };
}
