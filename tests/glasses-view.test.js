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
import { LISTEN_SECONDS, MIN_SECONDS, createListener, createRing, encodeWav, isBluetoothMic, micProblem, phoneMicId, pickPhoneMic, resample } from "../public/js/listen.js";
import { glassesDrawing, handsFreeHtml, spokenAnswer } from "../public/js/views/glasses.js";

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
    gl_open: "An assistant is listening to help me. Nothing is kept.", gl_open_say: "Say this out loud.", gl_speak_tell: "Prudence is listening. Tell them.",
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

test("what goes wrong with the microphone: none (no button) or denied (Try again)", () => {
  assert.equal(micProblem({ code: "no_mic" }), "none");
  assert.equal(micProblem({ name: "NotFoundError" }), "none");
  for (const name of ["NotAllowedError", "SecurityError", "NotReadableError", "AbortError"]) assert.equal(micProblem({ name }), "denied", name);
});

// ---------------------------------------------------------------- the listener --
// A fake browser: tracks that know when they stopped, a clock of frames.
function fakeBrowser({ devices = IPHONE, label = "iPhone Microphone", deny = null, rate = 48000 } = {}) {
  const log = [];
  const tracks = [];
  const streams = [];
  const contexts = [];
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
        const track = { label, readyState: "live", onended: null, stop() { this.readyState = "ended"; log.push("track stop"); } };
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
  return { env: { AudioContext: FakeContext, navigator }, log, tracks, contexts, hear };
}

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
