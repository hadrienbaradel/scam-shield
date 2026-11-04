// scripts/docs-check.mjs: the product docs in _product/ stay consistent with
// each other and with the repo (spec links, statuses, Keywords lines, index
// files, CLAUDE.md links, Last updated, stale advice, the architecture doc,
// committed conflict markers). Fixtures live in temp directories; no network;
// git is used only by the tests that need it.
import { test } from "node:test";
import assert from "node:assert/strict";
import { execFile, execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import {
  backtickedPathsIn, codeFiles, CONFLICT_MARKER, formatReport, ignoredNames, isLocalLink, lastUpdated, linksIn, mentionsName,
  parseTables, runDocsCheck, STATUSES, trackedFiles,
} from "../scripts/docs-check.mjs";

const script = new URL("../scripts/docs-check.mjs", import.meta.url).pathname;
// Resolves with { code, stdout, stderr } whatever the exit code.
const run = (args) => new Promise((resolve) => {
  execFile(process.execPath, [script, ...args], { timeout: 20000 },
    (err, stdout, stderr) => resolve({ code: err ? err.code : 0, stdout, stderr }));
});

const SPEC = `# Scam Shield — Product Spec

Last updated: 2026-10-27

## Features
| Feature | Status | One-line spec | Details |
|---|---|---|---|
| Gmail scanning | Built (unverified live) | Scans mail. | [specs/gmail.md](specs/gmail.md) |
| Link checks | **Partial** | Age and redirects. | [specs/link-checks.md](specs/link-checks.md) |
| Public deployment | Planned | Railway EU. | [specs/public-deployment.md](specs/public-deployment.md) |
| CI workflow | Planned | Local branch. | [specs/public-deployment.md](specs/public-deployment.md) |

## Ideas (not yet planned)
| Idea | Where it came from | Discussed | One line | Details |
|---|---|---|---|---|
| Second opinion | Vlad, 2026-10-27 | no | Ask a human. | [specs/second-opinion.md](specs/second-opinion.md) |
| Voice-note check | PRD | no | Transcribe a voice note. | — |

## Dropped
- Legacy rules engine: superseded.
`;

// The architecture doc of the passing layout: it names every file of its lib/
// and src/ below (lib/llm/meta.js through its module folder lib/llm/).
const ARCH = `# Architecture

Last updated: 2026-10-27

The server is \`src/server.js\`; one file per area in \`src/routes/\` (\`mail.js\`); \`src/db/pool.js\` holds the pool.
The engine is \`lib/detector.js\`; every model call goes through \`lib/llm/\`.
`;

// A layout that passes every check. Tests copy it and break one thing.
const GOOD = {
  "_product/spec.md": SPEC,
  "_product/specs/gmail.md": "# Gmail scanning\nStatus: Built (unverified live) · Last updated: 2026-10-27\n\nText.\n",
  "_product/specs/link-checks.md": "# Link checks\nStatus: Partial · Last updated: 2026-10-27\n",
  "_product/specs/public-deployment.md": "# Public deployment\nStatus: Planned\n",
  "_product/specs/second-opinion.md": "# Second opinion\nStatus: Idea · Raised by Vlad, 2026-10-27 · Discussed: no\n",
  "_product/docs/git.md": "Keywords: commit, branch\n\n# Git rules\n",
  "_product/research/feasibility.md": "Keywords: feasibility, gmail\n\nQuestions.\n",
  "_product/research.md": "# Research\n- [Feasibility](research/feasibility.md): 25 questions.\n",
  "_product/competitors/carefull.md": "# Carefull\n\nCategory: senior finance.\n",
  "_product/competitors.md": "# Competitors\n| Who | Details |\n|---|---|\n| Carefull | `competitors/carefull.md` |\n",
  "_product/marketing/demo-plan.md": "# Demo plan\n",
  "_product/marketing.md": "# Marketing\n- demo-plan.md: the 3-minute video.\n",
  "_product/README.md": "# _product/\n\n`spec.md` first; rules in `docs/git.md`; the index is `_product/spec.md`; per feature `specs/<feature>.md`.\n"
    + "The checker is `scripts/docs-check.mjs`; see [the process](docs/git.md) and [the spec](spec.md#features).\n",
  "CLAUDE.md": "# Fixture\n\nSee [README](README.md) and [the spec](_product/spec.md); rules in `_product/docs/git.md`; [hackathon](https://dev.meta.ai) stays.\n",
  "README.md": "# Fixture\n\nSet keys with `make secrets-set KEY=value`; config/credentials.example lists them.\n"
    + "Architecture and the reasons behind it: [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md).\n",
  "docs/PRD.md": "# PRD map\n\nMaps the PRD to the code.\n",
  "docs/ARCHITECTURE.md": ARCH,
  "scripts/docs-check.mjs": "// stub so the backticked path exists\n",
  "lib/detector.js": "// stub\n",
  "lib/llm/meta.js": "// stub, named through its module folder lib/llm/\n",
  "src/server.js": "// stub\n",
  "src/routes/mail.js": "// stub\n",
  "src/db/pool.js": "// stub\n",
  "src/db/migrations/001_init.sql": "-- skipped: a migration\n",
  "src/db/testDatabase.js": "// skipped: a test helper\n",
};

const roots = [];
function layout(files) {
  const root = mkdtempSync(join(tmpdir(), "docs-check-"));
  roots.push(root);
  for (const [path, content] of Object.entries(files)) {
    if (content === null) continue;
    mkdirSync(dirname(join(root, path)), { recursive: true });
    writeFileSync(join(root, path), content);
  }
  return root;
}
test.after(() => { for (const root of roots) rmSync(root, { recursive: true, force: true }); });

const check = (files, opts = { git: false }) => runDocsCheck(layout({ ...GOOD, ...files }), opts);
const messages = (result) => result.findings.map((f) => `${f.file}${f.line ? `:${f.line}` : ""}: ${f.severity}: ${f.message}`);

let hasGit = true;
try { execFileSync("git", ["--version"], { stdio: "ignore" }); } catch { hasGit = false; }

// ---------------------------------------------------------------- parsing

test("tables are parsed with line numbers, cleaned cells and raw cells", () => {
  const tables = parseTables(SPEC);
  assert.equal(tables.length, 2);
  assert.deepEqual(tables[0].header, ["feature", "status", "one-line spec", "details"]);
  assert.equal(tables[0].rows[0].line, 8);
  assert.equal(tables[0].rows[1].cells[1], "Partial");
  assert.match(tables[0].rows[1].raw[3], /\[specs\/link-checks\.md\]/);
  assert.equal(tables[1].rows[1].cells[4], "—");
});

test("links and backticked paths are picked out of a line", () => {
  assert.deepEqual(linksIn('See [a](docs/a.md), ![img](public/x.png "title") and [web](https://x.y/z).'),
    ["docs/a.md", "public/x.png", "https://x.y/z"]);
  assert.ok(isLocalLink("docs/a.md") && isLocalLink("../README.md") && isLocalLink("spec.md#features"));
  assert.ok(!isLocalLink("https://x.y") && !isLocalLink("mailto:a@b.c") && !isLocalLink("#anchor") && !isLocalLink("specs/<feature>.md"));
  assert.deepEqual(backtickedPathsIn("Run `node scripts/x.mjs`, read `_product/spec.md`, `docs/`, `specs/<feature>.md` and `.infra/ci.yml`."),
    ["_product/spec.md", "docs/", ".infra/ci.yml"]);
});

// ---------------------------------------------------------------- checks

test("a consistent layout passes with no findings", () => {
  const result = check({});
  assert.deepEqual(messages(result), []);
  assert.equal(result.errors, 0);
  assert.equal(result.warnings, 0);
  assert.equal(formatReport(result), "docs-check: 0 errors, 0 warnings\n");
});

test("1: a specs/ file nobody links and a table link to a missing file are errors", () => {
  const result = check({
    "_product/specs/orphan.md": "# Orphan\nStatus: Idea\n",
    "_product/spec.md": SPEC.replace("| Voice-note check | PRD | no | Transcribe a voice note. | — |",
      "| Voice-note check | PRD | no | Transcribe a voice note. | [specs/voice.md](specs/voice.md) |"),
  });
  assert.deepEqual(messages(result), [
    "_product/spec.md:17: error: link specs/voice.md: file not found",
    "_product/specs/orphan.md: error: not linked from _product/spec.md (Features or Ideas table)",
  ]);
});

test("2: an unknown status in spec.md or in a specs/ file is an error", () => {
  const result = check({
    "_product/spec.md": SPEC.replace("| Link checks | **Partial** |", "| Link checks | Someday |"),
    "_product/specs/second-opinion.md": "# Second opinion\nStatus: Soon · Raised by Vlad\n",
    "_product/specs/public-deployment.md": "# Public deployment\nNo status line here.\n",
  });
  assert.deepEqual(messages(result), [
    '_product/spec.md:9: error: invalid status "Someday" for "Link checks" (expected Idea, Planned, Partial, Built or Dropped)',
    '_product/specs/public-deployment.md: error: no "Status:" line (expected Idea, Planned, Partial, Built or Dropped)',
    '_product/specs/second-opinion.md:2: error: invalid status "Soon" (expected Idea, Planned, Partial, Built or Dropped)',
  ]);
  assert.deepEqual(STATUSES, ["Idea", "Planned", "Partial", "Built", "Dropped"]);
});

test("2: a specs/ file whose Status differs from its spec.md row is a warning showing both", () => {
  const result = check({ "_product/specs/link-checks.md": "# Link checks\nStatus: Built · Last updated: 2026-10-27\n" });
  assert.equal(result.errors, 0);
  assert.deepEqual(messages(result), [
    '_product/specs/link-checks.md:2: warning: Status "Built" differs from _product/spec.md: "Link checks" is Partial (line 9)',
  ]);
  // Two rows may share one file (public-deployment.md): any matching row is enough.
  assert.deepEqual(messages(check({ "_product/specs/public-deployment.md": "# Public deployment\nStatus: Planned\n" })), []);
});

test("3: a docs/ or research/ file that does not open with Keywords: is an error", () => {
  const result = check({
    "_product/docs/testing.md": "# Testing\n\nKeywords: later\n",
    "_product/research/meta.md": "\nKeywords: meta\n",
    "_product/research.md": "# Research\n- research/feasibility.md\n- research/meta.md\n",
  });
  assert.deepEqual(messages(result), [
    '_product/docs/testing.md:1: error: first line must start with "Keywords:"',
    '_product/research/meta.md:1: error: first line must start with "Keywords:"',
  ]);
});

test("4: a research/ file missing from research.md is an error", () => {
  const result = check({ "_product/research/meta-ai-stack.md": "Keywords: meta\n\nText.\n" });
  assert.deepEqual(messages(result), ["_product/research/meta-ai-stack.md: error: not listed in _product/research.md"]);
});

test("4: a missing index file is one error naming the file to create", () => {
  const result = check({ "_product/competitors.md": null, "_product/competitors/google.md": "# Google\n" });
  assert.deepEqual(messages(result), [
    "_product/competitors.md: error: missing: create it and list the 2 file(s) in _product/competitors/ (carefull.md, google.md)",
  ]);
  // An empty or absent folder needs no index.
  assert.deepEqual(messages(check({ "_product/marketing.md": null, "_product/marketing/demo-plan.md": null })), []);
});

test("5: a broken link or backticked path in CLAUDE.md or _product/README.md is an error", () => {
  const result = check({
    "CLAUDE.md": "# Fixture\n\n[gone](docs/nope.md) and `_product/docs/nope.md`; `docs/PRD.md` and [web](https://x.y/z) are fine.\n",
    "_product/README.md": "# _product/\n\n`docs/git.md` resolves from here; `docs/dx.md` (being written) does not; `scripts/docs-check.mjs` resolves from the root.\n",
  });
  assert.deepEqual(messages(result), [
    "_product/README.md:3: error: path docs/dx.md: file not found",
    "CLAUDE.md:3: error: link docs/nope.md: file not found",
    "CLAUDE.md:3: error: path _product/docs/nope.md: file not found",
  ]);
});

test("6: spec.md needs a Last updated date; the git call is optional", () => {
  const missing = check({ "_product/spec.md": SPEC.replace("Last updated: 2026-10-27\n", "") });
  assert.deepEqual(messages(missing), ['_product/spec.md: error: no "Last updated: YYYY-MM-DD" line']);
  const bad = check({ "_product/spec.md": SPEC.replace("Last updated: 2026-10-27", "Last updated: today") });
  assert.deepEqual(messages(bad), ['_product/spec.md:3: error: "Last updated:" needs a YYYY-MM-DD date']);
  // Not a git repository (or no git at all): no warning, no crash.
  assert.deepEqual(messages(check({ "_product/spec.md": SPEC.replace("2026-10-27", "2020-01-01") }, { git: true })), []);
});

test("6: a Last updated older than the newest commit touching specs/ is a warning", { skip: !hasGit && "git not installed" }, () => {
  const root = layout({ ...GOOD, "_product/spec.md": SPEC.replace("Last updated: 2026-10-27", "Last updated: 2026-10-20") });
  const env = { ...process.env, GIT_AUTHOR_DATE: "2026-10-27T12:00:00Z", GIT_COMMITTER_DATE: "2026-10-27T12:00:00Z" };
  for (const key of ["GIT_DIR", "GIT_WORK_TREE", "GIT_INDEX_FILE"]) delete env[key];
  const git = (...args) => execFileSync("git", ["-c", "user.name=t", "-c", "user.email=t@example.com", "-c", "commit.gpgsign=false", ...args],
    { cwd: root, env, stdio: "ignore" });
  git("init", "-q");
  git("add", "-A");
  git("commit", "-q", "-m", "specs");
  const result = runDocsCheck(root, { git: true });
  assert.equal(result.errors, 0);
  assert.deepEqual(messages(result), [
    "_product/spec.md:3: warning: Last updated 2026-10-20 is older than the newest commit touching _product/specs/ (2026-10-27); refresh the index",
  ]);
  assert.deepEqual(messages(runDocsCheck(root, { git: false })), []);
});

test("7: stale advice is a warning with file and line; lines that explain the change are not", () => {
  const result = check({
    "README.md": [
      "# Fixture",
      "node scripts/set-env.mjs META_MODEL_API_KEY=...   # never printed",
      "Copy .env.example to .env first.",
      "docs/PRD.md is the source of truth for the product.",
      "`node scripts/set-env.mjs KEY=value` still works as a deprecated shim.",
      "`.env.example` was renamed to `config/credentials.example`.",
      "The PRD is mapped to the code in docs/PRD.md.",
      "Architecture and the reasons behind it: [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md).",
      "",
    ].join("\n"),
  });
  assert.equal(result.errors, 0);
  assert.deepEqual(messages(result), [
    "README.md:2: warning: stale: scripts/set-env.mjs is a deprecated shim; keys live in config/credentials.enc (see _product/docs/secrets.md)",
    "README.md:3: warning: stale: .env.example was renamed to config/credentials.example",
    "README.md:4: warning: stale: docs/PRD.md named as the source of truth; _product/spec.md is",
  ]);
});

test("7: the scan covers CLAUDE.md, docs/*.md and every file under _product/", () => {
  const result = check({
    "CLAUDE.md": "# Fixture\n\nSet keys with `node scripts/set-env.mjs KEY=value`.\n",
    "docs/STATUS.md": "# Status\n\nThe PRD stays the source of truth.\n",
    "_product/docs/git.md": "Keywords: git\n\nNever commit .env.example with real values.\n",
  });
  assert.deepEqual(result.findings.map((f) => `${f.file}:${f.line}`), ["_product/docs/git.md:3", "CLAUDE.md:3", "docs/STATUS.md:3"]);
  assert.ok(result.findings.every((f) => f.severity === "warning" && f.check === "stale"));
});

test("a missing spec.md is reported, not a crash; findings come back sorted by file", () => {
  const result = check({ "_product/spec.md": null, "_product/research.md": null });
  assert.ok(result.errors >= 2);
  const files = result.findings.map((f) => f.file);
  assert.deepEqual(files, [...files].sort((a, b) => a.localeCompare(b)));
  assert.ok(messages(result).includes("_product/spec.md: error: missing: the product spec index (Features table, Ideas table, Dropped list)"));
  assert.ok(messages(result).some((m) => m.startsWith("_product/research.md: error: missing")));
  // Orphan errors need an index to compare against, so specs/ files are not all reported as unlinked.
  assert.ok(!messages(result).some((m) => m.includes("not linked from")));
});

// ---------------------------------------------------------------- 8 architecture

// Runs git in a fixture with a fixed author and date, never in the caller's repository.
const gitAt = (root, date) => (...args) => {
  const env = { ...process.env, GIT_AUTHOR_DATE: date, GIT_COMMITTER_DATE: date };
  for (const key of ["GIT_DIR", "GIT_WORK_TREE", "GIT_INDEX_FILE"]) delete env[key];
  execFileSync("git", ["-c", "user.name=t", "-c", "user.email=t@example.com", "-c", "commit.gpgsign=false", ...args],
    { cwd: root, env, stdio: "ignore" });
};

test("8: README.md must link docs/ARCHITECTURE.md; a bare mention or a link in a code block is not enough", () => {
  const linkError = 'README.md: error: no link to docs/ARCHITECTURE.md (add "Architecture and the reasons behind it: [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md)")';
  assert.deepEqual(messages(check({ "README.md": "# Fixture\n\nThe architecture is in docs/ARCHITECTURE.md.\n" })), [linkError]);
  assert.deepEqual(messages(check({ "README.md": "# Fixture\n\n```\n[architecture](docs/ARCHITECTURE.md)\n```\n" })), [linkError]);
  assert.ok(messages(check({ "README.md": null })).includes(linkError));
  // Any spelling that resolves to the file is a link.
  assert.deepEqual(messages(check({ "README.md": "# Fixture\n\nSee [how it is built](./docs/ARCHITECTURE.md#the-verdict-pipeline).\n" })), []);
});

test("8: docs/ARCHITECTURE.md must exist and carry a Last updated date", () => {
  assert.deepEqual(messages(check({ "docs/ARCHITECTURE.md": null })), [
    "docs/ARCHITECTURE.md: error: missing: the technical architecture doc (pipeline, components, data model, decisions and why)",
  ]);
  assert.deepEqual(messages(check({ "docs/ARCHITECTURE.md": ARCH.replace("Last updated: 2026-10-27\n", "") })), [
    'docs/ARCHITECTURE.md: error: no "Last updated: YYYY-MM-DD" line',
  ]);
  assert.deepEqual(messages(check({ "docs/ARCHITECTURE.md": ARCH.replace("Last updated: 2026-10-27", "Last updated: soon") })), [
    'docs/ARCHITECTURE.md:3: error: "Last updated:" needs a YYYY-MM-DD date',
  ]);
  assert.deepEqual(lastUpdated("# Doc\n\n**Last updated:** 2026-10-29 by Vlad\n"), { line: 3, date: "2026-10-29" });
  // Not a git repository (or no git at all): no warning, no crash.
  assert.deepEqual(messages(check({ "docs/ARCHITECTURE.md": ARCH.replace("2026-10-27", "2020-01-01") }, { git: true })), []);
});

test("8: every file under lib/ and src/ is named in the doc, by its own name or by its module folder's", () => {
  const result = check({
    "lib/lessons.js": "// a new top-level module the doc does not name\n",
    "lib/llm/gemini.js": "// a new provider: the doc names its module folder lib/llm/\n",
    "lib/promptGuard/index.js": "// a new module folder nobody named\n",
    "src/routes/whatsapp.js": "// a route: naming src/routes/ does not cover it\n",
    "src/channels/telegram.js": "// a channel needs its own name too\n",
    "src/jobs/digest.js": "// so does a job\n",
    "src/db/migrations/006_job_runs.sql": "-- skipped: a migration\n",
  });
  assert.deepEqual(messages(result), [
    "lib/lessons.js: error: not named in docs/ARCHITECTURE.md: say what lessons.js does under Components, or opt out with <!-- docs-check: ignore lessons.js -->",
    "lib/promptGuard/index.js: error: not named in docs/ARCHITECTURE.md, nor is its folder lib/promptGuard/: say what it does under Components, or opt out with <!-- docs-check: ignore promptGuard -->",
    "src/channels/telegram.js: error: not named in docs/ARCHITECTURE.md: say what telegram.js does under Components, or opt out with <!-- docs-check: ignore telegram.js -->",
    "src/jobs/digest.js: error: not named in docs/ARCHITECTURE.md: say what digest.js does under Components, or opt out with <!-- docs-check: ignore digest.js -->",
    "src/routes/whatsapp.js: error: not named in docs/ARCHITECTURE.md: say what whatsapp.js does under Components, or opt out with <!-- docs-check: ignore whatsapp.js -->",
  ]);
  assert.ok(result.findings.every((f) => f.check === "architecture" && f.severity === "error"));
});

test("8: <!-- docs-check: ignore <name> --> opts a file or a folder out; a name inside any other comment does not count", () => {
  const files = { "lib/lessons.js": "//\n", "lib/promptGuard/index.js": "//\n", "lib/promptGuard/chunks.js": "//\n", "src/routes/whatsapp.js": "//\n" };
  const doc = `${ARCH}\n<!-- docs-check: ignore lessons.js lib/promptGuard/ -->\n<!-- whatsapp.js is being built -->\n`;
  assert.deepEqual(messages(check({ ...files, "docs/ARCHITECTURE.md": doc })), [
    "src/routes/whatsapp.js: error: not named in docs/ARCHITECTURE.md: say what whatsapp.js does under Components, or opt out with <!-- docs-check: ignore whatsapp.js -->",
  ]);
  assert.deepEqual([...ignoredNames("<!-- docs-check: ignore a.js, lib/b/ -->\n<!--docs-check:ignore c-->\n`<!-- docs-check: ignore <name> -->`")], ["a.js", "lib/b", "c"]);
});

test("8: a name counts only whole; migrations, test helpers and dot files are not code to name", () => {
  assert.ok(mentionsName("see `lib/lessons.js`", "lessons") && mentionsName("lessons.js", "lessons.js") && mentionsName("(llm/)", "llm"));
  assert.ok(!mentionsName("lessonsLearned and micro_lessons", "lessons") && !mentionsName("OAuth", "auth"));
  const root = layout({ ...GOOD, "lib/.DS_Store": "", "lib/x.test.js": "//\n", "lib/testUtils.js": "//\n", "src/fixtures/mail.json": "{}\n" });
  assert.deepEqual(codeFiles(root), ["lib/detector.js", "lib/llm/meta.js", "src/db/pool.js", "src/routes/mail.js", "src/server.js"]);
});

test("8: a Last updated older than the newest commit touching lib/ or src/ is a warning", { skip: !hasGit && "git not installed" }, () => {
  const root = layout({ ...GOOD, "docs/ARCHITECTURE.md": ARCH.replace("2026-10-27", "2026-10-20") });
  const git = gitAt(root, "2026-10-27T12:00:00Z");
  git("init", "-q");
  git("add", "-A");
  git("commit", "-q", "-m", "code and docs");
  const result = runDocsCheck(root, { git: true });
  assert.equal(result.errors, 0);
  assert.deepEqual(messages(result), [
    "docs/ARCHITECTURE.md:3: warning: Last updated 2026-10-20 is older than the newest commit touching lib/ or src/ (2026-10-27); check the doc against the code, then move the date",
  ]);
  assert.deepEqual(messages(runDocsCheck(root, { git: false })), []);
  // A later commit that touches neither lib/ nor src/ asks for nothing.
  writeFileSync(join(root, "docs/ARCHITECTURE.md"), ARCH);
  gitAt(root, "2026-10-29T12:00:00Z")("commit", "-q", "-am", "docs only");
  assert.deepEqual(messages(runDocsCheck(root, { git: true })), []);
});

// ---------------------------------------------------------------- 9 conflict markers

// Built here, so that no line of this file starts with a marker itself.
const OURS = "<".repeat(7);
const THEIRS = ">".repeat(7);
const markerError = (marker) => `merge-conflict marker ${marker} left by a merge or rebase: resolve the conflict, then delete the marker lines`;

test("9: an outer conflict marker at the start of a line matches; the ======= underline and look-alikes do not", () => {
  for (const line of [`${OURS} HEAD`, `${THEIRS} 3f2a1b0 (Log: claim the CI task)`, OURS, THEIRS]) assert.ok(CONFLICT_MARKER.test(line), line);
  for (const line of ["=======", `${OURS}< HEAD`, ` ${OURS} HEAD`, `${THEIRS}x`, `quoted: ${THEIRS} HEAD`]) assert.ok(!CONFLICT_MARKER.test(line), line);
});

test("9: a tracked text file with conflict markers is an error per marker line; binary, node_modules and untracked files are not", { skip: !hasGit && "git not installed" }, () => {
  const conflicted = [
    "# Team log", "", "## In progress", "", "| Who | Since |", "|---|---|",
    `${OURS} HEAD`, "| Vlad · hygiene | 2026-11-04 |", "=======", "| Vlad · ci | 2026-11-04 |", `${THEIRS} 3f2a1b0 (Log: claim the CI task)`, "",
  ].join("\n");
  const root = layout({
    ...GOOD,
    "_product/log.md": conflicted,
    "_product/docs/git.md": "Keywords: commit, branch\n\nGit rules\n=======\n\nAn underline, not a marker.\n",
    "node_modules/pkg/README.md": conflicted,
  });
  writeFileSync(join(root, "data.bin"), Buffer.concat([Buffer.from([0, 1, 2]), Buffer.from(`\n${OURS} HEAD\n`)]));
  const git = gitAt(root, "2026-10-27T12:00:00Z");
  git("init", "-q");
  git("add", "-A");
  git("add", "-f", "node_modules/pkg/README.md", "data.bin"); // tracked even under a global ignore
  git("commit", "-q", "-m", "a rebase gone wrong");
  writeFileSync(join(root, "notes.md"), conflicted); // untracked: never read
  const result = runDocsCheck(root, { git: true });
  assert.deepEqual(messages(result), [
    `_product/log.md:7: error: ${markerError(OURS)}`,
    `_product/log.md:11: error: ${markerError(THEIRS)}`,
  ]);
  assert.ok(result.findings.every((f) => f.check === "markers"));
  assert.ok(trackedFiles(root).includes("node_modules/pkg/README.md") && !trackedFiles(root).includes("notes.md"));
  // No git, no check: --no-git, or a folder that is not a repository.
  assert.deepEqual(messages(runDocsCheck(root, { git: false })), []);
  assert.equal(trackedFiles(layout(GOOD)), null);
});

// ---------------------------------------------------------------- cli

test("cli: exit 1 with errors, 0 when clean, summary line first, findings sorted", async () => {
  const clean = await run(["--root", layout(GOOD), "--no-git"]);
  assert.equal(clean.code, 0);
  assert.equal(clean.stdout, "docs-check: 0 errors, 0 warnings\n");

  const broken = await run(["--root", layout({ ...GOOD, "_product/specs/orphan.md": "# Orphan\nStatus: Idea\n", "_product/research.md": null }), "--no-git"]);
  assert.equal(broken.code, 1);
  const lines = broken.stdout.trim().split("\n");
  assert.equal(lines[0], "docs-check: 2 errors, 0 warnings");
  assert.deepEqual(lines.slice(1), [
    "_product/research.md: error: missing: create it and list the 1 file(s) in _product/research/ (feasibility.md)",
    "_product/specs/orphan.md: error: not linked from _product/spec.md (Features or Ideas table)",
  ]);
});

test("cli: --warn-only downgrades every finding and exits 0", async () => {
  const root = layout({ ...GOOD, "_product/specs/orphan.md": "# Orphan\nStatus: Idea\n", "_product/docs/testing.md": "# Testing\n" });
  const strict = await run(["--root", root, "--no-git"]);
  assert.equal(strict.code, 1);
  const lenient = await run(["--root", root, "--no-git", "--warn-only"]);
  assert.equal(lenient.code, 0);
  const lines = lenient.stdout.trim().split("\n");
  assert.equal(lines[0], "docs-check: 0 errors, 2 warnings");
  assert.ok(lines.slice(1).every((l) => l.includes(": warning: ")));
});

test("cli: --json prints the result as JSON with the finding shape", async () => {
  const root = layout({ ...GOOD, "_product/specs/link-checks.md": "# Link checks\nStatus: Built\n", "_product/research.md": null });
  const { code, stdout } = await run(["--root", root, "--no-git", "--json"]);
  assert.equal(code, 1);
  const result = JSON.parse(stdout);
  assert.deepEqual(Object.keys(result), ["root", "errors", "warnings", "findings"]);
  assert.equal(result.root, root);
  assert.equal(result.errors, 1);
  assert.equal(result.warnings, 1);
  assert.deepEqual(result.findings.map((f) => Object.keys(f)), [
    ["severity", "check", "file", "line", "message"],
    ["severity", "check", "file", "line", "message"],
  ]);
  assert.deepEqual(result.findings.map((f) => [f.severity, f.check, f.file, f.line]), [
    ["error", "index", "_product/research.md", null],
    ["warning", "status", "_product/specs/link-checks.md", 2],
  ]);
  const lenient = JSON.parse((await run(["--root", root, "--no-git", "--json", "--warn-only"])).stdout);
  assert.deepEqual([lenient.errors, lenient.warnings], [0, 2]);
  assert.ok(lenient.findings.every((f) => f.severity === "warning"));
});

test("cli: an unknown argument exits 2 with the usage; --help exits 0", async () => {
  const bad = await run(["--bogus"]);
  assert.equal(bad.code, 2);
  assert.match(bad.stderr, /unknown argument --bogus/);
  assert.match(bad.stderr, /usage: node scripts\/docs-check\.mjs/);
  const help = await run(["--help"]);
  assert.equal(help.code, 0);
  assert.match(help.stdout, /--warn-only/);
});
