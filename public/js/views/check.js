// Check something (2026-11-04 redesign): _product/specs/protection-menu.md,
// Behavior lines 5 and 6 and Screens 1g to 1n; what each check does is in
// _product/specs/check-something-else.md; the canvas frames are in
// _product/design/2026-11-04-redesign/claude-design/Prudence Redesign.dc.html.
//
// One export draws every Check route (js/main.js, DRAW):
//
//   renderCheckScreen(root, status, { step }) -> void
//     step "choices"  #/check        frames 1g, 1h: the screenshot in gold,
//                                    Paste the words, Send a voice message,
//                                    the Meta glasses choice, More ways
//          "paste"    #/check/paste  frame 1i: the box, "Who sent it?" and
//                                    "Where did you get it?" as chips, Check it
//          "photo"    #/check/photo  frame 1j: Choose from my photos (gold),
//                                    Take a photo now (the camera)
//          "voice"    #/check/voice  Choose a voice message
//          "more"     #/check/more   the email file (and the Meta glasses
//                                    choice for someone who said they have none)
//     status is /api/status: museConfigured (pictures), voiceConfigured
//     (voice messages). Without them the screen says why, in plain words,
//     instead of offering a button that cannot work.
//
// A check runs in place, on its own route: the reading screen (frame 1k: the
// picture, a still ring, "Reading your picture…", Stop), then the verdict
// (1l to 1n: the shared card of js/views/card.js, Listen, and "Still unsure?"
// with Ask <name> and the Coming soon "Send it to Prudence"; on Safe, "Go back
// to Today" and the row folded behind "I still have a doubt"). A check that
// could not run says so in plain words with "Try again", which sends the same
// thing again; a picture or recording that cannot be used goes back to its
// screen with one sentence saying why. Stop, the back link or another tab
// abort the request; a late answer for a screen that is gone is dropped.
// Nothing is kept on the device: the pasted words wait in memory until their
// verdict arrives. Under the verdict, "Look closer" (status.lookCloser:
// _product/specs/investigate.md) sends the same words back with the check's
// id, and the card lists Muse Spark's checks (card.js runLookCloser).
//
// The glasses screens (js/views/glasses.js) run their checks through the same
// run() with a few more fields on the job (see run, below).
//
// Pure helpers, tested in tests/check-view.test.js:
//   WHO, WHERE                 the chips of frame 1i and what each one sends
//   pasteRequest({ text, who, where }) -> the body of POST /api/check/text
//                                 (claimedSender "bank" | "company" | "known" | "")
//   checkProblem(error, kind)  -> null (stopped), { signedOut: true }, or
//                                 { key, retry }: the words for a failed check
//                                 (kind "text", "image", "voice" or "eml")
//   lookCloserRequest(answer)  -> the body of POST /api/check/investigate
//                                 ({ checkId, message }), or null when the
//                                 answer holds no message words to look at
//   firstName(name)
//
// Styles: "redesign: check (check.js)" at the end of styles.css, on top of the
// shared components (.screen, .btn-choice, .chip, .btn-back, .btn-listen).

import { api } from "../api.js";
import { t } from "../i18n.js";
import { $, $$, esc, icon, readAloud, toast, focusHeading } from "../ui.js";
import { openAsk } from "./mail.js";
import { toWav16k } from "../audio.js";
import { verdictCardHtml, unsureRowHtml, bindVerdictCard, runLookCloser } from "./card.js";
import { glassesChoice } from "../protects.js";

// "Who sent it?": what the senior believes about the sender, sent as
// claimedSender and told to the model as her unverified belief; never the
// sender's name or address (the rules and her people read those).
export const WHO = Object.freeze([
  { key: "bank", label: "ck_who_bank" },
  { key: "company", label: "ck_who_company" },
  { key: "known", label: "ck_who_known" },
  { key: "unknown", label: "ck_who_unknown", none: true },
]);
// "Where did you get it?": the channel the pipeline judges it as. Facebook is
// "social", as a Facebook screenshot is (lib/muse.js imageChannel).
export const WHERE = Object.freeze([
  { key: "sms", label: "ch_sms", channel: "sms" },
  { key: "whatsapp", label: "ch_whatsapp", channel: "whatsapp" },
  { key: "facebook", label: "ck_where_facebook", channel: "social" },
  { key: "letter", label: "ck_where_letter", channel: "letter" },
  { key: "other", label: "ck_where_other", channel: "other" },
]);
const DEFAULT_WHO = "unknown";
const DEFAULT_WHERE = "sms";

export function pasteRequest({ text = "", who = DEFAULT_WHO, where = DEFAULT_WHERE } = {}) {
  const w = WHO.find((x) => x.key === who) || WHO.find((x) => x.key === DEFAULT_WHO);
  const c = WHERE.find((x) => x.key === where) || WHERE.find((x) => x.key === DEFAULT_WHERE);
  return { channel: c.channel, from: "", fromName: "", claimedSender: w.none ? "" : w.key, body: String(text) };
}

export const firstName = (s) => String(s || "").trim().split(/\s+/)[0] || "";

// What Look closer sends back: the check's id (its first verdict stays on the
// server) and the message exactly as the check judged it (the answer's
// `judged`: every field, never the display copy), with a chat's earlier turns;
// nothing without both.
export function lookCloserRequest(out) {
  const m = out?.judged?.message;
  if (!out?.checkId || !m || !String(m.body || m.subject || "").trim()) return null;
  return { checkId: out.checkId, message: m, threadHistory: Array.isArray(out.judged.threadHistory) ? out.judged.threadHistory : [] };
}

// What a failed check tells the senior. Never the server's own words (they
// can be "fetch failed" or a status code): a plain sentence from i18n.js.
// retry: the same check may work in a minute (the model or the network was
// unreachable, too many checks at once); otherwise she picks something else.
const UNUSABLE = { text: "ck_paste_empty", image: "ck_photo_unreadable", voice: "voice_unreadable", eml: "ck_eml_none" };
export function checkProblem(e, kind = "text") {
  if (e?.name === "AbortError") return null;
  const status = Number(e?.status) || 0;
  const code = String(e?.data?.error || e?.code || "");
  if (status === 401) return { signedOut: true };
  if (code === "no_message") return { key: kind === "eml" ? "ck_eml_none" : "photo_none", retry: false };
  if (code === "no_speech") return { key: "voice_none", retry: false };
  if (code === "screenshots_need_muse") return { key: "photo_needs_muse", retry: false };
  if (code === "voice_needs_muse") return { key: "voice_needs_muse", retry: false };
  if (code === "unreadable" || [400, 413, 415].includes(status)) return { key: UNUSABLE[kind] || "ck_failed", retry: false };
  return { key: "ck_failed", retry: true };
}

// The draft of frame 1i, kept while the senior goes to the reading screen and
// back (Stop), cleared once its verdict is on screen.
const draft = { text: "", who: DEFAULT_WHO, where: DEFAULT_WHERE };
let inflight = null; // { ctrl }: the one check running, aborted by the next screen
let closer = false; // the server can look closer (status.lookCloser)

// The back link of a screen, by default to Check; job: { backHref, backKey }.
export const backLink = (job) => `<a class="btn-back" href="${esc(job?.backHref || "#/check")}">${icon("chevron-left", 28, 2.5)}${esc(t(job?.backKey || "v2_tab_check"))}</a>`;
export const problemBox = (key) => `<p id="ckProblem" class="banner caution ck-problem" role="alert" tabindex="-1"${key ? "" : " hidden"}>${key ? esc(t(key)) : ""}</p>`;
// A screen drawn in place (reading, failure, verdict) starts at the top,
// whatever the screen before it was scrolled to.
const toTop = () => { try { window.scrollTo(0, 0); } catch { /* no window */ } };
export const showProblem = (root, key) => {
  const p = $("#ckProblem", root);
  if (!p) return;
  p.textContent = t(key);
  p.hidden = false;
  p.focus();
};

// Aborts the check that is running, if any: its late answer is dropped.
export function stopCheck() {
  inflight?.ctrl.abort();
  inflight = null;
}

export function renderCheckScreen(root, status, { step = "choices", problem = "" } = {}) {
  stopCheck();
  closer = Boolean(status?.lookCloser);
  const draw = { choices: drawChoices, paste: drawPaste, photo: drawPhoto, voice: drawVoice, more: drawMore }[step] || drawChoices;
  draw(root, status || {}, problem);
}

// ---------------------------------------------------------------- 1g, 1h --
// At Largest the labels wrap inside their buttons and the spacing tightens
// (.is-largest), so the three choices still sit above the tab bar (frame 1h).
function drawChoices(root, status) {
  const largest = Number(status.user?.textScale) >= 1.4;
  const glasses = glassesChoice(status);
  root.innerHTML = `
    <div class="screen is-snug ck-screen ck-choices${largest ? " is-largest" : ""}">
      <h1 class="screen-title">${esc(t("ck_title"))}</h1>
      <p class="screen-lead">${esc(t("ck_lead"))}</p>
      <a class="btn btn-choice is-hero btn-gold" href="#/check/photo">${icon("camera", 44)}<span class="btn-choice-words"><span class="btn-choice-label">${esc(t("ck_photo"))}</span><span class="btn-choice-sub">${esc(t("ck_photo_sub"))}</span></span></a>
      <a class="btn btn-choice" href="#/check/paste">${icon("clipboard", 36)}<span>${esc(t("ck_paste"))}</span></a>
      <a class="btn btn-choice" href="#/check/voice">${icon("mic", 36)}<span>${esc(t("ck_voice"))}</span></a>
      ${glasses.inMore ? "" : `<a class="btn btn-choice" href="${esc(glasses.href)}">${icon("glasses", 36)}<span>${esc(t(glasses.label))}</span></a>`}
      <a class="btn-link" href="#/check/more">${esc(t("ck_more"))}${icon("chevron-right", 22, 2.5)}</a>
    </div>`;
}

// -------------------------------------------------------------------- 1i --
function chips(name, items, chosen) {
  return items.map((c) => `<button class="chip" type="button" data-${name}="${c.key}" aria-pressed="${c.key === chosen}">${esc(t(c.label))}</button>`).join("");
}

function drawPaste(root, status, problem) {
  root.innerHTML = `
    <form id="ckPasteForm" class="screen is-snug ck-screen ck-paste" novalidate>
      ${backLink()}
      <h1 id="ckPasteTitle" class="screen-title">${esc(t("ck_paste"))}</h1>
      <textarea id="ckText" class="ck-text" aria-labelledby="ckPasteTitle" placeholder="${esc(t("ck_paste_placeholder"))}" autocomplete="off" spellcheck="false"></textarea>
      ${problemBox(problem)}
      <div class="ck-question">
        <h2 id="ckWho" class="section-title">${esc(t("ck_who"))}</h2>
        <div class="chip-row" role="group" aria-labelledby="ckWho">${chips("who", WHO, draft.who)}</div>
      </div>
      <div class="ck-question">
        <h2 id="ckWhere" class="section-title">${esc(t("channel_q"))}</h2>
        <div class="chip-row" role="group" aria-labelledby="ckWhere">${chips("where", WHERE, draft.where)}</div>
      </div>
      <button class="btn btn-gold btn-big ck-go" type="submit">${esc(t("ck_check_it"))}${icon("chevron-right", 26, 2.5)}</button>
    </form>`;
  const box = $("#ckText", root);
  box.value = draft.text;
  box.addEventListener("input", () => {
    draft.text = box.value;
    const p = $("#ckProblem", root);
    if (p && draft.text.trim()) p.hidden = true; // the words are there now
  });
  for (const name of ["who", "where"]) {
    $$(`[data-${name}]`, root).forEach((chip) => chip.addEventListener("click", () => {
      draft[name] = chip.dataset[name];
      $$(`[data-${name}]`, root).forEach((c) => c.setAttribute("aria-pressed", String(c === chip)));
    }));
  }
  $("#ckPasteForm", root).addEventListener("submit", (ev) => {
    ev.preventDefault();
    draft.text = box.value;
    if (!draft.text.trim()) { showProblem(root, "ck_paste_empty"); box.focus(); return; }
    const body = pasteRequest(draft);
    run(root, {
      kind: "text", title: "checking",
      send: (signal) => api("/api/check/text", { method: "POST", body, signal }),
      done: () => { draft.text = ""; draft.who = DEFAULT_WHO; draft.where = DEFAULT_WHERE; },
      back: (key) => { drawPaste(root, status, key); if (!key) $("#ckText", root)?.focus(); },
    });
  });
  if (problem) $("#ckProblem", root)?.focus();
}

// ---------------------------------------------------------------- 1j, 1k --
// The server takes PNG, JPEG or WebP up to 8 MB. Anything else the browser
// can open (a large camera photo, HEIC where the browser reads it) is drawn
// again on the device as a JPEG of at most 2560 px, which reads as well.
const PICTURE_TYPES = ["image/png", "image/jpeg", "image/webp"];
const PICTURE_MAX = 7 * 1024 * 1024;
export async function fitPicture(file) {
  if (PICTURE_TYPES.includes(file.type) && file.size <= PICTURE_MAX) return file;
  let bitmap;
  try { bitmap = await createImageBitmap(file); } catch { throw Object.assign(new Error("unreadable"), { code: "unreadable" }); }
  const scale = Math.min(1, 2560 / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(bitmap.width * scale));
  canvas.height = Math.max(1, Math.round(bitmap.height * scale));
  canvas.getContext("2d").drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  const blob = await new Promise((done) => canvas.toBlob(done, "image/jpeg", 0.88));
  if (!blob || blob.size > 8 * 1024 * 1024) throw Object.assign(new Error("unreadable"), { code: "unreadable" });
  return new File([blob], "picture.jpg", { type: "image/jpeg" });
}

// A picture's check, for Check and for the glasses screen; more: job fields.
export function pictureJob(file, more) {
  return {
    kind: "image", title: "ck_reading", picture: file,
    send: async (signal) => {
      const form = new FormData();
      form.append("image", await fitPicture(file));
      return api("/api/check/image", { method: "POST", form, signal });
    },
    ...more,
  };
}

function drawPhoto(root, status, problem) {
  if (!status.museConfigured) {
    root.innerHTML = `
      <div class="screen is-snug ck-screen ck-photo">
        ${backLink()}
        <h1 class="screen-title">${esc(t("ck_photo_title"))}</h1>
        <p class="banner caution ck-problem">${esc(t("photo_needs_muse"))}</p>
        <a class="btn btn-choice btn-gold" href="#/check/paste">${icon("clipboard", 36)}<span>${esc(t("ck_paste"))}</span></a>
      </div>`;
    return;
  }
  root.innerHTML = `
    <div class="screen is-snug ck-screen ck-photo">
      ${backLink()}
      <h1 class="screen-title">${esc(t("ck_photo_title"))}</h1>
      <p class="screen-lead">${esc(t("ck_photo_lead"))}</p>
      ${problemBox(problem)}
      <button id="ckChoose" class="btn btn-choice btn-gold" type="button">${icon("image", 36)}<span>${esc(t("ck_photo_choose"))}</span></button>
      <button id="ckTake" class="btn btn-choice" type="button">${icon("camera", 36)}<span>${esc(t("ck_photo_take"))}</span></button>
      <input id="ckPhotoFile" type="file" accept="image/*" hidden>
      <input id="ckCameraFile" type="file" accept="image/*" capture="environment" hidden>
    </div>`;
  // Real, focusable buttons open the hidden pickers.
  $("#ckChoose", root).addEventListener("click", () => $("#ckPhotoFile", root).click());
  $("#ckTake", root).addEventListener("click", () => $("#ckCameraFile", root).click());
  for (const input of [$("#ckPhotoFile", root), $("#ckCameraFile", root)]) {
    input.addEventListener("change", () => {
      const file = input.files?.[0];
      input.value = "";
      if (!file) return;
      run(root, pictureJob(file, { back: (key) => drawPhoto(root, status, key) }));
    });
  }
  if (problem) $("#ckProblem", root)?.focus();
}

// ------------------------------------------------------------------ voice --
function drawVoice(root, status, problem) {
  const on = Boolean(status.voiceConfigured);
  root.innerHTML = `
    <div class="screen is-snug ck-screen ck-voice">
      ${backLink()}
      <h1 class="screen-title">${esc(t("ck_voice"))}</h1>
      ${on ? `<p class="screen-lead">${esc(t("voice_lead"))}</p>
      ${problemBox(problem)}
      <button id="ckVoiceChoose" class="btn btn-choice btn-gold" type="button">${icon("mic", 36)}<span>${esc(t("voice_btn"))}</span></button>
      <input id="ckVoiceFile" type="file" accept="audio/*" hidden>`
    : `<p class="banner caution ck-problem">${esc(t("voice_needs_muse"))}</p>`}
    </div>`;
  if (!on) return;
  const input = $("#ckVoiceFile", root);
  $("#ckVoiceChoose", root).addEventListener("click", () => input.click());
  input.addEventListener("change", () => {
    const file = input.files?.[0];
    input.value = "";
    if (!file) return;
    run(root, {
      kind: "voice", title: "ck_listening",
      send: async (signal) => {
        // The page makes the 16 kHz mono WAV the server accepts (public/js/audio.js).
        let wav;
        try { wav = await toWav16k(file); } catch { throw Object.assign(new Error("unreadable"), { code: "unreadable" }); }
        if (signal.aborted) throw new DOMException("Stopped", "AbortError");
        const form = new FormData();
        form.append("audio", wav, "voice.wav");
        return api("/api/check/voice", { method: "POST", form, signal });
      },
      back: (key) => drawVoice(root, status, key),
    });
  });
  if (problem) $("#ckProblem", root)?.focus();
}

// ------------------------------------------------------------------- more --
function drawMore(root, status, problem) {
  const glasses = glassesChoice(status);
  root.innerHTML = `
    <div class="screen is-snug ck-screen ck-more">
      ${backLink()}
      <h1 class="screen-title">${esc(t("ck_more"))}</h1>
      ${problemBox(problem)}
      <section class="row-card" aria-labelledby="ckEmlTitle">
        <h2 id="ckEmlTitle" class="row-name">${esc(t("eml_title"))}</h2>
        <p class="row-state">${esc(t("eml_lead"))}</p>
        <button id="ckEmlChoose" class="btn btn-outline btn-big" type="button">${icon("mail", 28)}<span>${esc(t("eml_btn"))}</span></button>
        <input id="ckEmlFile" type="file" accept=".eml,message/rfc822" hidden>
      </section>
      ${glasses.inMore ? `<section class="row-card" aria-labelledby="ckGlassesTitle">
        <h2 id="ckGlassesTitle" class="row-name">${esc(t(glasses.label))}</h2>
        <a class="btn btn-outline btn-big" href="${esc(glasses.href)}">${icon("glasses", 28)}<span>${esc(t("gl_row_setup"))}</span></a>
      </section>` : ""}
    </div>`;
  const input = $("#ckEmlFile", root);
  $("#ckEmlChoose", root).addEventListener("click", () => input.click());
  input.addEventListener("change", () => {
    const file = input.files?.[0];
    input.value = "";
    if (!file) return;
    run(root, {
      kind: "eml", title: "checking",
      send: (signal) => { const form = new FormData(); form.append("email", file); return api("/api/check/eml", { method: "POST", form, signal }); },
      back: (key) => drawMore(root, status, key),
    });
  });
  if (problem) $("#ckProblem", root)?.focus();
}

// ------------------------------------------------------ running a check --
// job: { kind, title (the i18n key of the reading line), picture (a File to
// show while it is read), send(signal) -> the API answer, back(problemKey)
// (draws the screen the check started from), done() after a verdict }, and,
// for the glasses screens: backHref and backKey (the back link), note (the
// i18n key under the reading line; false for none), afterVerdict(verdict)
// once the card is on screen, cardEnd { key, onClick } (a gold button ending
// the card, instead of "Go back to Today"; "Ask <name>" is then an outline,
// so the screen keeps one gold verb).
export async function run(root, job) {
  inflight?.ctrl.abort();
  const ctrl = new AbortController();
  const mine = { ctrl };
  inflight = mine;
  const view = root.dataset.view;
  const here = location.hash;
  const leave = () => { if (location.hash !== here) ctrl.abort(); };
  window.addEventListener("hashchange", leave);
  // The trusted person's name for "Ask <name>", fetched while the check runs.
  const people = api("/api/guardians", { signal: ctrl.signal }).catch(() => ({ guardians: [] }));
  drawReading(root, job, () => {
    ctrl.abort();
    job.back("");
    if (!root.contains(document.activeElement)) focusHeading(root);
  });
  const gone = () => ctrl.signal.aborted || inflight !== mine || root.dataset.view !== view;
  try {
    const out = await job.send(ctrl.signal);
    const { guardians = [] } = await people;
    if (gone()) return;
    job.done?.();
    drawVerdict(root, job, out, guardians.find((g) => g.status === "active"));
  } catch (e) {
    if (gone()) return;
    const p = checkProblem(e, job.kind);
    if (!p) return;
    if (p.signedOut) { location.href = "/"; return; }
    if (p.retry) drawFailed(root, job, () => run(root, job));
    else job.back(p.key);
  } finally {
    window.removeEventListener("hashchange", leave);
    if (inflight === mine) inflight = null;
  }
}

// Frame 1k: what is being read, a still ring (it turns slowly only when the
// person has not asked for less motion), one sentence and Stop.
function drawReading(root, job, onStop) {
  root.innerHTML = `
    <div class="screen is-snug ck-screen ck-reading" aria-busy="true">
      ${backLink(job)}
      ${job.picture ? `<div class="ck-preview"><img id="ckPreview" alt="" hidden></div>` : ""}
      <div class="ck-wait">
        <span class="ck-ring" aria-hidden="true"></span>
        <h1 class="ck-wait-title" tabindex="-1">${esc(t(job.title))}</h1>
      </div>
      ${job.note === false ? "" : `<p class="screen-lead">${esc(t(job.note || "ck_reading_note"))}</p>`}
      <button id="ckStop" class="btn btn-outline btn-big ck-stop" type="button">${icon("stop", 24)}${esc(t("ck_stop"))}</button>
    </div>`;
  $("#ckStop", root).addEventListener("click", onStop);
  toTop();
  $(".ck-wait-title", root).focus();
  const img = $("#ckPreview", root);
  if (img && job.picture) {
    // A data: address (the page's rules allow no blob: pictures); a picture
    // the browser cannot draw leaves the striped box.
    const reader = new FileReader();
    reader.onload = () => { if (img.isConnected) { img.onload = () => { img.hidden = false; }; img.src = String(reader.result); } };
    reader.readAsDataURL(job.picture);
  }
}

// The check could not run (the model or the network unreachable, too many
// checks in a minute): plain words, and Try again sends the same thing.
function drawFailed(root, job, again) {
  root.innerHTML = `
    <div class="screen is-snug ck-screen ck-failed">
      ${backLink(job)}
      <div class="ck-wait">
        <span class="ck-mark" aria-hidden="true">${icon("careful", 34)}</span>
        <h1 class="ck-wait-title" tabindex="-1">${esc(t("ck_failed"))}</h1>
      </div>
      <p class="screen-lead">${esc(t("ck_failed_note"))}</p>
      <button id="ckRetry" class="btn btn-gold btn-big" type="button">${esc(t("retry"))}</button>
    </div>`;
  $("#ckRetry", root).addEventListener("click", again);
  toTop();
  $(".ck-wait-title", root).focus();
}

// Frames 1l to 1n. A voice message keeps its words in the card's "Show me
// the message" fold, an email file the email; a pasted text or a picture is
// already in her hands, so its card has no fold (frame 1l).
function drawVerdict(root, job, out, guardian) {
  const v = out.verdict || {};
  const safe = v.verdict === "safe";
  const fold = job.kind === "voice" && out.transcript ? { subject: t("voice_heard"), body: out.transcript }
    : job.kind === "eml" ? out.message : null;
  const look = lookCloserRequest(out);
  root.innerHTML = `
    <div class="screen is-snug ck-screen ck-verdict">
      <div class="screen-head">
        ${backLink(job)}
        <button id="ckListen" class="btn-listen" type="button" aria-label="${esc(t("v2_read"))}">${icon("speaker", 26)}<span aria-hidden="true">${esc(t("v2_read_short"))}</span></button>
      </div>
      ${verdictCardHtml({ verdict: v, message: fold, ids: "ck" })}
      ${unsureRowHtml({ verdict: v.verdict, guardianName: guardian ? firstName(guardian.name) : "", folded: safe, ids: "ck", lookCloser: closer && Boolean(look) })}
      <div id="ckAskPanel" class="ck-ask-panel"></div>
    </div>`;
  if (job.cardEnd) {
    $("#ckCard", root)?.insertAdjacentHTML("beforeend", `<button id="ckEnd" class="btn btn-gold btn-big" type="button">${esc(t(job.cardEnd.key))}</button>`);
    $("#ckEnd", root)?.addEventListener("click", job.cardEnd.onClick);
    // One gold verb on this screen only; the shared card stays as it is everywhere else.
    for (const ask of [$("#ckAsk", root), $("#ckAddTrusted", root)]) ask?.classList.replace("btn-gold", "btn-outline");
  } else if (safe) $("#ckCard", root)?.insertAdjacentHTML("beforeend", `<a id="ckToday" class="btn btn-gold btn-big" href="#/today">${esc(t("ck_back_today"))}</a>`);
  $("#ckListen", root).addEventListener("click", () => readAloud(v.headline ? v : { headline: t("v2_unknown_title"), reasons: [], action_text: t("v2_unknown_note") }));
  const panel = $("#ckAskPanel", root);
  bindVerdictCard(root, {
    ids: "ck",
    onAsk: () => openAsk({ checkId: out.checkId, verdict: v, message: out.message || {}, target: panel, provided: true })
      .then(() => panel.scrollIntoView({ block: "start", behavior: "smooth" }))
      .catch(() => toast(t("ck_failed"), "danger")),
    onLookCloser: () => runLookCloser(root, { ids: "ck", send: () => api("/api/check/investigate", { method: "POST", body: look }) }),
  });
  // The verdict word first, for a screen reader too.
  toTop();
  const word = $("#ckCard .vcard-word", root);
  if (word) { word.tabIndex = -1; word.focus(); }
  job.afterVerdict?.(v);
}
