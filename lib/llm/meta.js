// Meta Model API (Muse Spark), the default provider: OpenAI-compatible at
// api.meta.ai/v1, Standard mode only (PRD privacy rule: a "-contributor"
// model id is refused before any request leaves; public-corpus evaluation
// is the one opt-in exception, below).
// Muse Spark thinks before it answers, and the thinking counts against
// max_tokens: at 900 it used them all and returned nothing. Measured on a
// test case (2026-10-26): default effort ~2,950 thinking tokens / 11.5 s,
// "low" ~930 / 4.7 s, "minimal" ~280 / 2.8 s, same verdict. The detector's
// evidence already does the groundwork, so "low" is the default
// (META_MODEL_REASONING_EFFORT; retried without it if the API refuses it).

import { createOpenAiStyleProvider, RULES } from "./openai-compatible.js";
import { httpError, languageName, named, send } from "./audio.js";

export const DEFAULT_BASE_URL = "https://api.meta.ai/v1";
export const DEFAULT_MODEL = "muse-spark-1.3";

// The one exception (2026-10-31): scripts/eval-corpus.mjs --contributor scores
// the public Zenodo corpora at the Contributor price and calls this first. The
// server and every other script never call it, so they keep refusing.
let contributorForPublicEval = false;
export function allowContributorForPublicEval(on = true) { contributorForPublicEval = on; }

export function assertStandardMode(model) {
  if (/contributor/i.test(model) && !contributorForPublicEval) throw new Error(`Refusing Contributor-mode model ${model}: Prudence runs in Standard mode only`);
}

// Muse Voice Transcribe, the file endpoint: POST /v1/asr/transcribe with a
// JSON `request` part and the `audio` WAV; text/plain answers one turn per
// line, and PUSH_TO_TALK makes the whole clip one turn. This is the request
// live-tested on 2026-10-27 (35ff6e0), checked against Meta's docs on
// 2026-10-29: "WAV" is the only file encoding, PUSH_TO_TALK the default
// mode, 10 minutes and 32 MB at most. A language hint goes as languageBias
// (English names, only a nudge); without one the model detects the language.
export const VOICE_MODEL = "muse-voice-transcribe-1.0";
export const VOICE_LABEL = "Muse Voice Transcribe";

export async function transcribeWithMuse({ wav, language, signal } = {}, fetchImpl = globalThis.fetch) {
  const key = process.env.META_MODEL_API_KEY;
  if (!key) throw new Error(`${VOICE_LABEL} needs META_MODEL_API_KEY`);
  const base = (process.env.META_MODEL_BASE_URL || DEFAULT_BASE_URL).replace(/\/$/, "");
  const bias = languageName(language);
  const form = new FormData();
  form.append("request", new Blob([JSON.stringify({ model: VOICE_MODEL, audioEncoding: "WAV", mode: "PUSH_TO_TALK", ...(bias ? { languageBias: [bias] } : {}) })], { type: "application/json" }));
  form.append("audio", new Blob([wav], { type: "audio/wav" }), "voice.wav");
  const res = await send(VOICE_LABEL, fetchImpl, `${base}/asr/transcribe`, {
    method: "POST", body: form, signal,
    headers: { authorization: `Bearer ${key}`, accept: "text/plain" },
  });
  const body = await res.text().catch((e) => { throw named(VOICE_LABEL, e); });
  if (!res.ok) {
    let detail = "";
    try { detail = JSON.parse(body).error?.message || JSON.parse(body).message || ""; } catch { /* plain text error */ }
    throw httpError(`${VOICE_LABEL} ${res.status}${detail ? `: ${String(detail).slice(0, 200)}` : ""}`, res.status);
  }
  // text/plain: one turn per line.
  const text = body.split(/\r?\n/).map((l) => l.trim()).filter(Boolean).join(" ");
  return { text, model: VOICE_MODEL, provider: "meta", raw: body };
}

export function createMetaProvider({ fetchImpl } = {}) {
  return createOpenAiStyleProvider({
    name: "meta",
    label: "Muse Spark",
    errorLabel: "Meta Model API",
    fetchImpl,
    alwaysAuth: true,
    images: true,
    baseUrl: () => process.env.META_MODEL_BASE_URL || DEFAULT_BASE_URL,
    apiKey: () => process.env.META_MODEL_API_KEY,
    model: () => process.env.LLM_MODEL || process.env.META_MODEL_NAME || DEFAULT_MODEL,
    configured: () => Boolean(process.env.META_MODEL_API_KEY),
    defaultThinking: () => process.env.META_MODEL_REASONING_EFFORT || "low",
    beforeRequest: assertStandardMode,
    retryRules: [RULES.noEffort, RULES.noFormat],
    transcribe: transcribeWithMuse,
  });
}
