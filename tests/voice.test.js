// Voice checks (_product/specs/check-something-else.md, Behavior 8 to 13):
// the transcribe capability of lib/llm (Muse Voice Transcribe, OpenAI-style
// /audio/transcriptions, Claude's refusal, the mock), the WAV rules the
// server applies before anything leaves it, and POST /api/check/voice end to
// end on the mock provider. No network. The HTTP tests need Postgres and skip
// without it, like tests/integration.test.js.
import "./helpers/env.js";
import { test, before, after, afterEach } from "node:test";
import assert from "node:assert/strict";
import { pool, resetDb, makeUser, sessionFor, dbAvailable } from "./helpers/db.js";
import { one, many } from "../src/db/pool.js";
import { buildApp } from "../src/server.js";
import { getProvider, transcribe, transcribeConfigured, capabilities, PROVIDER_NAMES } from "../lib/llm/index.js";
import { VOICE_MODEL } from "../lib/llm/meta.js";
import { createOpenAiCompatibleProvider, DEFAULT_TRANSCRIBE_MODEL } from "../lib/llm/openai-compatible.js";
import { createAnthropicProvider } from "../lib/llm/anthropic.js";
import { createMockProvider } from "../lib/llm/mock.js";
import { inspectWav, languageCode, languageName, MAX_SECONDS } from "../lib/llm/audio.js";
import { transcribeVoice, voiceConfigured, breaker } from "../lib/muse.js";

const ORIGIN = "http://localhost:3999";
const ENV = ["LLM_PROVIDER", "LLM_MODEL", "LLM_BASE_URL", "LLM_TRANSCRIBE_MODEL", "OPENAI_API_KEY", "ANTHROPIC_API_KEY",
  "META_MODEL_API_KEY", "META_MODEL_BASE_URL"];
const mock = getProvider("mock");
const realFetch = globalThis.fetch;
const clean = () => {
  for (const k of ENV) delete process.env[k];
  mock.reset();
  breaker.failures = 0;
  breaker.openUntil = 0;
  globalThis.fetch = realFetch;
};
clean();
afterEach(clean);

const hasDb = await dbAvailable();
const db = { skip: hasDb ? false : "Postgres test database not available" };
let app;
before(async () => {
  if (hasDb) await resetDb();
  app = await buildApp({ logger: false });
});
after(async () => { await app?.close(); await pool.end(); });

// A WAV as the page makes it (public/js/audio.js), or bent one way.
function wav({ seconds = 1, rate = 16000, channels = 1, bits = 16, format = 1, marker = "" } = {}) {
  const block = (channels * bits) / 8;
  const bytes = Math.round(seconds * rate) * block;
  const head = Buffer.alloc(44);
  head.write("RIFF", 0, "latin1");
  head.writeUInt32LE(36 + bytes, 4);
  head.write("WAVEfmt ", 8, "latin1");
  head.writeUInt32LE(16, 16);
  head.writeUInt16LE(format, 20);
  head.writeUInt16LE(channels, 22);
  head.writeUInt32LE(rate, 24);
  head.writeUInt32LE(rate * block, 28);
  head.writeUInt16LE(block, 32);
  head.writeUInt16LE(bits, 34);
  head.write("data", 36, "latin1");
  head.writeUInt32LE(bytes, 40);
  const data = Buffer.alloc(bytes);
  if (marker && bytes) data.fill(marker, 0, bytes, "latin1");
  return Buffer.concat([head, data]);
}

// A fetch that records every request and answers with respond(url, init, n).
function capture(respond) {
  const calls = [];
  const fetchImpl = async (url, init) => { calls.push({ url, init }); return respond(url, init, calls.length); };
  return { calls, fetchImpl };
}
// A fetch that never answers: it fails when the request's signal fires.
const hang = (url, init) => new Promise((resolve, reject) => init.signal.addEventListener("abort", () => reject(init.signal.reason)));

// A multipart body, field by field (files with their name, type and bytes)...
async function fields(form) {
  const out = [];
  for (const [name, value] of form.entries()) {
    out.push(typeof value === "string" ? { name, value }
      : { name, filename: value.name, type: value.type, size: value.size, bytes: Buffer.from(await value.arrayBuffer()).toString("base64") });
  }
  return out;
}
// ...and as the bytes on the wire, the random boundary aside.
async function wire(form) {
  const res = new Response(form);
  const boundary = res.headers.get("content-type").split("boundary=")[1];
  return Buffer.from(await res.arrayBuffer()).toString("latin1").split(boundary).join("BOUNDARY");
}

// What lib/muse.js sent from 35ff6e0 (live-tested on 2026-10-27) until
// transcription moved behind lib/llm, frozen here as the reference.
async function legacyTranscribeVoice({ wav, timeoutMs = 30000, fetchImpl = fetch }) {
  if (!process.env.META_MODEL_API_KEY) throw new Error("Muse Voice Transcribe needs META_MODEL_API_KEY");
  const base = (process.env.META_MODEL_BASE_URL || "https://api.meta.ai/v1").replace(/\/$/, "");
  const form = new FormData();
  form.append("request", new Blob([JSON.stringify({ model: "muse-voice-transcribe-1.0", audioEncoding: "WAV", mode: "PUSH_TO_TALK" })], { type: "application/json" }));
  form.append("audio", new Blob([wav], { type: "audio/wav" }), "voice.wav");
  const started = Date.now();
  const res = await fetchImpl(`${base}/asr/transcribe`, {
    method: "POST", body: form, signal: AbortSignal.timeout(timeoutMs),
    headers: { authorization: `Bearer ${process.env.META_MODEL_API_KEY}`, accept: "text/plain" },
  });
  const body = await res.text();
  if (!res.ok) {
    let detail = "";
    try { detail = JSON.parse(body).error?.message || JSON.parse(body).message || ""; } catch { /* plain text error */ }
    throw new Error(`Muse Voice Transcribe ${res.status}${detail ? `: ${String(detail).slice(0, 200)}` : ""}`);
  }
  const text = body.split(/\r?\n/).map((l) => l.trim()).filter(Boolean).join(" ").slice(0, 6000);
  return { text, ms: Date.now() - started, model: "muse-voice-transcribe-1.0" };
}

// ------------------------------------------------------------ the adapters ---

test("meta: the Voice Transcribe request is field for field the one live-tested on 2026-10-27 (35ff6e0), and its lines become one transcript", async () => {
  process.env.META_MODEL_API_KEY = "test-key";
  const audio = wav({ seconds: 0.5, marker: "voice" });
  const answer = () => new Response("Grandma, it's me.\nI had an accident, please send money.\n", { status: 200 });
  const legacy = capture(answer);
  const layer = capture(answer);
  const alias = capture(answer);
  const was = await legacyTranscribeVoice({ wav: audio, fetchImpl: legacy.fetchImpl });
  const viaLayer = await transcribe({ wav: audio, fetchImpl: layer.fetchImpl, signal: AbortSignal.timeout(30000) });
  const viaAlias = await transcribeVoice({ wav: audio, fetchImpl: alias.fetchImpl });

  const withoutKey = (h) => ({ ...h, authorization: String(h.authorization).replace(/^Bearer .+$/, "Bearer <key>") });
  const before = legacy.calls[0];
  for (const { calls } of [layer, alias]) {
    const now = calls[0];
    assert.equal(now.url, before.url);
    assert.equal(now.url, "https://api.meta.ai/v1/asr/transcribe");
    assert.deepEqual(Object.keys(now.init), Object.keys(before.init));
    assert.equal(now.init.method, before.init.method);
    assert.deepEqual(withoutKey(now.init.headers), withoutKey(before.init.headers));
    assert.equal(now.init.headers.authorization, "Bearer test-key");
    assert.ok(now.init.signal instanceof AbortSignal, "a deadline travels with the request");
    assert.deepEqual(await fields(now.init.body), await fields(before.init.body));
    assert.equal(await wire(now.init.body), await wire(before.init.body), "byte for byte on the wire");
  }
  assert.equal(await layer.calls[0].init.body.get("request").text(), '{"model":"muse-voice-transcribe-1.0","audioEncoding":"WAV","mode":"PUSH_TO_TALK"}');
  assert.deepEqual([viaLayer.text, viaAlias.text], [was.text, was.text]);
  assert.equal(was.text, "Grandma, it's me. I had an accident, please send money.");
  assert.deepEqual([viaLayer.model, viaLayer.provider, viaAlias.model, viaAlias.provider], [VOICE_MODEL, "meta", was.model, "meta"]);
  // META_MODEL_BASE_URL still moves it, as before.
  process.env.META_MODEL_BASE_URL = "https://proxy.example/v1/";
  await legacyTranscribeVoice({ wav: audio, fetchImpl: legacy.fetchImpl });
  await transcribeVoice({ wav: audio, fetchImpl: alias.fetchImpl });
  assert.equal(alias.calls[1].url, legacy.calls[1].url);
  assert.equal(alias.calls[1].url, "https://proxy.example/v1/asr/transcribe");
});

test("meta: a language hint goes as languageBias with the language's English name; without one the model detects it", async () => {
  process.env.META_MODEL_API_KEY = "k";
  const seen = capture(() => new Response("Mamie, c'est moi.\n"));
  const requestPart = async (n) => JSON.parse(await seen.calls[n].init.body.get("request").text());
  assert.equal((await transcribe({ wav: wav(), language: "fr-FR", fetchImpl: seen.fetchImpl })).text, "Mamie, c'est moi.");
  assert.deepEqual(await requestPart(0), { model: VOICE_MODEL, audioEncoding: "WAV", mode: "PUSH_TO_TALK", languageBias: ["French"] });
  await transcribe({ wav: wav(), language: "en_US", fetchImpl: seen.fetchImpl });
  assert.deepEqual((await requestPart(1)).languageBias, ["English"]);
  await transcribe({ wav: wav(), language: "something else", fetchImpl: seen.fetchImpl });
  assert.equal("languageBias" in (await requestPart(2)), false, "not a language code: no hint");
  assert.deepEqual([languageCode("fr-FR"), languageCode("EN"), languageCode("French"), languageCode(undefined)], ["fr", "en", null, null]);
  assert.deepEqual([languageName("de"), languageName("pt-BR"), languageName("xx"), languageName("")], ["German", "Portuguese", null, null]);
});

test("meta: a refused key, a too-large upload, too many requests, a server error and a timeout keep the existing wording", async () => {
  process.env.META_MODEL_API_KEY = "k";
  const failWith = (status, body) => async () => new Response(body, { status });
  const cases = [
    [401, JSON.stringify({ error: { message: "Unauthorized", type: "authentication_error", param: null, code: "invalid_api_key" } }), "Muse Voice Transcribe 401: Unauthorized"],
    [413, JSON.stringify({ error: { message: "Request body exceeds 32 MB", type: "invalid_request_error" } }), "Muse Voice Transcribe 413: Request body exceeds 32 MB"],
    [429, JSON.stringify({ message: "Concurrency cap reached" }), "Muse Voice Transcribe 429: Concurrency cap reached"],
    [500, "upstream failure", "Muse Voice Transcribe 500"],
    [503, "", "Muse Voice Transcribe 503"],
  ];
  for (const [status, body, message] of cases) {
    const was = await legacyTranscribeVoice({ wav: wav(), fetchImpl: failWith(status, body) }).catch((e) => e);
    const now = await transcribeVoice({ wav: wav(), fetchImpl: failWith(status, body) }).catch((e) => e);
    assert.equal(was.message, message);
    assert.equal(now.message, message, `${status}: the same words as before`);
    assert.equal(now.status, status);
  }
  const late = await transcribeVoice({ wav: wav(), timeoutMs: 20, fetchImpl: hang }).catch((e) => e);
  assert.equal(late.message, "Muse Voice Transcribe timed out");
  assert.equal(late.code, "timeout");
  const stop = new AbortController();
  const cancelled = transcribe({ wav: wav(), fetchImpl: hang, signal: stop.signal }).catch((e) => e);
  stop.abort();
  assert.deepEqual([(await cancelled).message, (await cancelled).code], ["Muse Voice Transcribe request was cancelled", "aborted"]);
  const offline = await transcribe({ wav: wav(), fetchImpl: async () => { throw new TypeError("fetch failed"); } }).catch((e) => e);
  assert.ok(offline instanceof TypeError && offline.message === "fetch failed", "a network failure passes through as it is");
  // Without the key nothing is sent, with the old words.
  delete process.env.META_MODEL_API_KEY;
  const none = capture(() => new Response("never"));
  await assert.rejects(transcribe({ provider: "meta", wav: wav(), fetchImpl: none.fetchImpl }), { message: "Muse Voice Transcribe needs META_MODEL_API_KEY" });
  assert.equal(none.calls.length, 0);
});

test("openai-style: Whisper gets the WAV at /audio/transcriptions with LLM_TRANSCRIBE_MODEL (default whisper-1) and the language code; its text comes back", async () => {
  process.env.OPENAI_API_KEY = "sk-test";
  const seen = capture(() => Response.json({ text: " Grandma, it's me.\n I had an accident. " }));
  const openai = createOpenAiCompatibleProvider({ preset: "openai", fetchImpl: seen.fetchImpl });
  assert.equal(openai.capabilities.transcribe, true);
  assert.equal(openai.transcribeConfigured(), true);
  const audio = wav({ seconds: 0.25, marker: "whisper" });
  const out = await openai.transcribe({ wav: audio, language: "fr-FR", signal: AbortSignal.timeout(30000) });
  assert.deepEqual([out.text, out.model, out.provider], ["Grandma, it's me. I had an accident.", "whisper-1", "openai"]);
  assert.equal(DEFAULT_TRANSCRIBE_MODEL, "whisper-1");
  const call = seen.calls[0];
  assert.equal(call.url, "https://api.openai.com/v1/audio/transcriptions");
  assert.equal(call.init.method, "POST");
  assert.deepEqual(call.init.headers, { authorization: "Bearer sk-test" }, "multipart: fetch sets the content type and boundary");
  assert.ok(call.init.signal instanceof AbortSignal);
  assert.deepEqual(await fields(call.init.body), [
    { name: "file", filename: "voice.wav", type: "audio/wav", size: audio.length, bytes: audio.toString("base64") },
    { name: "model", value: "whisper-1" },
    { name: "language", value: "fr" },
  ]);
  // Another host and model (Groq's Whisper, say); no hint means no language field.
  process.env.LLM_TRANSCRIBE_MODEL = "whisper-large-v3-turbo";
  await createOpenAiCompatibleProvider({ preset: "groq", fetchImpl: seen.fetchImpl }).transcribe({ wav: audio });
  assert.equal(seen.calls[1].url, "https://api.groq.com/openai/v1/audio/transcriptions");
  assert.deepEqual((await fields(seen.calls[1].init.body)).map((f) => f.value ?? f.filename), ["voice.wav", "whisper-large-v3-turbo"]);
  // A self-hosted address needs no key and no chat model.
  delete process.env.OPENAI_API_KEY;
  process.env.LLM_BASE_URL = "http://localhost:8080/v1/";
  const local = createOpenAiCompatibleProvider({ preset: "openai-compatible", fetchImpl: seen.fetchImpl });
  assert.equal(local.configured(), false, "no chat model named");
  assert.equal(local.transcribeConfigured(), true);
  await local.transcribe({ wav: audio });
  assert.equal(seen.calls[2].url, "http://localhost:8080/v1/audio/transcriptions");
  assert.deepEqual(seen.calls[2].init.headers, {});
});

test("openai-style: errors read like its chat errors, a timeout is named, and nothing is sent without a key", async () => {
  process.env.OPENAI_API_KEY = "sk-test";
  for (const [status, message] of [[401, "Incorrect API key provided"], [413, "Maximum content size limit (26214400) exceeded"], [429, "Rate limit reached"], [500, "The server had an error"]]) {
    const openai = createOpenAiCompatibleProvider({ preset: "openai", fetchImpl: async () => Response.json({ error: { message } }, { status }) });
    const heard = await openai.transcribe({ wav: wav() }).catch((e) => e);
    const chat = await openai.complete({ messages: [{ role: "user", content: "hi" }] }).catch((e) => e);
    assert.equal(heard.message, `OpenAI API ${status}: ${message}`);
    assert.equal(heard.message, chat.message, "the same words as a chat failure");
    assert.equal(heard.status, status);
  }
  const bare = createOpenAiCompatibleProvider({ preset: "openai", fetchImpl: async () => new Response("Bad Gateway", { status: 502 }) });
  assert.equal((await bare.transcribe({ wav: wav() }).catch((e) => e)).message, "OpenAI API 502");
  const slow = createOpenAiCompatibleProvider({ preset: "openai", fetchImpl: hang });
  const late = await slow.transcribe({ wav: wav(), signal: AbortSignal.timeout(20) }).catch((e) => e);
  assert.deepEqual([late.message, late.code], ["OpenAI API timed out", "timeout"]);
  const odd = createOpenAiCompatibleProvider({ preset: "openai", fetchImpl: async () => Response.json({ transcript: "?" }) });
  await assert.rejects(odd.transcribe({ wav: wav() }), { message: "OpenAI API answered without a transcript" });
  delete process.env.OPENAI_API_KEY;
  const none = capture(() => Response.json({ text: "never" }));
  const keyless = createOpenAiCompatibleProvider({ preset: "openai", fetchImpl: none.fetchImpl });
  assert.equal(keyless.transcribeConfigured(), false);
  await assert.rejects(keyless.transcribe({ wav: wav() }), { message: "OpenAI API needs OPENAI_API_KEY or LLM_BASE_URL to transcribe" });
  assert.equal(none.calls.length, 0);
});

test("anthropic: transcription is refused with a clear 'not supported' error and nothing is sent", async () => {
  process.env.ANTHROPIC_API_KEY = "a";
  const seen = capture(() => Response.json({}));
  const claude = createAnthropicProvider({ fetchImpl: seen.fetchImpl });
  assert.equal(claude.capabilities.transcribe, false);
  assert.equal(claude.transcribeConfigured(), false);
  const e = await claude.transcribe({ wav: wav(), fetchImpl: seen.fetchImpl }).catch((x) => x);
  assert.match(e.message, /^Transcription is not supported by the Claude provider: voice checks need Muse Voice Transcribe \(META_MODEL_API_KEY\) or an OpenAI-style provider$/);
  assert.equal(e.code, "not_supported");
  assert.equal(seen.calls.length, 0);
  process.env.LLM_PROVIDER = "anthropic";
  await assert.rejects(transcribe({ wav: wav() }), /not supported/);
  assert.equal(transcribeConfigured(), false);
});

test("mock: transcripts are scripted (text, Error, function) and every request is recorded; reset clears them", async () => {
  const m = createMockProvider();
  assert.equal(m.capabilities.transcribe, true);
  assert.equal(m.transcribeConfigured(), false, "nothing scripted: no voice, as without Meta's key");
  m.scriptTranscript("Grandma, it's me.", new Error("asr down"), (req, n) => `call ${n} in ${req.language}`);
  assert.equal(m.transcribeConfigured(), true);
  const audio = wav();
  assert.deepEqual(await m.transcribe({ wav: audio }), { text: "Grandma, it's me.", model: "mock-transcribe-1", provider: "mock", raw: { scripted: "Grandma, it's me." } });
  await assert.rejects(m.transcribe({ wav: audio }), { message: "asr down" });
  assert.equal((await m.transcribe({ wav: audio, language: "fr" })).text, "call 3 in fr");
  await assert.rejects(m.transcribe({ wav: audio }), { message: "mock LLM: no scripted transcript for call 4" });
  assert.equal(m.transcribeCalls.length, 4);
  assert.equal(m.transcribeCalls[0].wav, audio);
  assert.equal(m.calls.length, 0, "chat calls are recorded apart");
  m.scriptTranscript("left over");
  m.reset();
  assert.deepEqual([m.transcribeCalls.length, m.transcribeConfigured()], [0, false]);
});

test("selection: Muse Voice Transcribe whenever Meta's key is set, else the active provider when it can transcribe; capabilities() says who can", async () => {
  const caps = capabilities();
  assert.deepEqual(Object.fromEntries(PROVIDER_NAMES.map((n) => [n, caps[n].transcribe])),
    { meta: true, anthropic: false, mock: true, "openai-compatible": true, openai: true, groq: true, together: true, ollama: true, "llama-api": true });
  assert.equal(voiceConfigured(), false, "the default (Meta) without its key: no voice checks");
  process.env.LLM_PROVIDER = "anthropic";
  process.env.ANTHROPIC_API_KEY = "a";
  assert.equal(voiceConfigured(), false, "Claude alone cannot transcribe");
  process.env.META_MODEL_API_KEY = "k";
  assert.equal(voiceConfigured(), true, "Meta's key: Muse Voice Transcribe, whatever model judges");
  const meta = capture(() => new Response("hello\n"));
  assert.equal((await transcribeVoice({ wav: wav(), fetchImpl: meta.fetchImpl })).provider, "meta");
  assert.match(meta.calls[0].url, /\/asr\/transcribe$/);
  process.env.LLM_PROVIDER = "mock";
  mock.scriptTranscript("not used");
  assert.equal((await transcribeVoice({ wav: wav(), fetchImpl: meta.fetchImpl })).provider, "meta", "Meta first, even when the mock judges");
  assert.equal(mock.transcribeCalls.length, 0);
  mock.reset();
  delete process.env.META_MODEL_API_KEY;
  assert.equal(voiceConfigured(), false, "the mock transcribes only what a test scripts");
  mock.scriptTranscript("  hello from the mock  ");
  assert.equal(voiceConfigured(), true);
  assert.deepEqual(await transcribeVoice({ wav: wav() }).then((o) => [o.text, o.provider]), ["hello from the mock", "mock"]);
  process.env.LLM_PROVIDER = "openai";
  process.env.OPENAI_API_KEY = "sk";
  assert.equal(voiceConfigured(), true, "else the active provider's Whisper");
  const whisper = capture(() => Response.json({ text: "hello" }));
  const out = await transcribeVoice({ wav: wav(), fetchImpl: whisper.fetchImpl });
  assert.deepEqual([out.text, out.provider, out.model], ["hello", "openai", "whisper-1"]);
  assert.match(whisper.calls[0].url, /\/audio\/transcriptions$/);
  process.env.LLM_PROVIDER = "nope";
  const warn = console.warn;
  console.warn = () => {};
  try { assert.equal(voiceConfigured(), false, "a misspelt provider: no voice checks"); } finally { console.warn = warn; }
});

// ------------------------------------------------------------ the format ---

test("wav: the page's 16 kHz mono 16-bit WAV passes, up to exactly 4 minutes", () => {
  assert.deepEqual(inspectWav(wav({ seconds: 1 })), { ok: true, seconds: 1, dataBytes: 32000, sampleRate: 16000, channels: 1, bitsPerSample: 16 });
  const longest = wav({ seconds: MAX_SECONDS });
  assert.deepEqual([inspectWav(longest).ok, inspectWav(longest).seconds], [true, 240]);
  assert.ok(longest.length < 8 * 1024 * 1024, "the page's longest recording fits the 8 MB upload limit");
  // Other chunks (LIST, odd sizes padded) are skipped; a streamed file that
  // claims more data than it holds counts what is there.
  const plain = wav({ seconds: 0.5 });
  const list = Buffer.concat([Buffer.from("LIST\x05\x00\x00\x00INFOx\x00", "latin1")]);
  assert.equal(inspectWav(Buffer.concat([plain.subarray(0, 36), list, plain.subarray(36)])).seconds, 0.5);
  const streamed = wav({ seconds: 1 });
  streamed.writeUInt32LE(0xffffffff, 40);
  assert.equal(inspectWav(streamed).seconds, 1);
  assert.equal(inspectWav(new Uint8Array(wav())).ok, true, "any byte array");
});

test("wav: each other shape is refused with its own message (not a WAV, damaged header, not PCM, stereo, 44.1 kHz, 8-bit, no sound data, over 4 minutes)", () => {
  const refusals = [
    [Buffer.from("ID3\x04 an mp3 file", "latin1"), "not_wav", "Please choose a voice recording: this file is not a WAV recording."],
    [Buffer.from("RIFF"), "not_wav", "Please choose a voice recording: this file is not a WAV recording."],
    [wav().subarray(0, 30), "wav_damaged", "This recording is damaged: its WAV header is cut short or missing."],
    [Buffer.concat([Buffer.from("RIFF\x04\x00\x00\x00WAVE", "latin1"), wav().subarray(36)]), "wav_damaged", "This recording is damaged: its WAV header is cut short or missing."],
    [wav({ format: 3 }), "wav_not_pcm", "This recording is not plain PCM audio: it must be a PCM WAV file."],
    [wav({ channels: 2 }), "wav_not_mono", "This recording has 2 channels: it must be mono (one channel)."],
    [wav({ rate: 44100 }), "wav_sample_rate", "This recording is sampled at 44100 Hz: it must be 16000 Hz (16 kHz)."],
    [wav({ rate: 24000 }), "wav_sample_rate", "This recording is sampled at 24000 Hz: it must be 16000 Hz (16 kHz)."],
    [wav({ bits: 8 }), "wav_bit_depth", "This recording uses 8-bit samples: it must be 16-bit."],
    [wav().subarray(0, 36), "wav_no_sound", "This recording has no sound in it."],
    [wav({ seconds: 0 }), "wav_no_sound", "This recording has no sound in it."],
    [wav({ seconds: MAX_SECONDS + 1 }), "wav_too_long", "This recording lasts 241 seconds: please choose one of 4 minutes or less."],
  ];
  for (const [bytes, error, message] of refusals) assert.deepEqual(inspectWav(bytes), { ok: false, error, message }, error);
  const broken = wav();
  broken.writeUInt32LE(48000, 28);
  assert.deepEqual(inspectWav(broken), { ok: false, error: "wav_damaged", message: "This recording is damaged: its WAV header does not add up." });
});

// ------------------------------------------------------------ the route ---

// A multipart upload as the browser sends it: optional fields, then one file.
function upload(content, { field = "audio", filename = "voice.wav", type = "audio/wav", from } = {}) {
  const boundary = `----prudencevoice${Date.now()}`;
  const parts = [];
  if (from !== undefined) parts.push(Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="from"\r\n\r\n${from}\r\n`));
  if (content) parts.push(Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="${field}"; filename="${filename}"\r\nContent-Type: ${type}\r\n\r\n`), content, Buffer.from("\r\n"));
  parts.push(Buffer.from(`--${boundary}--\r\n`));
  return { payload: Buffer.concat(parts), headers: { "content-type": `multipart/form-data; boundary=${boundary}` } };
}
async function poster(email) {
  const user = await makeUser({ email, name: "Linda", locale: "en-US" });
  const cookie = await sessionFor(user);
  const post = (content, opts) => {
    const body = upload(content, opts);
    return app.inject({ method: "POST", url: "/api/check/voice", headers: { cookie, origin: ORIGIN, ...body.headers }, payload: body.payload });
  };
  post.cookie = cookie;
  return { user, post };
}
const tableNames = async () => (await many("SELECT table_name AS name FROM information_schema.tables WHERE table_schema = 'public' AND table_type = 'BASE TABLE' ORDER BY 1")).map((r) => r.name);
async function rowCounts() {
  const out = {};
  for (const name of await tableNames()) out[name] = (await one(`SELECT count(*)::int AS n FROM "${name}"`)).n;
  return out;
}

const SCAM = { verdict: "scam", confidence: 0.95, headline: "Scam: someone pretending to be family.", reasons: [{ text: "A relative in trouble who wants gift cards and secrecy.", evidence: "payment" }],
  action: "verify_with_real_person", action_text: "Call your grandson on the number you already have.", real_company_says: null, impersonated_brand: null,
  scam_type: "voice_clone_family", matched_pattern_ids: [], escalate_to_guardian: true, guardian_summary: "A voice message asked for gift cards.", language: "en" };

test("HTTP: a WAV voice message becomes a transcript and a verdict on the channel voice_transcript, and neither the audio nor the words are stored", db, async () => {
  process.env.LLM_PROVIDER = "mock";
  const { user, post } = await poster("linda.voice.mock@example.test");
  const heard = "Grandma it's me, Ethan. I crashed the car near Riverside and the police kept my phone. Please buy two thousand dollars in gift cards and don't tell mom.";
  const MARK = "PRUDENCE-AUDIO-7f3a";
  const audio = wav({ seconds: 1, marker: MARK });
  mock.scriptTranscript(heard);
  mock.script(SCAM);
  const counts = await rowCounts();

  const res = await post(audio, { from: "+1 555-0199" });
  assert.equal(res.statusCode, 200, res.body);
  const out = res.json();
  assert.equal(out.transcript, heard);
  assert.deepEqual([out.message.channel, out.message.body, out.message.from], ["voice_transcript", heard, "+1 555-0199"]);
  assert.equal(out.verdict.verdict, "scam");
  assert.equal(out.verdict.source, "Mock LLM (mock-1)");
  assert.ok(out.checkId);
  // The uploaded bytes went to the transcriber once; the words, as a voice transcript, to the judge.
  assert.equal(mock.transcribeCalls.length, 1);
  assert.ok(Buffer.from(mock.transcribeCalls[0].wav).equals(audio));
  assert.ok(mock.transcribeCalls[0].signal instanceof AbortSignal);
  assert.equal(mock.calls.length, 1);
  const prompt = mock.calls[0].messages[0].content;
  assert.ok(prompt.includes('"channel":"voice_transcript"') && prompt.includes("Riverside"), "the model judged the words");

  // Kept: one check row (the verdict, channel "voice") and the cached verdict. Nothing else, and nowhere the words or the audio.
  const after = await rowCounts();
  const grew = Object.fromEntries(Object.keys(after).filter((t) => after[t] !== counts[t]).map((t) => [t, after[t] - counts[t]]));
  assert.deepEqual(grew, { checks: 1, llm_cache: 1 });
  const row = await one("SELECT * FROM checks WHERE id = $1 AND user_id = $2", [out.checkId, user.id]);
  assert.deepEqual([row.channel, row.verdict_value], ["voice", "scam"]);
  for (const name of await tableNames()) {
    const dump = (await many(`SELECT t::text AS row FROM "${name}" t`)).map((r) => r.row).join("\n");
    for (const trace of ["Riverside", "police kept my phone", MARK, Buffer.from(MARK).toString("hex"), Buffer.from(MARK).toString("base64").slice(0, 16)]) {
      assert.ok(!dump.includes(trace), `${name} holds no trace of the recording or its words (${trace})`);
    }
  }
});

test("HTTP: a wrong recording is refused before anything is sent: one 400 message per problem, 413 over 8 MB", db, async () => {
  process.env.LLM_PROVIDER = "mock";
  mock.scriptTranscript("never used");
  const { post } = await poster("voice.formats@example.test");
  const refusals = [
    [Buffer.from("hello"), { filename: "note.txt", type: "text/plain" }, "not_wav"],
    [wav({ rate: 44100 }), {}, "wav_sample_rate"],
    [wav({ channels: 2 }), {}, "wav_not_mono"],
    [wav({ bits: 8 }), {}, "wav_bit_depth"],
    [wav().subarray(0, 30), {}, "wav_damaged"],
    [wav().subarray(0, 36), {}, "wav_no_sound"],
    [wav({ seconds: MAX_SECONDS + 1 }), {}, "wav_too_long"],
  ];
  for (const [bytes, opts, error] of refusals) {
    const res = await post(bytes, opts);
    assert.equal(res.statusCode, 400, `${error}: ${res.body}`);
    assert.deepEqual(res.json(), { error, message: inspectWav(bytes).message });
  }
  const none = await post(null, { from: "+1 555-0100" });
  assert.equal(none.statusCode, 400);
  assert.deepEqual(none.json(), { error: "no_recording", message: "Please choose a voice recording." });
  const huge = await post(Buffer.concat([wav({ seconds: 0 }), Buffer.alloc(8 * 1024 * 1024)]));
  assert.equal(huge.statusCode, 413);
  assert.deepEqual(huge.json(), { error: "voice_too_large", message: "This recording is over 8 MB: please choose one of 4 minutes or less." });
  const notMultipart = await app.inject({ method: "POST", url: "/api/check/voice", headers: { cookie: post.cookie, origin: ORIGIN }, payload: { audio: "x" } });
  assert.equal(notMultipart.statusCode, 406, "anything but a multipart upload keeps the server's own answer");
  assert.equal(mock.transcribeCalls.length, 0, "nothing was sent to be transcribed");
  assert.equal(mock.calls.length, 0, "nothing was judged");
});

test("HTTP: no transcription available answers 503, a failed one 502 with the plain message, silence 422; nothing is judged", db, async () => {
  const { user, post } = await poster("voice.failures@example.test");
  const needs = { error: "voice_needs_muse", message: "Checking voice messages needs Meta's Muse Voice Transcribe, which is not switched on here yet." };
  let res = await post(wav());
  assert.deepEqual([res.statusCode, res.json()], [503, needs], "Meta, the default, without its key");
  process.env.LLM_PROVIDER = "anthropic";
  process.env.ANTHROPIC_API_KEY = "a";
  res = await post(wav());
  assert.deepEqual([res.statusCode, res.json()], [503, needs], "Claude alone cannot transcribe");
  process.env.LLM_PROVIDER = "mock";
  res = await post(wav());
  assert.equal(res.statusCode, 503, "the mock with nothing scripted");

  const failed = { error: "voice_failed", message: "We could not listen to this recording right now. Please try again in a minute." };
  mock.scriptTranscript(Object.assign(new Error("Muse Voice Transcribe 429: Concurrency cap reached"), { status: 429 }), "", "  \n ");
  res = await post(wav());
  assert.deepEqual([res.statusCode, res.json()], [502, failed]);
  for (let i = 0; i < 2; i++) {
    res = await post(wav());
    assert.deepEqual([res.statusCode, res.json()], [422, { error: "no_speech", message: "We could not hear any words in this recording." }]);
  }
  // Meta's own refusal (a revoked key) reaches the senior as the same plain message.
  process.env.META_MODEL_API_KEY = "revoked";
  globalThis.fetch = async (url) => (String(url).endsWith("/asr/transcribe")
    ? Response.json({ error: { message: "Unauthorized", type: "authentication_error", code: "invalid_api_key" } }, { status: 401 })
    : new Response("unexpected", { status: 500 }));
  res = await post(wav());
  assert.deepEqual([res.statusCode, res.json()], [502, failed]);
  assert.equal(mock.calls.length, 0, "nothing was judged");
  assert.equal((await many("SELECT id FROM checks WHERE user_id = $1", [user.id])).length, 0, "nothing was recorded");
});

test("/api/status: voiceConfigured is true with the mock and false when no provider can transcribe", async () => {
  const voice = async () => (await app.inject({ url: "/api/status" })).json().voiceConfigured;
  assert.equal(await voice(), false, "Meta, the default, without its key");
  process.env.LLM_PROVIDER = "mock";
  mock.scriptTranscript("ready");
  assert.equal(await voice(), true, "the mock, ready to transcribe");
  process.env.LLM_PROVIDER = "anthropic";
  process.env.ANTHROPIC_API_KEY = "a";
  assert.equal(await voice(), false, "Claude alone");
  process.env.META_MODEL_API_KEY = "k";
  assert.equal(await voice(), true, "Meta's key: Muse Voice Transcribe");
});
