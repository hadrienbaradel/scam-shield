// Meta glasses on Check (_product/specs/check-glasses.md; canvas:
// https://claude.ai/artifact/Bgzi1ykwujbxyGiPGA8ZUm). Nothing to install: the
// web app on the phone, the glasses as camera and headphones.
//
// One export draws every glasses route (js/main.js, DRAW):
//
//   renderGlassesScreen(root, status, { step, refresh }) -> void
//     step "home"    #/check/glasses         line 6: the two choices, "How do
//                                            my glasses work?"
//          "setup"   #/check/glasses/setup   lines 3 to 5, one thing per screen,
//                                            drawn in place: the drawing, Test
//                                            the sound, Your glasses are ready
//          "look"    #/check/glasses/look    lines 7 and 8
//          "listen"  #/check/glasses/listen  lines 9 to 15
//     status is /api/status; refresh is main.js's: after a saved answer it
//     reloads the status without redrawing this screen.
//
// A check runs through check.js's run(), as on Check; only its job differs.
// Listen keeps one session (js/listen.js createSession): every way out (Stop,
// another screen, the phone going to sleep while it listens, a new draw) ends
// it, and with it the microphone and the audio. What Prudence says belongs to
// the screen that said it: leaving it, or a new photo, silences it.
//
// Pure helpers, tested in tests/glasses-view.test.js:
//   spokenAnswer(verdict)    what Prudence says in the ear: at most two sentences
//   glassesDrawing()         the drawing, decorative: its words are real text under it
//   handsFreeHtml(status)    "Without touching your phone", or nothing
//   sayHere(text, lang), hush()  speech that stops when the screen changes
//   lookJob(file, back)      Look's check: silences the last answer, says the new one
//
// Styles: "2026-11-04 Meta glasses" at the end of styles.css.

import { api } from "../api.js";
import { t, getLang } from "../i18n.js";
import { $, esc, icon, speak, unlockSpeech, toast, focusHeading } from "../ui.js";
import { handsFreeWays } from "../protects.js";
import { createSession, micProblem, MIN_SECONDS } from "../listen.js";
import { backLink, problemBox, showProblem, run, pictureJob, stopCheck } from "./check.js";

const TO_GLASSES = Object.freeze({ backHref: "#/check/glasses", backKey: "gl_title" });
// How long the sentence before listening may take; Safari on iPhone sometimes
// never says it has ended.
const SPEAK_FALLBACK_MS = 6000;
// The microphone has just let go of the audio route: speech waits a moment.
const AFTER_MIC_MS = 300;

// ---------------------------------------------------------------- the words --
const noEndStop = (s) => String(s || "").trim().replace(/[.!?…\s]+$/, "");

// The verdict in the ear: the headline, then the one next step. Never the
// reasons: at most two short sentences (line 12).
export function spokenAnswer(v) {
  const headline = noEndStop(v?.headline);
  return headline
    ? `${headline}. ${String(v?.action_text || "").trim()}`.trim()
    : `${noEndStop(t("v2_unknown_title"))}. ${t("v2_unknown_note")}`;
}

// The glasses from behind, as you put them on, so the left arm is on the left.
// The strip is dashed: it is on the outer side. Decorative: the three
// sentences under it say the same in text that follows the person's size.
export function glassesDrawing() {
  return `<svg class="gl-drawing" viewBox="0 0 358 160" aria-hidden="true" focusable="false" fill="none" stroke="#16283f" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
        <path fill="#ffffff" d="M106 84H30C18 84 10 92 6 112C5 118 12 120 14 114C18 104 24 100 32 100H106Z"/>
        <path fill="#ffffff" d="M252 84H328C340 84 348 92 352 112C353 118 346 120 344 114C340 104 334 100 326 100H252Z"/>
        <rect fill="#eef4fb" x="104" y="76" width="68" height="56" rx="14"/>
        <rect fill="#eef4fb" x="186" y="76" width="68" height="56" rx="14"/>
        <path d="M172 92C176 86 182 86 186 92"/>
        <rect fill="#16283f" x="72" y="88" width="24" height="8" rx="4"/>
        <circle fill="#e9a820" stroke="none" cx="88" cy="92" r="3"/>
        <rect fill="#e9a820" x="262" y="77" width="22" height="8" rx="3"/>
        <rect fill="#fdf4dd" x="292" y="88" width="38" height="8" rx="4" stroke-dasharray="4 4"/>
        <path stroke-width="2" d="M84 46V86"/>
        <path stroke-width="2" d="M273 46V75"/>
        <path stroke-width="2" d="M320 46V86"/>
        <circle fill="#16283f" stroke="none" cx="84" cy="30" r="16"/>
        <circle fill="#16283f" stroke="none" cx="273" cy="30" r="16"/>
        <circle fill="#16283f" stroke="none" cx="320" cy="30" r="16"/>
        <text stroke="none" fill="#ffffff" font-size="19" font-weight="700" text-anchor="middle" x="84" y="36.5">1</text>
        <text stroke="none" fill="#ffffff" font-size="19" font-weight="700" text-anchor="middle" x="273" y="36.5">2</text>
        <text stroke="none" fill="#ffffff" font-size="19" font-weight="700" text-anchor="middle" x="320" y="36.5">3</text>
        <text stroke="none" fill="#1a1a1a" font-size="19" font-weight="700" text-anchor="start" x="6" y="152">${esc(t("gl_arm_left"))}</text>
        <text stroke="none" fill="#1a1a1a" font-size="19" font-weight="700" text-anchor="end" x="352" y="152">${esc(t("gl_arm_right"))}</text>
      </svg>`;
}

// The two choices of line 6, on the glasses screen and on "ready".
const choices = () => `
      <a class="btn btn-choice is-hero btn-gold" href="#/check/glasses/listen">${icon("mic", 44)}<span class="btn-choice-words"><span class="btn-choice-label">${esc(t("gl_talk"))}</span><span class="btn-choice-sub">${esc(t("gl_talk_sub"))}</span></span></a>
      <a class="btn btn-choice is-hero" href="#/check/glasses/look">${icon("camera", 44)}<span class="btn-choice-words"><span class="btn-choice-label">${esc(t("gl_look"))}</span><span class="btn-choice-sub">${esc(t("gl_look_sub"))}</span></span></a>`;

// Saves the answer about the glasses, then reloads the status. false: not saved
// (the person has been told, and stays where they are).
async function saveGlasses(value, refresh) {
  try {
    await api("/api/me", { method: "PATCH", body: { glasses: value } });
    await refresh?.(false);
    return true;
  } catch {
    toast(t("error_generic"), "danger");
    return false;
  }
}

// ------------------------------------------------------------------ speech --
// A new screen never keeps reading the last one (line 7, and Listen's rule):
// sayHere speaks until the hash changes; hush() stops it now.
let hushOnLeave = null;
export function hush() {
  if (hushOnLeave) { window.removeEventListener("hashchange", hushOnLeave); hushOnLeave = null; }
  if ("speechSynthesis" in window) speechSynthesis.cancel();
}
export function sayHere(text, lang) {
  hush();
  hushOnLeave = () => hush();
  window.addEventListener("hashchange", hushOnLeave);
  speak(text, lang);
}

// ------------------------------------------------------------------- draw --
export function renderGlassesScreen(root, status, { step = "home", refresh } = {}) {
  endSession();
  hush();
  const s = status || {};
  if (step === "setup") drawSetup(root, s, refresh);
  else if (step === "look") drawLook(root, s);
  else if (step === "listen") drawIntro(root, s);
  else drawHome(root);
}

// ------------------------------------------------------------------- home --
function drawHome(root) {
  root.innerHTML = `
    <div class="screen is-snug ck-screen gl-screen">
      ${backLink()}
      <h1 class="screen-title">${esc(t("gl_title"))}</h1>
      ${choices()}
      <a class="btn-link" href="#/check/glasses/setup">${esc(t("gl_how"))}${icon("chevron-right", 22, 2.5)}</a>
    </div>`;
}

// ------------------------------------------------------------------ set up --
function drawSetup(root, status, refresh) {
  root.innerHTML = `
    <div class="screen is-snug ck-screen gl-screen gl-setup">
      ${backLink()}
      <h1 class="screen-title">${esc(t("gl_on_title"))}</h1>
      ${glassesDrawing()}
      <ol class="gl-steps gl-marks">
        <li>${esc(t("gl_mark_1"))}</li>
        <li>${esc(t("gl_mark_2"))}</li>
        <li>${esc(t("gl_mark_3"))}</li>
      </ol>
      <button id="glOn" class="btn btn-gold btn-big" type="button">${esc(t("gl_on_btn"))}</button>
      <button id="glNew" class="btn-link" type="button" aria-expanded="false" aria-controls="glNewSteps">${esc(t("gl_new"))}</button>
      <ol id="glNewSteps" class="gl-steps" hidden>
        <li>${esc(t("gl_new_1"))}</li>
        <li>${esc(t("gl_new_2"))}</li>
        <li>${esc(t("gl_new_3"))}</li>
      </ol>
      <button id="glNone" class="btn-link" type="button">${esc(t("gl_none"))}</button>
    </div>`;
  $("#glOn", root).addEventListener("click", async () => {
    // "They are on" means there is a pair; one already tested stays tested.
    if (status.user?.glasses !== "ready" && !(await saveGlasses("have", refresh))) return;
    drawSound(root, status, refresh);
    focusHeading(root);
  });
  const fold = $("#glNew", root);
  fold.addEventListener("click", () => {
    const steps = $("#glNewSteps", root);
    steps.hidden = !steps.hidden;
    fold.setAttribute("aria-expanded", String(!steps.hidden));
  });
  $("#glNone", root).addEventListener("click", async () => {
    if (await saveGlasses("none", refresh)) location.hash = "#/check";
  });
}

function drawSound(root, status, refresh) {
  if (!("speechSynthesis" in window)) {
    root.innerHTML = `
      <div class="screen is-snug ck-screen gl-screen gl-sound">
        ${backLink()}
        <h1 class="screen-title">${esc(t("gl_sound_title"))}</h1>
        <p class="banner caution ck-problem">${esc(t("gl_no_speech"))}</p>
      </div>`;
    return;
  }
  root.innerHTML = `
    <div class="screen is-snug ck-screen gl-screen gl-sound">
      ${backLink()}
      <h1 class="screen-title">${esc(t("gl_sound_title"))}</h1>
      <button id="glPlay" class="btn btn-gold btn-big" type="button">${icon("speaker", 28)}<span>${esc(t("gl_sound_play"))}</span></button>
      <p id="glSaid" class="gl-said" hidden>${esc(t("gl_sound_sentence"))}</p>
      <div id="glHeard" class="gl-question" hidden>
        <h2 class="section-title" tabindex="-1">${esc(t("gl_sound_q"))}</h2>
        <button id="glYes" class="btn btn-gold btn-big" type="button">${esc(t("gl_sound_yes"))}</button>
        <button id="glNo" class="btn btn-outline btn-big" type="button">${esc(t("gl_sound_no"))}</button>
      </div>
      <div id="glHelp" class="gl-question" hidden>
        <p class="banner caution ck-problem" role="alert" tabindex="-1">${esc(t("gl_sound_help"))}</p>
        <button id="glAgain" class="btn btn-gold btn-big" type="button">${esc(t("retry"))}</button>
      </div>
    </div>`;
  const play = $("#glPlay", root);
  const heard = $("#glHeard", root);
  const help = $("#glHelp", root);
  const playSentence = () => {
    speak(t("gl_sound_sentence"), getLang());
    // The gold moves to "Yes, in my glasses"; the sentence stays written.
    play.classList.replace("btn-gold", "btn-outline");
    play.hidden = false;
    $("#glSaid", root).hidden = false;
    help.hidden = true;
    heard.hidden = false;
    $(".section-title", heard).focus();
  };
  play.addEventListener("click", playSentence);
  $("#glAgain", root).addEventListener("click", playSentence);
  $("#glNo", root).addEventListener("click", () => {
    heard.hidden = true;
    play.hidden = true;
    help.hidden = false;
    $(".banner", help).focus();
  });
  $("#glYes", root).addEventListener("click", async () => {
    if (!(await saveGlasses("ready", refresh))) return;
    drawReady(root);
    focusHeading(root);
  });
}

function drawReady(root) {
  root.innerHTML = `
    <div class="screen is-snug ck-screen gl-screen gl-ready">
      ${backLink()}
      <div class="gl-ready-head">
        <span class="gl-ready-mark" aria-hidden="true">${icon("check", 32, 3)}</span>
        <h1 class="screen-title">${esc(t("gl_ready_title"))}</h1>
      </div>
      ${choices()}
    </div>`;
}

// ------------------------------------------------------------------- look --
export function handsFreeHtml(status) {
  const ways = handsFreeWays(status);
  if (!ways.length) return "";
  return `<section class="gl-free" aria-labelledby="glFree">
        <h2 id="glFree" class="section-title">${esc(t("gl_free"))}</h2>
        ${ways.map((w) => `<a class="btn btn-outline btn-big" href="${esc(w.href)}"${w.external ? ' target="_blank" rel="noopener"' : " download"}>${esc(t(w.verb))}</a>
        <p class="gl-then">${esc(t("gl_free_then"))}</p>
        <p class="gl-say-words" data-way="${esc(w.key)}">${esc(t(w.say))}</p>`).join("\n        ")}
        <p class="vcard-note">${esc(t("gl_free_note"))}</p>
      </section>`;
}

function drawLook(root, status, problem = "") {
  const can = Boolean(status.museConfigured);
  root.innerHTML = `
    <div class="screen is-snug ck-screen gl-screen gl-look">
      ${backLink(TO_GLASSES)}
      <h1 class="screen-title">${esc(t("gl_look"))}</h1>
      <ol class="gl-steps">
        <li>${esc(t("gl_look_1"))}</li>
        <li>${esc(t("gl_look_2"))}</li>
        <li>${esc(t("gl_look_3"))}</li>
      </ol>
      ${can ? `${problemBox(problem)}
      <button id="glChoose" class="btn btn-gold btn-big" type="button">${icon("image", 28)}<span>${esc(t("gl_look_choose"))}</span></button>
      <input id="glPhoto" type="file" accept="image/*" hidden>`
    : `<p class="banner caution ck-problem">${esc(t("photo_needs_muse"))}</p>`}
      ${handsFreeHtml(status)}
    </div>`;
  if (!can) return;
  const input = $("#glPhoto", root);
  $("#glChoose", root).addEventListener("click", () => {
    hush();
    unlockSpeech(); // the answer is spoken after the check, far from this tap
    input.click();
  });
  input.addEventListener("change", () => {
    const file = input.files?.[0];
    input.value = "";
    if (!file) return;
    run(root, lookJob(file, (key) => drawLook(root, status, key)));
  });
  if (problem) $("#ckProblem", root)?.focus();
}

// A photo's check from Look: the last answer stops the moment a new one is
// sent; the new one is said in the ear until she leaves the screen.
export function lookJob(file, back) {
  const job = pictureJob(file, {
    ...TO_GLASSES,
    back,
    afterVerdict: (v) => sayHere(spokenAnswer(v), v.language || getLang()),
  });
  const send = job.send;
  return { ...job, send: (signal) => { hush(); return send(signal); } };
}

// ----------------------------------------------------------------- listen --
// The one listening session: { listen (js/listen.js createSession), root,
// status, timer, onHash }. No session, no microphone.
let session = null;

function endSession() {
  if (!session) return;
  const s = session;
  session = null;
  clearTimeout(s.timer);
  window.removeEventListener("hashchange", s.onHash);
  s.listen.end();
  stopCheck();
  hush();
}

// Stop, the phone going to sleep while it listens, a call taking the
// microphone, the page closing: line 13.
function stopListening(s) {
  if (session !== s) return;
  const { root, status } = s;
  endSession();
  drawIntro(root, status, "gl_stopped");
  focusHeading(root);
}

const micWorks = () => Boolean(navigator.mediaDevices?.getUserMedia && (window.AudioContext || window.webkitAudioContext));

function drawIntro(root, status, note = "") {
  if (status.voiceConfigured && !micWorks()) { drawMicProblem(root, status, "none"); return; }
  root.innerHTML = `
    <div class="screen is-snug ck-screen gl-screen gl-intro">
      ${backLink(TO_GLASSES)}
      <h1 class="screen-title">${esc(t("gl_talk"))}</h1>
      ${note ? `<p class="gl-stopped" role="status">${esc(t(note))}</p>` : ""}
      ${status.voiceConfigured ? `<p class="screen-lead">${esc(t("gl_listen_lead"))}</p>
      <button id="glStart" class="btn btn-gold btn-big" type="button">${icon("mic", 28)}<span>${esc(t("gl_listen_start"))}</span></button>
      <p class="vcard-note">${esc(t("gl_listen_calls"))}</p>`
    : `<p class="banner caution ck-problem">${esc(t("voice_needs_muse"))}</p>`}
    </div>`;
  $("#glStart", root)?.addEventListener("click", () => beginListening(root, status));
}

// Line 15: refused (how to allow it, Try again), held by something else (Try
// again), or no microphone at all (no button). kind: micProblem's answer.
const MIC_WORDS = { none: "gl_mic_none", denied: "gl_mic_denied", failed: "gl_mic_failed" };
function drawMicProblem(root, status, kind) {
  root.innerHTML = `
    <div class="screen is-snug ck-screen gl-screen gl-intro">
      ${backLink(TO_GLASSES)}
      <h1 class="screen-title">${esc(t("gl_talk"))}</h1>
      <p class="banner caution ck-problem" role="alert">${esc(t(MIC_WORDS[kind] || MIC_WORDS.failed))}</p>
      ${kind === "none" ? "" : `<button id="glStart" class="btn btn-gold btn-big" type="button">${esc(t("retry"))}</button>`}
    </div>`;
  $("#glStart", root)?.addEventListener("click", () => beginListening(root, status));
}

function micFailed(s, e) {
  if (session !== s) return;
  const { root, status } = s;
  endSession();
  drawMicProblem(root, status, micProblem(e));
  focusHeading(root);
}

// The tap on "Start listening": the order is in js/listen.js and line 10.
async function beginListening(root, status) {
  endSession();
  hush();
  unlockSpeech();
  const s = { root, status, timer: 0 };
  s.listen = createSession({
    onLevel: (level) => showLevel(root, level),
    // Hidden while listening, the page closing, a call or Siri: line 13.
    onStop: () => stopListening(s),
  });
  s.onHash = () => endSession();
  session = s;
  window.addEventListener("hashchange", s.onHash);
  try { await s.listen.prepare(); } catch (e) { micFailed(s, e); return; }
  if (session !== s) return;
  drawListening(s);
  focusHeading(root);
  // Nothing is captured before this sentence ends.
  let spoken = false;
  const next = () => {
    if (spoken) return;
    spoken = true;
    clearTimeout(s.timer);
    if (session === s) capture(s);
  };
  s.timer = setTimeout(next, SPEAK_FALLBACK_MS);
  speak(t("gl_speak_tell"), getLang(), next);
}

// The microphone on again, and the screen kept awake while it is; on a hidden
// page the session ends instead (js/listen.js createSession).
const capture = (s) => s.listen.capture().catch((e) => micFailed(s, e));

function drawListening(s, problem = "") {
  const { root } = s;
  root.innerHTML = `
    <div class="screen is-snug ck-screen gl-screen gl-listening">
      ${backLink(TO_GLASSES)}
      <p class="gl-say">${esc(t("gl_open_say"))}</p>
      <h1 class="gl-sentence">${esc(t("gl_open"))}</h1>
      <div class="gl-level" aria-hidden="true"><span id="glLevel" class="gl-level-bar"></span></div>
      ${problemBox(problem)}
      <button id="glAsk" class="btn btn-gold btn-big" type="button">${esc(t("gl_ask"))}</button>
      <button id="glStop" class="btn btn-outline btn-big" type="button">${icon("stop", 24)}<span>${esc(t("ck_stop"))}</span></button>
    </div>`;
  $("#glAsk", root).addEventListener("click", () => ask(s));
  $("#glStop", root).addEventListener("click", () => stopListening(s));
  if (problem) $("#ckProblem", root)?.focus();
}

// The bar moves only with the sound, and stays still for someone who asked
// for less motion (line 11); js/listen.js calls this at most ten times a second.
function showLevel(root, level) {
  if (window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) return;
  const bar = $("#glLevel", root);
  if (bar) bar.style.transform = `scaleX(${Math.max(0.03, level).toFixed(2)})`;
}

// "What do they want?": the microphone off first, then those seconds sent.
function ask(s) {
  if (session !== s) return;
  const { root, listen } = s;
  if (listen.capturedSeconds() < MIN_SECONDS) { showProblem(root, "gl_nobody"); return; }
  // Off, and the screen may sleep: from here on, hiding the page changes nothing.
  listen.release();
  let wav = listen.takeWav();
  run(root, {
    ...TO_GLASSES,
    kind: "voice",
    title: "gl_thinking",
    note: false,
    send: (signal) => {
      const form = new FormData();
      // Before the file: the only fields the server's request.file() sees.
      form.append("context", "conversation");
      form.append("lang", getLang()); // the card names the speaker in the page's language
      form.append("audio", wav, "conversation.wav");
      return api("/api/check/voice", { method: "POST", form, signal });
    },
    // A verdict came: those seconds are gone, on the phone too.
    done: () => { wav = null; listen.clear(); },
    back: (key) => {
      if (session !== s) return;
      if (!key) { stopListening(s); return; } // Stop on "Prudence is thinking…"
      drawListening(s, key === "voice_none" ? "gl_nobody" : key);
      capture(s); // it keeps listening
    },
    afterVerdict: (v) => {
      clearTimeout(s.timer);
      s.timer = setTimeout(() => { if (session === s) speak(spokenAnswer(v), v.language || getLang()); }, AFTER_MIC_MS);
    },
    cardEnd: { key: "gl_keep", onClick: () => keepListening(s) },
  });
}

function keepListening(s) {
  if (session !== s) return;
  clearTimeout(s.timer);
  hush();
  s.listen.clear();
  drawListening(s);
  capture(s);
  focusHeading(s.root);
}
