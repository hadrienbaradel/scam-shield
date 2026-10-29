// Learn (_product/specs/micro-learning.md, design canvas "Prudence Learn
// tab"): one-minute lessons, one step per screen like Today's one card at a
// time. Prudence says a few lines, asks a question with big answer buttons,
// cheers a right answer (a star, confetti) and explains a wrong one without
// blame; the lesson ends with the rule to remember. Lessons come from
// GET /api/lessons; progress is kept in the account when signed in and on
// this device in the demo (#/demo/learn).

import { api } from "../api.js";
import { t, getLang } from "../i18n.js";
import { $, esc, verdictCard, readAloud, speak, toast, focusHeading } from "../ui.js";

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
const onLearn = () => /^#\/(demo\/)?learn\b/.test(location.hash);
const stale = (n) => n !== painted || !L.root.isConnected || !onLearn();

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
    <button id="learnRetry" class="btn btn-navy v2-big" type="button">${t("retry")}</button></div>`, { focus: false });
  $("#learnRetry", L.root).addEventListener("click", () => renderLearn(L.root, L.status, { demo: L.demo }));
}

const isDone = (id) => L.progress.lessons[id]?.done === true;
const starsOf = (id) => (Number.isInteger(L.progress.lessons[id]?.stars) ? L.progress.lessons[id].stars : 0);

// Stars are drawn, never typed (the font has no ★, and gold text on white
// fails contrast): a navy outline, a gold fill when earned, always beside words.
const STAR = '<path d="M12 2.9l2.35 6.76 7.16.15-5.71 4.33 2.08 6.85L12 16.9l-5.88 4.09 2.08-6.85-5.71-4.33 7.16-.15z"/>';
const star = (size, on, width = 2) => `<svg class="learn-star-icon${on ? " is-on" : ""}" width="${size}" height="${size}" viewBox="0 0 24 24" stroke-width="${width}" stroke-linejoin="round" aria-hidden="true">${STAR}</svg>`;
const starRow = (n, total, size, width) => Array.from({ length: total }, (_, i) => star(size, i < n, width)).join("");

// ------------------------------------------------------------------- home
function drawHome() {
  const s = L.summary;
  const parts = [plural(s.done, "learn_lessons", { done: s.done, total: s.total }), plural(s.stars, "learn_stars", { n: s.stars }),
    ...(s.days >= 2 ? [t("learn_days", { n: s.days })] : [])];
  const badges = L.progress.badges.map((id) => L.lessons.find((l) => l.id === id)).filter(Boolean);
  const todo = L.lessons.filter((l) => !isDone(l.id));
  const done = L.lessons.filter((l) => isDone(l.id));
  paint(`
    <div class="v2 learn">
      <div class="learn-hello">
        <h1 class="v2-hello">${t("learn_title")}</h1>
        <p class="learn-lead">${t("learn_lead")}</p>
      </div>
      <section class="learn-progress" aria-label="${esc(t("learn_progress_label"))}">
        <p class="learn-progress-line">${parts.map((p) => `<span>${esc(p)}</span>`).join("&nbsp;· ")}</p>
        ${badges.length ? `
          <div class="learn-badges-box">
            <h2>${t("learn_badges")}</h2>
            <ul class="learn-badges">${badges.map((l) => `<li class="learn-badge"><span class="learn-badge-emoji" aria-hidden="true">${esc(l.emoji)}</span>${rich(l.badge)}</li>`).join("")}</ul>
          </div>` : ""}
      </section>
      ${todo.length ? `
        <section class="learn-group" aria-labelledby="learnToTry">
          <h2 id="learnToTry">${t("learn_to_try")}</h2>
          <ul class="learn-list">${todo.map((l, i) => lessonCard(l, i === 0 ? "next" : "todo")).join("")}</ul>
        </section>` : ""}
      ${done.length ? `
        <section class="learn-group" aria-labelledby="learnDone">
          <h2 id="learnDone">${t("learn_done_title")}</h2>
          <ul class="learn-list">${done.map((l) => lessonCard(l, "done")).join("")}</ul>
        </section>` : ""}
    </div>`);
}

// One whole-card link per lesson: the first one not done is bigger, with a
// gold Start bar; a done one shows its best stars and can be played again.
function lessonCard(l, kind) {
  const href = `${base()}/${enc(l.id)}`;
  const emoji = () => `<span class="learn-emoji" aria-hidden="true">${esc(l.emoji)}</span>`;
  const minutes = esc(plural(l.minutes, "learn_minutes", { n: l.minutes }));
  if (kind === "next") {
    return `<li><a class="learn-lesson is-next" href="${href}">
      <span class="learn-lesson-top">${emoji()}<span class="learn-lesson-body"><span class="learn-lesson-title">${rich(l.title)}</span><span class="learn-meta">${minutes}</span></span></span>
      <span class="learn-start">${t("learn_start")} ${icon("next", 26)}</span></a></li>`;
  }
  if (kind === "todo") {
    return `<li><a class="learn-lesson" href="${href}">${emoji()}<span class="learn-lesson-body"><span class="learn-lesson-title">${rich(l.title)}</span>
      <span class="learn-meta">${minutes}<span aria-hidden="true">·</span><span class="learn-cue">${t("learn_start")} ${icon("next", 20)}</span></span></span></a></li>`;
  }
  const n = starsOf(l.id);
  const total = l.steps.filter(isAsk).length; // one star per question
  return `<li><a class="learn-lesson is-done" href="${href}">${emoji()}<span class="learn-lesson-body"><span class="learn-lesson-title">${rich(l.title)}</span>
    <span class="learn-stars"><span class="learn-star-row">${starRow(n, total, 24)}</span><span>${esc(plural(n, "learn_of", { n, total }))}</span></span>
    <span class="learn-meta"><span class="learn-done">${icon("check", 20, 2.4)}${t("learn_done_chip")}</span><span class="learn-cue">${icon("replay", 20)}${t("learn_again")}</span></span></span></a></li>`;
}

// ---------------------------------------------------------------- a lesson
// The lesson state stays in memory while it runs; progress is written once,
// on the end screen. Leaving in the middle loses nothing that was saved.
function startLesson(lesson) {
  L.run = { lesson, step: 0, answers: [], total: lesson.steps.filter(isAsk).length, saved: null };
  drawStep();
}

// The question the person is on (a say step counts toward the next one).
const questionAt = () => Math.min(L.run.lesson.steps.slice(0, L.run.step).filter(isAsk).length, L.run.total - 1);

function header() {
  const listen = "speechSynthesis" in window
    ? `<button id="learnRead" class="v2-read" type="button" aria-label="${esc(t("v2_read"))}">${icon("speaker", 24)} <span aria-hidden="true">${t("v2_read_short")}</span></button>` : "";
  return `<header class="v2-head">
      <a class="v2-back" href="${base()}" aria-label="${esc(t("learn_back"))}">${icon("back", 24)} ${t("learn_tab")}</a>${listen}
    </header>`;
}
// onRead: what Listen does on this screen.
const bindHeader = (onRead) => $("#learnRead", L.root)?.addEventListener("click", onRead);
const say = (parts) => () => speak(spoken(parts), L.lang);

// "Question 1 of 3" and three stars: earned ones filled, the current one
// underlined in gold, the one just earned popping in.
function stepper(q, fresh = -1) {
  const { answers, total } = L.run;
  const got = answers.filter(Boolean).length;
  const label = got ? plural(got, "learn_so_far", { n: got }) : t("learn_no_stars");
  return `<div class="learn-stepper">
      <p class="learn-step-label">${esc(t("learn_question", { i: q + 1, n: total }))}</p>
      <span class="learn-step-stars" role="img" aria-label="${esc(label)}">${Array.from({ length: total }, (_, i) =>
    `<span class="learn-star${answers[i] ? " is-on" : ""}${i === q ? " is-current" : ""}${i === fresh ? " is-new" : ""}">${star(24, answers[i])}</span>`).join("")}</span>
    </div>`;
}

const nextButton = () => `<div class="v2-actions learn-dock"><button id="learnNext" class="btn btn-gold v2-big" type="button">${t("learn_next")} ${icon("next", 26)}</button></div>`;
function bindNext() {
  $("#learnNext", L.root).addEventListener("click", () => { L.run.step += 1; drawStep(); });
}

function drawStep() {
  const step = L.run.lesson.steps[L.run.step];
  if (!step) return drawEnd();
  return isAsk(step) ? drawAsk(step) : drawSay(step);
}

function drawSay(step) {
  const { lesson } = L.run;
  const lines = Array.isArray(step.say) ? step.say : [];
  paint(`
    <div class="v2 learn">
      ${header()}
      ${stepper(questionAt())}
      <div class="learn-lesson-head"><span class="learn-emoji" aria-hidden="true">${esc(lesson.emoji)}</span><h1>${rich(lesson.title)}</h1></div>
      <div class="learn-say">
        <p class="learn-speaker"><span class="learn-mark" aria-hidden="true">✓</span>Prudence</p>
        ${lines.map((line) => `<p class="learn-line">${rich(line)}</p>`).join("")}
      </div>
      ${nextButton()}
    </div>`);
  bindHeader(say(lines));
  bindNext();
}

function drawAsk(step) {
  const q = questionAt();
  paint(`
    <div class="v2 learn">
      ${header()}
      ${stepper(q)}
      <h1 class="learn-question">${rich(step.ask)}</h1>
      <div class="learn-choices" role="group" aria-label="${esc(t("learn_choose"))}">
        ${step.choices.map((c, i) => `<button class="btn learn-choice" type="button" data-choice="${i}">${icon("circle", 26)}<span>${rich(c.text)}</span></button>`).join("")}
      </div>
    </div>`);
  bindHeader(say([step.ask, ...step.choices.map((c) => c.text)]));
  L.root.querySelectorAll(".learn-choice").forEach((b) => b.addEventListener("click", () => {
    // One answer per question; a tap landing within a moment of the screen
    // appearing is the second half of a double tap on the last screen's Next.
    if (L.run.answers[q] !== undefined || performance.now() - paintedAt < 400) return;
    const choice = step.choices[Number(b.dataset.choice)];
    L.run.answers[q] = choice.right === true;
    drawResult(step, q, choice);
  }));
}

// Right: a cheer, a star and confetti. Wrong: a warm line, what they chose
// and why it fails (never in red), then the right answer. No second try.
function drawResult(step, q, choice) {
  const ok = choice.right === true;
  const right = step.choices.find((c) => c.right === true) || choice;
  const perfect = ok && L.run.answers.filter(Boolean).length === L.run.total;
  paint(`
    <div class="v2 learn">
      ${header()}
      ${stepper(q, ok ? q : -1)}
      ${ok ? `
        <section class="learn-result is-right" role="status">
          <div class="learn-result-head">
            <span class="learn-result-dot" aria-hidden="true">${star(30, true)}</span>
            <div class="learn-result-words"><h1>${t("learn_right")}</h1><p class="learn-result-sub">${t("learn_right_star")}</p></div>
          </div>
          <p class="learn-line learn-reply">${rich(choice.reply)}</p>
        </section>
        ${confetti(perfect)}` : `
        <section class="learn-result is-wrong" role="status">
          <div class="learn-result-head">
            <span class="learn-result-dot" aria-hidden="true">${icon("bulb", 30)}</span>
            <h1>${t("learn_wrong")}</h1>
          </div>
          <div class="learn-pick">
            <p class="learn-pick-label">${t("learn_your_answer")}</p>
            <p class="learn-pick-text">${rich(choice.text)}</p>
            <p class="learn-pick-reply">${rich(choice.reply)}</p>
          </div>
          <div class="learn-pick is-right">
            <p class="learn-pick-label">${icon("check", 24, 2.6)}${t("learn_right_answer")}</p>
            <p class="learn-pick-text">${rich(right.text)}</p>
          </div>
        </section>`}
      ${nextButton()}
    </div>`);
  bindHeader(ok ? say([t("learn_right"), t("learn_right_star"), choice.reply])
    : say([t("learn_wrong"), t("learn_your_answer"), choice.text, choice.reply, t("learn_right_answer"), right.text]));
  bindNext();
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
  return next ? `<a id="learnNextLesson" class="btn btn-navy v2-big" href="${base()}/${enc(next.id)}">${t("learn_next_lesson")} ${icon("next", 26)}</a>` : "";
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
    <div class="v2 learn">
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
        <h2 id="learnRuleTitle">${icon("bulb", 24)} ${t("learn_rule")}</h2>
        <p class="learn-rule-text">${rich(lesson.rule)}</p>
      </section>
      <div class="learn-end-actions">
        ${lesson.demo_case ? `<button id="learnReal" class="btn btn-gold v2-big" type="button">${icon("message", 26)} ${t("learn_try_real")}</button>` : ""}
        ${nextLessonLink(next)}
        <a class="v2-link" href="${base()}">${t("learn_back")}</a>
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
    <div class="v2 learn">
      ${header()}
      <h1 class="v2-hello">${t("learn_try_real")}</h1>
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
    paint(`<div class="v2 learn">${header()}<h1 class="v2-hello">${t("learn_try_real")}</h1>
      <p class="banner danger" role="alert">${t("check_failed")} ${t("check_failed_tip")}</p>
      <button id="learnRetry" class="btn btn-navy v2-big" type="button">${t("retry")}</button></div>`);
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
    <div class="v2 learn">
      ${header()}
      <h1 class="v2-hello">${t("learn_try_real")}</h1>
      <p class="learn-real-note">${t("learn_real_note")}</p>
      ${msg ? `
        <article class="learn-real-msg">
          <p class="learn-real-from">${icon("message", 22)} ${esc(msg.fromName || msg.from || "")}</p>
          ${msg.subject ? `<p class="learn-real-subject">${esc(msg.subject)}</p>` : ""}
          ${long ? `
            <button id="learnShow" class="btn btn-light-dark" type="button" aria-expanded="false" aria-controls="learnBody">${t("v2_show")}</button>
            <pre id="learnBody" class="mail-body" hidden>${esc(body)}</pre>` : `<p class="learn-real-body">${esc(body)}</p>`}
        </article>` : ""}
      ${judged ? verdictCard(v) : `
        <div class="v2-card caution"><p class="v2-badge">${t("checking")}</p>
          <p class="v2-headline">${t("v2_unknown_title")}</p><p class="v2-fact">${t("v2_unknown_note")}</p></div>
        <button id="learnRetry" class="btn btn-navy v2-big" type="button">${t("retry")}</button>`}
      <div class="learn-end-actions">
        ${nextLessonLink(next)}
        <a class="v2-link" href="${base()}">${t("learn_back")}</a>
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

// Inline stroke icons (no emoji, no icon font); decorative, hidden from screen readers.
const PATHS = {
  back: '<path d="M15 18l-6-6 6-6"/>', next: '<path d="M9 6l6 6-6 6"/>',
  speaker: '<path d="M4 9v6h4l5 4V5L8 9H4z"/><path d="M16.5 8.5a5 5 0 0 1 0 7"/><path d="M19 6a8.5 8.5 0 0 1 0 12"/>',
  check: '<path d="M5 12.5l4.5 4.5L19 7.5"/>', circle: '<circle cx="12" cy="12" r="8.5"/>',
  bulb: '<path d="M9 18h6"/><path d="M10 21h4"/><path d="M12 3a6 6 0 0 0-3.6 10.8c.7.6 1.1 1.3 1.1 2.2h5c0-.9.4-1.6 1.1-2.2A6 6 0 0 0 12 3z"/>',
  replay: '<path d="M3 12a9 9 0 1 0 2.64-6.36L3 8"/><path d="M3 3v5h5"/>',
  message: '<path d="M4 5h16v11H8l-4 4z"/>',
};
function icon(name, size = 24, width = 2) {
  return `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="${width}" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${PATHS[name] || ""}</svg>`;
}
