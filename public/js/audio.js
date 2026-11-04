// Turns any recording the browser can play (m4a, mp3, ogg, opus, wav…) into
// the 16 kHz mono 16-bit WAV that Muse Voice Transcribe takes. It all happens
// on the device: the original file never leaves it, only this smaller copy.
// Capped at 4 minutes, which keeps the upload under the server's 8 MB limit.

const RATE = 16000;
const MAX_SECONDS = 240;

export async function toWav16k(file) {
  const ctx = new AudioContext();
  let decoded;
  try { decoded = await ctx.decodeAudioData(await file.arrayBuffer()); } finally { ctx.close(); }
  const frames = Math.ceil(Math.min(decoded.duration, MAX_SECONDS) * RATE);
  // One output channel: the browser mixes stereo down for us.
  const offline = new OfflineAudioContext(1, frames, RATE);
  const source = offline.createBufferSource();
  source.buffer = decoded;
  source.connect(offline.destination);
  source.start();
  const pcm = (await offline.startRendering()).getChannelData(0);
  return new Blob([encodeWav(pcm)], { type: "audio/wav" });
}

// The bytes of a 16 kHz mono 16-bit PCM WAV, from samples between -1 and 1 at
// 16 kHz: what lib/llm/audio.js inspectWav accepts. Listen uses it too
// (public/js/listen.js).
export function encodeWav(pcm) {
  const view = new DataView(new ArrayBuffer(44 + pcm.length * 2));
  const ascii = (at, s) => { for (let i = 0; i < s.length; i++) view.setUint8(at + i, s.charCodeAt(i)); };
  ascii(0, "RIFF"); view.setUint32(4, 36 + pcm.length * 2, true); ascii(8, "WAVE");
  ascii(12, "fmt "); view.setUint32(16, 16, true); view.setUint16(20, 1, true); view.setUint16(22, 1, true);
  view.setUint32(24, RATE, true); view.setUint32(28, RATE * 2, true); view.setUint16(32, 2, true); view.setUint16(34, 16, true);
  ascii(36, "data"); view.setUint32(40, pcm.length * 2, true);
  for (let i = 0; i < pcm.length; i++) {
    const s = Math.max(-1, Math.min(1, pcm[i]));
    view.setInt16(44 + i * 2, s < 0 ? s * 0x8000 : s * 0x7fff, true);
  }
  return view.buffer;
}
