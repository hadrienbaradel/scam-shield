// Public demo (no sign-in): the PRD regression inbox and the two seed
// profiles, judged by the same engine. Used for the hackathon video and
// for anyone trying Prudence before connecting their own Gmail.

import { readFile, stat } from "node:fs/promises";
import { pathToFileURL } from "node:url";
import { checkMessage, transcribeVoice, voiceConfigured } from "../../lib/muse.js";
import { callBackFor } from "../../lib/context.js";
import { inspectWav } from "../../lib/llm/audio.js";
import { linksFromText } from "../google/gmail.js";

const load = async (p) => JSON.parse(await readFile(new URL(`../../${p}`, import.meta.url), "utf8"));
const PROFILES = { linda: await load("data/profiles/linda.json"), francoise: await load("data/profiles/francoise.json") };
const CARDS = await load("data/patterns/cards.json");
const CASES = (await load("testcases/cases.json")).cases;
const DEMO_INBOX = CASES.map((c) => ({
  ...c.message, id: c.id, profile: c.profile, locale: c.locale,
  threadHistory: c.threadHistory || [], mockLinkInspection: c.mockLinkInspection || {},
  date: `Example ${c.id} · ${c.message.channel || "email"}`,
}));

// The demo "Today": a few messages that need the person, as on a real
// morning. Their verdicts are computed live when a card opens.
const PERSONAS = {
  en: { profile: "linda", today: ["D1", "B2", "D7"] },
  fr: { profile: "francoise", today: ["A4", "B1", "A6"] },
};
const summary = (e) => ({ id: e.id, channel: e.channel, fromName: e.fromName || "", from: e.from || "", subject: e.subject || "", body: e.body, links: e.links || [] });

const demoVerdicts = new Map();

// The demo voicemail ("Grandma, it's me…"), heard by Muse Voice Transcribe
// and judged like any message. The file is a real recording in
// public/demo/ (in the repo), or on a developer's laptop a local
// placeholder in .runtime/demo/ (never committed: the Mac's synthetic
// voices are licensed for personal use). DEMO_VOICEMAIL_DIR, when set, is the only place looked at.
async function demoVoicemail(lang) {
  const dirs = process.env.DEMO_VOICEMAIL_DIR ? [pathToFileURL(`${process.env.DEMO_VOICEMAIL_DIR}/`)]
    : [new URL("../../public/demo/", import.meta.url), new URL("../../.runtime/demo/", import.meta.url)];
  for (const dir of dirs) {
    const file = new URL(`voicemail-${lang}.wav`, dir);
    try { const s = await stat(file); return { file, key: `${lang}:${s.size}:${s.mtimeMs}` }; } catch { /* next place */ }
  }
  return null;
}
const VOICEMAIL_FROM = { en: "+1 555-0188", fr: "+33 6 12 34 56 78" };
const demoVoice = new Map();

export default async function demoRoutes(app) {
  app.get("/api/demo/today", async (request) => {
    const lang = request.query.lang === "fr" ? "fr" : "en";
    const persona = PERSONAS[lang];
    const profile = PROFILES[persona.profile];
    const guardian = (profile.trustedContacts || []).find((c) => /guardian/i.test(c.relation || ""));
    return {
      name: profile.userName,
      guardian: guardian ? { name: guardian.name, phone: guardian.phone || null } : null,
      checked: DEMO_INBOX.filter((e) => e.locale.startsWith(lang)).length,
      queue: persona.today.map((id) => summary(DEMO_INBOX.find((e) => e.id === id))),
      voicemail: voiceConfigured() && Boolean(await demoVoicemail(lang)),
    };
  });

  app.get("/api/demo/voicemail", async (request, reply) => {
    const v = await demoVoicemail(request.query.lang === "fr" ? "fr" : "en");
    if (!v) return reply.code(404).send({ error: "no_demo_voicemail" });
    return reply.type("audio/wav").header("cache-control", "public, max-age=0").send(await readFile(v.file));
  });

  // Same file, same answer: one transcription and one verdict per recording.
  app.post("/api/demo/voicemail", { config: { rateLimit: { max: 20, timeWindow: "1 minute" } } }, async (request, reply) => {
    const lang = request.body?.lang === "fr" ? "fr" : "en";
    if (!voiceConfigured()) return reply.code(503).send({ error: "voice_needs_muse", message: "Checking voice messages needs Meta's Muse Voice Transcribe, which is not switched on here yet." });
    const v = await demoVoicemail(lang);
    if (!v) return reply.code(404).send({ error: "no_demo_voicemail" });
    const hit = demoVoice.get(v.key);
    if (hit) return hit;
    const wav = await readFile(v.file);
    const format = inspectWav(wav);
    if (!format.ok) return reply.code(500).send({ error: format.error, message: format.message });
    let transcript;
    try { ({ text: transcript } = await transcribeVoice({ wav })); } catch (e) {
      request.log.warn({ err: e.message }, "demo voicemail transcription failed");
      return reply.code(502).send({ error: "voice_failed", message: "We could not listen to this recording right now. Please try again in a minute." });
    }
    if (!transcript) return reply.code(422).send({ error: "no_speech", message: "We could not hear any words in this recording." });
    const persona = PERSONAS[lang];
    const message = { channel: "voice_transcript", from: VOICEMAIL_FROM[lang], fromName: VOICEMAIL_FROM[lang], subject: "", body: transcript, links: linksFromText(transcript), auth: "" };
    const verdict = await checkMessage({ locale: lang === "fr" ? "fr-FR" : "en-US", message, personalContext: PROFILES[persona.profile], patternCards: CARDS });
    const out = { verdict, transcript, message, callBack: callBackFor(PROFILES[persona.profile], message) };
    if (!verdict.degraded) demoVoice.set(v.key, out);
    return out;
  });

  app.get("/api/demo/inbox", async (request) => {
    const lang = request.query.lang === "fr" ? "fr" : request.query.lang === "en" ? "en" : null;
    return { emails: lang ? DEMO_INBOX.filter((e) => e.locale.startsWith(lang)) : DEMO_INBOX };
  });

  app.post("/api/demo/check", { config: { rateLimit: { max: 60, timeWindow: "1 minute" } } }, async (request, reply) => {
    const e = demoExample(request.body?.id);
    if (!e) return reply.code(404).send({ error: "unknown example" });
    return demoVerdict(e);
  });
}

// One example, its persona, the shipped cards: also read by Look closer
// (src/routes/investigate.js) for the demo cards.
export const demoExample = (id) => DEMO_INBOX.find((x) => x.id === id) || null;
export const demoProfile = (e) => PROFILES[e.profile];
export const DEMO_CARDS = CARDS;

// Same example, same answer: judges and the video see stable verdicts, and a
// repeat view costs no model call. Failures are not kept.
export async function demoVerdict(e) {
  const hit = demoVerdicts.get(e.id);
  if (hit) return hit;
  const verdict = await checkMessage({
    locale: e.locale, message: e, personalContext: PROFILES[e.profile], patternCards: CARDS,
    threadHistory: e.threadHistory, mockLinkInspection: e.mockLinkInspection, linkInspection: e.mockLinkInspection,
  });
  const out = { ...verdict, callBack: callBackFor(PROFILES[e.profile], e) };
  if (!verdict.degraded) demoVerdicts.set(e.id, out);
  return out;
}
