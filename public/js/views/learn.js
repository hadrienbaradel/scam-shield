// Learn (_product/specs/micro-learning.md; the 2026-11-04 redesign canvas,
// frames 1o and 1p, _product/specs/protection-menu.md line 7; the spec's
// "Thread screen"): one-minute lessons told as one conversation that grows
// with each tap, like texts with a friend. Prudence talks and the person
// answers with a tap on a reply in their own words; the character's texts
// land in the thread under the name he borrows; three times the thread
// stops on "What do you do?". After each choice the character answers in
// his own voice and Prudence names the tell. A right choice earns a cheer
// and confetti (a star when it is the first try) and the story goes on by
// itself; a wrong one plays out, then Rewind takes it back out of the
// thread and the same choice comes back with the tried answer greyed. The
// lesson ends with the rule to remember.
// Lessons come from GET /api/lessons; progress is kept in the account when
// signed in and on this device in the demo (#/demo/learn).

import { api } from "../api.js";
import { t, getLang } from "../i18n.js";
import { $, esc, verdictCard, readAloud, speak, toast, focusHeading, icon } from "../ui.js";

let L = null; // the screen state: root, mode, lessons, progress, summary, the lesson running
const enc = encodeURIComponent;
const lessonCache = new Map(); // lang -> lessons (they change only when the server restarts)
const inboxCache = new Map(); // lang -> demo messages, for "Try it on a real one"
let saving = Promise.resolve(); // the last progress write, so a new screen reads after it

// Lesson text is content: escaped first, then **bold** (the only markup a
// lesson may hold, checked by lib/lessons.js) becomes <strong>. In French,
// a plain space before ? ! : ; » or after « is shown as a no-break space, so
// the mark never wraps onto a line of its own (the lesson files type a plain
// one; what Listen reads, plain(), keeps it).
const french = (s) => (getLang() === "fr" ? String(s ?? "").replace(/(«) | ([?!:;»])/g, "$1\u00a0$2") : s);
const rich = (s) => esc(french(s)).replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>");
const plain = (s) => String(s ?? "").replace(/\*\*/g, "");
// What Listen reads: the words without the bold marks, each part ending like a sentence.
const spoken = (parts) => parts.map((p) => plain(p).trim()).filter(Boolean)
  .map((p) => (/[.!?…:;»"”)]$/.test(p) ? p : `${p}.`)).join(" ");
// One or many: French says "0 étoile", English "0 stars".
const plural = (n, key, vars) => t((getLang() === "fr" ? n < 2 : n === 1) ? `${key}_one` : key, vars);
const pad = (n) => String(n).padStart(2, "0");
const localDay = (d = new Date()) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const base = () => (L.demo ? "#/demo/learn" : "#/learn");
const isAsk = (step) => Boolean(step) && Object.hasOwn(step, "ask");
const isSay = (step) => Boolean(step) && Object.hasOwn(step, "say");
const isChat = (step) => Boolean(step) && Object.hasOwn(step, "chat");

// ------------------------------------------------------------ progress rules
// Mirrored from lib/lessons.js, the source of truth (emptyProgress,
// applyLessonResult, summarize): the demo keeps its progress on this device
// and must count exactly like the account does. Same rules: the best stars
// are kept, a badge is earned once, days in a row: the same day changes
// nothing, the next day adds one, a gap starts again at 1, an earlier day
// leaves the streak alone; nothing ever goes down. Change them there first.
const DAY = /^\d{4}-\d{2}-\d{2}$/;
const isObj = (v) => v !== null && typeof v === "object" && !Array.isArray(v);
function dayNumber(day) {
  if (typeof day !== "string" || !DAY.test(day)) return NaN;
  const [y, m, d] = day.split("-").map(Number);
  const at = new Date(Date.UTC(y, m - 1, d));
  return at.getUTCFullYear() === y && at.getUTCMonth() === m - 1 && at.getUTCDate() === d ? at.getTime() / 86400000 : NaN;
}
const isDay = (day) => Number.isFinite(dayNumber(day));
const daysBetween = (from, to) => dayNumber(to) - dayNumber(from);
const emptyProgress = () => ({ lessons: {}, badges: [], streak: { days: 0, lastDay: null } });
function normalized(progress) {
  const p = isObj(progress) ? progress : {};
  const s = isObj(p.streak) ? p.streak : {};
  return {
    lessons: isObj(p.lessons) ? p.lessons : {},
    badges: Array.isArray(p.badges) ? p.badges : [],
    streak: { days: Number.isInteger(s.days) && s.days > 0 ? s.days : 0, lastDay: isDay(s.lastDay) ? s.lastDay : null },
  };
}
function applyLessonResult(progress, { lessonId, stars, day }) {
  const p = normalized(progress);
  // The server refuses such a result; here the screen must never break, so it changes nothing.
  if (typeof lessonId !== "string" || !lessonId || !Number.isInteger(stars) || stars < 0 || stars > 3 || !isDay(day)) return p;
  const before = isObj(p.lessons[lessonId]) ? p.lessons[lessonId] : {};
  const lesson = {
    stars: Math.max(Number.isInteger(before.stars) ? before.stars : 0, stars),
    done: true,
    plays: (Number.isInteger(before.plays) ? before.plays : 0) + 1,
    lastDay: isDay(before.lastDay) && before.lastDay > day ? before.lastDay : day,
  };
  const gap = p.streak.lastDay ? daysBetween(p.streak.lastDay, day) : null;
  const streak = gap === null ? { days: 1, lastDay: day }
    : gap <= 0 ? { days: Math.max(p.streak.days, 1), lastDay: p.streak.lastDay }
      : { days: gap === 1 ? p.streak.days + 1 : 1, lastDay: day };
  return {
    lessons: { ...p.lessons, [lessonId]: lesson },
    badges: p.badges.includes(lessonId) ? [...p.badges] : [...p.badges, lessonId],
    streak,
  };
}
function summarize(progress, lessons, today) {
  const p = normalized(progress);
  const mine = lessons.map((l) => p.lessons[l?.id]).filter(isObj);
  const alive = p.streak.lastDay && daysBetween(p.streak.lastDay, today) <= 1;
  return {
    done: mine.filter((x) => x.done === true).length,
    total: lessons.length,
    stars: mine.reduce((n, x) => n + (Number.isInteger(x.stars) ? x.stars : 0), 0),
    days: alive ? p.streak.days : 0,
  };
}

// The demo's progress on this device. A browser that stores nothing
// (private mode) keeps it for this visit only.
const KEY = "ss_learn_progress";
let kept = null;
function readLocal() {
  if (kept) return normalized(kept);
  try { return normalized(JSON.parse(localStorage.getItem(KEY) || "null")); } catch { return emptyProgress(); }
}
function writeLocal(progress) {
  kept = progress;
  try { localStorage.setItem(KEY, JSON.stringify(progress)); } catch { /* private mode: this visit only */ }
}

function loadLessons(lang) {
  if (!lessonCache.has(lang)) {
    lessonCache.set(lang, api(`/api/lessons?lang=${lang}`).then((r) => r.lessons || [])
      .catch((e) => { lessonCache.delete(lang); throw e; }));
  }
  return lessonCache.get(lang);
}
function loadInbox(lang) {
  if (!inboxCache.has(lang)) {
    inboxCache.set(lang, api(`/api/demo/inbox?lang=${lang}`).then((r) => r.emails || [])
      .catch((e) => { inboxCache.delete(lang); throw e; }));
  }
  return inboxCache.get(lang);
}

// ------------------------------------------------------------------ screens
// Every screen goes through paint(): it starts at the top, moves focus to
// the new heading (a screen reader says where the person is), and counts
// screens so that an answer arriving after the person has moved on, or the
// rest of a lesson's beat still appearing, is dropped instead of drawn over
// them. No Learn screen docks a button (a lesson's buttons sit at the end
// of its thread), so the answer bar's room under the page is never kept.
let painted = 0;
let shownAt = 0; // when the buttons on screen appeared, for the double-tap guard
let pending = 0; // the timer of a beat still appearing
function paint(html, { focus = true } = {}) {
  if ("speechSynthesis" in window) speechSynthesis.cancel(); // a new screen never keeps reading the last one
  clearTimeout(pending);
  L.root.innerHTML = html;
  document.body.classList.remove("v2-docked");
  if (focus) { window.scrollTo(0, 0); focusHeading(L.root); }
  shownAt = performance.now();
  return ++painted;
}
const stale = (n) => n !== painted || !L.root.isConnected || L.root.dataset.view !== "learn";

export async function renderLearn(root, status, { demo = false } = {}) {
  L = { root, status, demo, local: demo || !status.user, lang: getLang(), lessons: [], progress: emptyProgress(), summary: null, run: null };
  const n = paint(`<div class="v2 learn"><p class="v2-wait">${t("please_wait")}</p></div>`, { focus: false });
  const day = localDay();
  try {
    const [lessons, mine] = await Promise.all([
      loadLessons(L.lang),
      L.local ? null : saving.then(() => api(`/api/learn/progress?day=${day}`)),
    ]);
    if (stale(n)) return;
    L.lessons = lessons;
    L.progress = L.local ? readLocal() : normalized(mine.progress);
    L.summary = L.local || !mine.summary ? summarize(L.progress, lessons, day) : mine.summary;
  } catch (e) {
    if (e.status === 401) throw e; // signed out meanwhile: the app takes them to the front page
    if (stale(n)) return;
    L.lessons = [];
  }
  if (!L.lessons.length) return drawFailed();
  const id = (location.hash.match(/^#\/(?:demo\/)?learn\/([a-z0-9-]+)/) || [])[1];
  const lesson = id && L.lessons.find((l) => l.id === id);
  if (lesson) return startLesson(lesson);
  if (id) history.replaceState(null, "", base()); // a lesson that does not exist (any more): the Learn home
  return drawHome();
}

function drawFailed() {
  paint(`<div class="v2 learn"><p class="banner danger" role="alert">${t("learn_load_failed")}</p>
    <button id="learnRetry" class="btn btn-navy btn-big" type="button">${t("retry")}</button></div>`, { focus: false });
  $("#learnRetry", L.root).addEventListener("click", () => renderLearn(L.root, L.status, { demo: L.demo }));
}

const isDone = (id) => L.progress.lessons[id]?.done === true;
const starsOf = (id) => (Number.isInteger(L.progress.lessons[id]?.stars) ? L.progress.lessons[id].stars : 0);

// Stars are drawn, never typed (the font has no ★, and gold text on white
// fails contrast): the shared star outline (ui.js), navy, filled white or
// gold by .learn-star-icon (styles.css), always beside words or with a label.
const star = (size, on, width = 2) => icon("star", size, width).replace("<svg ", `<svg class="learn-star-icon${on ? " is-on" : ""}" `);
const starRow = (n, total, size, width) => Array.from({ length: total }, (_, i) => star(size, i < n, width)).join("");
// A lesson's stars as one picture a screen reader names: "No stars yet", "2 of 3 stars".
const starsLabel = (n, total) => (n > 0 ? plural(n, "learn_of", { n, total }) : t("learn_no_stars"));
const starGroup = (n, total, size, cls) =>
  `<span class="${cls}" role="img" aria-label="${esc(starsLabel(n, total))}">${starRow(n, total, size)}</span>`;

// ------------------------------------------------------------------- home
// Frame 1o: the game shows from zero (protection-menu.md line 7). Before the
// first lesson the card reads "Your first star is one minute away" over every
// badge still to earn, in grey; after it, the progress line over the badges,
// the earned ones in colour. A zero is never shown ("0 stars" is left out).
function drawHome() {
  const todo = L.lessons.filter((l) => !isDone(l.id));
  const done = L.lessons.filter((l) => isDone(l.id));
  paint(`
    <div class="screen is-snug learn">
      <div class="learn-hello">
        <h1 class="screen-title">${t("learn_title")}</h1>
        <p class="screen-lead learn-lead">${t("learn_lead")}</p>
      </div>
      ${progressCard()}
      ${todo.length ? `
        <section class="learn-group" aria-labelledby="learnToTry">
          <h2 id="learnToTry" class="section-title">${t("learn_to_try")}</h2>
          <ul class="learn-list">${todo.map((l, i) => lessonCard(l, i === 0 ? "next" : "todo")).join("")}</ul>
        </section>` : ""}
      ${done.length ? `
        <section class="learn-group" aria-labelledby="learnDone">
          <h2 id="learnDone" class="section-title">${t("learn_done_title")}</h2>
          <ul class="learn-list">${done.map((l) => lessonCard(l, "done")).join("")}</ul>
        </section>` : ""}
    </div>`);
}

// The progress card. A screen reader hears the line, then "Your badges" and
// the names of the earned ones; the grey circles are only pictures, the line
// under them says how many are left.
function progressCard() {
  const s = L.summary;
  const zero = !(s.done > 0);
  const earned = new Set(L.progress.badges);
  const mine = L.lessons.filter((l) => earned.has(l.id));
  const left = L.lessons.length - mine.length;
  const head = zero ? esc(t("lh_first_star"))
    : [plural(s.done, "learn_lessons", { done: s.done, total: s.total }),
      ...(s.stars > 0 ? [plural(s.stars, "learn_stars", { n: s.stars })] : []),
      ...(s.days >= 2 ? [t("learn_days", { n: s.days })] : [])].map((p) => `<span>${esc(p)}</span>`).join("&nbsp;· ");
  const line = zero ? t("lh_badges_to_earn", { n: L.lessons.length }) : left > 0 ? plural(left, "lh_badges_left", { n: left }) : "";
  const badge = (l) => (earned.has(l.id)
    ? `<li class="learn-badge-dot is-earned"><span aria-hidden="true">${esc(l.emoji)}</span><span class="learn-sr">${rich(l.badge)}</span></li>`
    : `<li class="learn-badge-dot" aria-hidden="true">${esc(l.emoji)}</li>`);
  return `
    <section class="learn-progress" aria-label="${esc(t("learn_progress_label"))}">
      <p class="learn-progress-head">${star(34, s.stars > 0)}<span class="learn-progress-line">${head}</span></p>
      <div class="learn-badges-box">
        <ul class="learn-badge-row"${mine.length ? ` aria-label="${esc(t("learn_badges"))}"` : ' aria-hidden="true"'}>${L.lessons.map(badge).join("")}</ul>
        ${line ? `<p class="learn-badge-line">${esc(line)}</p>` : ""}
      </div>
    </section>`;
}

// One whole-card link per lesson, each with its three drawn stars. The first
// one not done is the big card with the gold Start; the others are rows with
// a "Start ›" cue; a done one shows its best stars and can be played again.
function lessonCard(l, kind) {
  const href = `${base()}/${enc(l.id)}`;
  const emoji = `<span class="learn-emoji" aria-hidden="true">${esc(l.emoji)}</span>`;
  const title = `<span class="learn-lesson-title">${rich(l.title)}</span>`;
  const minutes = `<span class="learn-minutes">${esc(plural(l.minutes, "learn_minutes", { n: l.minutes }))}</span>`;
  const n = starsOf(l.id);
  const total = l.steps.filter(isAsk).length; // one star per question
  if (kind === "next") {
    return `<li><a class="learn-lesson is-next" href="${href}">
      <span class="learn-lesson-top">${emoji}<span class="learn-lesson-body">${title}${minutes}</span></span>
      ${starGroup(n, total, 30, "learn-star-row is-big")}
      <span class="learn-start">${t("learn_start")}${icon("chevron-right", 26, 2.5)}</span></a></li>`;
  }
  if (kind === "todo") {
    return `<li><a class="learn-lesson" href="${href}">${emoji}<span class="learn-lesson-body">${title}
      <span class="learn-meta">${starGroup(n, total, 24, "learn-star-row")}${minutes}<span class="learn-cue">${t("learn_start")}${icon("chevron-right", 20, 2.5)}</span></span></span></a></li>`;
  }
  return `<li><a class="learn-lesson is-done" href="${href}">${emoji}<span class="learn-lesson-body">${title}
    <span class="learn-stars"><span class="learn-star-row">${starRow(n, total, 24)}</span><span>${esc(starsLabel(n, total))}</span></span>
    <span class="learn-meta"><span class="learn-done">${icon("check", 20, 2.5)}${t("learn_done_chip")}</span><span class="learn-cue">${drawn("replay", 20)}${t("learn_again")}</span></span></span></a></li>`;
}

// ---------------------------------------------------------------- a lesson
// A lesson is one conversation, like texts with a friend (micro-learning.md,
// Behavior 3 to 5; the Design's "Thread screen"): under the header and the
// stepper, the lesson's title once, then the thread, a list of messages that
// grows downward and stays on the screen. A beat is what appears between two
// taps: the steps up to and including the next chat (Prudence waits for a
// reply), the next ask (the question and its choices) or the end (one
// Next). The run's state stays in memory; progress is written once, on the
// end screen, so leaving in the middle loses nothing that was saved.
//   step        the chat or ask the thread waits on (steps.length: the end)
//   answers[q]  whether the first choice on question q was the right one:
//               its star (stars count first tries, 0 to 3)
//   tried[q]    the choices tried on question q, greyed and marked "Tried"
//               when Rewind brings the question back
//   heard       what Listen reads: the messages arrived since the last tap,
//   waiting     then what the buttons say once they are there (the question
//               and its choices, or the replies)
function startLesson(lesson) {
  L.run = { lesson, step: 0, answers: [], tried: [], total: lesson.steps.filter(isAsk).length, saved: null, heard: [], waiting: [] };
  drawThread();
}

// A tap landing within a moment of buttons appearing is the second half of
// a double tap on the button before them: dropped.
const tooSoon = () => performance.now() - shownAt < 400;

// Frame 1p: "‹ Learn" and the round "Listen" on one row (the shared
// .btn-back and .btn-listen).
function header() {
  const listen = "speechSynthesis" in window
    ? `<button id="learnRead" class="btn-listen" type="button" aria-label="${esc(t("v2_read"))}">${icon("speaker", 26)}<span aria-hidden="true">${t("v2_read_short")}</span></button>` : "";
  return `<header class="screen-head learn-head">
      <a class="btn-back" href="${base()}" aria-label="${esc(t("learn_back"))}">${icon("chevron-left", 28, 2.5)}${t("learn_tab")}</a>${listen}
    </header>`;
}
// onRead: what Listen does on this screen.
const bindHeader = (onRead) => $("#learnRead", L.root)?.addEventListener("click", onRead);
const say = (parts) => () => speak(spoken(parts), L.lang);

// "Choice 1 of 3" and three stars: earned ones filled, the current one
// underlined in gold, the one just earned popping in.
function stepper(q, fresh = -1) {
  const { answers, total } = L.run;
  const got = answers.filter(Boolean).length;
  const label = got ? plural(got, "learn_so_far", { n: got }) : t("learn_no_stars");
  return `<div class="learn-stepper">
      <p class="learn-step-label">${esc(t("learn_question", { i: q + 1, n: total }))}</p>
      <span class="learn-step-stars" role="img" aria-label="${esc(label)}">${Array.from({ length: total }, (_, i) =>
    `<span class="learn-star${answers[i] ? " is-on" : ""}${i === q ? " is-current" : ""}${i === fresh ? " is-new" : ""}">${star(28, answers[i])}</span>`).join("")}</span>
    </div>`;
}

// The pace (the Design's "Thread screen"): each new message about 450 ms
// after the one before so the eye can follow, the buttons last. Under
// reduced motion a beat appears at once, and what Rewind takes back goes at
// once instead of sliding away (320 ms, learn-out in styles.css). Timers
// append the elements: the content-security policy allows no inline style.
const PACE = 450;
const LEAVE = 320;
const calm = () => Boolean(window.matchMedia?.("(prefers-reduced-motion: reduce)").matches);
// An element built from its HTML (escaped content, as every screen).
function node(html) {
  const box = document.createElement("template");
  box.innerHTML = html.trim();
  return box.content.firstElementChild;
}
// The newest element scrolled into view, its bottom just above the tab bar
// (its scroll margin, styles.css). "nearest" lines its bottom up like "end"
// whenever it fits the screen, and keeps the top of a taller one in view.
const reveal = (el) => el.scrollIntoView?.({ block: "nearest", behavior: calm() ? "auto" : "smooth" });
// Keyboard and screen-reader focus on a message or on the question, without
// scrolling away from the newest message.
function focusOn(el) {
  if (!el) return;
  el.setAttribute("tabindex", "-1");
  el.focus({ preventScroll: true });
}

// The messages, each a list item that names its speaker above its bubble:
// Prudence under her mark, on the left; the character under the name he
// borrows (his own when he answers a choice), on the left, his emoji as the
// avatar (decorative); the person under "You", on the right. One bubble per
// message, its lines as paragraphs. Each comes with what Listen reads of
// it, the speaker first: "Prudence says: ...", "USPS says: ...", "You
// say: ...". An item's then() runs as it appears.
const saidBy = (name) => t("learn_says", { name: plain(name).trim() });
function message(kind, name, lines, mark = "") {
  return `<li class="learn-msg ${kind}">
      <p class="learn-msg-name">${name}</p>
      <div class="learn-bubble">${mark}${lines.map((line) => `<p>${rich(line)}</p>`).join("")}</div>
    </li>`;
}
const herName = () => `<span class="learn-mark" aria-hidden="true">${icon("check", 18, 3.2)}</span><span>Prudence</span>`;
const prudence = (lines) => ({ html: message("is-prudence", herName(), lines), heard: [saidBy("Prudence"), ...lines] });
// Her tell after a choice, what gave him away: her bubble in gold, with the bulb.
const tell = (line) => ({ html: message("is-prudence is-tell", herName(), [line], drawn("bulb", 26)), heard: [saidBy("Prudence"), line] });
const character = (name, lines) => ({
  html: message("is-character", `<span class="learn-avatar" aria-hidden="true">${esc(L.run.lesson.emoji)}</span><span>${rich(name)}</span>`, lines),
  heard: [saidBy(name), ...lines],
});
const you = (line) => ({ html: message("is-you", esc(t("learn_you")), [line]), heard: [t("learn_you_say"), line] });
// The question, a heading in the thread; Listen reads it with its choices
// (run.waiting), and Rewind gives it the focus back by its id.
const question = (step, q) => ({ html: `<li class="learn-ask"><h2 id="learnQ${q}" class="learn-question">${rich(step.ask)}</h2></li>`, heard: [] });

// The items from step i on, up to and including the next chat or ask; the
// run then waits on that chat or ask, or on Next after the last say. A say
// is Prudence's (from: narrator, the default) or the character's, under the
// name he borrows when the step gives one.
const linesOf = (v) => (Array.isArray(v) ? v : []);
const asksBefore = (k) => L.run.lesson.steps.slice(0, k).filter(isAsk).length;
function storyFrom(i) {
  const { steps, character: own } = L.run.lesson;
  const items = [];
  let k = i;
  for (; k < steps.length; k += 1) {
    const step = steps[k];
    if (isAsk(step)) { items.push(question(step, asksBefore(k))); break; }
    if (isChat(step)) { items.push(prudence(linesOf(step.chat))); break; }
    if (isSay(step)) items.push(step.from === "character" ? character(step.as || own, linesOf(step.say)) : prudence(linesOf(step.say)));
  }
  L.run.step = k;
  return items;
}

// The lesson screen: its frame at once (the header, the stepper, the title,
// the thread still empty), then the first beat, from Prudence's hello to
// the first chat. The title has the focus (paint), so the opening moves none.
function drawThread() {
  const { lesson } = L.run;
  paint(`
    <div class="v2 learn learn-run">
      ${header()}
      ${stepper(0)}
      <div class="learn-lesson-head"><span class="learn-emoji" aria-hidden="true">${esc(lesson.emoji)}</span><h1>${rich(lesson.title)}</h1></div>
      <ol class="learn-thread" role="list" aria-label="${esc(t("learn_thread"))}"></ol>
    </div>`);
  bindHeader(() => speak(spoken([...L.run.heard, ...L.run.waiting]), L.lang));
  L.run.heard = [lesson.title];
  beat(storyFrom(0), waitBox, { wait: true, focus: false });
}

// One beat: its messages appended one at a time, each scrolled into view,
// then its buttons, so nothing of a beat can be tapped while it is still
// appearing. A beat still appearing when the screen changes (Back, another
// tab, the end) stops there. Once it is all there, focus moves to its first
// new message: a screen reader reads the new messages in order, then
// reaches the buttons (no live region on top: it would read them twice).
// buttons(added) builds the buttons for what the run now waits on.
function beat(items, buttons, { wait = false, focus = true } = {}) {
  const run = L.run;
  const n = painted;
  const quick = calm();
  const thread = $(".learn-thread", L.root);
  const added = [];
  const put = (item) => {
    const li = node(item.html);
    thread.append(li);
    added.push(li);
    run.heard.push(...item.heard);
    item.then?.();
    reveal(li);
  };
  const end = () => {
    const box = buttons(added);
    thread.after(box);
    reveal(box);
    shownAt = performance.now();
    if (focus) focusOn(added[0]);
  };
  let i = 0;
  const next = () => {
    if (stale(n) || L.run !== run) return;
    if (quick) { items.forEach(put); end(); return; }
    if (i === items.length) { end(); return; }
    put(items[i]);
    i += 1;
    pending = setTimeout(next, PACE);
  };
  // The opening lets the title come first; under reduced motion it waits
  // only for the app to focus the title before the thread scrolls.
  if (wait) pending = setTimeout(next, quick ? 0 : PACE);
  else next();
}

// The buttons for what the thread waits on: a chat's replies, a question's
// choices, or Next after the last message.
function waitBox() {
  const step = L.run.lesson.steps[L.run.step];
  if (isAsk(step)) return choicesBox(step, asksBefore(L.run.step));
  if (isChat(step)) return repliesBox(step);
  return nextBox();
}
// A tap: its buttons go (the words tapped come back as the person's
// message), the reading stops, and Listen starts again from here.
function tapped(box) {
  box.remove();
  if ("speechSynthesis" in window) speechSynthesis.cancel();
  L.run.heard = [];
  L.run.waiting = [];
}

// A chat's replies, in the person's own voice: never right or wrong, no star
// (Behavior 3). A tap: the person's message, Prudence's answer, then the
// story goes on to the next chat, question or the end.
function repliesBox(step) {
  const replies = Array.isArray(step.replies) ? step.replies : [];
  const box = node(`<div class="learn-choices" role="group" aria-label="${esc(t("learn_choose_reply"))}">
      ${replies.map((r, i) => `<button class="btn learn-choice" type="button" data-reply="${i}">${icon("chat", 26)}<span>${rich(r.say)}</span></button>`).join("")}
    </div>`);
  box.querySelectorAll(".learn-choice").forEach((b) => b.addEventListener("click", () => {
    if (tooSoon()) return;
    const reply = replies[Number(b.dataset.reply)];
    tapped(box);
    beat([you(reply.say), ...(reply.answer ? [prudence([reply.answer])] : []), ...storyFrom(L.run.step + 1)], waitBox);
  }));
  L.run.waiting = replies.map((r) => r.say);
  return box;
}

// "What do you do?" and two to four big buttons. Back after a Rewind, the
// answers tried stay in their place, grey and marked "Tried" in words (and
// aria-disabled, so a screen reader says it too); a tap on one does nothing.
function choicesBox(step, q) {
  const tried = L.run.tried[q] || [];
  const button = (c, i) => (tried.includes(i)
    ? `<button class="btn learn-choice is-tried" type="button" data-choice="${i}" aria-disabled="true">${drawn("circle", 26)}<span class="learn-choice-words"><span>${rich(c.text)}</span> <span class="learn-tried">${esc(t("learn_tried"))}</span></span></button>`
    : `<button class="btn learn-choice" type="button" data-choice="${i}">${drawn("circle", 26)}<span>${rich(c.text)}</span></button>`);
  const box = node(`<div class="learn-choices" role="group" aria-label="${esc(t("learn_choose"))}">
      ${step.choices.map(button).join("")}
    </div>`);
  box.querySelectorAll(".learn-choice").forEach((b) => b.addEventListener("click", () => {
    if (b.getAttribute("aria-disabled") === "true" || tooSoon()) return;
    choose(step, q, Number(b.dataset.choice), box);
  }));
  L.run.waiting = [step.ask, ...step.choices.flatMap((c, i) => (tried.includes(i) ? [c.text, t("learn_tried")] : [c.text]))];
  return box;
}

// After a choice (Behavior 4): the person's message, the character's answer
// in his own voice and his own name, Prudence's tell. Right: the cheer,
// confetti and the star the first time, then the story goes on by itself.
// Wrong: no verdict and no right answer shown, one Rewind at the end.
function choose(step, q, i, box) {
  const run = L.run;
  const choice = step.choices[i];
  const right = choice.right === true;
  if (run.answers[q] === undefined) run.answers[q] = right; // the first choice on a question decides its star
  if (!right) run.tried[q] = [...(run.tried[q] || []), i];
  tapped(box);
  const items = [you(choice.text),
    ...(choice.reply ? [character(run.lesson.character, [choice.reply])] : []), ...(choice.tell ? [tell(choice.tell)] : [])];
  if (!right) { beat(items, (added) => rewindBox(step, q, added)); return; }
  items.push(cheer(q));
  beat([...items, ...storyFrom(run.step + 1)], waitBox);
}

// The cheer, a small note in the thread: "Well spotted!", and under it "You
// earned a star." the first time, as the star pops in, there and in the
// stepper (which moves on to the next choice); confetti falls, more of it
// on a 3 of 3.
function cheer(q) {
  const { answers, total } = L.run;
  const earned = answers[q] === true;
  const perfect = earned && answers.filter(Boolean).length === total;
  return {
    html: `<li class="learn-cheer"><span class="learn-cheer-dot" aria-hidden="true">${earned ? star(30, true) : icon("check", 28, 3)}</span>
        <p><strong>${esc(t("learn_right"))}</strong>${earned ? ` <span>${esc(t("learn_right_star"))}</span>` : ""}</p></li>`,
    heard: [t("learn_right"), ...(earned ? [t("learn_right_star")] : [])],
    then() {
      $(".learn-stepper", L.root)?.replaceWith(node(stepper(Math.min(q + 1, total - 1), earned ? q : -1)));
      $(".learn-confetti", L.root)?.remove();
      $(".learn-run", L.root)?.prepend(node(confetti(perfect)));
    },
  };
}

// After a wrong choice: one big gold Rewind at the end of the thread (the ⏪
// drawn, the font has no such glyph). It takes the person's message, his
// answer and the tell back out (they slide away; under reduced motion they
// just go), then brings the same choices back with the tried one greyed,
// and the question takes the focus.
function rewindBox(step, q, added) {
  const box = node(`<div class="learn-thread-end"><button id="learnRewind" class="btn btn-gold btn-big" type="button">${drawn("rewind", 26)}${t("learn_rewind")}</button></div>`);
  $("#learnRewind", box).addEventListener("click", () => {
    if (tooSoon()) return;
    const run = L.run;
    const n = painted;
    tapped(box);
    const back = () => {
      if (stale(n) || L.run !== run) return;
      added.forEach((li) => li.remove());
      const choices = choicesBox(step, q);
      $(".learn-thread", L.root).after(choices);
      reveal(choices);
      shownAt = performance.now();
      focusOn($(`#learnQ${q}`, L.root));
    };
    if (calm()) { back(); return; }
    added.forEach((li) => li.classList.add("is-leaving"));
    pending = setTimeout(back, LEAVE);
  });
  L.run.waiting = [];
  return box;
}

// After the last message: one big gold Next, to the stars and the rule.
function nextBox() {
  const box = node(`<div class="learn-thread-end"><button id="learnNext" class="btn btn-gold btn-big" type="button">${t("learn_next")}${icon("chevron-right", 26, 2.5)}</button></div>`);
  $("#learnNext", box).addEventListener("click", () => { if (!tooSoon()) drawEnd(); });
  L.run.waiting = [];
  return box;
}

// CSS-only confetti that falls once (about 1.2 s), hidden from screen
// readers, more pieces on the third star of a 3 of 3; nothing at all with
// reduced motion. The pieces are placed by their class (no inline styles).
function confetti(big) {
  const pieces = Array.from({ length: big ? 36 : 24 }, (_, i) => `<i class="lc-${i + 1}"></i>`).join("");
  return `<div class="learn-confetti${big ? " is-big" : ""}" aria-hidden="true">${pieces}</div>`;
}

// The first time through earns the badge. The result is saved once: in the
// account (the server applies the same rules) or on this device.
function save(run) {
  const lessonId = run.lesson.id;
  const stars = run.answers.filter(Boolean).length;
  const day = localDay();
  const firstTime = !L.progress.badges.includes(lessonId);
  L.progress = applyLessonResult(L.progress, { lessonId, stars, day });
  L.summary = summarize(L.progress, L.lessons, day);
  if (L.local) {
    writeLocal(L.progress);
  } else {
    const mine = L;
    saving = api(`/api/learn/progress/${enc(lessonId)}`, { method: "PUT", body: { stars, day } })
      .then((r) => { if (mine === L && r?.progress) { L.progress = normalized(r.progress); L.summary = r.summary || L.summary; } })
      .catch(() => toast(t("learn_save_failed"), "danger"));
  }
  return { stars, firstTime };
}

// The next lesson not done yet, after this one in the list order.
function nextLesson(id) {
  const i = L.lessons.findIndex((l) => l.id === id);
  return [...L.lessons.slice(i + 1), ...L.lessons.slice(0, Math.max(i, 0))].find((l) => !isDone(l.id)) || null;
}

// "Next lesson" replaces the finished lesson in the history, so Back goes
// to the Learn home rather than into the lesson just finished.
function nextLessonLink(next) {
  return next ? `<a id="learnNextLesson" class="btn btn-navy btn-big" href="${base()}/${enc(next.id)}">${t("learn_next_lesson")}${icon("chevron-right", 26, 2.5)}</a>` : "";
}
function bindNextLesson() {
  $("#learnNextLesson", L.root)?.addEventListener("click", (e) => { e.preventDefault(); location.replace(e.currentTarget.getAttribute("href")); });
}

function drawEnd() {
  const run = L.run;
  if (!run.saved) run.saved = save(run);
  const { stars, firstTime } = run.saved;
  const { lesson } = run;
  const next = nextLesson(lesson.id);
  const of = plural(stars, "learn_of", { n: stars, total: run.total });
  paint(`
    <div class="v2 learn learn-run">
      ${header()}
      <section class="learn-end">
        <h1>${t("learn_finished")}</h1>
        <p class="learn-end-stars"><span class="learn-end-row">${starRow(stars, run.total, 44, 1.6)}</span><span>${esc(of)}</span></p>
        ${firstTime ? `
          <div class="learn-new-badge">
            <span class="learn-new-badge-emoji" aria-hidden="true">${esc(lesson.emoji)}</span>
            <span class="learn-new-badge-words"><span class="learn-new-badge-label">${t("learn_new_badge")}</span><span class="learn-new-badge-name">${rich(lesson.badge)}</span></span>
          </div>` : ""}
      </section>
      <section class="learn-rule" aria-labelledby="learnRuleTitle">
        <h2 id="learnRuleTitle">${drawn("bulb", 24)} ${t("learn_rule")}</h2>
        <p class="learn-rule-text">${rich(lesson.rule)}</p>
      </section>
      <div class="learn-end-actions">
        ${lesson.demo_case ? `<button id="learnReal" class="btn btn-gold btn-big" type="button">${icon("chat", 26)} ${t("learn_try_real")}</button>` : ""}
        ${nextLessonLink(next)}
        <a class="btn-link" href="${base()}">${t("learn_back")}</a>
      </div>
    </div>`);
  bindHeader(say([t("learn_finished"), of, ...(firstTime ? [t("learn_new_badge"), lesson.badge] : []), t("learn_rule"), lesson.rule]));
  $("#learnReal", L.root)?.addEventListener("click", drawReal);
  bindNextLesson();
}

// "Try it on a real one": the lesson's example message, judged live by the
// same engine as the demo (POST /api/demo/check, public), on this screen.
async function drawReal() {
  const { lesson } = L.run;
  const next = nextLesson(lesson.id);
  const n = paint(`
    <div class="v2 learn learn-run">
      ${header()}
      <h1 class="screen-title">${t("learn_try_real")}</h1>
      <p class="v2-wait">${t("checking")} ${t("please_wait")}</p>
    </div>`);
  $("#learnRead", L.root)?.remove();
  let msg; let v;
  try {
    [msg, v] = await Promise.all([
      loadInbox(L.lang).then((list) => list.find((m) => m.id === lesson.demo_case) || null),
      api("/api/demo/check", { method: "POST", body: { id: lesson.demo_case } }),
    ]);
  } catch {
    if (stale(n)) return;
    paint(`<div class="v2 learn learn-run">${header()}<h1 class="screen-title">${t("learn_try_real")}</h1>
      <p class="banner danger" role="alert">${t("check_failed")} ${t("check_failed_tip")}</p>
      <button id="learnRetry" class="btn btn-navy btn-big" type="button">${t("retry")}</button></div>`);
    $("#learnRead", L.root)?.remove();
    $("#learnRetry", L.root).addEventListener("click", drawReal);
    return;
  }
  if (stale(n)) return;
  // No verdict (a check still running or a broken answer) is never shown as Safe.
  const judged = v && ["safe", "be_careful", "scam"].includes(v.verdict);
  const body = String(msg?.body || "");
  const long = body.length > 160; // a long message sits behind a button, the verdict in front
  paint(`
    <div class="v2 learn learn-run">
      ${header()}
      <h1 class="screen-title">${t("learn_try_real")}</h1>
      <p class="learn-real-note">${t("learn_real_note")}</p>
      ${msg ? `
        <article class="learn-real-msg">
          <p class="learn-real-from">${icon("chat", 22)} ${esc(msg.fromName || msg.from || "")}</p>
          ${msg.subject ? `<p class="learn-real-subject">${esc(msg.subject)}</p>` : ""}
          ${long ? `
            <button id="learnShow" class="btn btn-light-dark" type="button" aria-expanded="false" aria-controls="learnBody">${t("v2_show")}</button>
            <pre id="learnBody" class="mail-body" hidden>${esc(body)}</pre>` : `<p class="learn-real-body">${esc(body)}</p>`}
        </article>` : ""}
      ${judged ? verdictCard(v) : `
        <div class="v2-card caution"><p class="v2-badge">${t("checking")}</p>
          <p class="v2-headline">${t("v2_unknown_title")}</p><p class="v2-fact">${t("v2_unknown_note")}</p></div>
        <button id="learnRetry" class="btn btn-navy btn-big" type="button">${t("retry")}</button>`}
      <div class="learn-end-actions">
        ${nextLessonLink(next)}
        <a class="btn-link" href="${base()}">${t("learn_back")}</a>
      </div>
    </div>`);
  if (judged) bindHeader(() => readAloud(v));
  else $("#learnRead", L.root)?.remove();
  $("#learnRetry", L.root)?.addEventListener("click", drawReal);
  $("#learnShow", L.root)?.addEventListener("click", (e) => {
    const box = $("#learnBody", L.root);
    box.hidden = !box.hidden;
    e.currentTarget.setAttribute("aria-expanded", String(!box.hidden));
    e.currentTarget.textContent = box.hidden ? t("v2_show") : t("v2_hide");
  });
  bindNextLesson();
}

// The four shapes the shared set (icon() in ui.js) has not got: the answer
// circle, the bulb of the tell and the rule, Play again, and Rewind (⏪, two
// filled triangles: the font has no such glyph). Same stroke style, decorative.
const PATHS = {
  circle: '<circle cx="12" cy="12" r="8.5"/>',
  bulb: '<path d="M9 18h6"/><path d="M10 21h4"/><path d="M12 3a6 6 0 0 0-3.6 10.8c.7.6 1.1 1.3 1.1 2.2h5c0-.9.4-1.6 1.1-2.2A6 6 0 0 0 12 3z"/>',
  replay: '<path d="M3 12a9 9 0 1 0 2.64-6.36L3 8"/><path d="M3 3v5h5"/>',
  rewind: '<path d="M11.5 6.5 4 12l7.5 5.5z" fill="currentColor"/><path d="M20.5 6.5 13 12l7.5 5.5z" fill="currentColor"/>',
};
function drawn(name, size = 24, width = 2) {
  return `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="${width}" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">${PATHS[name] || ""}</svg>`;
}
