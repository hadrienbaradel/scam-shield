// scripts/session-brief.mjs: the SessionStart brief never crashes, stays under
// 45 lines, ends with the footer, and never prints a secret.
import { test } from "node:test";
import assert from "node:assert/strict";
import { execFile, execFileSync } from "node:child_process";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  parseTables, parseSpec, parseFeasibility, isUndiscussed, statusOf, buildBrief, FOOTER, MAX_LINES,
} from "../scripts/session-brief.mjs";

const script = new URL("../scripts/session-brief.mjs", import.meta.url).pathname;
const repoRoot = new URL("../", import.meta.url).pathname;
// Resolves with { code, output } whatever the exit code.
const run = (args, env = {}) => new Promise((resolve) => {
  execFile(process.execPath, [script, ...args], { env: { ...process.env, ...env }, timeout: 20000 },
    (err, stdout, stderr) => resolve({ code: err ? err.code : 0, output: `${stdout}${stderr}`, stdout }));
});

const SPEC = `# Spec

## Features
| Feature | Status | One-line spec | Details |
|---|---|---|---|
| Gmail scanning | Built (unverified live) | Scans mail. | [specs/gmail.md](specs/gmail.md) |
| Verdict engine | **Built** | One verdict. | — |
| Link checks | Partial | Age and redirects. | — |
| Chrome extension | Planned | Docs call it next. | — |
| Public deployment | Planned | Railway EU. | — |
| Voice notes | Idea | Transcribe a voice note. | — |
| Legacy rules | Dropped | Superseded. | — |
| Weird row | Someday | Unknown status word. | — |

## Ideas (not yet planned)
| Idea | Where it came from | Discussed | One line | Details |
|---|---|---|---|---|
| Sandboxed link screenshot | PRD | no | Render the landing page. | [specs/link-sandbox.md](specs/link-sandbox.md) |
| On-device pre-screen | PRD | 2026-10-27 with Hadrien | Glimmer on the phone. | — |
| QR code spotting | PRD | No | A QR becomes a link. | — |
| iOS share sheet | PRD | | Share from an iPhone. | — |
| Scam of the week | PRD | no | A weekly picture. | — |
| FTC alerts feed | STATUS | not yet | Fourth feed source. | — |
| Report a scam | review | no | A Report step. | — |

## Dropped
- Legacy rules engine: superseded.
- Display-name matching: a typed name is a claim.

## Non-goals
- Filtering spam.
`;

const FEASIBILITY = `# Feasibility

| # | Question | Area | Status | Why it matters | Finding |
|---|---|---|---|---|---|
| 1 | Can Gmail push new mail within seconds? | Gmail | Open | The demo shows a live inbox. | — |
| 2 | Can an Android app read SMS without Play review? | SMS | Researched | Sideload only. | Yes, sideloaded. |
| 3 | Can Muse transcribe a voice note? | Voice | **Open** | Voice-note check. | — |
| 4 | Web or app for the senior? | App vs web | Decided | Scope. | Web first. |
| 5 | Can we step in during a live call? | Real-time | open | Protection. | — |
`;

test("spec tables: status counts, undiscussed ideas, planned or partial features", () => {
  const p = parseSpec(SPEC);
  assert.equal(p.found, true);
  // Built 2 (one with a parenthesis, one bold); "Someday" is not a status; the
  // 7 ideas count as Idea; the two "## Dropped" bullets count as Dropped.
  assert.deepEqual(p.counts, { Built: 2, Partial: 1, Planned: 2, Idea: 8, Dropped: 3 });
  assert.equal(p.ideas, 7);
  assert.equal(p.undiscussedTotal, 6, "no, No, empty, not yet and no again; the dated one is discussed");
  assert.deepEqual(p.undiscussed, ["Sandboxed link screenshot", "QR code spotting", "iOS share sheet", "Scam of the week", "FTC alerts feed"]);
  assert.equal(p.nextTotal, 3);
  assert.deepEqual(p.next.map((f) => `${f.name}:${f.status}`), ["Link checks:Partial", "Chrome extension:Planned", "Public deployment:Planned"]);
});

test("spec cells are read defensively", () => {
  assert.equal(statusOf("Built (unverified live)"), "Built");
  assert.equal(statusOf("**Partial**"), "Partial");
  assert.equal(statusOf("Someday"), null);
  assert.equal(statusOf(undefined), null);
  for (const v of ["no", "No", "not yet", "", "-", "—"]) assert.ok(isUndiscussed(v), `"${v}" is undiscussed`);
  for (const v of ["2026-10-27 with Hadrien", "Nov 3 with Vlad", "yes", "none"]) assert.ok(!isUndiscussed(v), `"${v}" is discussed`);
  // An Ideas table without a Discussed column: every idea is still undiscussed.
  const p = parseSpec("| Idea | One line |\n|---|---|\n| A | x |\n| B | y |\n");
  assert.deepEqual(p.undiscussed, ["A", "B"]);
  assert.equal(p.counts.Idea, 2);
  const t = parseTables("| a \\| b | c |\n|---|---|\n| [link](u) | **bold** `code` |\n");
  assert.deepEqual(t[0].header, ["a | b", "c"]);
  assert.deepEqual(t[0].rows, [["link", "bold code"]]);
});

test("a missing or malformed spec gives zeros, never a throw", () => {
  const zero = { Built: 0, Partial: 0, Planned: 0, Idea: 0, Dropped: 0 };
  for (const text of [null, undefined, 42, "", "# Only prose\n\nNo table here.\n", "| a | b |\n|---|---|\n| 1 | 2 |\n", "| Status |\n|---|\n|\n||||\n"]) {
    const p = parseSpec(text);
    assert.deepEqual(p.counts, zero, `counts for ${JSON.stringify(text)}`);
    assert.deepEqual(p.undiscussed, []);
    assert.deepEqual(p.next, []);
  }
  assert.equal(parseSpec("| Feature | Status |\n|---|---|\n| X | Built |\n").counts.Built, 1);
});

test("feasibility table: open questions with their numbers", () => {
  const f = parseFeasibility(FEASIBILITY);
  assert.equal(f.found, true);
  assert.deepEqual(f.counts, { Open: 3, Researched: 1, Decided: 1, Other: 0 });
  assert.equal(f.total, 5);
  assert.equal(f.openTotal, 3);
  assert.deepEqual(f.open, [
    { n: "1", question: "Can Gmail push new mail within seconds?" },
    { n: "3", question: "Can Muse transcribe a voice note?" },
    { n: "5", question: "Can we step in during a live call?" },
  ]);
  // No number column: rows are numbered by position. Odd status words are "Other".
  const g = parseFeasibility("| Question | Status |\n|---|---|\n| Why? | Open |\n| How? | Parked |\n");
  assert.deepEqual(g.open, [{ n: "1", question: "Why?" }]);
  assert.equal(g.counts.Other, 1);
  for (const text of [null, "", "no table", "| a | b |\n|---|---|\n| 1 | 2 |\n"]) {
    const h = parseFeasibility(text);
    assert.equal(h.found, false);
    assert.deepEqual(h.open, []);
  }
});

test("missing product files are one line each, and a non-git folder still gets a brief", (t) => {
  const dir = mkdtempSync(join(tmpdir(), "session-brief-empty-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const lines = buildBrief(dir);
  assert.ok(lines.some((l) => l === "Product state: _product/spec.md not found"), lines.join("\n"));
  assert.ok(lines.some((l) => l === "Feasibility: _product/research/feasibility.md not found"));
  assert.equal(lines.at(-1), `Session start: ${FOOTER}`);
  assert.ok(lines.length <= MAX_LINES);
});

test("in a checkout: commits by others since my last commit, distance to main, product state", async (t) => {
  const dir = mkdtempSync(join(tmpdir(), "session-brief-repo-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  // The user's own git config (signing, hooks, aliases) must not leak into the fixture.
  const env = { ...process.env, GIT_CONFIG_GLOBAL: "/dev/null", GIT_CONFIG_NOSYSTEM: "1" };
  const git = (args, extra = {}) => execFileSync("git", args, { cwd: dir, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], env: { ...env, ...extra } });
  const as = (name, date) => ({
    GIT_AUTHOR_NAME: name, GIT_AUTHOR_EMAIL: `${name.toLowerCase()}@example.com`, GIT_AUTHOR_DATE: date,
    GIT_COMMITTER_NAME: name, GIT_COMMITTER_EMAIL: `${name.toLowerCase()}@example.com`, GIT_COMMITTER_DATE: date,
  });
  try { git(["init", "-q", "-b", "main"]); } catch { t.skip("git init -b is not available"); return; }
  git(["config", "user.name", "Bob"]);
  git(["config", "user.email", "bob@example.com"]);
  writeFileSync(join(dir, "a.txt"), "1\n");
  git(["add", "."]);
  git(["commit", "-q", "-m", "Start: first commit"], as("Alice", "2026-10-20T10:00:00Z"));
  git(["checkout", "-q", "-b", "bob/topic"]);
  writeFileSync(join(dir, "b.txt"), "2\n");
  git(["add", "."]);
  git(["commit", "-q", "-m", "Topic: Bob's own work"], as("Bob", "2026-10-21T10:00:00Z"));
  git(["checkout", "-q", "main"]);
  writeFileSync(join(dir, "a.txt"), "3\n");
  git(["add", "."]);
  git(["commit", "-q", "-m", "Engine: Alice's later change"], as("Alice", "2026-10-22T10:00:00Z"));
  git(["checkout", "-q", "bob/topic"]);
  mkdirSync(join(dir, "_product", "research"), { recursive: true });
  writeFileSync(join(dir, "_product", "spec.md"), SPEC);
  writeFileSync(join(dir, "_product", "research", "feasibility.md"), FEASIBILITY);

  const { code, stdout } = await run([dir], env);
  assert.equal(code, 0, stdout);
  const lines = stdout.split("\n").filter((l, i, a) => i < a.length - 1 || l !== "");
  assert.ok(lines.length <= MAX_LINES, `${lines.length} lines`);
  assert.match(lines[0], /^Session brief: repo session-brief-repo-\S+, branch bob\/topic \(1 ahead, 1 behind main\), 2 uncommitted changes$/);
  assert.match(lines[1], /^Developer: Bob · today \d{4}-\d{2}-\d{2} · /);
  assert.ok(stdout.includes("Since your last commit ("), stdout);
  assert.ok(stdout.includes("2026-10-21 10:00): 1 commit by others on any branch"), stdout);
  assert.ok(stdout.includes("  2026-10-22  Alice  Engine: Alice's later change"), stdout);
  assert.ok(!stdout.includes("Start: first commit"), "older than my last commit");
  assert.ok(!stdout.includes("Bob's own work"), "my own commit");
  assert.ok(stdout.includes("Commits on main not on this branch: 1"), stdout);
  assert.ok(stdout.includes("Product state (_product/spec.md): Built 2, Partial 1, Planned 2, Idea 8, Dropped 3"), stdout);
  assert.ok(stdout.includes("Undiscussed ideas (6, first 5):\n  - Sandboxed link screenshot\n"), stdout);
  assert.ok(stdout.includes("Planned or Partial features (3):\n  - Link checks (Partial)\n  - Chrome extension (Planned)\n"), stdout);
  assert.ok(stdout.includes("Feasibility (_product/research/feasibility.md): Open 3, Researched 1, Decided 1; open questions:\n  #1 Can Gmail push new mail within seconds?\n  #3 "), stdout);
  assert.ok(!stdout.includes("#2 "), "researched questions are not open");
  assert.equal(lines.at(-1), `Session start: ${FOOTER}`);

  // A developer with no commit yet falls back to the last 7 days.
  git(["config", "user.name", "Nobody"]);
  const again = await run([dir], env);
  assert.equal(again.code, 0, again.stdout);
  assert.ok(again.stdout.includes("No commit by Nobody found; in the last 7 days:"), again.stdout);
  assert.ok(again.stdout.includes("Developer: Nobody"), again.stdout);
});

test("run in this repo: exits 0, under 45 lines, ends with the footer, prints no secret", async () => {
  const started = Date.now();
  const { code, stdout, output } = await run([], { META_MODEL_API_KEY: "sk-SESSION-BRIEF-TEST-VALUE", TOKEN_ENC_KEY: "session-brief-test-key" });
  const elapsed = Date.now() - started;
  assert.equal(code, 0, output);
  const lines = stdout.replace(/\n$/, "").split("\n");
  assert.ok(lines.length <= MAX_LINES, `${lines.length} lines`);
  assert.match(lines[0], /^Session brief: repo \S+, (branch \S+|detached at \S+) \(/);
  assert.ok(stdout.includes("\nSince your last commit (") || stdout.includes("\nNo commit by "), stdout);
  assert.ok(stdout.includes("\nProduct state (_product/spec.md): Built "), stdout);
  assert.equal(lines.at(-1), `Session start: ${FOOTER}`);
  for (const secret of ["sk-SESSION-BRIEF-TEST-VALUE", "session-brief-test-key"]) assert.ok(!output.includes(secret), `leaked ${secret}`);
  assert.ok(elapsed < 3000, `took ${elapsed} ms (target: under one second)`);
});

test("the SessionStart hook runs the brief on startup and resume", () => {
  const settings = JSON.parse(readFileSync(join(repoRoot, ".claude", "settings.json"), "utf8"));
  assert.deepEqual(Object.keys(settings), ["hooks"]);
  const [entry] = settings.hooks.SessionStart;
  assert.equal(entry.matcher, "startup|resume");
  const [hook] = entry.hooks;
  assert.equal(hook.type, "command");
  assert.ok(hook.command.includes("node") && hook.command.includes("scripts/session-brief.mjs"), hook.command);
  assert.ok(hook.timeout > 0);
});
