// Micro-learning (_product/specs/micro-learning.md): the lesson files and
// their format (a conversation the person is inside: Prudence's chats with
// the replies the person taps, who says each line, three choices with the
// character's reply and Prudence's tell), the EN/FR twins, make
// lessons-check, the progress rules (stars, badges, days in a row), GET
// /api/lessons, and the signed-in progress in Postgres (those tests skip
// without it, like integration.test.js).
import "./helpers/env.js";
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, relative } from "node:path";
import { parse, stringify } from "yaml";
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

// A valid lesson: a say first, a chat before the first question (two replies)
// and another before the second (one reply), three questions whose second
// choice is the right one, a tell on every choice, the character's own text
// last. Its steps: 0 say, 1 chat, 2 ask, 3 say, 4 chat, 5 ask, 6 ask (three
// choices), 7 say from the character. Each test breaks one thing in a copy.
const chat = (lines, n = 2) => ({ chat: lines, replies: Array.from({ length: n }, (_, i) => ({ say: `Say ${i + 1}`, answer: `Answer ${i + 1}` })) });
const ask = (question, n = 2) => ({
  ask: question,
  choices: Array.from({ length: n }, (_, i) => ({ text: `Choice ${i + 1}`, reply: `Reply ${i + 1}`, tell: `Tell ${i + 1}`, ...(i === 1 ? { right: true } : {}) })),
});
const lesson = (over = {}) => ({
  id: "parcel-fee", order: 1, title: "The $1.99 parcel trap", character: "Mr. Tiny Fee", emoji: "📦", minutes: 1,
  badge: "Parcel-fee spotter", rule: "A real carrier never asks you to pay a fee by text.",
  steps: [
    { say: ["Meet **Mr. Tiny Fee**. He never asks for much.", "He counts on one thought."] },
    chat(["Ever had a text about a parcel you were not expecting?"]),
    ask("A text says your package is on hold until you pay $1.99. What do you do?"),
    { say: ["His real prize is **your card number**."] },
    chat(["Want to see what he tries next?"], 1),
    ask("The text says it comes from USPS. How can you be sure?"),
    ask("What is the safest way to check on a parcel?", 3),
    { from: "character", as: "USPS", say: ["Fine. FINE. Keep your **$1.99**."] },
  ],
  ...over,
});
const broken = (mutate) => {
  const doc = structuredClone(lesson());
  mutate(doc);
  return validateLesson(doc, { lang: "en", caseIds: EN });
};
// The problems of a French twin of lesson(), changed by mutate, against the English one.
const frenchTwin = (mutate) => {
  const doc = structuredClone(lesson());
  mutate(doc);
  return twinProblems([lesson()], [doc]).map((p) => p.problem);
};
const NO_CHARACTER = "steps: no say from the character; at least one needs from: character (the scam is shown, not described)";
const NO_TALK = "steps: no chat before the first ask; Prudence talks with the person before the first question";

// The sample lesson of the spec's format section (_product/specs/micro-learning.md,
// "Lesson file format (YAML)"), copied verbatim: change the two together.
const SAMPLE = `id: parcel-fee                  # [a-z0-9-], the file name, the same in en/ and fr/
order: 1                        # position on the Learn home, 1 or more, unique in a language, equal in the two languages
title: The $1.99 parcel trap
character: Mr. Tiny Fee         # the scam character of this lesson; he speaks in the first person
emoji: "📦"                     # one emoji, decorative (aria-hidden); the avatar on his bubbles
minutes: 1
badge: Parcel-fee spotter       # earned the first time the lesson is finished
rule: Never pay a delivery fee from a link in a text. Go to the carrier's own website or app.
demo_case: D1                   # optional: an id from testcases/cases.json whose locale matches the lesson's language
steps:                          # the conversation, one message per step; Prudence speaks first, a say ends it
  - chat:                       # Prudence talks (1 to 3 lines, **bold** the only markup, under 140 characters) and waits for a tap
      - Hello! Got a minute? A text fooled a friend of mine yesterday. Same text, every week.
      - Ever had a text about a parcel you were not expecting?
    replies:                    # 1 to 3 replies in the person's own voice, none right or wrong; each gets her answer
      - say: All the time.      # the button, under 60 characters
        answer: Same here. They come in waves. Here is yesterday's.
      - say: Once or twice.
        answer: Once is enough for the trick to work. Here is yesterday's.
      - say: Never. Nobody texts me.
        answer: Lucky you. Let me show you one anyway, so you know the face.
  - from: character             # a text from the character, shown as a message under the name he borrows
    as: USPS                    # optional, only with from: character; under 40 characters
    say:                        # a line with a colon and a space in it goes in quotes, or YAML reads it as a field
      - "Your parcel is waiting at our depot. A small fee of **$1.99** is due. Pay here: usps-fee.example"
  - ask: What do you do?        # exactly three asks per lesson; a chat comes before the first
    choices:                    # 2 to 4 choices, exactly one with right: true
      - text: Pay it. It is only $1.99.
        reply: Wonderful! Now just your card number, the date and the three little digits on the back. For $1.99. Promise.
        tell: A $1.99 fee that needs your whole card is not a fee. It is your card.
      - text: Open the carrier's own app and look.
        right: true
        reply: Oh no. Not the app. Nobody checks the app. Fine. FINE.
        tell: Your parcel is where it always was. Going to the carrier yourself costs nothing and proves everything.
  - chat:                       # one reply is fine: a Next in the person's own words
      - He will not give up that easily. Watch.
    replies:
      - say: Oh no.
        answer: Oh yes. Here he comes.
  - from: character
    as: USPS
    say:
      - FINAL NOTICE. Pay **today** or your parcel goes back to the sender.
  - ask: And now?
    choices:
      - text: Tap the link, just to look.
        reply: Just a look! Come in, come in. Mind the step.
        tell: His page is built to make you type. A look is how it starts.
      - text: Use the tracking number from the shop, on the carrier's own website.
        right: true
        reply: The tracking number. From the shop. Who taught you that?
        tell: You went to them, so he gets nothing. Not even $1.99.
  - chat:
      - The text says USPS. His texts always say USPS. Or FedEx. Or "Parcel Service".
      - How do you think he picks the name?
    replies:
      - say: He types whatever he likes?
        answer: Exactly that. A name at the top of a text is typed, not proven.
      - say: No idea.
        answer: He types whatever he likes. A name at the top of a text is typed, not proven.
  - ask: How do you know it is really USPS?
    choices:
      - text: It says USPS, so it is USPS.
        reply: It does say USPS. I typed it myself. Lovely font, no?
        tell: Anyone can type a name into a text. A name proves nothing.
      - text: I cannot tell from the text, so I ask USPS myself.
        right: true
        reply: Ask them? That is cheating. I am filing a complaint.
        tell: You cannot tell from the text, and you do not have to. You ask the carrier.
  - say:                        # Prudence (from: narrator is the default): 1 to 3 lines
      - Mr. Tiny Fee walks home. The coin jar stays empty.
`;
const ONE_KIND = "a step is say (1 to 3 lines), chat (Prudence's lines with replies) or ask (a question with choices)";

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

test("a lesson asks exactly three questions, anywhere between the first chat and the story's last line", () => {
  assert.deepEqual(broken((d) => { d.steps.splice(5, 1); }), ["steps: exactly 3 ask steps (questions), found 2"]);
  assert.deepEqual(broken((d) => { d.steps.splice(2, 0, ask("One more?")); }), ["steps: exactly 3 ask steps (questions), found 4"]);
  assert.deepEqual(broken((d) => { d.steps = []; }), ["steps: must be a list of steps, found an empty list"]);
  assert.deepEqual(broken((d) => { d.steps = "say hello"; }), ['steps: must be a list of steps, found "say hello"']);
  assert.deepEqual(broken((d) => { d.steps = [0, 1, 2, 5, 6, 3, 4, 7].map((i) => d.steps[i]); }), [], "the three questions one after the other");
});

test("Prudence says one to three short lines at a time", () => {
  assert.deepEqual(broken((d) => { d.steps[0].say = []; }), ["steps[0].say: 1 to 3 lines, found 0"]);
  assert.deepEqual(broken((d) => { d.steps[0].say = ["One.", "Two.", "Three.", "Four."]; }), ["steps[0].say: 1 to 3 lines, found 4"]);
  assert.deepEqual(broken((d) => { d.steps[0].say = "Meet Mr. Tiny Fee."; }), ['steps[0].say: must be a list of 1 to 3 lines, found "Meet Mr. Tiny Fee."']);
  assert.deepEqual(broken((d) => { d.steps[0].say = ["Fine.", 3]; }), ["steps[0].say[1]: must be text, found the number 3"]);
  assert.deepEqual(broken((d) => { d.steps[0].say = ["   "]; }), ["steps[0].say[0]: is blank"]);
});

test("a question offers two to four big answers, exactly one of them right", () => {
  assert.deepEqual(broken((d) => { d.steps[2].choices.splice(0, 1); }), ["steps[2].choices: 2 to 4 choices, found 1"]);
  assert.deepEqual(broken((d) => { d.steps[2].choices.push(...[1, 2, 3].map((i) => ({ text: `More ${i}`, reply: "No.", tell: "No." }))); }),
    ["steps[2].choices: 2 to 4 choices, found 5"]);
  assert.deepEqual(broken((d) => { delete d.steps[5].choices[1].right; }), ["steps[5].choices: exactly one choice must have right: true, found 0"]);
  assert.deepEqual(broken((d) => { d.steps[2].choices[0].right = true; }), ["steps[2].choices: exactly one choice must have right: true, found 2"]);
  assert.deepEqual(broken((d) => { d.steps[2].choices[0].right = "yes"; }), ['steps[2].choices[0].right: must be true or false, found "yes"']);
  assert.deepEqual(broken((d) => { d.steps[2].choices[0].right = false; }), []);
  assert.deepEqual(broken((d) => { delete d.steps[2].choices; }), ["steps[2].choices: must be a list of 2 to 4 choices, found nothing"]);
  assert.deepEqual(broken((d) => { d.steps[2].ask = ""; }), ["steps[2].ask: missing"]);
});

test("every answer gets its reply, right or wrong, so the explanation always comes", () => {
  assert.deepEqual(broken((d) => { delete d.steps[2].choices[0].reply; }), ["steps[2].choices[0].reply: missing"]);
  assert.deepEqual(broken((d) => { delete d.steps[2].choices[0].text; }), ["steps[2].choices[0].text: missing"]);
  assert.deepEqual(broken((d) => { d.steps[2].choices[0] = "Pay it"; }),
    ['steps[2].choices[0]: a choice has text, reply, tell and maybe right: true, found "Pay it"']);
});

test("a step is lines to say, a chat or a question: exactly one of the three", () => {
  assert.equal(broken((d) => { d.steps[0].ask = "And a question?"; })[0], `steps[0]: ${ONE_KIND}, found say and ask in one step`);
  assert.equal(broken((d) => { d.steps[1].ask = "And a question?"; })[0], `steps[1]: ${ONE_KIND}, found chat and ask in one step`);
  assert.equal(broken((d) => { d.steps[0].chat = ["Hi."]; d.steps[0].ask = "And?"; })[0], `steps[0]: ${ONE_KIND}, found say, chat and ask in one step`);
  assert.deepEqual(broken((d) => { d.steps[0] = { tell: ["Hi"] }; }), [`steps[0]: ${ONE_KIND}, found none of the three`]);
  assert.deepEqual(broken((d) => { d.steps[0] = "Hello"; }), [`steps[0]: ${ONE_KIND}, found "Hello"`]);
});

test("every line, question, answer and reply stays under 140 characters, counted as characters, not bytes", () => {
  assert.deepEqual(broken((d) => { d.steps[0].say[0] = "é".repeat(139); }), []);
  assert.deepEqual(broken((d) => { d.steps[0].say[0] = "📦".repeat(139); }), [], "an emoji is one character");
  assert.deepEqual(broken((d) => { d.steps[0].say[0] = "é".repeat(140); }), ["steps[0].say[0]: 140 characters, keep it under 140"]);
  assert.deepEqual(broken((d) => { d.steps[1].chat[0] = "c".repeat(140); }), ["steps[1].chat[0]: 140 characters, keep it under 140"]);
  assert.deepEqual(broken((d) => { d.steps[2].ask = "Q".repeat(150); }), ["steps[2].ask: 150 characters, keep it under 140"]);
  assert.deepEqual(broken((d) => { d.steps[2].choices[0].text = "t".repeat(141); }), ["steps[2].choices[0].text: 141 characters, keep it under 140"]);
  assert.deepEqual(broken((d) => { d.steps[2].choices[1].reply = "r".repeat(140); }), ["steps[2].choices[1].reply: 140 characters, keep it under 140"]);
  assert.deepEqual(broken((d) => { d.rule = "r".repeat(200); }), ["rule: 200 characters, keep it under 140"]);
});

test("bold is the only markup a lesson may use: no HTML, no links, no lone star", () => {
  const line = (text) => broken((d) => { d.steps[0].say[0] = text; }).join("\n");
  assert.equal(line("Meet **Mr. Tiny Fee** and **his fee**."), "");
  for (const html of ["<b>Mr. Tiny Fee</b>", "Fees > zero", "<script>"]) assert.match(line(html), /^steps\[0\]\.say\[0\]: no < or > \(HTML is not allowed\)/, html);
  for (const link of ["Go to [usps.com](https://usps-hold.test)", "See [this", "x](y"]) assert.match(line(link), /links are not allowed/, link);
  for (const star of ["A *single* star", "**unclosed bold", "****", "**a*b**"]) assert.match(line(star), /a lone \* is not allowed; bold is written \*\*like this\*\*/, star);
  assert.match(broken((d) => { d.steps[2].choices[0].reply = "<i>No</i>"; }).join("\n"), /^steps\[2\]\.choices\[0\]\.reply: no < or >/);
  assert.match(broken((d) => { d.steps[1].replies[0].say = "<b>Yes</b>"; }).join("\n"), /^steps\[1\]\.replies\[0\]\.say: no < or >/);
  assert.match(broken((d) => { d.steps[1].replies[0].answer = "See [this](https://usps-hold.test)"; }).join("\n"), /^steps\[1\]\.replies\[0\]\.answer: no \[ or \]\(/);
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
  assert.deepEqual(broken((d) => { d.steps[2].choices[0].rigth = true; }), ["steps[2].choices[0].rigth: unknown field; expected text, right, reply, tell"]);
  assert.deepEqual(broken((d) => { d.steps[0].choices = []; }), ["steps[0].choices: unknown field; expected from, as, say"]);
  assert.deepEqual(broken((d) => { d.steps[2].hint = "Look closely."; }), ["steps[2].hint: unknown field; expected ask, choices"]);
  assert.deepEqual(broken((d) => { d.steps[1].replies[0].anwser = "Typo."; }), ["steps[1].replies[0].anwser: unknown field; expected say, answer"]);
});

test("a file that is not a lesson at all is refused in plain words", () => {
  for (const doc of [null, [], "hello", 3]) assert.match(validateLesson(doc)[0], /^not a lesson: expected the fields id, order, title, character/, String(doc));
});

// ---------------------------------------------------------------- the lesson is a story (Behavior 3, 4, 9)

test("the sample lesson of the spec's format section passes every rule", () => {
  assert.deepEqual(validateLesson(parse(SAMPLE), { lang: "en", caseIds: EN }), []);
});

test("Prudence speaks first and a say ends the story: a say or a chat opens it, the scammer leaving closes it", () => {
  assert.deepEqual(broken((d) => { d.steps.unshift(...d.steps.splice(2, 1)); }), [
    "steps[0]: the story opens on a say or a chat (Prudence speaks first), found an ask",
    NO_TALK,
  ]);
  assert.deepEqual(broken((d) => { d.steps.push(...d.steps.splice(5, 1)); }), ["steps[7]: the story ends with a say (the scammer leaves), found an ask"]);
  assert.deepEqual(broken((d) => { d.steps.push(chat(["See you tomorrow?"])); }), ["steps[8]: the story ends with a say (the scammer leaves), found a chat"]);
});

test("never more than two says in a row: between the questions the story moves, it never lectures", () => {
  assert.deepEqual(broken((d) => { d.steps.splice(1, 0, { from: "character", as: "USPS", say: ["Your parcel is on hold."] }); }), [], "two in a row are fine");
  assert.deepEqual(broken((d) => { d.steps.splice(3, 0, { say: ["One."] }, { from: "character", say: ["Two."] }); }),
    ["steps[3] to steps[5]: 3 says in a row; 2 at most, so the story never turns into a lecture"]);
  assert.deepEqual(broken((d) => { d.steps.push({ say: ["A."] }, { say: ["B."] }, { say: ["C."] }); }),
    ["steps[7] to steps[10]: 4 says in a row; 2 at most, so the story never turns into a lecture"], "a long run is one problem, at the end too");
});

test("at least one say comes from the character: the scam is shown, not described", () => {
  assert.deepEqual(broken((d) => { delete d.steps[7].from; delete d.steps[7].as; }), [NO_CHARACTER]);
  assert.deepEqual(broken((d) => { d.steps[7].from = "narrator"; delete d.steps[7].as; }), [NO_CHARACTER]);
  assert.deepEqual(broken((d) => { d.steps[0].from = "character"; }), [], "any say may be his, and he may speak more than once");
});

test("a say comes from the narrator or the character, and only a say has a speaker", () => {
  for (const from of ["narrator", "character"]) assert.deepEqual(broken((d) => { d.steps[3].from = from; }), [], from);
  assert.deepEqual(broken((d) => { d.steps[3].from = "USPS"; }), ['steps[3].from: must be narrator or character, found "USPS"']);
  for (const bad of ["Narrator", "", null, 3, ["you"]]) {
    assert.match(broken((d) => { d.steps[3].from = bad; }).join("\n"), /^steps\[3\]\.from: must be narrator or character, found /, String(bad));
  }
  assert.deepEqual(broken((d) => { d.steps[2].from = "character"; }), ["steps[2].from: unknown field; expected ask, choices"], "a question has no speaker");
  assert.deepEqual(broken((d) => { d.steps[7].says = ["Hi"]; }), ["steps[7].says: unknown field; expected from, as, say"]);
});

test("the name the character borrows goes only on his texts and stays under 40 characters", () => {
  assert.deepEqual(broken((d) => { d.steps[7].as = "Your bank"; }), []);
  assert.deepEqual(broken((d) => { delete d.steps[7].as; }), [], "he may text under no name at all");
  assert.deepEqual(broken((d) => { d.steps[7].as = "U".repeat(39); }), []);
  assert.deepEqual(broken((d) => { d.steps[7].as = "U".repeat(40); }), ["steps[7].as: 40 characters, keep it under 40"]);
  assert.deepEqual(broken((d) => { d.steps[7].as = null; }), ["steps[7].as: empty; write the name he borrows or remove the line"]);
  assert.deepEqual(broken((d) => { d.steps[7].as = 7; }), ["steps[7].as: must be text, found the number 7"]);
  assert.match(broken((d) => { d.steps[7].as = "<b>USPS</b>"; }).join("\n"), /^steps\[7\]\.as: no < or > \(HTML is not allowed\)/);
  for (const from of [undefined, "narrator"]) {
    assert.deepEqual(broken((d) => { if (from) d.steps[0].from = from; d.steps[0].as = "USPS"; }),
      ["steps[0].as: only a text from the character carries a borrowed name; add from: character or remove as"], String(from));
  }
  assert.deepEqual(broken((d) => { d.steps[7].from = "the character"; }), ['steps[7].from: must be narrator or character, found "the character"', NO_CHARACTER],
    "a wrong from is the problem to fix; the name waits for it");
});

test("every choice that is not right has a tell, the narrator's plain line; the right one may go without", () => {
  const missing = (at) => `${at}.tell: missing; a choice that is not right needs the narrator's plain line`;
  assert.deepEqual(broken((d) => { delete d.steps[2].choices[0].tell; }), [missing("steps[2].choices[0]")]);
  assert.deepEqual(broken((d) => { d.steps[6].choices[2].right = false; d.steps[6].choices[2].tell = ""; }), [missing("steps[6].choices[2]")]);
  assert.deepEqual(broken((d) => { delete d.steps[2].choices[1].tell; }), [], "the right one may go without");
  assert.deepEqual(broken((d) => { d.steps[2].choices[1].tell = null; }), ["steps[2].choices[1].tell: empty; write the narrator's plain line or remove the line"]);
  assert.deepEqual(broken((d) => { d.steps[6].choices[2].tell = "t".repeat(140); }), ["steps[6].choices[2].tell: 140 characters, keep it under 140"]);
  assert.deepEqual(broken((d) => { d.steps[2].choices[1].tell = "t".repeat(140); }), ["steps[2].choices[1].tell: 140 characters, keep it under 140"],
    "the right one's tell, when there, follows the same rules");
  assert.deepEqual(broken((d) => { d.steps[2].choices[0].tell = "A *lone* star"; }), ["steps[2].choices[0].tell: a lone * is not allowed; bold is written **like this**"]);
  assert.deepEqual(broken((d) => { d.steps[2].choices[0].tell = ["A list"]; }), ["steps[2].choices[0].tell: must be text, found a list of 1"]);
  assert.deepEqual(broken((d) => { d.steps[2].choices[1].right = "yes"; delete d.steps[2].choices[1].tell; }), [
    'steps[2].choices[1].right: must be true or false, found "yes"',
    "steps[2].choices: exactly one choice must have right: true, found 0",
  ], "a right that is neither true nor false is fixed before its tell is asked for");
});

// ---------------------------------------------------------------- the lesson talks before it tests (Behavior 3, 5, 9)

test("a chat is one to three lines from Prudence, then she waits for the person's tap", () => {
  assert.deepEqual(broken((d) => { d.steps[1].chat = ["Hello!", "Got a minute?", "Ever had a text about a parcel?"]; }), []);
  assert.deepEqual(broken((d) => { d.steps[1].chat = []; }), ["steps[1].chat: 1 to 3 lines, found 0"]);
  assert.deepEqual(broken((d) => { d.steps[1].chat = ["One.", "Two.", "Three.", "Four."]; }), ["steps[1].chat: 1 to 3 lines, found 4"]);
  assert.deepEqual(broken((d) => { d.steps[1].chat = "Got a minute?"; }), ['steps[1].chat: must be a list of 1 to 3 lines, found "Got a minute?"']);
  assert.deepEqual(broken((d) => { d.steps[4].chat = null; }), ["steps[4].chat: must be a list of 1 to 3 lines, found nothing"]);
  assert.deepEqual(broken((d) => { d.steps[1].chat[0] = ""; }), ["steps[1].chat[0]: missing"]);
  assert.deepEqual(broken((d) => { d.steps[1].chat[0] = { "Ever had a text": "a parcel?" }; }), [
    "steps[1].chat[0]: must be text, found a group of fields; a colon followed by a space makes YAML read the line as a field, so put the line in quotes",
  ]);
});

test("the person answers a chat with one tap among one to three replies", () => {
  assert.deepEqual(broken((d) => { d.steps[1].replies.push({ say: "Say 3", answer: "Answer 3" }); }), [], "three replies");
  assert.deepEqual(broken((d) => { d.steps[1].replies.splice(1); }), [], "one reply is fine: a Next in the person's own words");
  assert.deepEqual(broken((d) => { d.steps[1].replies = []; }), ["steps[1].replies: 1 to 3 replies, found 0"]);
  assert.deepEqual(broken((d) => { d.steps[4].replies.push(...[2, 3, 4].map((i) => ({ say: `Say ${i}`, answer: `Answer ${i}` }))); }),
    ["steps[4].replies: 1 to 3 replies, found 4"]);
  assert.deepEqual(broken((d) => { delete d.steps[1].replies; }), ["steps[1].replies: must be a list of 1 to 3 replies, found nothing"]);
  assert.deepEqual(broken((d) => { d.steps[1].replies = "All the time."; }), ['steps[1].replies: must be a list of 1 to 3 replies, found "All the time."']);
  assert.deepEqual(broken((d) => { d.steps[1].replies[0] = "All the time."; }),
    ['steps[1].replies[0]: a reply has say (the button the person taps) and answer (Prudence\'s answer), found "All the time."']);
});

test("a reply is a button: its say stays under 60 characters", () => {
  assert.deepEqual(broken((d) => { d.steps[1].replies[0].say = "é".repeat(59); }), []);
  assert.deepEqual(broken((d) => { d.steps[1].replies[0].say = "é".repeat(60); }), ["steps[1].replies[0].say: 60 characters, keep it under 60"]);
  assert.deepEqual(broken((d) => { d.steps[4].replies[0].say = "Oh no, not him again, I know that one, he never stops texting."; }),
    ["steps[4].replies[0].say: 62 characters, keep it under 60"]);
  assert.deepEqual(broken((d) => { d.steps[1].replies[1].say = ""; }), ["steps[1].replies[1].say: missing"]);
  assert.deepEqual(broken((d) => { d.steps[1].replies[1].say = ["All the time."]; }), ["steps[1].replies[1].say: must be text, found a list of 1"]);
});

test("every reply gets Prudence's answer, so she shows she heard it", () => {
  assert.deepEqual(broken((d) => { delete d.steps[1].replies[0].answer; }), ["steps[1].replies[0].answer: missing"]);
  assert.deepEqual(broken((d) => { d.steps[4].replies[0].answer = "  "; }), ["steps[4].replies[0].answer: is blank"]);
  assert.deepEqual(broken((d) => { d.steps[1].replies[1].answer = "a".repeat(140); }), ["steps[1].replies[1].answer: 140 characters, keep it under 140"]);
});

test("a reply is the person's say and Prudence's answer, nothing else: never right or wrong", () => {
  assert.deepEqual(broken((d) => { d.steps[1].replies[0].right = true; }), ["steps[1].replies[0].right: unknown field; expected say, answer"]);
  assert.deepEqual(broken((d) => { d.steps[1].replies[1] = { text: "Once or twice.", answer: "Once is enough." }; }),
    ["steps[1].replies[1].text: unknown field; expected say, answer", "steps[1].replies[1].say: missing"]);
});

test("a chat holds Prudence's lines and the replies, nothing else", () => {
  assert.deepEqual(broken((d) => { d.steps[1].from = "narrator"; }), ["steps[1].from: unknown field; expected chat, replies"], "a chat is always Prudence's");
  assert.deepEqual(broken((d) => { d.steps[1].choices = []; }), ["steps[1].choices: unknown field; expected chat, replies"]);
  assert.deepEqual(broken((d) => { d.steps[4].reply = "Oh no."; }), ["steps[4].reply: unknown field; expected chat, replies"]);
});

test("Prudence talks with the person before the first question: a chat comes before the first ask", () => {
  assert.deepEqual(broken((d) => { [d.steps[1], d.steps[2]] = [d.steps[2], d.steps[1]]; }), [NO_TALK]);
  assert.deepEqual(broken((d) => { d.steps.splice(2, 0, ...d.steps.splice(4, 1)); }), [], "two chats before it are fine too");
});

test("a lesson has two chats at least, so it talks before it tests", () => {
  assert.deepEqual(broken((d) => { d.steps.splice(4, 1); }), ["steps: 1 chat step; 2 at least, so the lesson talks before it tests"]);
  assert.deepEqual(broken((d) => { d.steps.splice(4, 1); d.steps.splice(1, 1); }), [NO_TALK, "steps: no chat step; 2 at least, so the lesson talks before it tests"]);
  assert.deepEqual(broken((d) => { d.steps.splice(6, 0, chat(["One more thing."], 3)); }), [], "three are fine");
});

test("nothing is scripted for the person: from: you is refused, and the problem says their words are a reply they tap", () => {
  const you = 'steps[3].from: must be narrator or character, found "you"; what the person says is a reply they tap: write a chat step with replies';
  assert.deepEqual(broken((d) => { d.steps[3].from = "you"; }), [you]);
  assert.deepEqual(broken((d) => { d.steps[3].from = "you"; d.steps[3].as = "Me"; }), [you], "the from is the problem to fix; the name waits for it");
});

test("the story may open on a chat: Prudence's hello and a question about the person's own life", () => {
  assert.deepEqual(broken((d) => { d.steps.shift(); }), []);
  assert.ok("chat" in parse(SAMPLE).steps[0], "the spec's sample opens on one");
});

test("a chat breaks a run of says, as a question does: say, say, chat, say, say is fine; three says in a row are not", () => {
  const around = (...says) => (d) => { d.steps.splice(0, 2, { say: ["A."] }, { from: "character", say: ["B."] }, chat(["Shall we see?"]), ...says); };
  assert.deepEqual(broken(around({ say: ["C."] }, { from: "character", say: ["D."] })), []);
  assert.deepEqual(broken(around({ say: ["C."] }, { say: ["D."] }, { say: ["E."] })),
    ["steps[3] to steps[5]: 3 says in a row; 2 at most, so the story never turns into a lecture"], "the count starts again after the chat");
  assert.deepEqual(broken((d) => { d.steps.splice(0, 1, { say: ["A."] }, { say: ["B."] }, { say: ["C."] }); }),
    ["steps[0] to steps[2]: 3 says in a row; 2 at most, so the story never turns into a lecture"]);
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
  const fr = frenchTwin;
  assert.deepEqual(twinProblems([lesson()], [lesson({ order: 2 })]), [{ id: "parcel-fee", lang: "fr", problem: "differs from en/parcel-fee.yaml: order 2 here, 1 in English" }]);
  assert.deepEqual(fr((d) => { d.steps[0].say.push("Une ligne de plus."); }), [], "a translation may take more or fewer lines");
  assert.deepEqual(fr((d) => { d.steps.pop(); }), ["differs from en/parcel-fee.yaml: 7 steps here, 8 in English"]);
  assert.deepEqual(fr((d) => { [d.steps[0], d.steps[1]] = [d.steps[1], d.steps[0]]; }), [
    "differs from en/parcel-fee.yaml: steps[0] is chat here, say in English",
    "differs from en/parcel-fee.yaml: steps[1] is say here, chat in English",
  ]);
  assert.deepEqual(fr((d) => { [d.steps[4], d.steps[5]] = [d.steps[5], d.steps[4]]; }), [
    "differs from en/parcel-fee.yaml: steps[4] is ask here, chat in English",
    "differs from en/parcel-fee.yaml: steps[5] is chat here, ask in English",
  ]);
  assert.deepEqual(fr((d) => { d.steps[6].choices.pop(); }), ["differs from en/parcel-fee.yaml: steps[6] has 2 choices here, 3 in English"]);
  assert.deepEqual(fr((d) => { d.steps[3] = "?"; d.steps[2].choices = "none"; }), [
    "differs from en/parcel-fee.yaml: steps[2] has 0 choices here, 2 in English",
    "differs from en/parcel-fee.yaml: steps[3] is not a step here, say in English",
  ]);
});

test("the twins play the same: the same speaker on each say and the right choice at the same place", () => {
  const differs = (what) => [`differs from en/parcel-fee.yaml: ${what}`];
  assert.deepEqual(frenchTwin((d) => { d.steps[7].as = "Chronopost"; d.steps[2].choices[0].tell = "Autre chose."; delete d.steps[2].choices[1].tell; }), [],
    "the borrowed name and the tells are translated");
  assert.deepEqual(frenchTwin((d) => { d.steps[0].from = "narrator"; }), [], "a say with no from is the narrator's");
  assert.deepEqual(frenchTwin((d) => { d.steps[3].from = "character"; }), differs("steps[3] is from: character here, from: narrator in English"));
  assert.deepEqual(frenchTwin((d) => { delete d.steps[7].from; delete d.steps[7].as; }), differs("steps[7] is from: narrator here, from: character in English"));
  assert.deepEqual(frenchTwin((d) => { d.steps[2].choices.reverse(); }), differs("steps[2] has right: true on choices[0] here, on choices[1] in English"));
  assert.deepEqual(frenchTwin((d) => { d.steps[6].choices[1].right = false; d.steps[6].choices[2].right = true; }),
    differs("steps[6] has right: true on choices[2] here, on choices[1] in English"));
  assert.deepEqual(frenchTwin((d) => { delete d.steps[5].choices[1].right; }), differs("steps[5] has right: true on no choice here, on choices[1] in English"));
});

test("the twins talk the same: the same number of replies on each chat", () => {
  const differs = (what) => [`differs from en/parcel-fee.yaml: ${what}`];
  assert.deepEqual(frenchTwin((d) => {
    d.steps[1].chat = ["Bonjour !", "Déjà reçu un SMS pour un colis que vous n'attendiez pas ?"];
    d.steps[1].replies[0] = { say: "Tout le temps.", answer: "Moi aussi. Ils arrivent par vagues." };
  }), [], "the lines, the replies and her answers are translated");
  assert.deepEqual(frenchTwin((d) => { d.steps[1].replies.pop(); }), differs("steps[1] has 1 reply here, 2 in English"));
  assert.deepEqual(frenchTwin((d) => { d.steps[4].replies.push({ say: "Et alors ?", answer: "Regardez." }); }), differs("steps[4] has 2 replies here, 1 in English"));
  assert.deepEqual(frenchTwin((d) => { d.steps[1].replies = "aucune"; }), differs("steps[1] has 0 replies here, 2 in English"));
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

test("every say the app gets names its speaker, the narrator when the file does not say", () => {
  const spoken = lesson().steps.map((s) => ("say" in s ? { from: "narrator", ...s } : s));
  const root = checkout({
    "testcases/cases.json": CASES,
    "data/lessons/en/parcel-fee.yaml": lesson(),
    "data/lessons/fr/parcel-fee.yaml": lesson({ steps: spoken }),
  });
  try {
    const { lessons, problems } = load(root);
    assert.deepEqual(problems, []);
    for (const lang of LANGS) {
      const [served] = lessons[lang];
      assert.deepEqual(served.steps.filter((s) => "say" in s).map((s) => s.from), ["narrator", "narrator", "character"], lang);
      assert.equal(served.steps[7].as, "USPS", lang);
      assert.deepEqual(served.steps[6].choices.map((c) => c.tell), ["Tell 1", "Tell 2", "Tell 3"], lang);
      assert.deepEqual(served.steps.filter((s) => "chat" in s), [lesson().steps[1], lesson().steps[4]], `${lang}: a chat is served as it is, with no speaker`);
      assert.deepEqual(served, lesson({ steps: spoken }), `${lang}: nothing else is added or changed`);
    }
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

test("a lesson file that cannot be read is reported with its name, never a crash", { skip: process.getuid?.() === 0 ? "root reads any file" : false }, () => {
  const root = checkout({ "testcases/cases.json": CASES, "data/lessons/en/parcel-fee.yaml": lesson(), "data/lessons/fr/parcel-fee.yaml": lesson() });
  chmodSync(join(root, "data/lessons/fr/parcel-fee.yaml"), 0o000);
  try {
    const { lessons, problems } = load(root);
    assert.deepEqual(lessons, { en: [], fr: [] }, "the English twin is left out with it");
    assert.deepEqual(problems.map((p) => relative(root, p.file)), ["data/lessons/fr/parcel-fee.yaml"]);
    assert.match(problems[0].problem, /^could not read the file: EACCES/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("make lessons-check fails on a broken file and names it, and passes on the shipped lessons", () => {
  const twin = lesson();
  twin.steps.splice(3, 1);
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
      "data/lessons/fr/parcel-fee.yaml: differs from en/parcel-fee.yaml: 7 steps here, 8 in English",
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

test("GET /api/lessons gives the app Prudence's chats with the replies and her answers, who says each line, the name the character borrows and the tells", async () => {
  for (const lang of LANGS) {
    const { lessons } = (await app.inject({ url: `/api/lessons?lang=${lang}` })).json();
    assert.ok(lessons.length, `${lang}: lessons are served`);
    const chats = lessons.map((l) => l.steps.filter((s) => "chat" in s));
    assert.ok(chats.every((list) => list.length >= 2), `${lang}: every lesson talks at least twice`);
    assert.ok(chats.flat().every((s) => s.chat.length && s.chat.every((line) => typeof line === "string")
      && s.replies.length && s.replies.every((r) => typeof r.say === "string" && typeof r.answer === "string")), `${lang}: every chat carries Prudence's lines and the replies, each with her answer`);
    const says = lessons.flatMap((l) => l.steps.filter((s) => "say" in s));
    assert.ok(says.every((s) => ["narrator", "character"].includes(s.from)), `${lang}: every say names its speaker, never the person`);
    assert.ok(says.some((s) => s.from === "character" && typeof s.as === "string"), `${lang}: the character texts under a borrowed name`);
    const notRight = lessons.flatMap((l) => l.steps.filter((s) => "ask" in s).flatMap((s) => s.choices.filter((c) => c.right !== true)));
    assert.ok(notRight.length && notRight.every((c) => typeof c.tell === "string"), `${lang}: a tell on every choice that is not right`);
  }
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
