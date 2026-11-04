// Micro-learning lessons (_product/specs/micro-learning.md): the YAML files
// under data/lessons/<lang>/, each a conversation the person is inside. A chat
// step is Prudence talking, then one to three replies the person taps, each
// with her answer; a say step is Prudence's lines (the narrator) or the scam
// character's text under the name he borrows; three ask steps stop the story
// on a choice, which he answers before Prudence names the tell. Checked
// against the lesson format and paired across languages, plus the pure
// progress rules (best stars, badges, days in a row). No server imports:
// `make lessons-check` and the tests use it without a database.

import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { parse } from "yaml";

export const LANGS = ["en", "fr"];
const ROOT = fileURLToPath(new URL("../", import.meta.url));
export const LESSONS_DIR = join(ROOT, "data", "lessons");
export const CASES_FILE = join(ROOT, "testcases", "cases.json");

const REQUIRED = ["id", "order", "title", "character", "emoji", "minutes", "badge", "rule", "steps"];
const FIELDS = [...REQUIRED, "demo_case"];
const MAX_CHARS = 140; // every text stays under it, counted in characters, not bytes
const MAX_AS = 40; // the name the character borrows, on his bubble
const MAX_REPLY = 60; // a reply the person taps in a chat: it is a button
const ASKS = 3;
const CHATS = 2; // at least: the lesson talks before it tests
const SAYS_IN_A_ROW = 2; // at most: more is a lecture
const KINDS = ["say", "chat", "ask"]; // a step is exactly one of them
const SPEAKERS = ["narrator", "character"]; // who says a say step; narrator when the file does not say
const ID = /^[a-z0-9-]+$/;
const DAY = /^\d{4}-\d{2}-\d{2}$/;
const EMOJI = /\p{Extended_Pictographic}|\p{Regional_Indicator}|⃣/u;
const graphemes = new Intl.Segmenter("en", { granularity: "grapheme" });

const isObj = (v) => v !== null && typeof v === "object" && !Array.isArray(v);
const has = (o, key) => isObj(o) && Object.hasOwn(o, key);
const blank = (v) => v === undefined || v === null || v === "";
// The kinds a step holds, and its kind: "say", "chat", "ask", or null for a
// step that holds several, none or is not a step (checkStep names those).
const kindsOf = (step) => KINDS.filter((k) => has(step, k));
const kindOf = (step) => {
  const kinds = kindsOf(step);
  return kinds.length === 1 ? kinds[0] : null;
};
const chars = (s) => [...graphemes.segment(s)].length;
const firstLine = (s) => String(s).split("\n")[0].replace(/:\s*$/, "");

// A wrong value as a problem names it: short, quoted when it is text.
function shown(v) {
  if (v === undefined || v === null) return "nothing";
  if (Array.isArray(v)) return v.length ? `a list of ${v.length}` : "an empty list";
  if (isObj(v)) return "a group of fields";
  if (typeof v === "string") return JSON.stringify([...v].length > 40 ? `${[...v].slice(0, 40).join("")}…` : v);
  if (typeof v === "number") return `the number ${v}`;
  return String(v);
}

// **bold** is the only markup: no HTML, no links, no lone *.
function markupProblem(s) {
  if (/[<>]/.test(s)) return "no < or > (HTML is not allowed); **bold** is the only markup";
  if (s.includes("[") || s.includes("](")) return "no [ or ]( (links are not allowed); **bold** is the only markup";
  if (s.replace(/\*\*[^*]+\*\*/g, "").includes("*")) return "a lone * is not allowed; bold is written **like this**";
  return null;
}

function checkText(problems, where, value, max = MAX_CHARS) {
  if (blank(value)) {
    problems.push(`${where}: missing`);
  } else if (typeof value !== "string") {
    // The usual cause: an unquoted line with ": " in it ("Pay here: usps-redelivery.co"), which YAML reads as a field.
    const colon = isObj(value) ? "; a colon followed by a space makes YAML read the line as a field, so put the line in quotes" : "";
    problems.push(`${where}: must be text, found ${shown(value)}${colon}`);
  } else if (!value.trim()) {
    problems.push(`${where}: is blank`);
  } else {
    const n = chars(value);
    if (n >= max) problems.push(`${where}: ${n} characters, keep it under ${max}`);
    const markup = markupProblem(value);
    if (markup) problems.push(`${where}: ${markup}`);
  }
}

// A text the format lets you leave out: absent is fine, an empty line is not.
function checkOptionalText(problems, where, obj, key, what, max = MAX_CHARS) {
  if (!has(obj, key)) return;
  if (blank(obj[key])) problems.push(`${where}: empty; write ${what} or remove the line`);
  else checkText(problems, where, obj[key], max);
}

function unknownFields(problems, where, obj, allowed) {
  for (const key of Object.keys(obj)) {
    if (!allowed.includes(key)) problems.push(`${where}${key}: unknown field; expected ${allowed.join(", ")}`);
  }
}

// A say's lines and a chat's: a list of 1 to 3 texts.
function checkLines(problems, where, lines) {
  if (!Array.isArray(lines)) {
    problems.push(`${where}: must be a list of 1 to 3 lines, found ${shown(lines)}`);
    return;
  }
  if (lines.length < 1 || lines.length > 3) problems.push(`${where}: 1 to 3 lines, found ${lines.length}`);
  lines.forEach((line, j) => checkText(problems, `${where}[${j}]`, line));
}

function checkStep(problems, where, step) {
  const kinds = kindsOf(step);
  if (kinds.length !== 1) {
    const found = kinds.length > 1 ? `${kinds.slice(0, -1).join(", ")} and ${kinds.at(-1)} in one step` : isObj(step) ? "none of the three" : shown(step);
    problems.push(`${where}: a step is say (1 to 3 lines), chat (Prudence's lines with replies) or ask (a question with choices), found ${found}`);
    return;
  }
  if (kinds[0] === "say") {
    unknownFields(problems, `${where}.`, step, ["from", "as", "say"]);
    const speakerOk = !has(step, "from") || SPEAKERS.includes(step.from);
    // "you" spoke in the stories before they learned to talk; nothing is scripted for the person any more.
    const you = step.from === "you" ? "; what the person says is a reply they tap: write a chat step with replies" : "";
    if (!speakerOk) problems.push(`${where}.from: must be narrator or character, found ${shown(step.from)}${you}`);
    if (step.from === "character") checkOptionalText(problems, `${where}.as`, step, "as", "the name he borrows", MAX_AS);
    // A wrong from is the problem to fix first; as is judged once it is right.
    else if (has(step, "as") && speakerOk) problems.push(`${where}.as: only a text from the character carries a borrowed name; add from: character or remove as`);
    checkLines(problems, `${where}.say`, step.say);
    return;
  }
  if (kinds[0] === "chat") {
    // Prudence talks, then waits for one tap: each reply is the person's
    // button and her answer to it, never right or wrong.
    unknownFields(problems, `${where}.`, step, ["chat", "replies"]);
    checkLines(problems, `${where}.chat`, step.chat);
    if (!Array.isArray(step.replies)) {
      problems.push(`${where}.replies: must be a list of 1 to 3 replies, found ${shown(step.replies)}`);
      return;
    }
    if (step.replies.length < 1 || step.replies.length > 3) problems.push(`${where}.replies: 1 to 3 replies, found ${step.replies.length}`);
    step.replies.forEach((reply, j) => {
      const at = `${where}.replies[${j}]`;
      if (!isObj(reply)) {
        problems.push(`${at}: a reply has say (the button the person taps) and answer (Prudence's answer), found ${shown(reply)}`);
        return;
      }
      unknownFields(problems, `${at}.`, reply, ["say", "answer"]);
      checkText(problems, `${at}.say`, reply.say, MAX_REPLY);
      checkText(problems, `${at}.answer`, reply.answer);
    });
    return;
  }
  unknownFields(problems, `${where}.`, step, ["ask", "choices"]);
  checkText(problems, `${where}.ask`, step.ask);
  if (!Array.isArray(step.choices)) {
    problems.push(`${where}.choices: must be a list of 2 to 4 choices, found ${shown(step.choices)}`);
    return;
  }
  if (step.choices.length < 2 || step.choices.length > 4) problems.push(`${where}.choices: 2 to 4 choices, found ${step.choices.length}`);
  step.choices.forEach((choice, j) => {
    const at = `${where}.choices[${j}]`;
    if (!isObj(choice)) {
      problems.push(`${at}: a choice has text, reply, tell and maybe right: true, found ${shown(choice)}`);
      return;
    }
    unknownFields(problems, `${at}.`, choice, ["text", "right", "reply", "tell"]);
    checkText(problems, `${at}.text`, choice.text);
    checkText(problems, `${at}.reply`, choice.reply);
    if (choice.right !== undefined && typeof choice.right !== "boolean") problems.push(`${at}.right: must be true or false, found ${shown(choice.right)}`);
    // The narrator's tell: on every choice that is not right, optional on the
    // right one; a right that is neither true nor false is fixed first.
    if (choice.right === true) checkOptionalText(problems, `${at}.tell`, choice, "tell", "the narrator's plain line");
    else if (!blank(choice.tell)) checkText(problems, `${at}.tell`, choice.tell);
    else if (choice.right === undefined || choice.right === false) problems.push(`${at}.tell: missing; a choice that is not right needs the narrator's plain line`);
  });
  const right = step.choices.filter((c) => isObj(c) && c.right === true).length;
  if (right !== 1) problems.push(`${where}.choices: exactly one choice must have right: true, found ${right}`);
}

// The story around the questions: exactly three of them, Prudence first (a
// say or a chat) and a say last (the scammer leaves), never more than two
// says in a row (a chat or an ask breaks the run), the character's own text
// at least once, and the talk before the test: a chat before the first
// question and two chats at least.
function checkStory(problems, steps) {
  const kinds = steps.map(kindOf);
  const asks = kinds.filter((k) => k === "ask").length;
  if (asks !== ASKS) problems.push(`steps: exactly ${ASKS} ask steps (questions), found ${asks}`);
  if (kinds[0] === "ask") problems.push("steps[0]: the story opens on a say or a chat (Prudence speaks first), found an ask");
  const last = steps.length - 1;
  // A lone ask is the opening's problem; a lone chat is the ending's.
  if (kinds[last] === "chat" || (last > 0 && kinds[last] === "ask")) {
    problems.push(`steps[${last}]: the story ends with a say (the scammer leaves), found ${kinds[last] === "ask" ? "an ask" : "a chat"}`);
  }
  let start = -1; // where the current run of says began
  [...kinds, null].forEach((kind, i) => {
    if (kind === "say") {
      if (start < 0) start = i;
    } else {
      if (start >= 0 && i - start > SAYS_IN_A_ROW) {
        problems.push(`steps[${start}] to steps[${i - 1}]: ${i - start} says in a row; ${SAYS_IN_A_ROW} at most, so the story never turns into a lecture`);
      }
      start = -1;
    }
  });
  if (!steps.some((s, i) => kinds[i] === "say" && s.from === "character")) {
    problems.push("steps: no say from the character; at least one needs from: character (the scam is shown, not described)");
  }
  const firstAsk = kinds.indexOf("ask");
  if (firstAsk >= 0 && !kinds.slice(0, firstAsk).includes("chat")) {
    problems.push("steps: no chat before the first ask; Prudence talks with the person before the first question");
  }
  const chats = kinds.filter((k) => k === "chat").length;
  if (chats < CHATS) problems.push(`steps: ${chats || "no"} chat step; ${CHATS} at least, so the lesson talks before it tests`);
}

// One parsed lesson against the format of the spec. Returns the problems in
// plain words, each naming its field ("steps[2].choices: ..."); [] when valid.
// caseIds: the ids of testcases/cases.json whose locale starts with lang.
export function validateLesson(doc, { lang = "en", caseIds = new Set() } = {}) {
  if (!isObj(doc)) return [`not a lesson: expected the fields ${REQUIRED.join(", ")}, found ${shown(doc)}`];
  const problems = [];
  unknownFields(problems, "", doc, FIELDS);
  for (const key of REQUIRED) if (doc[key] === undefined || doc[key] === null || doc[key] === "") problems.push(`${key}: missing`);

  if (doc.id != null && doc.id !== "" && (typeof doc.id !== "string" || !ID.test(doc.id))) {
    problems.push(`id: only lowercase letters, digits and dashes, found ${shown(doc.id)}`);
  }
  if (doc.order != null && doc.order !== "" && (!Number.isInteger(doc.order) || doc.order < 1)) {
    problems.push(`order: must be a whole number, 1 or more, found ${shown(doc.order)}`);
  }
  for (const key of ["title", "character", "badge", "rule"]) if (doc[key] != null && doc[key] !== "") checkText(problems, key, doc[key]);
  if (doc.emoji != null && doc.emoji !== "" && (typeof doc.emoji !== "string" || chars(doc.emoji) !== 1 || !EMOJI.test(doc.emoji))) {
    problems.push(`emoji: must be exactly one emoji, found ${shown(doc.emoji)}`);
  }
  if (doc.minutes != null && doc.minutes !== "" && (!Number.isInteger(doc.minutes) || doc.minutes < 1)) {
    problems.push(`minutes: must be a whole number, 1 or more, found ${shown(doc.minutes)}`);
  }
  if (has(doc, "demo_case")) {
    if (doc.demo_case == null || doc.demo_case === "") problems.push("demo_case: empty; name a case of testcases/cases.json or remove the line");
    else if (typeof doc.demo_case !== "string" || !caseIds.has(doc.demo_case)) {
      problems.push(`demo_case: ${shown(doc.demo_case)} is not a case of testcases/cases.json whose locale starts with "${lang}"`);
    }
  }
  if (doc.steps != null && doc.steps !== "") {
    if (!Array.isArray(doc.steps) || !doc.steps.length) {
      problems.push(`steps: must be a list of steps, found ${shown(doc.steps)}`);
    } else {
      doc.steps.forEach((step, i) => checkStep(problems, `steps[${i}]`, step));
      checkStory(problems, doc.steps);
    }
  }
  return problems;
}

// Per step: its kind, who says a say (narrator when the file does not say),
// per chat the number of replies, and per ask the number of choices and where
// the right one is (-1: none).
const shape = (lesson) => (Array.isArray(lesson.steps) ? lesson.steps : []).map((s) => {
  const kind = kindOf(s);
  if (kind === "say") return { kind, from: s.from ?? "narrator" };
  if (kind === "chat") return { kind, replies: Array.isArray(s.replies) ? s.replies.length : 0 };
  if (kind !== "ask") return { kind: "not a step" };
  const choices = Array.isArray(s.choices) ? s.choices : [];
  return { kind, choices: choices.length, right: choices.findIndex((c) => isObj(c) && c.right === true) };
});
const rightOn = (i) => (i < 0 ? "on no choice" : `on choices[${i}]`);

// The English and French files tell the same lesson, so the two languages
// play the same: same ids, and per id the same order on the Learn home, the
// same number of steps, the same kinds in the same order, the same speaker
// on each say, the same number of replies per chat, the same number of
// choices per question and the right choice at the same place. The lines,
// the replies and her answers, the borrowed name and the tells are
// translated, so they may differ.
// Returns [{ id, lang, problem }], lang being the file to fix.
export function twinProblems(en, fr) {
  const byId = (list) => new Map((list || []).filter((l) => isObj(l) && typeof l.id === "string").map((l) => [l.id, l]));
  const E = byId(en);
  const F = byId(fr);
  const problems = [];
  for (const id of E.keys()) if (!F.has(id)) problems.push({ id, lang: "en", problem: `no French twin: add fr/${id}.yaml with the same id and steps` });
  for (const id of F.keys()) if (!E.has(id)) problems.push({ id, lang: "fr", problem: `no English twin: add en/${id}.yaml with the same id and steps` });
  for (const [id, lesson] of E) {
    if (!F.has(id)) continue;
    const a = shape(lesson);
    const b = shape(F.get(id));
    const differ = (what) => problems.push({ id, lang: "fr", problem: `differs from en/${id}.yaml: ${what}` });
    if (lesson.order !== F.get(id).order) differ(`order ${F.get(id).order ?? "none"} here, ${lesson.order ?? "none"} in English`);
    if (a.length !== b.length) {
      differ(`${b.length} steps here, ${a.length} in English`);
      continue;
    }
    a.forEach((step, i) => {
      const other = b[i];
      if (step.kind !== other.kind) differ(`steps[${i}] is ${other.kind} here, ${step.kind} in English`);
      else if (step.kind === "say" && step.from !== other.from) differ(`steps[${i}] is from: ${other.from} here, from: ${step.from} in English`);
      else if (step.kind === "chat" && step.replies !== other.replies) differ(`steps[${i}] has ${other.replies} ${other.replies === 1 ? "reply" : "replies"} here, ${step.replies} in English`);
      else if (step.kind === "ask" && step.choices !== other.choices) differ(`steps[${i}] has ${other.choices} choices here, ${step.choices} in English`);
      else if (step.kind === "ask" && step.right !== other.right) differ(`steps[${i}] has right: true ${rightOn(other.right)} here, ${rightOn(step.right)} in English`);
    });
  }
  return problems;
}

function readCaseIds(casesFile, problems) {
  const ids = Object.fromEntries(LANGS.map((lang) => [lang, new Set()]));
  try {
    const { cases } = JSON.parse(readFileSync(casesFile, "utf8"));
    for (const c of Array.isArray(cases) ? cases : []) {
      for (const lang of LANGS) if (String(c?.locale || "").startsWith(lang)) ids[lang].add(c.id);
    }
  } catch (e) {
    problems.push({ file: casesFile, problem: `could not read the demo cases: ${firstLine(e.message)}` });
  }
  return ids;
}

function readLesson(file, stem, lang, caseIds) {
  let text;
  try {
    text = readFileSync(file, "utf8");
  } catch (e) {
    return { problems: [`could not read the file: ${firstLine(e.message)}`] };
  }
  let lesson;
  try {
    lesson = parse(text);
  } catch (e) {
    return { problems: [`not valid YAML: ${firstLine(e.message)}`] };
  }
  const problems = validateLesson(lesson, { lang, caseIds });
  if (isObj(lesson) && typeof lesson.id === "string" && ID.test(lesson.id) && lesson.id !== stem) {
    problems.push(`id: "${lesson.id}" does not match the file name; the file must be ${lesson.id}.yaml`);
  }
  return { lesson, problems };
}

// A lesson as the app gets it: every say names its speaker, the narrator when
// the file does not say, so the screens never guess; a chat or an ask is
// served as it is. The file's own object is left as it was.
const served = (lesson) => ({ ...lesson, steps: lesson.steps.map((s) => (has(s, "say") ? { from: "narrator", ...s } : s)) });

// Every lesson that is valid in English and in French, as the app gets it
// (served above), each list sorted by order (the Learn home's order) then id,
// and every problem with its file.
// Never throws: a broken file is reported and left out, with its twin; so are
// two lessons of one language that share an order.
export function loadLessons({ dir = LESSONS_DIR, casesFile = CASES_FILE } = {}) {
  const problems = [];
  const caseIds = readCaseIds(casesFile, problems);
  const valid = {}; // lang -> Map(id -> lesson): the files with no problem of their own
  const present = {}; // lang -> Set(file name without .yaml), broken files included
  for (const lang of LANGS) {
    valid[lang] = new Map();
    present[lang] = new Set();
    const folder = join(dir, lang);
    let names;
    try {
      names = readdirSync(folder, { withFileTypes: true }).filter((e) => e.isFile() && !e.name.startsWith(".")).map((e) => e.name).sort();
    } catch (e) {
      problems.push({ file: folder, problem: `could not read the ${lang} lessons folder (${e.code || firstLine(e.message)})` });
      continue;
    }
    for (const name of names) {
      const file = join(folder, name);
      if (!name.endsWith(".yaml")) {
        problems.push({ file, problem: "not a lesson file: lessons are named <id>.yaml" });
        continue;
      }
      const stem = name.slice(0, -".yaml".length);
      present[lang].add(stem);
      const own = readLesson(file, stem, lang, caseIds[lang]);
      for (const problem of own.problems) problems.push({ file, problem });
      if (!own.problems.length) valid[lang].set(stem, served(own.lesson));
    }
    const byOrder = Map.groupBy(valid[lang].values(), (l) => l.order);
    for (const [order, same] of byOrder) {
      if (same.length < 2) continue;
      for (const l of same) {
        const others = same.filter((x) => x !== l).map((x) => `${lang}/${x.id}.yaml`).join(", ");
        problems.push({ file: join(folder, `${l.id}.yaml`), problem: `order: ${order} is also the order of ${others}; each lesson needs its own number` });
        valid[lang].delete(l.id);
      }
    }
  }
  // Twins are compared on the files valid in their own language; a twin that
  // exists but is broken already has its problems listed above.
  const comparable = (lang, other) => [...valid[lang].values()].filter((l) => valid[other].has(l.id) || !present[other].has(l.id));
  const twins = twinProblems(comparable("en", "fr"), comparable("fr", "en"));
  for (const t of twins) problems.push({ file: join(dir, t.lang, `${t.id}.yaml`), problem: t.problem });
  const unpaired = new Set(twins.map((t) => t.id));
  const lessons = Object.fromEntries(LANGS.map((lang) => [lang,
    [...valid[lang].values()].filter((l) => !unpaired.has(l.id) && LANGS.every((other) => valid[other].has(l.id)))
      .sort((a, b) => a.order - b.order || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))]));
  problems.sort((a, b) => (a.file < b.file ? -1 : a.file > b.file ? 1 : 0));
  return { lessons, problems };
}

// ---------------------------------------------------------------- progress

// "YYYY-MM-DD" -> days since 1970-01-01 (UTC); NaN when it is not a real day.
function dayNumber(day) {
  if (typeof day !== "string" || !DAY.test(day)) return NaN;
  const [y, m, d] = day.split("-").map(Number);
  const at = new Date(Date.UTC(y, m - 1, d));
  return at.getUTCFullYear() === y && at.getUTCMonth() === m - 1 && at.getUTCDate() === d ? at.getTime() / 86400000 : NaN;
}

export const isDay = (day) => Number.isFinite(dayNumber(day));
export const daysBetween = (from, to) => dayNumber(to) - dayNumber(from);
export const utcDay = (date = new Date()) => date.toISOString().slice(0, 10);

export function emptyProgress() {
  return { lessons: {}, badges: [], streak: { days: 0, lastDay: null } };
}

// Stored progress may be partial or older: fill the gaps, keep what is there.
function normalized(progress) {
  const p = isObj(progress) ? progress : {};
  const s = isObj(p.streak) ? p.streak : {};
  return {
    lessons: isObj(p.lessons) ? p.lessons : {},
    badges: Array.isArray(p.badges) ? p.badges : [],
    streak: { days: Number.isInteger(s.days) && s.days > 0 ? s.days : 0, lastDay: isDay(s.lastDay) ? s.lastDay : null },
  };
}

// Why a lesson result cannot be saved, in plain words, or null: 0 to 3 stars
// (one per right answer) and the person's day, within two days of today (UTC).
export function resultProblem(result, today = utcDay()) {
  const { stars, day } = isObj(result) ? result : {};
  if (!Number.isInteger(stars) || stars < 0 || stars > 3) return "stars must be a whole number from 0 to 3.";
  if (!isDay(day)) return "day must be a date written like 2026-10-29.";
  if (Math.abs(daysBetween(today, day)) > 2) return `day must be within two days of today (${today}).`;
  return null;
}

// A finished lesson: the best stars are kept, plays counted, the badge earned
// the first time whatever the score, and the days in a row: the same day
// counts once, the next day adds one, a gap starts again at 1. A day before
// the last one recorded leaves the streak as it is. Nothing ever goes down
// and the progress passed in is never changed.
export function applyLessonResult(progress, { lessonId, stars, day }) {
  if (typeof lessonId !== "string" || !lessonId || !Number.isInteger(stars) || stars < 0 || stars > 3 || !isDay(day)) {
    throw new RangeError("applyLessonResult needs a lessonId, 0 to 3 stars and a YYYY-MM-DD day");
  }
  const p = normalized(progress);
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

// The Learn home's progress line: lessons done out of the lessons shipped,
// stars earned on them, and the days in a row while the streak is alive
// (the last day is yesterday, today, or later: the person's day may run
// ahead of UTC), else 0.
export function summarize(progress, lessons, today = utcDay()) {
  const p = normalized(progress);
  const list = Array.isArray(lessons) ? lessons : [];
  const mine = list.map((l) => p.lessons[l?.id]).filter(isObj);
  const day = today instanceof Date ? utcDay(today) : today;
  const alive = p.streak.lastDay && daysBetween(p.streak.lastDay, day) <= 1;
  return {
    done: mine.filter((x) => x.done === true).length,
    total: list.length,
    stars: mine.reduce((n, x) => n + (Number.isInteger(x.stars) ? x.stars : 0), 0),
    days: alive ? p.streak.days : 0,
  };
}
