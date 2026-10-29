// Audio for the transcribe capability, shared by the adapters: the one input
// format they all take, checked on the server before anything leaves it, the
// language hint in each API's form, and the error wording.
//
// The format is what the web page makes (public/js/audio.js): a RIFF/WAVE
// file of plain PCM, mono, 16 kHz, 16-bit, at most 4 minutes (7.7 MB, under
// the 8 MB upload limit). Muse Voice Transcribe takes mono 16-bit PCM WAV at
// 16 or 24 kHz up to 10 minutes and 32 MB (dev.meta.ai/docs/speech-to-text,
// 2026-10-29); Whisper takes any WAV up to 25 MB.

export const WAV_FORMAT = { sampleRate: 16000, channels: 1, bitsPerSample: 16 };
export const MAX_SECONDS = 240;
const BYTES_PER_SECOND = WAV_FORMAT.sampleRate * WAV_FORMAT.channels * (WAV_FORMAT.bitsPerSample / 8);

const problem = (error, message) => ({ ok: false, error, message });

// { ok: true, seconds, dataBytes, sampleRate, channels, bitsPerSample }, or
// { ok: false, error, message } with one plain message per problem.
export function inspectWav(input) {
  const b = Buffer.isBuffer(input) ? input : Buffer.from(input || []);
  if (b.length < 12 || b.toString("latin1", 0, 4) !== "RIFF" || b.toString("latin1", 8, 12) !== "WAVE") {
    return problem("not_wav", "Please choose a voice recording: this file is not a WAV recording.");
  }
  // Chunks: a 4-letter id, a 32-bit little-endian size, the bytes, padded to
  // an even length. "fmt " must come before "data"; others are skipped.
  let fmt = null;
  let dataBytes = null;
  for (let at = 12; at + 8 <= b.length;) {
    const id = b.toString("latin1", at, at + 4);
    const size = b.readUInt32LE(at + 4);
    const start = at + 8;
    if (id === "fmt ") {
      if (size < 16 || start + 16 > b.length) break;
      fmt = { format: b.readUInt16LE(start), channels: b.readUInt16LE(start + 2), sampleRate: b.readUInt32LE(start + 4),
        byteRate: b.readUInt32LE(start + 8), blockAlign: b.readUInt16LE(start + 12), bitsPerSample: b.readUInt16LE(start + 14) };
    } else if (id === "data") {
      // A streamed recording may claim more bytes than it holds: count what is there.
      if (fmt) dataBytes = Math.min(size, b.length - start);
      break;
    }
    at = start + size + (size % 2);
  }
  if (!fmt) return problem("wav_damaged", "This recording is damaged: its WAV header is cut short or missing.");
  if (fmt.format !== 1) return problem("wav_not_pcm", "This recording is not plain PCM audio: it must be a PCM WAV file.");
  if (fmt.channels !== 1) return problem("wav_not_mono", `This recording has ${fmt.channels} channels: it must be mono (one channel).`);
  if (fmt.sampleRate !== WAV_FORMAT.sampleRate) return problem("wav_sample_rate", `This recording is sampled at ${fmt.sampleRate} Hz: it must be 16000 Hz (16 kHz).`);
  if (fmt.bitsPerSample !== WAV_FORMAT.bitsPerSample) return problem("wav_bit_depth", `This recording uses ${fmt.bitsPerSample}-bit samples: it must be 16-bit.`);
  if (fmt.blockAlign !== 2 || fmt.byteRate !== BYTES_PER_SECOND) return problem("wav_damaged", "This recording is damaged: its WAV header does not add up.");
  if (!dataBytes || dataBytes < 2) return problem("wav_no_sound", "This recording has no sound in it.");
  const seconds = dataBytes / BYTES_PER_SECOND;
  if (seconds > MAX_SECONDS) return problem("wav_too_long", `This recording lasts ${Math.ceil(seconds)} seconds: please choose one of 4 minutes or less.`);
  return { ok: true, seconds, dataBytes, ...WAV_FORMAT };
}

// A language hint ("fr", "fr-FR", "en_US") as each API wants it: Whisper
// takes the ISO 639-1 code, Meta's languageBias the English name ("French").
// Anything else means no hint: the model detects the language.
export function languageCode(hint) {
  const m = /^([a-z]{2})(?:[-_][a-z0-9]+)*$/i.exec(String(hint || "").trim());
  return m ? m[1].toLowerCase() : null;
}
const NAMES = new Intl.DisplayNames(["en"], { type: "language", fallback: "none" });
export function languageName(hint) {
  const code = languageCode(hint);
  return (code && NAMES.of(code)) || null;
}

// Errors: a timeout or a cancel is named after the API instead of a bare
// AbortError (code "timeout" or "aborted"); an HTTP failure carries its status.
export function named(label, e) {
  if (e?.name === "TimeoutError") return Object.assign(new Error(`${label} timed out`), { code: "timeout", cause: e });
  if (e?.name === "AbortError") return Object.assign(new Error(`${label} request was cancelled`), { code: "aborted", cause: e });
  return e;
}
export async function send(label, fetchImpl, url, init) {
  try { return await fetchImpl(url, init); } catch (e) { throw named(label, e); }
}
export const httpError = (message, status) => Object.assign(new Error(message), { status });
