// Micro-learning (_product/specs/micro-learning.md): the lesson files and
// their format, the EN/FR twins, make lessons-check, the progress rules
// (stars, badges, days in a row), GET /api/lessons, and the signed-in
// progress in Postgres (those tests skip without it, like integration.test.js).
import "./helpers/env.js";
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, relative } from "node:path";
import { stringify } from "yaml";
import {
  applyLessonResult, CASES_FILE, emptyProgress, LANGS, loadLessons, resultProblem, summarize, twinProblems, utcDay, validateLesson,
} from "../lib/lessons.js";
import { main as lessonsCheck } from "../scripts/lessons-check.mjs";
import { pool, resetDb, makeUser, sessionFor, dbAvailable } from "./helpers/db.js";
import { one } from "../src/db/pool.js";
import { buildApp } from "../src/server.js";

const ORIGIN = "http://localhost:3999";
const hasDb = await dbAvailable();
const db = { skip: hasDb ? false : "Postgres test database not available" };
const EN = new Set(["D1", "D3"]);
const FR = new Set(["A4"]);
const SHIPPED = loadLessons().lessons;
let app;

before(async () => {
  if (hasDb) await resetDb();
  app = await buildApp({ logger: false });
});
after(async () => { await app?.close(); await pool.end(); });

// A valid lesson; each test breaks one thing in a copy.
const ask = (question, n = 2) => ({
  ask: question,
  choices: Array.from({ length: n }, (_, i) => ({ text: `Choice ${i + 1}`, reply: `Reply ${i + 1}`, ...(i === 1 ? { right: true } : {}) })),
});
const lesson = (over = {}) => ({
  id: "parcel-fee", order: 1, title: "The $1.99 parcel trap", character: "Mr. Tiny Fee", emoji: "📦", minutes: 1,
  badge: "Parcel-fee spotter", rule: "A real carrier never asks you to pay a fee by text.",
  steps: [
    { say: ["Meet **Mr. Tiny Fee**. He never asks for much.", "He counts on one thought."] },
    ask("A text says your package is on hold until you pay $1.99. What do you do?"),
    { say: ["His real prize is **your card number**."] },
    ask("The text says it comes from USPS. How can you be sure?"),
    ask("What is the safest way to check on a parcel?", 3),
  ],
  ...over,
});
const broken = (mutate) => {
  const doc = structuredClone(lesson());
  mutate(doc);
  return validateLesson(doc, { lang: "en", caseIds: EN });
};
const EITHER = "a step is either say (1 to 3 lines) or ask (a question with choices)";

// A checkout in a temp directory: { "data/lessons/en/x.yaml": object or text, ... }.
function checkout(files) {
  const root = mkdtempSync(join(tmpdir(), "lessons-"));
  for (const [path, content] of Object.entries(files)) {
    mkdirSync(dirname(join(root, path)), { recursive: true });
    writeFileSync(join(root, path), typeof content === "string" ? content : stringify(content));
  }
  return root;
}
const CASES = JSON.stringify({ cases: [{ id: "D1", locale: "en-US" }, { id: "A4", locale: "fr-FR" }] });
const load = (root) => loadLessons({ dir: join(root, "data/lessons"), casesFile: join(root, "testcases/cases.json") });
const sink = () => { const s = { text: "", write(chunk) { s.text += chunk; return true; } }; return s; };
const deepFreeze = (o) => { Object.values(o).forEach((v) => v && typeof v === "object" && deepFreeze(v)); return Object.freeze(o); };

// ---------------------------------------------------------------- the lesson format (Behavior 3, 4, 8)

test("a well-formed lesson passes every check, with or without a demo case", () => {
  assert.deepEqual(validateLesson(lesson(), { lang: "en", caseIds: EN }), []);
  assert.deepEqual(validateLesson(lesson({ demo_case: "D1" }), { lang: "en", caseIds: EN }), []);
});

test("a lesson missing a field is refused, and the problem names the field", () => {
  for (const key of ["id", "order", "title", "character", "emoji", "minutes", "badge", "rule", "steps"]) {
    assert.deepEqual(broken((d) => { delete d[key]; }), [`${key}: missing`], key);
  }
  assert.deepEqual(broken((d) => { d.title = ""; }), ["title: missing"]);
  assert.deepEqual(broken((d) => { d.rule = null; }), ["rule: missing"]);
  assert.deepEqual(broken((d) => { d.badge = 7; }), ["badge: must be text, found the number 7"]);
  assert.deepEqual(broken((d) => { d.character = "  "; }), ["character: is blank"]);
  assert.deepEqual(broken((d) => { d.title = true; }), ["title: must be text, found true"]);
});

test("a lesson id is lowercase letters, digits and dashes, like its file name", () => {
  assert.deepEqual(broken((d) => { d.id = "Parcel_Fee"; }), ['id: only lowercase letters, digits and dashes, found "Parcel_Fee"']);
  assert.deepEqual(broken((d) => { d.id = 42; }), ["id: only lowercase letters, digits and dashes, found the number 42"]);
  assert.deepEqual(broken((d) => { d.id = "parcel-fee-2"; }), []);
  assert.deepEqual(broken((d) => { d.id = `The ${"very ".repeat(10)}long trap`; }),
    ['id: only lowercase letters, digits and dashes, found "The very very very very very very very v…"'], "a long value is cut short in the problem");
});

test("each lesson shows exactly one emoji", () => {
  for (const ok of ["📦", "⏰", "👩‍👩‍👧", "🇫🇷", "1️⃣"]) assert.deepEqual(broken((d) => { d.emoji = ok; }), [], ok);
  for (const bad of ["📦📦", "A", "📦 ", ":)", 7, ["📦"]]) {
    assert.match(broken((d) => { d.emoji = bad; }).join("\n"), /^emoji: must be exactly one emoji, found /, String(bad));
  }
});

test("a lesson says how many minutes it takes, as a whole number", () => {
  for (const bad of [0, -1, 1.5, "1"]) assert.match(broken((d) => { d.minutes = bad; }).join("\n"), /^minutes: must be a whole number, 1 or more/, String(bad));
  assert.deepEqual(broken((d) => { d.minutes = 2; }), []);
});

test("a lesson asks exactly three questions, with lines and questions in any order", () => {
  assert.deepEqual(broken((d) => { d.steps.pop(); }), ["steps: exactly 3 ask steps (questions), found 2"]);
  assert.deepEqual(broken((d) => { d.steps.push(ask("One more?")); }), ["steps: exactly 3 ask steps (questions), found 4"]);
  assert.deepEqual(broken((d) => { d.steps = []; }), ["steps: must be a list of steps, found an empty list"]);
  assert.deepEqual(broken((d) => { d.steps = "say hello"; }), ['steps: must be a list of steps, found "say hello"']);
  assert.deepEqual(broken((d) => { d.steps.reverse(); }), []);
});

test("Prudence says one to three short lines at a time", () => {
  assert.deepEqual(broken((d) => { d.steps[0].say = []; }), ["steps[0].say: 1 to 3 lines, found 0"]);
  assert.deepEqual(broken((d) => { d.steps[0].say = ["One.", "Two.", "Three.", "Four."]; }), ["steps[0].say: 1 to 3 lines, found 4"]);
  assert.deepEqual(broken((d) => { d.steps[0].say = "Meet Mr. Tiny Fee."; }), ['steps[0].say: must be a list of 1 to 3 lines, found "Meet Mr. Tiny Fee."']);
  assert.deepEqual(broken((d) => { d.steps[0].say = ["Fine.", 3]; }), ["steps[0].say[1]: must be text, found the number 3"]);
  assert.deepEqual(broken((d) => { d.steps[0].say = ["   "]; }), ["steps[0].say[0]: is blank"]);
});

test("a question offers two to four big answers, exactly one of them right", () => {
  assert.deepEqual(broken((d) => { d.steps[1].choices.splice(0, 1); }), ["steps[1].choices: 2 to 4 choices, found 1"]);
  assert.deepEqual(broken((d) => { d.steps[1].choices.push(...[1, 2, 3].map((i) => ({ text: `More ${i}`, reply: "No." }))); }),
    ["steps[1].choices: 2 to 4 choices, found 5"]);
  assert.deepEqual(broken((d) => { delete d.steps[3].choices[1].right; }), ["steps[3].choices: exactly one choice must have right: true, found 0"]);
  assert.deepEqual(broken((d) => { d.steps[1].choices[0].right = true; }), ["steps[1].choices: exactly one choice must have right: true, found 2"]);
  assert.deepEqual(broken((d) => { d.steps[1].choices[0].right = "yes"; }), ['steps[1].choices[0].right: must be true or false, found "yes"']);
  assert.deepEqual(broken((d) => { d.steps[1].choices[0].right = false; }), []);
  assert.deepEqual(broken((d) => { delete d.steps[1].choices; }), ["steps[1].choices: must be a list of 2 to 4 choices, found nothing"]);
  assert.deepEqual(broken((d) => { d.steps[1].ask = ""; }), ["steps[1].ask: missing"]);
});

test("every answer gets its reply, right or wrong, so the explanation always comes", () => {
  assert.deepEqual(broken((d) => { delete d.steps[1].choices[0].reply; }), ["steps[1].choices[0].reply: missing"]);
  assert.deepEqual(broken((d) => { delete d.steps[1].choices[0].text; }), ["steps[1].choices[0].text: missing"]);
  assert.deepEqual(broken((d) => { d.steps[1].choices[0] = "Pay it"; }),
    ['steps[1].choices[0]: a choice has text, reply and maybe right: true, found "Pay it"']);
});

test("a step is either lines to say or a question, never both or neither", () => {
  assert.equal(broken((d) => { d.steps[0].ask = "And a question?"; })[0], `steps[0]: ${EITHER}, found both`);
  assert.deepEqual(broken((d) => { d.steps[0] = { tell: ["Hi"] }; }), [`steps[0]: ${EITHER}, found neither`]);
  assert.deepEqual(broken((d) => { d.steps[0] = "Hello"; }), [`steps[0]: ${EITHER}, found "Hello"`]);
});

test("every line, question, answer and reply stays under 140 characters, counted as characters, not bytes", () => {
  assert.deepEqual(broken((d) => { d.steps[0].say[0] = "é".repeat(139); }), []);
  assert.deepEqual(broken((d) => { d.steps[0].say[0] = "📦".repeat(139); }), [], "an emoji is one character");
  assert.deepEqual(broken((d) => { d.steps[0].say[0] = "é".repeat(140); }), ["steps[0].say[0]: 140 characters, keep it under 140"]);
  assert.deepEqual(broken((d) => { d.steps[1].ask = "Q".repeat(150); }), ["steps[1].ask: 150 characters, keep it under 140"]);
  assert.deepEqual(broken((d) => { d.steps[1].choices[0].text = "t".repeat(141); }), ["steps[1].choices[0].text: 141 characters, keep it under 140"]);
  assert.deepEqual(broken((d) => { d.steps[1].choices[1].reply = "r".repeat(140); }), ["steps[1].choices[1].reply: 140 characters, keep it under 140"]);
  assert.deepEqual(broken((d) => { d.rule = "r".repeat(200); }), ["rule: 200 characters, keep it under 140"]);
});

test("bold is the only markup a lesson may use: no HTML, no links, no lone star", () => {
  const line = (text) => broken((d) => { d.steps[0].say[0] = text; }).join("\n");
  assert.equal(line("Meet **Mr. Tiny Fee** and **his fee**."), "");
  for (const html of ["<b>Mr. Tiny Fee</b>", "Fees > zero", "<script>"]) assert.match(line(html), /^steps\[0\]\.say\[0\]: no < or > \(HTML is not allowed\)/, html);
  for (const link of ["Go to [usps.com](https://usps-hold.test)", "See [this", "x](y"]) assert.match(line(link), /links are not allowed/, link);
  for (const star of ["A *single* star", "**unclosed bold", "****", "**a*b**"]) assert.match(line(star), /a lone \* is not allowed; bold is written \*\*like this\*\*/, star);
  assert.match(broken((d) => { d.steps[1].choices[0].reply = "<i>No</i>"; }).join("\n"), /^steps\[1\]\.choices\[0\]\.reply: no < or >/);
  assert.match(broken((d) => { d.title = "*New*"; }).join("\n"), /^title: a lone \*/);
});

test("each lesson has its own place in the list: a whole number, never shared within a language", () => {
  for (const bad of [0, -1, 1.5, "1"]) assert.match(broken((d) => { d.order = bad; }).join("\n"), /^order: must be a whole number, 1 or more/, String(bad));
  assert.deepEqual(broken((d) => { d.order = 12; }), []);
  const root = checkout({
    "testcases/cases.json": CASES,
    "data/lessons/en/alpha.yaml": lesson({ id: "alpha", order: 1 }),
    "data/lessons/en/beta.yaml": lesson({ id: "beta", order: 1 }),
    "data/lessons/en/gamma.yaml": lesson({ id: "gamma", order: 2 }),
    "data/lessons/fr/alpha.yaml": lesson({ id: "alpha", order: 1 }),
    "data/lessons/fr/beta.yaml": lesson({ id: "beta", order: 3 }),
    "data/lessons/fr/gamma.yaml": lesson({ id: "gamma", order: 2 }),
  });
  try {
    const { lessons, problems } = load(root);
    assert.deepEqual(problems.map((p) => `${relative(root, p.file)}: ${p.problem}`), [
      "data/lessons/en/alpha.yaml: order: 1 is also the order of en/beta.yaml; each lesson needs its own number",
      "data/lessons/en/beta.yaml: order: 1 is also the order of en/alpha.yaml; each lesson needs its own number",
    ], "their French twins are left out with them, without a second problem");
    assert.deepEqual(lessons.en.map((l) => l.id), ["gamma"]);
    assert.deepEqual(lessons.fr.map((l) => l.id), ["gamma"]);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("a lesson that names a demo case names a real message in its own language", () => {
  assert.deepEqual(validateLesson(lesson({ demo_case: "A4" }), { lang: "fr", caseIds: FR }), []);
  assert.deepEqual(validateLesson(lesson({ demo_case: "D1" }), { lang: "fr", caseIds: FR }),
    ['demo_case: "D1" is not a case of testcases/cases.json whose locale starts with "fr"']);
  assert.match(validateLesson(lesson({ demo_case: "Z9" }), { lang: "en", caseIds: EN }).join("\n"), /^demo_case: "Z9" is not a case/);
  assert.deepEqual(validateLesson(lesson({ demo_case: null }), { lang: "en", caseIds: EN }), ["demo_case: empty; name a case of testcases/cases.json or remove the line"]);
  assert.match(validateLesson(lesson({ demo_case: "D1" })).join("\n"), /^demo_case: "D1" is not a case/, "without a case list, no case is assumed to exist");
});

test("a typo in a field name is caught, never silently ignored", () => {
  assert.deepEqual(validateLesson(lesson({ "demo-case": "D1" }), { lang: "en", caseIds: EN }),
    ["demo-case: unknown field; expected id, order, title, character, emoji, minutes, badge, rule, steps, demo_case"]);
  assert.deepEqual(broken((d) => { d.steps[1].choices[0].rigth = true; }), ["steps[1].choices[0].rigth: unknown field; expected text, reply, right"]);
  assert.deepEqual(broken((d) => { d.steps[0].choices = []; }), ["steps[0].choices: unknown field; expected say"]);
  assert.deepEqual(broken((d) => { d.steps[1].hint = "Look closely."; }), ["steps[1].hint: unknown field; expected ask, choices"]);
});

test("a file that is not a lesson at all is refused in plain words", () => {
  for (const doc of [null, [], "hello", 3]) assert.match(validateLesson(doc)[0], /^not a lesson: expected the fields id, order, title, character/, String(doc));
});

// ---------------------------------------------------------------- English and French twins (Behavior 8)

test("every English lesson has its French twin, and every French one its English twin", () => {
  assert.deepEqual(twinProblems([lesson()], [lesson()]), []);
  assert.deepEqual(twinProblems([lesson(), lesson({ id: "urgency" })], [lesson()]),
    [{ id: "urgency", lang: "en", problem: "no French twin: add fr/urgency.yaml with the same id and steps" }]);
  assert.deepEqual(twinProblems([lesson()], [lesson(), lesson({ id: "gift-card" })]),
    [{ id: "gift-card", lang: "fr", problem: "no English twin: add en/gift-card.yaml with the same id and steps" }]);
});

test("the twins tell the same lesson: the same place in the list, the same steps in the same order, the same number of answers", () => {
  const fr = (mutate) => { const d = structuredClone(lesson()); mutate(d); return twinProblems([lesson()], [d]).map((p) => p.problem); };
  assert.deepEqual(twinProblems([lesson()], [lesson({ order: 2 })]), [{ id: "parcel-fee", lang: "fr", problem: "differs from en/parcel-fee.yaml: order 2 here, 1 in English" }]);
  assert.deepEqual(fr((d) => { d.steps[0].say.push("Une ligne de plus."); }), [], "a translation may take more or fewer lines");
  assert.deepEqual(fr((d) => { d.steps.pop(); }), ["differs from en/parcel-fee.yaml: 4 steps here, 5 in English"]);
  assert.deepEqual(fr((d) => { [d.steps[0], d.steps[1]] = [d.steps[1], d.steps[0]]; }), [
    "differs from en/parcel-fee.yaml: steps[0] is ask here, say in English",
    "differs from en/parcel-fee.yaml: steps[1] is say here, ask in English",
  ]);
  assert.deepEqual(fr((d) => { d.steps[4].choices.pop(); }), ["differs from en/parcel-fee.yaml: steps[4] has 2 choices here, 3 in English"]);
  assert.deepEqual(fr((d) => { d.steps[2] = "?"; d.steps[1].choices = "none"; }), [
    "differs from en/parcel-fee.yaml: steps[1] has 0 choices here, 2 in English",
    "differs from en/parcel-fee.yaml: steps[2] is not a step here, say in English",
  ]);
});

// ---------------------------------------------------------------- loading the files (Behavior 8)

test("a broken lesson file is reported with its name and the problem, and the other lessons still load", () => {
  const root = checkout({
    "testcases/cases.json": CASES,
    "data/lessons/en/parcel-fee.yaml": lesson({ demo_case: "D1" }),
    "data/lessons/fr/parcel-fee.yaml": lesson({ demo_case: "A4" }),
    "data/lessons/en/urgency.yaml": "id: urgency\ntitle: [unclosed\n",
    "data/lessons/fr/urgency.yaml": lesson({ id: "urgency", order: 2 }),
    "data/lessons/en/gift-card.yaml": lesson({ id: "gift-card", order: 3 }),
    "data/lessons/fr/.DS_Store": "finder noise",
    "data/lessons/fr/notes.txt": "a draft",
  });
  try {
    const { lessons, problems } = load(root);
    assert.deepEqual(lessons.en.map((l) => l.id), ["parcel-fee"]);
    assert.deepEqual(lessons.fr.map((l) => l.id), ["parcel-fee"]);
    assert.deepEqual(problems.map((p) => `${relative(root, p.file)}: ${p.problem}`.replace(/ at line .*/, "")), [
      "data/lessons/en/gift-card.yaml: no French twin: add fr/gift-card.yaml with the same id and steps",
      "data/lessons/en/urgency.yaml: not valid YAML: Flow sequence in block collection must be sufficiently indented and end with a ]",
      "data/lessons/fr/notes.txt: not a lesson file: lessons are named <id>.yaml",
    ], "the valid French urgency.yaml is left out with its broken twin, without a second problem");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("a lesson file is named after its id, and the lessons come in their order, not by file name", () => {
  const root = checkout({
    "testcases/cases.json": CASES,
    "data/lessons/en/urgency.yaml": lesson({ id: "urgency", order: 1 }),
    "data/lessons/fr/urgency.yaml": lesson({ id: "urgency", order: 1 }),
    "data/lessons/en/bank.yaml": lesson({ id: "bank", order: 2 }),
    "data/lessons/fr/bank.yaml": lesson({ id: "bank", order: 2 }),
    "data/lessons/en/parcel.yaml": lesson(),
    "data/lessons/fr/parcel.yaml": lesson(),
  });
  try {
    const { lessons, problems } = load(root);
    assert.deepEqual(lessons.en.map((l) => l.id), ["urgency", "bank"]);
    assert.deepEqual(lessons.fr.map((l) => l.id), ["urgency", "bank"]);
    assert.deepEqual(problems.map((p) => `${relative(root, p.file)}: ${p.problem}`), [
      'data/lessons/en/parcel.yaml: id: "parcel-fee" does not match the file name; the file must be parcel-fee.yaml',
      'data/lessons/fr/parcel.yaml: id: "parcel-fee" does not match the file name; the file must be parcel-fee.yaml',
    ]);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("a missing lessons folder or demo cases file is reported, never a crash", () => {
  const root = checkout({ "data/lessons/en/parcel-fee.yaml": lesson({ demo_case: "D1" }) });
  try {
    const { lessons, problems } = loadLessons({ dir: join(root, "data/lessons"), casesFile: join(root, "nowhere.json") });
    assert.deepEqual(lessons, { en: [], fr: [] });
    assert.deepEqual(problems.map((p) => [relative(root, p.file), p.problem.replace(/:.*|\s\(.*/, "")]), [
      ["data/lessons/en/parcel-fee.yaml", "demo_case"],
      ["data/lessons/fr", "could not read the fr lessons folder"],
      ["nowhere.json", "could not read the demo cases"],
    ]);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("make lessons-check fails on a broken file and names it, and passes on the shipped lessons", () => {
  const twin = lesson();
  twin.steps.splice(2, 1);
  const root = checkout({
    "testcases/cases.json": CASES,
    "data/lessons/en/parcel-fee.yaml": lesson(),
    "data/lessons/fr/parcel-fee.yaml": twin,
    "data/lessons/en/urgency.yaml": lesson({ id: "urgency", order: 2, minutes: 0 }),
    "data/lessons/fr/urgency.yaml": lesson({ id: "urgency", order: 2 }),
  });
  try {
    const out = sink();
    assert.equal(lessonsCheck(["--root", root], out, sink()), 1);
    assert.equal(out.text, [
      "lessons-check: 0 lessons in EN and FR, 2 problems",
      "data/lessons/en/urgency.yaml: minutes: must be a whole number, 1 or more, found the number 0",
      "data/lessons/fr/parcel-fee.yaml: differs from en/parcel-fee.yaml: 4 steps here, 5 in English",
      "",
    ].join("\n"));
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
  const shipped = sink();
  assert.equal(lessonsCheck([], shipped, sink()), 0);
  assert.match(shipped.text, /^lessons-check: \d+ lessons in EN and FR, 0 problems\n$/);
  const err = sink();
  assert.equal(lessonsCheck(["--frobnicate"], sink(), err), 2);
  assert.match(err.text, /unknown argument --frobnicate/);
});

// ---------------------------------------------------------------- the shipped lessons (Behavior 6, 8, 9)

test("every shipped lesson loads in English and French with no problem", () => {
  const { lessons, problems } = loadLessons();
  assert.deepEqual(problems, []);
  assert.ok(lessons.en.length >= 2, "at least the two seed lessons");
  assert.deepEqual(lessons.en.map((l) => l.id), lessons.fr.map((l) => l.id));
  for (const id of ["parcel-fee", "urgency"]) assert.ok(lessons.en.some((l) => l.id === id), id);
});

test("the Learn home lists the shipped lessons in their order, the parcel lesson first for the video", () => {
  const known = ["parcel-fee", "grandchild", "urgency", "bank-call", "codes", "tech-support", "gift-cards", "romance-crypto"];
  for (const lang of LANGS) {
    const orders = SHIPPED[lang].map((l) => l.order);
    assert.ok(orders.every((n, i) => i === 0 || n > orders[i - 1]), `${lang}: ${orders.join(", ")}`);
    assert.equal(SHIPPED[lang][0].id, "parcel-fee", lang);
    assert.deepEqual(SHIPPED[lang].map((l) => l.id).filter((id) => known.includes(id)), known, lang);
  }
});

test("'Try it on a real one' opens a real message in the lesson's language", () => {
  const cases = JSON.parse(readFileSync(CASES_FILE, "utf8")).cases;
  for (const lang of LANGS) {
    for (const l of SHIPPED[lang].filter((x) => x.demo_case)) {
      const c = cases.find((x) => x.id === l.demo_case);
      assert.ok(c && c.locale.startsWith(lang), `${lang}/${l.id}.yaml names ${l.demo_case}`);
    }
  }
  assert.equal(SHIPPED.en.find((l) => l.id === "parcel-fee").demo_case, "D1", "the video's lesson opens the USPS $1.99 text");
  assert.equal(SHIPPED.fr.find((l) => l.id === "parcel-fee").demo_case, "A4", "and the Chronopost 1,99 € text in French");
});

// ---------------------------------------------------------------- stars, badges, days in a row (Behavior 7, 10)

test("a finished lesson earns a star per right answer, and playing it again keeps the best score", () => {
  let p = applyLessonResult(emptyProgress(), { lessonId: "parcel-fee", stars: 2, day: "2026-10-29" });
  assert.deepEqual(p.lessons["parcel-fee"], { stars: 2, done: true, plays: 1, lastDay: "2026-10-29" });
  p = applyLessonResult(p, { lessonId: "parcel-fee", stars: 1, day: "2026-10-29" });
  assert.deepEqual(p.lessons["parcel-fee"], { stars: 2, done: true, plays: 2, lastDay: "2026-10-29" });
  p = applyLessonResult(p, { lessonId: "parcel-fee", stars: 3, day: "2026-10-30" });
  assert.deepEqual(p.lessons["parcel-fee"], { stars: 3, done: true, plays: 3, lastDay: "2026-10-30" });
});

test("the badge is earned the first time a lesson is finished, whatever the score, and only once", () => {
  let p = applyLessonResult(emptyProgress(), { lessonId: "urgency", stars: 0, day: "2026-10-29" });
  assert.deepEqual(p.badges, ["urgency"]);
  p = applyLessonResult(p, { lessonId: "urgency", stars: 3, day: "2026-10-30" });
  p = applyLessonResult(p, { lessonId: "parcel-fee", stars: 1, day: "2026-10-30" });
  assert.deepEqual(p.badges, ["urgency", "parcel-fee"]);
});

test("days in a row: a second lesson the same day counts once, the next day adds one, a missed day quietly starts again at 1", () => {
  const play = (p, day) => applyLessonResult(p, { lessonId: "parcel-fee", stars: 1, day });
  let p = play(emptyProgress(), "2026-10-29");
  assert.deepEqual(p.streak, { days: 1, lastDay: "2026-10-29" });
  p = play(p, "2026-10-29");
  assert.deepEqual(p.streak, { days: 1, lastDay: "2026-10-29" });
  p = play(play(play(p, "2026-10-30"), "2026-10-31"), "2026-11-01");
  assert.deepEqual(p.streak, { days: 4, lastDay: "2026-11-01" }, "the end of a month is not a gap");
  p = play(p, "2026-11-03");
  assert.deepEqual(p.streak, { days: 1, lastDay: "2026-11-03" });
  assert.deepEqual(p.lessons["parcel-fee"].stars, 1, "a missed day takes nothing else away");
  assert.equal(play(play(emptyProgress(), "2026-12-31"), "2027-01-01").streak.days, 2, "nor the end of a year");
  assert.equal(play(play(emptyProgress(), "2026-02-28"), "2026-03-01").streak.days, 2);
  assert.equal(play(play(emptyProgress(), "2028-02-28"), "2028-03-01").streak.days, 1, "2028 has a February 29");
});

test("nothing is ever lost: progress is never changed in place, and an earlier day leaves the streak as it is", () => {
  const before = deepFreeze(applyLessonResult(emptyProgress(), { lessonId: "parcel-fee", stars: 3, day: "2026-10-30" }));
  const after = applyLessonResult(before, { lessonId: "parcel-fee", stars: 0, day: "2026-10-29" });
  assert.deepEqual(after.lessons["parcel-fee"], { stars: 3, done: true, plays: 2, lastDay: "2026-10-30" });
  assert.deepEqual(after.streak, { days: 1, lastDay: "2026-10-30" });
  assert.deepEqual(after.badges, ["parcel-fee"]);
  for (const bad of [{ stars: 4, day: "2026-10-30" }, { stars: 1, day: "2026-02-30" }, { stars: 1, day: "2026-10-30", lessonId: "" }]) {
    assert.throws(() => applyLessonResult(before, { lessonId: "parcel-fee", ...bad }), RangeError, JSON.stringify(bad));
  }
});

test("progress saved in an older or partial shape is read without losing anything", () => {
  const old = { lessons: { "parcel-fee": { stars: 2 } }, badges: ["parcel-fee"] };
  assert.deepEqual(applyLessonResult(old, { lessonId: "parcel-fee", stars: 1, day: "2026-10-29" }), {
    lessons: { "parcel-fee": { stars: 2, done: true, plays: 1, lastDay: "2026-10-29" } },
    badges: ["parcel-fee"],
    streak: { days: 1, lastDay: "2026-10-29" },
  });
  assert.deepEqual(applyLessonResult(null, { lessonId: "urgency", stars: 2, day: "2026-10-29" }).badges, ["urgency"]);
  assert.deepEqual(summarize(undefined, null), { done: 0, total: 0, stars: 0, days: 0 });
  assert.deepEqual(summarize({ lessons: "x", badges: "y", streak: { days: -2, lastDay: "soon" } }, [{ id: "a" }], "2026-10-29"),
    { done: 0, total: 1, stars: 0, days: 0 });
});

test("the progress line counts lessons done, stars and days in a row, the days only while the streak is alive", () => {
  const shipped = [{ id: "parcel-fee" }, { id: "urgency" }, { id: "gift-card" }];
  let p = applyLessonResult(emptyProgress(), { lessonId: "parcel-fee", stars: 3, day: "2026-10-29" });
  p = applyLessonResult(p, { lessonId: "urgency", stars: 2, day: "2026-10-30" });
  p = applyLessonResult(p, { lessonId: "retired-lesson", stars: 3, day: "2026-10-30" });
  assert.deepEqual(summarize(p, shipped, "2026-10-30"), { done: 2, total: 3, stars: 5, days: 2 }, "a lesson no longer shipped is not counted");
  assert.equal(summarize(p, shipped, "2026-10-31").days, 2, "until tomorrow is over, the streak is alive");
  assert.equal(summarize(p, shipped, "2026-11-01").days, 0, "a missed day shows no streak");
  assert.equal(summarize(p, shipped, "2026-10-29").days, 2, "the person's day may run ahead of UTC");
  assert.equal(summarize(p, shipped, new Date("2026-10-30T12:00:00Z")).days, 2);
  assert.deepEqual(summarize(emptyProgress(), shipped), { done: 0, total: 3, stars: 0, days: 0 });
});

test("a lesson result needs 0 to 3 stars and a day within two days of today", () => {
  const today = "2026-10-29";
  for (const ok of [{ stars: 3, day: today }, { stars: 0, day: "2026-10-27" }, { stars: 1, day: "2026-10-31" }]) assert.equal(resultProblem(ok, today), null, ok.day);
  for (const stars of [4, -1, 1.5, "3", undefined]) assert.equal(resultProblem({ stars, day: today }, today), "stars must be a whole number from 0 to 3.", String(stars));
  for (const day of ["29/10/2026", "2026-02-30", "yesterday", undefined]) assert.equal(resultProblem({ stars: 1, day }, today), "day must be a date written like 2026-10-29.", String(day));
  assert.equal(resultProblem({ stars: 1, day: "2026-10-26" }, today), "day must be within two days of today (2026-10-29).");
  assert.equal(resultProblem(null, today), "stars must be a whole number from 0 to 3.");
  assert.equal(resultProblem({ stars: 1, day: utcDay() }), null, "today is the server's UTC date by default");
});

// ---------------------------------------------------------------- the HTTP routes (Behavior 1, 7)

test("the lessons open without signing in, in English or French, and any other language gets English", async () => {
  const en = await app.inject({ url: "/api/lessons?lang=en" });
  assert.equal(en.statusCode, 200);
  assert.deepEqual(en.json(), { lessons: SHIPPED.en });
  const fr = (await app.inject({ url: "/api/lessons?lang=fr" })).json().lessons;
  assert.deepEqual(fr, SHIPPED.fr);
  assert.equal(fr.find((l) => l.id === "parcel-fee").character, "Monsieur Petits Frais");
  for (const query of ["", "?lang=de", "?lang=FR-fr"]) assert.deepEqual((await app.inject({ url: `/api/lessons${query}` })).json().lessons, SHIPPED.en, query);
});

test("progress is kept only for a signed-in person", async () => {
  assert.equal((await app.inject({ url: "/api/learn/progress" })).statusCode, 401);
  const put = await app.inject({ method: "PUT", url: "/api/learn/progress/parcel-fee", headers: { origin: ORIGIN }, payload: { stars: 3, day: utcDay() } });
  assert.equal(put.statusCode, 401);
});

const today = utcDay();
const daysAgo = (n) => utcDay(new Date(Date.now() - n * 86400000));
const signedIn = async (email) => {
  const user = await makeUser({ email });
  return { user, h: { cookie: await sessionFor(user), origin: ORIGIN } };
};
const finish = (h, lessonId, payload) => app.inject({ method: "PUT", url: `/api/learn/progress/${lessonId}`, headers: h, payload });
const stored = async (user) => (await one("SELECT progress FROM lesson_progress WHERE user_id = $1", [user.id]))?.progress ?? null;

test("a first finished lesson is saved in the account, with its badge", db, async () => {
  const { user, h } = await signedIn("learner.first@example.test");
  const empty = await app.inject({ url: "/api/learn/progress", headers: h });
  assert.equal(empty.statusCode, 200);
  assert.deepEqual(empty.json(), { progress: emptyProgress(), summary: { done: 0, total: SHIPPED.en.length, stars: 0, days: 0 } });
  const res = await finish(h, "parcel-fee", { stars: 2, day: today });
  assert.equal(res.statusCode, 200, res.body);
  assert.deepEqual(res.json().progress, {
    lessons: { "parcel-fee": { stars: 2, done: true, plays: 1, lastDay: today } }, badges: ["parcel-fee"], streak: { days: 1, lastDay: today },
  });
  assert.deepEqual(res.json().summary, { done: 1, total: SHIPPED.en.length, stars: 2, days: 1 });
  assert.deepEqual(await stored(user), res.json().progress);
  assert.deepEqual((await app.inject({ url: "/api/learn/progress", headers: h })).json(), res.json());
});

test("playing a lesson again with a lower score keeps the best one", db, async () => {
  const { user, h } = await signedIn("learner.again@example.test");
  assert.equal((await finish(h, "urgency", { stars: 3, day: today })).statusCode, 200);
  const again = (await finish(h, "urgency", { stars: 1, day: today })).json();
  assert.deepEqual(again.progress.lessons.urgency, { stars: 3, done: true, plays: 2, lastDay: today });
  assert.deepEqual(again.progress.badges, ["urgency"]);
  assert.equal((await stored(user)).lessons.urgency.stars, 3);
});

test("two days in a row are counted", db, async () => {
  const { h } = await signedIn("learner.streak@example.test");
  assert.equal((await finish(h, "parcel-fee", { stars: 1, day: daysAgo(1) })).statusCode, 200);
  const second = (await finish(h, "urgency", { stars: 2, day: today })).json();
  assert.deepEqual(second.progress.streak, { days: 2, lastDay: today });
  assert.deepEqual(second.summary, { done: 2, total: SHIPPED.en.length, stars: 3, days: 2 });
  const later = (await app.inject({ url: `/api/learn/progress?day=${today}`, headers: h })).json();
  assert.equal(later.summary.days, 2);
  assert.equal((await app.inject({ url: "/api/learn/progress?day=not-a-day", headers: h })).json().summary.days, 2, "a day that is not one counts from today in UTC");
});

test("a result with impossible stars or a far-away day is refused in plain words, and nothing is saved", db, async () => {
  const { user, h } = await signedIn("learner.invalid@example.test");
  for (const payload of [{ stars: 4, day: today }, { stars: "3", day: today }, { day: today }, { stars: 1, day: "yesterday" }, { stars: 1, day: daysAgo(5) }]) {
    const res = await finish(h, "parcel-fee", payload);
    assert.equal(res.statusCode, 400, JSON.stringify(payload));
    assert.match(res.json().error, /^(stars|day) must be /);
  }
  assert.equal((await app.inject({ method: "PUT", url: "/api/learn/progress/parcel-fee", headers: h })).statusCode, 400, "no body at all");
  assert.equal(await stored(user), null);
});

test("a lesson that does not exist is refused", db, async () => {
  const { user, h } = await signedIn("learner.unknown@example.test");
  const res = await finish(h, "no-such-lesson", { stars: 3, day: today });
  assert.equal(res.statusCode, 404);
  assert.equal(res.json().error, "There is no lesson with that name.");
  assert.equal(await stored(user), null);
});

test("deleting the account erases the lesson progress with everything else", db, async () => {
  const { user, h } = await signedIn("learner.leaving@example.test");
  assert.equal((await finish(h, "parcel-fee", { stars: 3, day: today })).statusCode, 200);
  assert.ok(await stored(user));
  assert.equal((await app.inject({ method: "DELETE", url: "/api/account", headers: h })).json().deleted, true);
  assert.equal((await one("SELECT count(*)::int AS n FROM lesson_progress WHERE user_id = $1", [user.id])).n, 0);
});
