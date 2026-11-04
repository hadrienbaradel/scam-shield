// Learn (_product/specs/micro-learning.md; the 2026-11-04 redesign canvas,
// frames 1o and 1p, _product/specs/protection-menu.md line 7; the spec's
// "Story screens"): one-minute lessons told as stories, one step per screen
// like Today's one card at a time. Prudence narrates, the character's texts
// land in a bubble under the name he borrows, the person's own lines sit on
// the right; three times the story stops on "What do you do?", with the
// text it answers on the same screen. After each choice the character
// answers in his own voice and the narrator names the tell. A right choice
// earns a cheer and confetti (a star when it is the first try); a wrong one
// plays out, then Rewind brings the same choice back with the tried answer
// greyed. The lesson ends with the rule to remember.
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
// lesson may hold, checked by lib/lessons.js) becomes <strong>.
const rich = (s) => esc(s).replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>");
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
// the new heading (a screen reader says where the person is), docks the
// Next button above the tabs, and counts screens so that an answer arriving
// after the person has moved on is dropped instead of drawn over them.
let painted = 0;
let paintedAt = 0;
function paint(html, { focus = true } = {}) {
  if ("speechSynthesis" in window) speechSynthesis.cancel(); // a new screen never keeps reading the last one
  L.root.innerHTML = html;
  const dock = L.root.querySelector(".v2-actions");
  document.body.classList.toggle("v2-docked", Boolean(dock));
  if (dock) document.body.style.setProperty("--dock-h", `${dock.offsetHeight}px`);
  if (focus) { window.scrollTo(0, 0); focusHeading(L.root); }
  paintedAt = performance.now();
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
// A lesson is a story the person is inside (micro-learning.md, Behavior 3
// and 4), one step per screen, except that a say right before an ask shares
// the ask's screen, so the decision always has its text in view. Its state
// stays in memory while it runs; progress is written once, on the end
// screen, so leaving in the middle loses nothing that was saved.
//   answers[q]  whether the first choice on question q was the right one:
//               its star (stars count first tries, 0 to 3)
//   tried[q]    the choices tried on question q, greyed and marked "Tried"
//               when Rewind brings the question back
function startLesson(lesson) {
  L.run = { lesson, step: 0, answers: [], tried: [], total: lesson.steps.filter(isAsk).length, saved: null };
  drawStep();
}

// The question the person is on (a say step counts toward the next one).
const questionAt = () => Math.min(L.run.lesson.steps.slice(0, L.run.step).filter(isAsk).length, L.run.total - 1);
// A tap landing within a moment of a screen appearing is the second half of
// a double tap on the last screen's button: dropped.
const tooSoon = () => performance.now() - paintedAt < 400;

// Frame 1p: "‹ Learn" and the round "Listen" on one row (the shared
// .btn-back and .btn-listen); the rest of the lesson is as it was.
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

// The one button of a lesson screen, docked above the tabs: Next, or Rewind
// after a wrong choice (the ⏪ drawn, the font has no such glyph).
const dockButton = (id, label) => `<div class="v2-actions learn-dock"><button id="${id}" class="btn btn-gold btn-big" type="button">${label}</button></div>`;
const nextButton = () => dockButton("learnNext", `${t("learn_next")}${icon("chevron-right", 26, 2.5)}`);
const rewindButton = () => dockButton("learnRewind", `${drawn("rewind", 26)}${t("learn_rewind")}`);
function bindNext() {
  $("#learnNext", L.root).addEventListener("click", () => {
    if (tooSoon()) return;
    L.run.step += 1;
    drawStep();
  });
}

// A say right before an ask is not a screen of its own: the run steps over
// it to the ask, which draws it on top. Next and Rewind both come through
// here, so the step stays on the ask and the stepper counts asks as before.
function drawStep() {
  const { steps } = L.run.lesson;
  if (isSay(steps[L.run.step]) && isAsk(steps[L.run.step + 1])) L.run.step += 1;
  const step = steps[L.run.step];
  if (!step) return drawEnd();
  return isAsk(step) ? drawAsk(step) : drawSay(step);
}

// Who says a say step: the narrator (also when from is missing), the
// character, or the person ("you").
const speakerOf = (step) => (step?.from === "character" || step?.from === "you" ? step.from : "narrator");
// The name on the character's bubble: the one he borrows ("USPS") when the
// step gives one, his own otherwise. He answers a choice in his own name.
const nameOf = (step) => (speakerOf(step) === "character" && step.as ? step.as : L.run.lesson.character);
// Listen reads a bubble with its speaker first: "USPS says: ...", "You say: ...".
const saidBy = (who, name) => (who === "you" ? t("learn_you_say") : t("learn_says", { name: plain(name).trim() }));

// The narrator: Prudence's lines under her mark, as before the stories.
function narratorLines(lines) {
  return `<div class="learn-say">
      <p class="learn-speaker"><span class="learn-mark" aria-hidden="true">${icon("check", 18, 3.2)}</span>Prudence</p>
      ${lines.map((line) => `<p class="learn-line">${rich(line)}</p>`).join("")}
    </div>`;
}
// A text in the story, one bubble per line like texts on a phone: the
// character's on the left under his name, the lesson's emoji as his avatar
// (decorative); the person's own on the right under "You".
function bubbles(who, name, lines) {
  const you = who === "you";
  const head = you ? esc(t("learn_you"))
    : `<span class="learn-avatar" aria-hidden="true">${esc(L.run.lesson.emoji)}</span><span>${rich(name)}</span>`;
  return `<div class="learn-msg ${you ? "is-you" : "is-character"}">
      <p class="learn-msg-name">${head}</p>
      ${lines.map((line) => `<p class="learn-bubble">${rich(line)}</p>`).join("")}
    </div>`;
}

// A say as it shows, on its own screen or on top of the ask it leads to,
// and what Listen reads of it (a bubble starts with its speaker).
const linesOf = (step) => (Array.isArray(step.say) ? step.say : []);
function sayBlock(step) {
  const who = speakerOf(step);
  return who === "narrator" ? narratorLines(linesOf(step)) : bubbles(who, nameOf(step), linesOf(step));
}
const sayHeard = (step) => (speakerOf(step) === "narrator" ? linesOf(step) : [saidBy(speakerOf(step), nameOf(step)), ...linesOf(step)]);

function drawSay(step) {
  const { lesson } = L.run;
  paint(`
    <div class="v2 learn learn-run">
      ${header()}
      ${stepper(questionAt())}
      <div class="learn-lesson-head"><span class="learn-emoji" aria-hidden="true">${esc(lesson.emoji)}</span><h1>${rich(lesson.title)}</h1></div>
      ${sayBlock(step)}
      ${nextButton()}
    </div>`);
  bindHeader(say(sayHeard(step)));
  bindNext();
}

// "What do you do?" and two to four big buttons, under the say that leads to
// it (drawn as on its own screen; Rewind brings it back too). The question
// stays the heading that takes the focus, described by that text so a screen
// reader hears what it answers. Back after a Rewind, the answers tried stay
// in their place, grey and marked "Tried" in words (and aria-disabled, so a
// screen reader says it too); a tap on one does nothing.
function drawAsk(step) {
  const q = questionAt();
  const before = L.run.lesson.steps[L.run.step - 1];
  const lead = isSay(before) ? before : null; // the say right before shares this screen
  const tried = L.run.tried[q] || [];
  const button = (c, i) => (tried.includes(i)
    ? `<button class="btn learn-choice is-tried" type="button" data-choice="${i}" aria-disabled="true">${drawn("circle", 26)}<span class="learn-choice-words"><span>${rich(c.text)}</span> <span class="learn-tried">${esc(t("learn_tried"))}</span></span></button>`
    : `<button class="btn learn-choice" type="button" data-choice="${i}">${drawn("circle", 26)}<span>${rich(c.text)}</span></button>`);
  paint(`
    <div class="v2 learn learn-run">
      ${header()}
      ${stepper(q)}
      ${lead ? `<div id="learnAskSay" class="learn-ask-say">${sayBlock(lead)}</div>` : ""}
      <h1 class="learn-question"${lead ? ' aria-describedby="learnAskSay"' : ""}>${rich(step.ask)}</h1>
      <div class="learn-choices" role="group" aria-label="${esc(t("learn_choose"))}">
        ${step.choices.map(button).join("")}
      </div>
    </div>`);
  bindHeader(say([...(lead ? sayHeard(lead) : []), step.ask, ...step.choices.flatMap((c, i) => (tried.includes(i) ? [c.text, t("learn_tried")] : [c.text]))]));
  L.root.querySelectorAll(".learn-choice").forEach((b) => b.addEventListener("click", () => {
    if (b.getAttribute("aria-disabled") === "true" || tooSoon()) return;
    const i = Number(b.dataset.choice);
    const choice = step.choices[i];
    const right = choice.right === true;
    if (L.run.answers[q] === undefined) L.run.answers[q] = right; // the first choice on a question decides its star
    if (!right) L.run.tried[q] = [...tried, i];
    drawResult(q, choice);
  }));
}

// After a choice (Behavior 4): what the person chose in a plain box, never
// red; the character's answer in his own voice; the narrator's tell, one
// plain line under it. Right: the cheer, confetti, the star when it was the
// first try, and Next. Wrong: no verdict and no right answer shown; the box
// is the screen's heading, and Rewind brings the same choice back.
function drawResult(q, choice) {
  const { lesson, answers, total } = L.run;
  const right = choice.right === true;
  const earned = right && answers[q] === true; // right the first time: the star is earned now
  const perfect = earned && answers.filter(Boolean).length === total;
  const box = right ? "div" : "h1";
  paint(`
    <div class="v2 learn learn-run">
      ${header()}
      ${stepper(q, earned ? q : -1)}
      <section class="learn-result" role="status">
        ${right ? `
          <div class="learn-result-head">
            <span class="learn-result-dot" aria-hidden="true">${earned ? star(30, true) : icon("check", 30, 3)}</span>
            <div class="learn-result-words"><h1>${t("learn_right")}</h1>${earned ? `<p class="learn-result-sub">${t("learn_right_star")}</p>` : ""}</div>
          </div>` : ""}
        <${box} class="learn-pick"><span class="learn-pick-label">${t("learn_your_answer")}<span class="learn-sr">:</span></span> <span class="learn-pick-text">${rich(choice.text)}</span></${box}>
        ${choice.reply ? bubbles("character", lesson.character, [choice.reply]) : ""}
        ${choice.tell ? `<p class="learn-tell">${drawn("bulb", 26)}<span>${rich(choice.tell)}</span></p>` : ""}
      </section>
      ${right ? `${confetti(perfect)}${nextButton()}` : rewindButton()}
    </div>`);
  const story = [t("learn_your_answer"), choice.text,
    ...(choice.reply ? [saidBy("character", lesson.character), choice.reply] : []), ...(choice.tell ? [choice.tell] : [])];
  bindHeader(say(right ? [t("learn_right"), ...(earned ? [t("learn_right_star")] : []), ...story] : story));
  if (right) bindNext();
  else $("#learnRewind", L.root).addEventListener("click", () => { if (!tooSoon()) drawStep(); });
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
