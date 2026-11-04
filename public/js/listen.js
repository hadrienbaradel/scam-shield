// Listen on the glasses screen (_product/specs/check-glasses.md, lines 9 to
// 15): the phone's microphone, the last 45 seconds in memory, a 16 kHz WAV.
// No words and no DOM here (the screen is public/js/views/glasses.js), and
// nothing touches a browser at import time: tests/glasses-view.test.js runs
// this under Node with a fake microphone.
//
// Pure helpers:
//   createRing(sampleRate, seconds)  the last LISTEN_SECONDS of samples
//   resample(pcm, fromRate, toRate)  to the 16 kHz mono the server takes
//   encodeWav(pcm)                   its bytes (public/js/audio.js)
//   isBluetoothMic(label), pickPhoneMic(devices), phoneMicId(devices, label)
//   micProblem(error) -> "none" | "denied"
//
// createListener({ onLevel, onEnded, env }) -> the one microphone session:
//   prepare()  inside the tap: resumes the audio, asks for the microphone,
//              decides which one, then lets go of it (iOS routes speech badly
//              while the microphone is open, and the glasses' microphone is
//              aimed at the wearer: lines 10 and 14)
//   start()    opens the microphone; only from here do samples enter the ring
//   release()  microphone off; the ring stays, for takeWav()
//   capturedSeconds(), takeWav() -> a WAV Blob, clear()
//   destroy()  microphone off, ring zeroed, audio closed: nothing is left
//   live()     whether a microphone track is open now

import { encodeWav } from "./audio.js";

export { encodeWav };

export const LISTEN_SECONDS = 45;
export const MIN_SECONDS = 2; // under this, nobody can have said anything to judge
export const WAV_RATE = 16000;
const FRAME = 4096;
const LEVEL_EVERY_MS = 100; // the level bar moves at most ten times a second

// The newest samples overwrite the oldest: at most `seconds` of sound exist.
export function createRing(sampleRate, seconds = LISTEN_SECONDS) {
  const size = Math.max(1, Math.round(sampleRate * seconds));
  const data = new Float32Array(size);
  let at = 0;
  let filled = 0;
  return {
    sampleRate,
    capacity: size,
    get length() { return filled; },
    get seconds() { return filled / sampleRate; },
    push(frame) {
      for (let i = Math.max(0, frame.length - size); i < frame.length; i++) {
        data[at] = frame[i];
        at = (at + 1) % size;
      }
      filled = Math.min(size, filled + frame.length);
    },
    // The samples in the order they were heard.
    read() {
      const out = new Float32Array(filled);
      const start = filled < size ? 0 : at;
      for (let i = 0; i < filled; i++) out[i] = data[(start + i) % size];
      return out;
    },
    clear() { data.fill(0); at = 0; filled = 0; },
    // For the tests: every sample is gone.
    empty() { return filled === 0 && data.every((v) => v === 0); },
  };
}

// Down: the average of the samples each new one stands for, so the speech
// stays clean. Up (a Bluetooth context at 8 kHz): a straight line between two
// samples. One context rate is the phone's, usually 44.1 or 48 kHz.
export function resample(pcm, fromRate, toRate = WAV_RATE) {
  if (fromRate === toRate) return pcm;
  const ratio = fromRate / toRate;
  const out = new Float32Array(Math.floor(pcm.length / ratio));
  if (ratio > 1) {
    let start = 0;
    for (let i = 0; i < out.length; i++) {
      const end = Math.min(pcm.length, Math.round((i + 1) * ratio));
      let sum = 0;
      for (let j = start; j < end; j++) sum += pcm[j];
      out[i] = end > start ? sum / (end - start) : 0;
      start = end;
    }
    return out;
  }
  for (let i = 0; i < out.length; i++) {
    const pos = i * ratio;
    const low = Math.floor(pos);
    const high = Math.min(pcm.length - 1, low + 1);
    out[i] = pcm[low] + (pcm[high] - pcm[low]) * (pos - low);
  }
  return out;
}

// ---------------------------------------------------------- which microphone --
// The glasses' microphones are aimed at the wearer and barely hear the person
// in front of them (research/glasses/platform.md, section 3), so an input
// that looks like them is passed over when the phone has its own (line 14).
const BLUETOOTH = /\b(bluetooth|ray[- ]?ban|meta|glasses|head(set|phones?)|ear(buds?|phones?)|air ?pods|hands[- ]?free|wireless)\b/i;
export const isBluetoothMic = (label) => BLUETOOTH.test(String(label || ""));

// The phone's own input among the browser's device list, or null when there
// is none it can tell (no labels, or only Bluetooth inputs). "default" and
// "communications" follow whatever the system chose, the glasses included, so
// a named input comes first.
export function pickPhoneMic(devices) {
  const own = (Array.isArray(devices) ? devices : [])
    .filter((d) => d?.kind === "audioinput" && d.label && !isBluetoothMic(d.label));
  const named = own.filter((d) => !["default", "communications"].includes(d.deviceId));
  return named[0] || own[0] || null;
}

// The deviceId to ask for, or null to leave the system's choice: with no
// Bluetooth input around, nothing needs changing.
export function phoneMicId(devices, trackLabel = "") {
  const inputs = (Array.isArray(devices) ? devices : []).filter((d) => d?.kind === "audioinput");
  if (!isBluetoothMic(trackLabel) && !inputs.some((d) => isBluetoothMic(d.label))) return null;
  return pickPhoneMic(inputs)?.deviceId || null;
}

// What the screen says when the microphone cannot be opened: no microphone at
// all ("none", no button), or anything else, a refusal first ("denied", with
// Try again).
export function micProblem(e) {
  return e?.code === "no_mic" || e?.name === "NotFoundError" ? "none" : "denied";
}

// ---------------------------------------------------------------- listening --
export function createListener({ onLevel = () => {}, onEnded = () => {}, env = globalThis } = {}) {
  let ctx = null;
  let ring = null;
  let deviceId = null;
  let stream = null;
  let source = null;
  let processor = null;
  let lastLevel = 0;
  let gone = false;

  const stopTracks = (s) => s?.getTracks?.().forEach((tr) => { tr.onended = null; tr.stop(); });
  const devices = () => env.navigator?.mediaDevices;
  const open = async () => {
    const media = devices();
    if (!deviceId) return media.getUserMedia({ audio: true });
    // The chosen microphone may have gone since (a phone can drop an input).
    try { return await media.getUserMedia({ audio: { deviceId: { exact: deviceId } } }); } catch (e) {
      if (e?.name !== "OverconstrainedError" && e?.name !== "NotFoundError") throw e;
      deviceId = null;
      return media.getUserMedia({ audio: true });
    }
  };

  const release = () => {
    if (processor) { processor.onaudioprocess = null; processor.disconnect?.(); }
    source?.disconnect?.();
    stopTracks(stream);
    processor = null;
    source = null;
    stream = null;
  };

  return {
    async prepare() {
      const AudioCtx = env.AudioContext || env.webkitAudioContext;
      if (!AudioCtx || !devices()?.getUserMedia) throw Object.assign(new Error("no microphone"), { code: "no_mic" });
      // Before any await: this must happen inside the tap.
      ctx = new AudioCtx();
      const resumed = ctx.resume?.();
      ring = createRing(ctx.sampleRate);
      const first = await devices().getUserMedia({ audio: true });
      try {
        const list = await devices().enumerateDevices?.();
        deviceId = phoneMicId(list, first.getAudioTracks?.()[0]?.label);
      } finally {
        stopTracks(first);
      }
      await resumed?.catch?.(() => {});
    },

    // Reopens the microphone. Returns false when destroyed meanwhile. Nothing
    // enters the ring before this.
    async start() {
      if (gone || stream) return !gone;
      const s = await open();
      if (gone) { stopTracks(s); return false; }
      if (stream) { stopTracks(s); return true; }
      stream = s;
      await ctx.resume?.();
      if (gone || stream !== s) return !gone;
      source = ctx.createMediaStreamSource(s);
      // A worklet would need its own file; this runs on iOS Safari and Chrome on Android.
      processor = ctx.createScriptProcessor(FRAME, 1, 1);
      processor.onaudioprocess = (ev) => {
        const frame = ev.inputBuffer.getChannelData(0);
        ring?.push(frame);
        const now = Date.now();
        if (now - lastLevel < LEVEL_EVERY_MS) return;
        lastLevel = now;
        let sum = 0;
        for (let i = 0; i < frame.length; i++) sum += frame[i] * frame[i];
        onLevel(Math.min(1, Math.sqrt(sum / (frame.length || 1)) * 6));
      };
      source.connect(processor);
      // Connected so it runs; its output stays silent.
      processor.connect(ctx.destination);
      s.getAudioTracks?.().forEach((tr) => { tr.onended = () => { if (stream === s) onEnded(); }; });
      return true;
    },

    release,
    capturedSeconds: () => ring?.seconds || 0,
    takeWav: () => new Blob([encodeWav(resample(ring.read(), ctx.sampleRate))], { type: "audio/wav" }),
    clear: () => ring?.clear(),
    live: () => Boolean(stream?.getTracks?.().some((tr) => tr.readyState !== "ended")),

    destroy() {
      gone = true;
      release();
      ring?.clear();
      ring = null;
      ctx?.close?.()?.catch?.(() => {});
      ctx = null;
    },
  };
}
