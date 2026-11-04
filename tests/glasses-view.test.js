// Meta glasses on Check (_product/specs/check-glasses.md): Listen's sound
// (public/js/listen.js, with a fake microphone) and the screens' pure parts
// (public/js/protects.js, public/js/views/glasses.js). No browser, no
// database; what the server answers is in tests/glasses.test.js.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { STRINGS, setLang } from "../public/js/i18n.js";
import { inspectWav } from "../lib/llm/audio.js";
import { CRITERIA, SCREENS, glassesChoice, glassesRow, handsFreeWays, hasGlasses, scoreOf, screenFor } from "../public/js/protects.js";
import { ICON_NAMES } from "../public/js/ui.js";
import { LISTEN_SECONDS, MIN_SECONDS, createListener, createRing, createSession, encodeWav, isBluetoothMic, micProblem, phoneMicId, pickPhoneMic, resample } from "../public/js/listen.js";
import { glassesDrawing, handsFreeHtml, spokenAnswer, sayHere, hush, lookJob } from "../public/js/views/glasses.js";
import { askPreviewHtml } from "../public/js/views/mail.js";

const withGlasses = (glasses) => ({ user: { glasses } });
const inFrench = (fn) => {
  globalThis.document = { documentElement: {} }; // setLang records the language on <html>
  try { setLang("fr"); return fn(); } finally { setLang("en"); delete globalThis.document; }
};

// ------------------------------------------------------------ the Check choice --
test("the Check choice: asks at first, says Use once set up, waits in More ways after a no", () => {
  const asks = { label: "ck_glasses", href: "#/check/glasses/setup", inMore: false };
  assert.deepEqual(glassesChoice(withGlasses(null)), asks, "never asked");
  assert.deepEqual(glassesChoice(withGlasses("have")), asks, "a pair not tested yet still goes through set up");
  assert.deepEqual(glassesChoice({}), asks, "a status with no answer");
  assert.deepEqual(glassesChoice(withGlasses("ready")), { label: "ck_glasses_use", href: "#/check/glasses", inMore: false });
  assert.deepEqual(glassesChoice(withGlasses("none")), { ...asks, inMore: true });
  assert.equal(STRINGS.en.ck_glasses, "Do you have Meta glasses?");
  assert.equal(STRINGS.en.ck_glasses_use, "Use my Meta glasses");
});

test("Settings: Not set up with Set up my glasses, Ready with Use my glasses; a no is one tap from changing its mind", () => {
  const notSet = { name: "gl_row", state: "gl_row_none", verb: "gl_row_setup", href: "#/check/glasses/setup" };
  for (const g of [null, "none", "have"]) assert.deepEqual(glassesRow(withGlasses(g)), notSet, String(g));
  assert.deepEqual(glassesRow(withGlasses("ready")), { name: "gl_row", state: "gl_row_ready", verb: "gl_row_use", href: "#/check/glasses" });
  assert.deepEqual(["gl_row", "gl_row_none", "gl_row_setup", "gl_row_ready", "gl_row_use"].map((k) => STRINGS.en[k]),
    ["Meta glasses", "Not set up", "Set up my glasses", "Ready", "Use my glasses"]);
});

// ------------------------------------------------------------------ the score --
test("the score counts the glasses only for someone who said they have a pair, on once they heard the test sentence", () => {
  const score = (glasses) => scoreOf({ status: withGlasses(glasses), devices: [], guardians: [], progress: null, checks: [] });
  for (const g of [null, "none"]) assert.equal(score(g).total, 6, `${g}: never in the total, so the full score stays reachable`);
  assert.equal(score("have").total, 7);
  assert.equal(score("ready").total, 7);
  assert.equal(score("have").on, 0, "said yes, not tested");
  assert.equal(score("ready").on, 1, "heard the sentence");
  const row = CRITERIA.find((c) => c.key === "glasses");
  assert.equal(row.href, "#/check/glasses/setup");
  assert.equal(STRINGS.en.score_glasses_step, "Test my glasses");
  assert.deepEqual([hasGlasses(withGlasses("have")), hasGlasses(withGlasses("ready")), hasGlasses(withGlasses("none")), hasGlasses(null)], [true, true, false, false]);
  const allButGlasses = { status: { ...withGlasses("have"), gmail: { connected: true }, breachLookup: { at: "2026-11-04" } }, devices: [{}], guardians: [{ status: "active" }],
    progress: { summary: { done: 1 } }, checks: [{ channel: "voice" }] };
  assert.equal(scoreOf(allButGlasses).next.key, "glasses");
  assert.equal(scoreOf(allButGlasses).next.step, "Test my glasses");
  assert.equal(scoreOf(allButGlasses).next.href, "#/check/glasses/setup");
});

test("the routes: four screens under Check, the longest route winning", () => {
  for (const [hash, view] of [["#/check/glasses", "check-glasses"], ["#/check/glasses/setup", "check-glasses-setup"], ["#/check/glasses/look", "check-glasses-look"], ["#/check/glasses/listen", "check-glasses-listen"]]) {
    assert.equal(screenFor(hash).view, view);
    assert.equal(screenFor(hash).tab, "check");
    assert.ok(!screenFor(hash).mail, `${hash}: no mailbox needed`);
  }
  assert.equal(new Set(SCREENS.map((s) => s.view)).size, SCREENS.filter((s) => s.route !== "#/people").length, "one view per screen");
  assert.ok(ICON_NAMES.includes("glasses"));
});

// ---------------------------------------------------------------- hands free --
const receiving = { messengerReceives: true, messengerLink: "https://m.me/139962502991539", whatsappReceives: true, whatsappLink: "https://wa.me/15556239145" };

test("Without touching your phone hides without the App Secret or the token: never a dead button", () => {
  assert.deepEqual(handsFreeWays({}), []);
  assert.equal(handsFreeHtml({}), "");
  assert.deepEqual(handsFreeWays({ messengerConfigured: true, messengerLink: receiving.messengerLink, messengerReceives: false, whatsappConfigured: true, whatsappLink: receiving.whatsappLink, whatsappReceives: false }), [],
    "what production answers today: configured, but every delivery refused");
  assert.equal(handsFreeWays({ ...receiving, messengerLink: "http://m.me/x" }).some((w) => w.key === "messenger"), false, "a strange address gives no button");
  assert.equal(handsFreeWays({ ...receiving, whatsappLink: null }).some((w) => w.key === "whatsapp"), false, "no number, no contact card");
  assert.equal(handsFreeWays({ ...receiving, messengerReceives: "true" }).some((w) => w.key === "messenger"), false, "only a real true");
});

test("Without touching your phone: Messenger opens the chat, WhatsApp saves the contact, each with the words to say", () => {
  assert.deepEqual(handsFreeWays(receiving).map((w) => [w.key, w.href, w.external]), [["messenger", receiving.messengerLink, true], ["whatsapp", "/prudence.vcf", false]]);
  const html = handsFreeHtml(receiving);
  assert.match(html, /Without touching your phone/);
  assert.match(html, new RegExp(`href="${receiving.messengerLink}" target="_blank" rel="noopener">Say hello to Prudence once<`));
  assert.match(html, /href="\/prudence\.vcf" download>Save Prudence in my contacts</);
  assert.match(html, /Then say:/);
  assert.match(html, /Hey Meta, send a photo to Hey Prudence on Messenger\./);
  assert.match(html, /Hey Meta, send a photo to Prudence on WhatsApp\./);
  assert.match(html, /The answer comes back as a message in that app\./);
  const one = handsFreeHtml({ ...receiving, whatsappReceives: false });
  assert.match(one, /Messenger/);
  assert.doesNotMatch(one, /WhatsApp/);
});

// ----------------------------------------------------------- what is spoken --
test("the answer in the ear: the headline and the next step, never the reasons", () => {
  const v = { headline: "Be careful: a roofer wants cash today.", action_text: "Do not pay cash today. Ask for a written quote.", reasons: [{ text: "A long reason." }] };
  assert.equal(spokenAnswer(v), "Be careful: a roofer wants cash today. Do not pay cash today. Ask for a written quote.");
  assert.equal(spokenAnswer({ ...v, action_text: "" }), "Be careful: a roofer wants cash today.");
  assert.equal(spokenAnswer({ headline: "No stop", action_text: "Then this." }), "No stop. Then this.");
  assert.equal(spokenAnswer({}), `${STRINGS.en.v2_unknown_title.replace(/[.\s]+$/, "")}. ${STRINGS.en.v2_unknown_note}`, "no headline: the card's own words for it");
  assert.equal(spokenAnswer(null), spokenAnswer({}));
});

// ---------------------------------------------------------------- the drawing --
test("the drawing is decorative plain SVG the page's rules allow, its arms named in her language", () => {
  const svg = glassesDrawing();
  assert.match(svg, /aria-hidden="true"/);
  assert.doesNotMatch(svg, /style=|<script|<image|<foreignObject|role="img"/, "no inline style: the page's rules refuse it");
  for (const n of [">1<", ">2<", ">3<", ">Left arm<", ">Right arm<"]) assert.ok(svg.includes(n), n);
  const fr = inFrench(() => glassesDrawing());
  assert.ok(fr.includes(">Branche gauche<") && fr.includes(">Branche droite<"));
  assert.match(fr, /text-anchor="start" x="6"/, "a longer word grows inwards, never past the edge");
  assert.match(fr, /text-anchor="end" x="352"/);
});

// ------------------------------------------------------------------- the words --
test("every word of the glasses screens is the spec's, in English and in French", () => {
  const en = STRINGS.en;
  for (const [key, words] of Object.entries({
    gl_on_title: "Turn on your glasses", gl_on_btn: "They are on", gl_new: "They are new: help me install them", gl_none: "I don't have Meta glasses",
    gl_mark_1: "The switch, inside the left arm. Slide it forward to turn them on.", gl_mark_2: "The button, on top of the right arm. Press it once to take a photo.",
    gl_mark_3: "The touch strip, on the side of the right arm. Tap to pause, slide to change the volume.",
    gl_sound_title: "Test the sound", gl_sound_play: "Play a test sentence", gl_sound_sentence: "Hello, this is Prudence. If you hear me in your glasses, you are ready.",
    gl_sound_q: "Did you hear it in your glasses?", gl_sound_yes: "Yes, in my glasses", gl_sound_no: "No, it came from the phone",
    gl_sound_help: "Open your phone's Bluetooth settings, choose your glasses, then try again.", gl_ready_title: "Your glasses are ready",
    gl_title: "Your Meta glasses", gl_talk: "Someone is talking to me", gl_talk_sub: "Prudence listens. The answer comes in your glasses.",
    gl_look: "Show Prudence a letter or a screen", gl_look_sub: "Take a photo with your glasses.", gl_how: "How do my glasses work?",
    gl_look_1: "Look at the letter or the screen. Hold still.", gl_look_2: "Press the button on top of the right arm once. Or say: Hey Meta, take a photo.",
    gl_look_3: "Open the Meta AI app, so the photo reaches your phone.", gl_look_choose: "Choose my photo", gl_free: "Without touching your phone",
    gl_listen_lead: "The phone hears the person in front of you. Keep it in your hand or on the table. The answer comes in your glasses.",
    gl_listen_start: "Start listening", gl_listen_calls: "It cannot hear a phone call on this phone.",
    gl_open: "An assistant is listening to help me. No recording is kept.", gl_open_say: "Say this out loud.", gl_speak_tell: "Prudence is listening. Tell them.",
    gl_ask: "What do they want?", gl_thinking: "Prudence is thinking…", gl_keep: "Keep listening",
    gl_nobody: "Prudence has not heard anyone yet. Wait until they have spoken, then tap again.", gl_stopped: "Prudence stopped listening.",
    onb_glasses_q: "Do you have Meta glasses?", onb_glasses_yes: "Yes", onb_glasses_no: "No",
  })) assert.equal(en[key], words, key);
  const keys = Object.keys(en).filter((k) => /^(gl_|onb_glasses_|ck_glasses|score_glasses)/.test(k));
  assert.ok(keys.length > 50);
  for (const k of keys) {
    assert.ok(STRINGS.fr[k]?.trim(), `fr.${k}`);
    if (!/^(onb_glasses_no)$/.test(k)) assert.notEqual(STRINGS.fr[k], en[k], `fr.${k} is translated`);
  }
  // Said aloud to the other person: true, since the verdict is kept like any check (review round 1).
  assert.equal(STRINGS.fr.gl_open, "Un assistant m'écoute pour m'aider. Aucun enregistrement n'est gardé.");
  for (const lang of ["en", "fr"]) {
    assert.doesNotMatch(STRINGS[lang].gl_open, /Nothing is kept|Rien n'est gardé/, `${lang}: never the old promise`);
  }
});

test("Listen is readable: the sentence, the buttons and the bar pass AA with the app's real colours", () => {
  const css = readFileSync(new URL("../public/styles.css", import.meta.url), "utf8");
  const token = (name) => css.match(new RegExp(`--${name}:\\s*(#[0-9a-f]{6})`, "i"))[1];
  const lum = (hex) => {
    const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255).map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
    return 0.2126 * r + 0.7152 * g + 0.0722 * b;
  };
  const ratio = (a, b) => { const [hi, lo] = [lum(a), lum(b)].sort((x, y) => y - x); return (hi + 0.05) / (lo + 0.05); };
  assert.ok(ratio(token("surface"), token("navy")) >= 7, "the big sentence, white on navy");
  assert.ok(ratio(token("navy"), token("line")) >= 3, "the bar, navy on grey");
  assert.ok(ratio(token("navy"), token("gold")) >= 4.5, "the gold button's navy words");
  assert.ok(ratio(token("navy"), token("navy-wash")) >= 4.5, "Prudence stopped listening, navy on its wash");
  assert.match(css, /\.gl-sentence \{[^}]*background: var\(--navy\);[^}]*color: var\(--surface\);[^}]*font-size: var\(--t32\)/s);
  assert.match(css, /prefers-reduced-motion: no-preference\) \{\s*\.gl-level-bar/, "the bar's movement is smoothed only for someone who allows motion");
});

// ------------------------------------------------------------------- the ring --
const samples = (n, value = 0.5) => new Float32Array(n).fill(value);

test("only the last 45 seconds exist", () => {
  assert.equal(LISTEN_SECONDS, 45);
  const ring = createRing(1000);
  assert.equal(ring.capacity, 45000);
  assert.equal(ring.seconds, 0);
  for (let i = 0; i < 60; i++) ring.push(new Float32Array(1000).fill(i));
  assert.equal(ring.seconds, 45, "a full minute heard, 45 seconds kept");
  const kept = ring.read();
  assert.equal(kept.length, 45000);
  assert.equal(kept[0], 15, "the oldest second kept is second 15");
  assert.equal(kept.at(-1), 59, "the newest comes last");
  for (let i = 1; i < kept.length; i++) assert.ok(kept[i] >= kept[i - 1], "in the order heard");
});

test("the ring: a short listen reads as it was heard; a frame longer than the ring keeps its end; clear leaves nothing", () => {
  const ring = createRing(10, 1);
  ring.push(Float32Array.of(1, 2, 3));
  assert.deepEqual([...ring.read()], [1, 2, 3]);
  assert.equal(ring.seconds, 0.3);
  ring.push(Float32Array.from({ length: 25 }, (_, i) => i));
  assert.deepEqual([...ring.read()], [15, 16, 17, 18, 19, 20, 21, 22, 23, 24]);
  ring.push(Float32Array.of(99));
  assert.deepEqual([...ring.read()], [16, 17, 18, 19, 20, 21, 22, 23, 24, 99]);
  assert.equal(ring.empty(), false);
  ring.clear();
  assert.equal(ring.empty(), true, "every sample zeroed");
  assert.equal(ring.seconds, 0);
  assert.deepEqual([...ring.read()], []);
});

test("resample: 48 kHz and 44.1 kHz down to 16 kHz keep the length in time and the sound's level; up works too", () => {
  for (const rate of [48000, 44100]) {
    const out = resample(samples(rate), rate);
    assert.equal(out.length, 16000, `${rate}: one second stays one second`);
    assert.ok(out.every((v) => Math.abs(v - 0.5) < 1e-6), `${rate}: level kept`);
  }
  const same = samples(10);
  assert.equal(resample(same, 16000), same, "already 16 kHz: untouched");
  const up = resample(Float32Array.of(0, 1, 0, 1), 8000);
  assert.equal(up.length, 8);
  assert.deepEqual([...up.slice(0, 3)], [0, 0.5, 1]);
  assert.equal(resample(new Float32Array(0), 48000).length, 0);
});

test("the WAV is what the server accepts: 16 kHz, mono, 16-bit PCM", () => {
  const seconds = 3;
  const check = inspectWav(Buffer.from(encodeWav(resample(samples(48000 * seconds), 48000))));
  assert.equal(check.ok, true, JSON.stringify(check));
  assert.deepEqual([check.seconds, check.sampleRate, check.channels, check.bitsPerSample], [seconds, 16000, 1, 16]);
  const loud = new DataView(encodeWav(Float32Array.of(2, -2, 0)));
  assert.deepEqual([loud.getInt16(44, true), loud.getInt16(46, true), loud.getInt16(48, true)], [32767, -32768, 0], "too loud is cut, never wrapped");
  const full = inspectWav(Buffer.from(encodeWav(resample(samples(48000 * LISTEN_SECONDS), 48000))));
  assert.equal(full.ok, true);
  assert.ok(full.dataBytes < 8 * 1024 * 1024, "45 seconds is far under the 8 MB upload limit");
});

// ---------------------------------------------------------- which microphone --
const input = (deviceId, label) => ({ kind: "audioinput", deviceId, label });
const IPHONE = [input("a", "iPhone Microphone"), input("b", "Ray-Ban Meta 0123")];
const ANDROID = [input("default", "Default"), input("communications", "Communications"), input("h", "Headset earpiece"), input("s", "Speakerphone"), input("bt", "Bluetooth headset (Ray-Ban Meta)")];

test("the glasses' microphone is passed over when the phone has its own", () => {
  for (const label of ["Ray-Ban Meta 0123", "Meta glasses", "Bluetooth headset", "AirPods Pro", "Hands-Free device", "Headset earpiece", "Galaxy Buds wireless"]) assert.ok(isBluetoothMic(label), label);
  for (const label of ["iPhone Microphone", "Speakerphone", "Default", "Built-in Microphone", "Metal case mic", ""]) assert.ok(!isBluetoothMic(label), label);
  assert.equal(pickPhoneMic(IPHONE).deviceId, "a");
  assert.equal(pickPhoneMic(ANDROID).deviceId, "s", "a named microphone before Default, which may follow the glasses");
  assert.equal(pickPhoneMic([input("default", "Default"), input("bt", "Ray-Ban Meta")]).deviceId, "default");
  assert.equal(pickPhoneMic([input("bt", "Ray-Ban Meta")]), null, "only the glasses: nothing else to choose");
  assert.equal(pickPhoneMic([input("x", "")]), null, "no labels: it cannot tell");
  assert.equal(pickPhoneMic([{ kind: "audiooutput", deviceId: "o", label: "Speaker" }]), null, "an output is no microphone");
  assert.equal(pickPhoneMic(undefined), null);
});

test("the microphone changes only when something Bluetooth is around", () => {
  assert.equal(phoneMicId(IPHONE, "Ray-Ban Meta 0123"), "a", "the browser took the glasses: use the phone");
  assert.equal(phoneMicId(ANDROID, "Default"), "s", "Default may follow the glasses when they are connected");
  assert.equal(phoneMicId([input("a", "iPhone Microphone")], "iPhone Microphone"), null, "no glasses: leave it");
  assert.equal(phoneMicId([input("bt", "Ray-Ban Meta")], "Ray-Ban Meta"), null, "only the glasses: better than nothing");
  assert.equal(phoneMicId(undefined), null);
});

test("what goes wrong with the microphone: none (no button), denied (how to allow it) or failed (another app may hold it)", () => {
  assert.equal(micProblem({ code: "no_mic" }), "none");
  assert.equal(micProblem({ name: "NotFoundError" }), "none");
  for (const name of ["NotAllowedError", "SecurityError"]) assert.equal(micProblem({ name }), "denied", name);
  for (const name of ["NotReadableError", "AbortError", "OverconstrainedError", "TypeError", undefined]) assert.equal(micProblem({ name }), "failed", String(name));
  assert.equal(micProblem(undefined), "failed");
  assert.equal(STRINGS.en.gl_mic_failed, "Prudence could not use the microphone. Close any other app using it, then try again.");
  assert.equal(STRINGS.fr.gl_mic_failed, "Prudence n'a pas pu utiliser le micro. Fermez toute autre application qui l'utilise, puis réessayez.");
  assert.doesNotMatch(STRINGS.en.gl_mic_failed, /settings/i, "not the refusal's advice");
});

// ---------------------------------------------------------------- the listener --
// A fake browser: tracks that know when they stopped, a clock of frames.
function fakeBrowser({ devices = IPHONE, label = "iPhone Microphone", deny = null, rate = 48000, slow = false } = {}) {
  const log = [];
  const tracks = [];
  const streams = [];
  const contexts = [];
  const pending = [];
  class FakeContext {
    constructor() { this.sampleRate = rate; this.destination = {}; this.state = "suspended"; contexts.push(this); log.push("context"); }
    resume() { this.state = "running"; log.push("resume"); return Promise.resolve(); }
    close() { this.state = "closed"; log.push("close"); return Promise.resolve(); }
    createMediaStreamSource() { return { connect() {}, disconnect() { log.push("source off"); } }; }
    createScriptProcessor() { const p = { connect() {}, disconnect() { log.push("processor off"); }, onaudioprocess: null }; this.processor = p; log.push("processor"); return p; }
  }
  const navigator = {
    mediaDevices: {
      async getUserMedia(constraints) {
        log.push(`mic ${JSON.stringify(constraints.audio)}`);
        if (deny) throw deny;
        // slow: after the first ask, the microphone arrives only when the test lets it (a busy phone).
        if (slow && tracks.length) await new Promise((resolve) => pending.push(resolve));
        const track = { label, readyState: "live", onended: null, onmute: null, stop() { this.readyState = "ended"; log.push("track stop"); } };
        tracks.push(track);
        const stream = { getTracks: () => [track], getAudioTracks: () => [track] };
        streams.push(stream);
        return stream;
      },
      enumerateDevices: async () => devices,
    },
  };
  const hear = (seconds, value = 0.25) => {
    const processor = contexts.at(-1).processor;
    const frame = new Float32Array(4096).fill(value);
    for (let left = seconds * rate; left > 0; left -= frame.length) processor.onaudioprocess?.({ inputBuffer: { getChannelData: () => frame } });
  };
  const arrive = () => { while (pending.length) pending.shift()(); };
  const live = () => tracks.filter((tr) => tr.readyState === "live").length;
  return { env: { AudioContext: FakeContext, navigator }, log, tracks, contexts, hear, arrive, live };
}

// The page around it: whether it is hidden, its pagehide, the screen's wake lock.
function fakePage(b, { wakeLock = true, slowLock = false } = {}) {
  const on = (target) => {
    const handlers = {};
    target.addEventListener = (type, fn) => { (handlers[type] ||= new Set()).add(fn); };
    target.removeEventListener = (type, fn) => { handlers[type]?.delete(fn); };
    target.fire = (type) => { for (const fn of [...(handlers[type] || [])]) fn({ type }); };
    target.count = (type) => handlers[type]?.size || 0;
    return target;
  };
  const document = on({ visibilityState: "visible" });
  const locks = [];
  const waiting = [];
  if (wakeLock) b.env.navigator.wakeLock = {
    request: async () => {
      if (slowLock) await new Promise((resolve) => waiting.push(resolve));
      const lock = { released: false, release() { this.released = true; return Promise.resolve(); } };
      locks.push(lock);
      return lock;
    },
  };
  const env = on(Object.assign(b.env, { document }));
  const hide = () => { document.visibilityState = "hidden"; document.fire("visibilitychange"); };
  const show = () => { document.visibilityState = "visible"; document.fire("visibilitychange"); };
  const held = () => locks.filter((l) => !l.released).length;
  const grant = () => { while (waiting.length) waiting.shift()(); };
  return { env, document, hide, show, locks, held, grant };
}
const tick = () => new Promise((resolve) => setImmediate(resolve));

test("Start: the context resumes inside the tap, the microphone is asked once then let go, and nothing is captured before start()", async () => {
  const b = fakeBrowser();
  const l = createListener({ env: b.env });
  const asked = l.prepare();
  assert.deepEqual(b.log.slice(0, 3), ["context", "resume", "mic true"], "all before the first await");
  await asked;
  assert.equal(b.tracks.length, 1);
  assert.equal(b.tracks[0].readyState, "ended", "let go before anything is said");
  assert.equal(l.live(), false);
  assert.equal(l.capturedSeconds(), 0, "nothing captured");
  assert.ok(!b.log.includes("processor"), "nothing runs yet");
  await l.start();
  assert.equal(l.live(), true);
  b.hear(3);
  assert.ok(Math.abs(l.capturedSeconds() - 3) < 0.1);
  l.destroy();
});

test("the phone's own microphone is asked for when the glasses are connected", async () => {
  const b = fakeBrowser({ label: "Ray-Ban Meta 0123" });
  const l = createListener({ env: b.env });
  await l.prepare();
  await l.start();
  assert.ok(b.log.includes('mic {"deviceId":{"exact":"a"}}'), b.log.join(", "));
  l.destroy();
});

test("a chosen microphone that went away falls back on the system's; a refusal stays a refusal", async () => {
  const b = fakeBrowser({ label: "Ray-Ban Meta 0123" });
  const l = createListener({ env: b.env });
  await l.prepare();
  const real = b.env.navigator.mediaDevices.getUserMedia;
  let first = true;
  b.env.navigator.mediaDevices.getUserMedia = async (c) => {
    if (first) { first = false; throw Object.assign(new Error("gone"), { name: "OverconstrainedError" }); }
    return real(c);
  };
  assert.equal(await l.start(), true);
  assert.equal(l.live(), true);
  l.destroy();

  const b2 = fakeBrowser({ label: "Ray-Ban Meta 0123" });
  const l2 = createListener({ env: b2.env });
  await l2.prepare();
  b2.env.navigator.mediaDevices.getUserMedia = async () => { throw Object.assign(new Error("no"), { name: "NotAllowedError" }); };
  await assert.rejects(l2.start(), { name: "NotAllowedError" });
  l2.destroy();
});

test("a refused microphone, and a browser with none, say why", async () => {
  const refused = createListener({ env: fakeBrowser({ deny: Object.assign(new Error("no"), { name: "NotAllowedError" }) }).env });
  await assert.rejects(refused.prepare(), (e) => micProblem(e) === "denied");
  refused.destroy();
  await assert.rejects(createListener({ env: {} }).prepare(), (e) => micProblem(e) === "none");
  await assert.rejects(createListener({ env: { AudioContext: class {}, navigator: {} } }).prepare(), (e) => micProblem(e) === "none");
});

test("What do they want?: the microphone goes off first, and the seconds heard become a WAV the server accepts", async () => {
  const b = fakeBrowser();
  const l = createListener({ env: b.env });
  await l.prepare();
  await l.start();
  b.hear(5);
  assert.ok(l.capturedSeconds() >= MIN_SECONDS);
  l.release();
  assert.equal(l.live(), false);
  assert.ok(b.tracks.every((tr) => tr.readyState === "ended"), "no track live");
  const wav = l.takeWav();
  assert.equal(wav.type, "audio/wav");
  const check = inspectWav(Buffer.from(await wav.arrayBuffer()));
  assert.equal(check.ok, true, JSON.stringify(check));
  assert.ok(Math.abs(check.seconds - 5) < 0.2, String(check.seconds));
  // Keep listening: the same session opens the microphone again, on a clean ring.
  l.clear();
  assert.equal(l.capturedSeconds(), 0);
  await l.start();
  assert.equal(l.live(), true);
  b.hear(1);
  assert.ok(l.capturedSeconds() > 0.9 && l.capturedSeconds() < 1.1);
  l.destroy();
});

test("Stop: no track live, the audio closed, nothing left to read, and a late microphone is let go", async () => {
  const b = fakeBrowser();
  const l = createListener({ env: b.env });
  await l.prepare();
  await l.start();
  b.hear(2);
  l.destroy();
  assert.ok(b.tracks.every((tr) => tr.readyState === "ended"), "no track live");
  assert.equal(l.live(), false);
  assert.equal(l.capturedSeconds(), 0, "the audio is gone");
  assert.equal(b.contexts[0].state, "closed");
  assert.equal(b.contexts[0].processor.onaudioprocess, null, "nothing runs any more");

  const slow = fakeBrowser();
  const late = createListener({ env: slow.env });
  await late.prepare();
  const opening = late.start();
  late.destroy();
  assert.equal(await opening, false, "destroyed while the microphone was opening");
  assert.ok(slow.tracks.every((tr) => tr.readyState === "ended"), "the microphone that arrived late was let go");
  assert.equal(await late.start(), false, "and it never reopens");
});

test("the level moves at most ten times a second, from 0 to 1, and the end of a track is told once", async () => {
  const b = fakeBrowser();
  const levels = [];
  let ended = 0;
  const realNow = Date.now;
  let now = 1000;
  Date.now = () => now;
  try {
    const l = createListener({ env: b.env, onLevel: (v) => levels.push(v), onEnded: () => { ended++; } });
    await l.prepare();
    await l.start();
    const processor = b.contexts[0].processor;
    const frame = (value) => ({ inputBuffer: { getChannelData: () => new Float32Array(512).fill(value) } });
    for (let i = 0; i < 10; i++) { now += 10; processor.onaudioprocess(frame(0.05)); }
    assert.ok(levels.length <= 1, "10 frames in 100 ms: at most one update");
    now += 200;
    processor.onaudioprocess(frame(1));
    assert.equal(levels.at(-1), 1, "capped at 1");
    now += 200;
    processor.onaudioprocess(frame(0));
    assert.equal(levels.at(-1), 0);
    b.tracks.at(-1).onended();
    assert.equal(ended, 1);
    l.destroy();
    assert.equal(b.tracks.at(-1).onended, null, "stopped by us: not told");
  } finally { Date.now = realNow; }
});

// -------------------------------------------------------------- review round 1 --
test("a microphone still being opened when it is let go is closed the moment it arrives, never kept open", async () => {
  const b = fakeBrowser({ slow: true });
  const l = createListener({ env: b.env });
  await l.prepare();
  const opening = l.start(); // after "Prudence has not heard anyone", it listens again...
  await tick();
  l.release(); // ...and she taps "What do they want?" before the microphone has come
  b.arrive();
  assert.equal(await opening, false, "not started");
  assert.equal(b.live(), 0, "the late microphone was let go");
  assert.equal(l.live(), false);
  assert.equal(b.contexts[0].processor, undefined, "nothing was wired to it");
  // The next start is a new one, and works.
  const again = l.start();
  await tick();
  b.arrive();
  assert.equal(await again, true);
  assert.equal(b.live(), 1);
  l.destroy();
});

test("a call or Siri taking the microphone ends the listening: a muted track, an interrupted audio, an ended track; not once it is let go", async () => {
  for (const how of ["mute", "interrupted", "ended"]) {
    const b = fakeBrowser();
    const page = fakePage(b);
    const stops = [];
    const session = createSession({ env: page.env, onStop: (why) => stops.push(why) });
    await session.prepare();
    assert.equal(await session.capture(), true);
    await tick();
    b.hear(3);
    const track = b.tracks.at(-1);
    if (how === "mute") track.onmute();
    if (how === "ended") track.onended();
    if (how === "interrupted") { b.contexts[0].state = "interrupted"; b.contexts[0].onstatechange(); }
    assert.deepEqual(stops, ["interrupted"], how);
    assert.equal(session.over, true, `${how}: the session is over`);
    assert.equal(b.live(), 0, `${how}: no track live`);
    assert.equal(session.capturedSeconds(), 0, `${how}: the stale audio is gone, never judged`);
    assert.equal(page.held(), 0, `${how}: the screen may sleep`);
  }
  // After "What do they want?" the microphone is off already: nothing to stop.
  const b = fakeBrowser();
  const page = fakePage(b);
  const stops = [];
  const session = createSession({ env: page.env, onStop: (why) => stops.push(why) });
  await session.prepare();
  await session.capture();
  const track = b.tracks.at(-1);
  session.release();
  assert.equal(track.onmute, null, "a released track tells nothing");
  b.contexts[0].state = "interrupted";
  b.contexts[0].onstatechange();
  assert.deepEqual(stops, [], "interrupted while Prudence thinks: the answer still comes");
  session.end();
});

test("hiding the page while it listens ends it; once the microphone is let go, hiding changes nothing and the answer still comes", async () => {
  const b = fakeBrowser();
  const page = fakePage(b);
  const stops = [];
  const session = createSession({ env: page.env, onStop: (why) => stops.push(why) });
  await session.prepare();
  await session.capture();
  page.hide();
  assert.deepEqual(stops, ["hidden"]);
  assert.equal(b.live(), 0, "no capture in the background");
  assert.equal(page.document.count("visibilitychange"), 0, "nothing left listening to the page");

  const b2 = fakeBrowser();
  const page2 = fakePage(b2);
  const stops2 = [];
  const thinking = createSession({ env: page2.env, onStop: (why) => stops2.push(why) });
  await thinking.prepare();
  await thinking.capture();
  b2.hear(5);
  thinking.release(); // "What do they want?": Prudence is thinking
  const wav = thinking.takeWav();
  page2.hide(); // she locks the phone
  assert.deepEqual(stops2, [], "the check is not stopped");
  assert.equal(thinking.over, false);
  assert.ok(wav.size > 44, "the seconds she sent are still there to send");
  page2.show();
  thinking.end();
});

test("the microphone is never opened on a hidden page: the session ends instead, back to Prudence stopped listening", async () => {
  // Hidden while Prudence was thinking, the answer is "nobody spoke": it would listen again.
  const b = fakeBrowser();
  const page = fakePage(b);
  const stops = [];
  const session = createSession({ env: page.env, onStop: (why) => stops.push(why) });
  await session.prepare();
  await session.capture();
  session.release();
  page.hide();
  const asked = b.log.filter((line) => line.startsWith("mic ")).length;
  assert.equal(await session.capture(), false);
  assert.deepEqual(stops, ["hidden"]);
  assert.equal(b.log.filter((line) => line.startsWith("mic ")).length, asked, "the microphone was not even asked for");
  assert.equal(b.live(), 0);
  assert.equal(session.over, true);
  assert.equal(await session.capture(), false, "and never reopens");

  // Hidden while the microphone is still being opened: it is let go when it arrives.
  const b2 = fakeBrowser({ slow: true });
  const page2 = fakePage(b2);
  const stops2 = [];
  const opening = createSession({ env: page2.env, onStop: (why) => stops2.push(why) });
  await opening.prepare();
  const started = opening.capture();
  await tick();
  page2.hide();
  b2.arrive();
  assert.equal(await started, false);
  assert.deepEqual(stops2, ["hidden"]);
  assert.equal(b2.live(), 0);
});

test("the page closing ends it at any moment; Stop and another screen end it without a word", async () => {
  const b = fakeBrowser();
  const page = fakePage(b);
  const stops = [];
  const session = createSession({ env: page.env, onStop: (why) => stops.push(why) });
  await session.prepare();
  await session.capture();
  page.env.fire("pagehide");
  assert.deepEqual(stops, ["left"]);
  assert.equal(b.live(), 0);
  assert.equal(page.env.count("pagehide"), 0, "nothing left listening to the page");
  session.end();
  assert.deepEqual(stops, ["left"], "told once");
  const quiet = createSession({ env: fakePage(fakeBrowser()).env, onStop: () => stops.push("quiet") });
  quiet.end();
  assert.deepEqual(stops, ["left"]);
});

test("the screen is kept awake only while the microphone is open: let go on the verdict, taken again with Keep listening", async () => {
  const b = fakeBrowser();
  const page = fakePage(b);
  const session = createSession({ env: page.env });
  await session.prepare();
  assert.equal(page.held(), 0, "not before it listens");
  await session.capture();
  await tick();
  assert.equal(page.held(), 1);
  assert.equal(session.awake, true);
  session.release(); // "What do they want?": thinking, then the verdict or a failure
  assert.equal(page.held(), 0, "released with the microphone");
  assert.equal(session.awake, false);
  await session.capture(); // "Keep listening", or nobody heard
  await tick();
  assert.equal(page.held(), 1, "taken again");
  session.end();
  assert.equal(page.held(), 0);

  // A lock that arrives after the microphone was let go is given back at once.
  const b2 = fakeBrowser();
  const page2 = fakePage(b2, { slowLock: true });
  const late = createSession({ env: page2.env });
  await late.prepare();
  await late.capture();
  late.release();
  page2.grant();
  await tick();
  assert.equal(page2.locks.length, 1);
  assert.equal(page2.held(), 0, "given back");
  late.end();

  // No wake lock in this browser: it listens anyway.
  const plain = createSession({ env: fakePage(fakeBrowser(), { wakeLock: false }).env });
  await plain.prepare();
  assert.equal(await plain.capture(), true);
  plain.end();
});

// A browser that speaks, for Look's answer: what it says, what it cancels.
function fakeSpeech() {
  const said = [];
  let cancelled = 0;
  const handlers = {};
  const win = {
    speechSynthesis: { speak: (u) => said.push(u.text), cancel: () => { cancelled++; } },
    addEventListener: (type, fn) => { (handlers[type] ||= new Set()).add(fn); },
    removeEventListener: (type, fn) => { handlers[type]?.delete(fn); },
  };
  const saved = { window: globalThis.window, speechSynthesis: globalThis.speechSynthesis, SpeechSynthesisUtterance: globalThis.SpeechSynthesisUtterance };
  globalThis.window = win;
  globalThis.speechSynthesis = win.speechSynthesis;
  globalThis.SpeechSynthesisUtterance = class { constructor(text) { this.text = text; } };
  return {
    said, cancelled: () => cancelled,
    navigate: () => { for (const fn of [...(handlers.hashchange || [])]) fn({ type: "hashchange" }); },
    listening: () => handlers.hashchange?.size || 0,
    restore: () => { for (const [k, v] of Object.entries(saved)) { if (v === undefined) delete globalThis[k]; else globalThis[k] = v; } },
  };
}

test("Look's answer stops when she leaves the screen, and when a new photo is sent: a new screen never keeps reading the last one", async () => {
  const sp = fakeSpeech();
  try {
    const job = lookJob({ name: "letter.png" }, () => {});
    assert.equal(job.backHref, "#/check/glasses");
    job.afterVerdict({ headline: "Scam: a fake Medicare notice.", action_text: "Do not call the number.", language: "en" });
    assert.deepEqual(sp.said, ["Scam: a fake Medicare notice. Do not call the number."]);
    const before = sp.cancelled();
    sp.navigate(); // Back, a tab, any other screen
    assert.ok(sp.cancelled() > before, "silenced on leaving");
    assert.equal(sp.listening(), 0, "and the listener is gone with it");

    sayHere("An earlier answer", "en");
    const second = lookJob({ name: "screen.png" }, () => {});
    const now = sp.cancelled();
    await second.send(new AbortController().signal).catch(() => {}); // no canvas under Node: the picture fails after the hush
    assert.ok(sp.cancelled() > now, "a new photo silences the last answer before it is sent");
    hush();
    assert.equal(sp.listening(), 0);
  } finally { sp.restore(); }
});

test("a conversation heard on the glasses screen does not count as a voice message checked", () => {
  const voice = (checks) => scoreOf({ status: null, devices: [], guardians: [], progress: null, checks }).on;
  assert.equal(voice([{ id: "c1", channel: "conversation", verdict_value: "be_careful" }]), 0);
  assert.equal(voice([{ id: "c2", channel: "voice", verdict_value: "be_careful" }]), 1);
});

test("Ask from a Listen verdict shows the speaker without empty brackets; an address keeps its brackets", () => {
  const v = { headline: "Be careful: cash today.", reasons: [{ text: "Pressure to pay <now>." }] };
  const face = askPreviewHtml({ fromName: "Person speaking face to face", from: "", subject: "" }, v);
  assert.match(face, /<p class="mail-meta">Person speaking face to face<\/p>/);
  assert.doesNotMatch(face, /&lt;&gt;|&lt;\s*&gt;/, "no empty brackets");
  assert.match(face, /Pressure to pay &lt;now&gt;\./, "escaped");
  const mail = askPreviewHtml({ fromName: "Chase", from: "alerts@chase.test", subject: "Your card" }, v);
  assert.match(mail, /Chase &lt;alerts@chase\.test&gt;/);
  assert.match(mail, /<strong>Your card<\/strong>/);
  assert.doesNotMatch(askPreviewHtml({}, v), /mail-meta/, "nobody to name: no line");
});
