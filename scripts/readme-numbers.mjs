#!/usr/bin/env node
// README numbers: the figures at the top of README.md are measured, not typed
// (_product/docs/testing.md). `make readme-numbers` writes them; `make check`
// (so CI) fails when the README's coverage drifts from the run's.
//
//   node scripts/readme-numbers.mjs --write   run the suite with coverage (npm run check: Postgres needed),
//                                             the seed cases (scripts/score.mjs, NODE_ENV=test, no key),
//                                             count the commits since the kickoff and the Android unit
//                                             tests, ask gh for the last 100 CI runs (skipped when gh does
//                                             not answer), then rewrite the block between
//                                             <!-- numbers:start --> and <!-- numbers:end --> and the
//                                             coverage, tests and seed-case badges of README.md
//   node scripts/readme-numbers.mjs --check   line coverage from coverage/lcov.info (written by npm run
//                                             check just before) against the README's table and badge:
//                                             exit 1 when they differ by more than 1.0 point, or when the
//                                             block or its coverage row is missing
//   node scripts/readme-numbers.mjs --root <dir> ...   another checkout (the tests use this)
//
// Rows of the block the script does not measure (the time to a verdict, from a
// dated evaluation) are kept as written; a measured row it could not measure
// this time is kept with the date it was measured. Plain Node; never reads
// .env or config/master.key.

import { execFileSync, spawnSync } from "node:child_process";
import { readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

export const README = "README.md";
export const LCOV = "coverage/lcov.info";
export const START = "<!-- numbers:start -->";
export const END = "<!-- numbers:end -->";
export const TOLERANCE = 1.0;
// Building started when the kickoff ended: 12:24 PM ET on Monday Oct 26, 2026 (docs/PROVENANCE.md).
export const KICKOFF = "2026-10-26T12:24:00-04:00";
export const KICKOFF_DAY = "2026-10-26";
export const FIX = "run make readme-numbers and commit README.md";
const CI_WORKFLOW = "ci.yml";
const CI_LIMIT = 100;
const FAILED = ["failure", "timed_out", "startup_failure"];
// Keys the seed-case run must not see (it never calls a model; NODE_ENV=test already stops the credentials).
const MODEL_KEYS = ["META_MODEL_API_KEY", "OPENAI_API_KEY", "ANTHROPIC_API_KEY", "GROQ_API_KEY", "HF_TOKEN", "LLM_PROVIDER"];

// ---------------------------------------------------------------- parsing

// The summary node --test prints last: "ℹ tests 411", "ℹ pass 411", "ℹ fail 0" (spec reporter; "# tests 411" in TAP).
export function parseTestSummary(output) {
  const out = {};
  for (const m of String(output ?? "").matchAll(/^(?:ℹ|#)\s*(tests|suites|pass|fail|cancelled|skipped|todo)\s+(\d+)\s*$/gm)) out[m[1]] = Number(m[2]);
  return ["tests", "pass", "fail"].every((k) => Number.isInteger(out[k])) ? out : null;
}

// The line % of the "all files" row in node's coverage table: "ℹ all files | 94.85 | 84.43 | 88.36 |".
export function parseCoverageTable(output) {
  const rows = [...String(output ?? "").matchAll(/^(?:ℹ|#)\s*all files\s*\|\s*(\d+(?:\.\d+)?)\s*\|/gm)];
  return rows.length ? Number(rows.at(-1)[1]) : null;
}

// Line coverage of an lcov file: every LH over every LF, the way node computes its "all files" line.
export function lcovLineCoverage(text) {
  let found = 0;
  let hit = 0;
  for (const m of String(text ?? "").matchAll(/^(LF|LH):(\d+)\s*$/gm)) {
    if (m[1] === "LF") found += Number(m[2]);
    else hit += Number(m[2]);
  }
  return { found, hit, percent: found ? (100 * hit) / found : null };
}

// "Overall: 37/37" and "False Scam on legit (C): 0" from scripts/score.mjs.
export function parseScore(output) {
  const text = String(output ?? "");
  const overall = text.match(/^Overall:\s*(\d+)\/(\d+)\s*$/m);
  if (!overall) return null;
  const falseScam = text.match(/^False Scam on legit \(C\):\s*(\d+)/m);
  return { pass: Number(overall[1]), total: Number(overall[2]), falseScam: falseScam ? Number(falseScam[1]) : null };
}

// The coverage floor: --test-coverage-lines=93 in package.json's check script.
export function coverageThreshold(packageJson) {
  try {
    const m = String(JSON.parse(packageJson).scripts?.check ?? "").match(/--test-coverage-lines=(\d+(?:\.\d+)?)/);
    return m ? Number(m[1]) : null;
  } catch {
    return null;
  }
}

// JUnit tests in a Kotlin or Java file: one @Test annotation each.
export function countAnnotatedTests(source) {
  return (String(source ?? "").match(/^\s*@Test\b/gm) || []).length;
}

// gh's JSON for the last runs of a workflow: how many failed, passed, were cancelled or still run.
export function summarizeRuns(runs) {
  const list = Array.isArray(runs) ? runs : [];
  const count = (f) => list.filter(f).length;
  return {
    total: list.length,
    failed: count((r) => FAILED.includes(r.conclusion)),
    passed: count((r) => r.conclusion === "success"),
    cancelled: count((r) => r.conclusion === "cancelled"),
    running: count((r) => r.status && r.status !== "completed"),
  };
}

// Whole calendar days from one YYYY-MM-DD to another.
export const daysBetween = (from, to) => Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86400000);
export const localDate = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

// ---------------------------------------------------------------- the README

// The text between the markers, or null when either is missing.
export function blockOf(readme) {
  const text = String(readme ?? "");
  const s = text.indexOf(START);
  const e = s < 0 ? -1 : text.indexOf(END, s + START.length);
  return e < 0 ? null : text.slice(s + START.length, e);
}

export function replaceBlock(readme, inner) {
  const text = String(readme ?? "");
  const s = text.indexOf(START);
  const e = s < 0 ? -1 : text.indexOf(END, s + START.length);
  if (e < 0) throw new Error(`README.md has no numbers block: put ${START} and ${END} on their own lines where the table goes`);
  return `${text.slice(0, s + START.length)}${inner}${text.slice(e)}`;
}

const cleanCell = (cell) => String(cell ?? "").replace(/\*\*|`/g, "").replace(/\s+/g, " ").trim();
const cellsOf = (line) => line.trim().replace(/^\|/, "").replace(/\|$/, "").split("|");

// The table rows of a block, header and separator left out: { first, raw }.
export function tableRows(block) {
  const lines = String(block ?? "").split(/\r?\n/).filter((l) => l.trim().startsWith("|"));
  return lines.slice(1).filter((l) => !/^\|\s*:?-+:?\s*\|/.test(l.trim())).map((raw) => ({ raw, first: cleanCell(cellsOf(raw)[0]) }));
}

const plural = (n, one, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

function ciValue({ ci }) {
  const parts = [`${ci.passed} passed`];
  if (ci.cancelled) parts.push(`${ci.cancelled} cancelled by a newer push`);
  if (ci.running) parts.push(`${ci.running} running`);
  return `**${ci.failed} failed** of the last ${ci.total} (${parts.join(", ")})`;
}

// The rows the script measures, in order. `match` finds the same row in an older block.
export const ROWS = [
  { key: "tests", match: /^Tests\b/, label: "Tests (`make check`, the Postgres suites included)",
    value: (n) => `**${n.tests.pass} passing**, ${n.tests.fail} failing` },
  { key: "coverage", match: /^Line coverage\b/, label: "Line coverage of `lib/` and `src/`",
    value: (n) => `**${n.coverage.toFixed(2)}%**${n.threshold ? `; \`make check\` and CI fail below ${n.threshold}%` : ""}` },
  { key: "score", match: /^Seed cases\b/, label: "Seed cases, PRD pass criteria (`make score`, run by CI)",
    value: (n) => `**${n.score.pass}/${n.score.total}**${n.score.falseScam === null ? "" : `, ${plural(n.score.falseScam, "genuine message")} called Scam`}` },
  { key: "android", match: /^Android\b/, label: "Android companion unit tests (JVM, run by CI)",
    value: (n) => `**${n.android}**` },
  { key: "commits", match: /^Commits\b/, label: "Commits since the kickoff (Oct 26, 12:24 PM ET), a team of two",
    value: (n) => `**${n.commits}** in ${plural(n.days, "day")}` },
  { key: "ci", match: /^CI runs\b/, label: "CI runs (`ci.yml` on GitHub Actions)", value: ciValue },
];

// The block between the markers: the measured rows, then the rows of the old block the script does not own.
export function renderBlock(numbers, previous = "", { date }) {
  const old = tableRows(previous);
  const oldDate = (String(previous ?? "").match(/As of (\d{4}-\d{2}-\d{2})/) || [])[1] || null;
  const lines = ["| What | Measured |", "|---|---|"];
  const kept = [];
  for (const row of ROWS) {
    if (numbers[row.key] !== null && numbers[row.key] !== undefined) { lines.push(`| ${row.label} | ${row.value(numbers)} |`); continue; }
    const before = old.find((r) => row.match.test(r.first));
    if (!before) continue;
    kept.push(row.key);
    lines.push(/\(as of \d{4}-\d{2}-\d{2}\)/.test(before.raw) || !oldDate ? before.raw.trim() : before.raw.trim().replace(/\s*\|$/, ` (as of ${oldDate}) |`));
  }
  for (const r of old) if (!ROWS.some((row) => row.match.test(r.first))) lines.push(r.raw.trim());
  const note = `As of ${date}, measured by \`make readme-numbers\` (a row that names its own date comes from that run); \`make check\` fails when the coverage here and the run's differ by more than one point.`;
  return { text: `\n${lines.join("\n")}\n\n${note}\n`, kept };
}

// A shields.io static badge: "-" and "_" doubled, the rest URL-encoded.
export function badgeUrl(label, message, color) {
  const enc = (s) => encodeURIComponent(String(s).replace(/-/g, "--").replace(/_/g, "__"));
  return `https://img.shields.io/badge/${enc(label)}-${enc(message)}-${color}`;
}

export function badgeUrls(n) {
  const c = n.coverage;
  return {
    coverage: badgeUrl("coverage", `${c.toFixed(1)}%`, c >= 90 ? "brightgreen" : c >= 80 ? "green" : c >= 70 ? "yellow" : "red"),
    tests: badgeUrl("tests", n.tests.fail ? `${n.tests.pass} passing, ${n.tests.fail} failing` : `${n.tests.pass} passing`, n.tests.fail ? "red" : "brightgreen"),
    seed: badgeUrl("seed cases", `${n.score.pass}/${n.score.total}`, n.score.pass === n.score.total ? "brightgreen" : "red"),
  };
}

const BADGES = {
  coverage: /https:\/\/img\.shields\.io\/badge\/coverage-[^\s)"'<>]*/g,
  tests: /https:\/\/img\.shields\.io\/badge\/tests-[^\s)"'<>]*/g,
  seed: /https:\/\/img\.shields\.io\/badge\/seed%20cases-[^\s)"'<>]*/g,
};

// The README with its three measured badges pointed at `urls`; `missing` names the badges it has not got.
export function updateBadges(readme, urls) {
  let text = String(readme ?? "");
  const missing = [];
  for (const [key, re] of Object.entries(BADGES)) {
    if (!text.match(re)) { missing.push(key); continue; }
    text = text.replace(re, urls[key]);
  }
  return { text, missing };
}

// The coverage the README states: the "Line coverage" row of the block, and the coverage badge.
export function readmeCoverage(readme) {
  const row = tableRows(blockOf(readme) ?? "").find((r) => /^Line coverage\b/.test(r.first));
  const m = row && cellsOf(row.raw).slice(1).join("|").match(/(\d+(?:\.\d+)?)\s*%/);
  return m ? Number(m[1]) : null;
}

export function badgeCoverage(readme) {
  const m = String(readme ?? "").match(/img\.shields\.io\/badge\/coverage-(\d+(?:\.\d+)?)%25/);
  return m ? Number(m[1]) : null;
}

// --check: { ok, message } for a README and the lcov text of the run (null when the file is missing).
export function checkReadme(readme, lcov, { tolerance = TOLERANCE } = {}) {
  const fail = (message) => ({ ok: false, message: `readme-numbers: ${message}` });
  if (blockOf(readme) === null) return fail(`README.md has no numbers block: put ${START} and ${END} on their own lines where the table goes, then ${FIX}`);
  const stated = readmeCoverage(readme);
  if (stated === null) return fail(`the numbers block of README.md has no "Line coverage" row: ${FIX}`);
  if (lcov === null || lcov === undefined) return fail(`${LCOV} not found: run make check (or make coverage) first`);
  const { percent } = lcovLineCoverage(lcov);
  if (percent === null) return fail(`${LCOV} has no line totals (LF/LH): run make check again`);
  for (const [where, value] of [["the numbers table", stated], ["the coverage badge", badgeCoverage(readme)]]) {
    if (value === null) continue;
    const gap = Math.round(Math.abs(value - percent) * 100) / 100;
    if (gap > tolerance) {
      return fail(`README.md (${where}) says ${value}% line coverage, this run measured ${percent.toFixed(2)}% (${gap.toFixed(2)} points apart, more than ${tolerance.toFixed(1)}): ${FIX}`);
    }
  }
  return { ok: true, message: `readme-numbers: README.md says ${stated}% line coverage, this run measured ${percent.toFixed(2)}% (within ${tolerance.toFixed(1)} point)` };
}

// ---------------------------------------------------------------- measuring

const read = (path) => {
  try { return readFileSync(path, "utf8"); } catch { return null; }
};
const isDir = (path) => { try { return statSync(path).isDirectory(); } catch { return false; } };
const SKIP_DIRS = new Set(["build", "node_modules"]);

// @Test annotations in android/**/src/test/**; null without an android/ folder or test files.
export function androidTests(root) {
  const base = join(root, "android");
  if (!isDir(base)) return null;
  let files = 0;
  let tests = 0;
  const walk = (dir) => {
    for (const e of readdirSync(dir, { withFileTypes: true })) {
      if (e.name.startsWith(".") || SKIP_DIRS.has(e.name)) continue;
      const path = join(dir, e.name);
      if (e.isDirectory()) walk(path);
      else if (/\.(kt|java)$/.test(e.name) && /[\\/]src[\\/]test[\\/]/.test(path.slice(base.length))) {
        files++;
        tests += countAnnotatedTests(read(path));
      }
    }
  };
  walk(base);
  return files ? tests : null;
}

const gitEnv = () => {
  const env = { ...process.env };
  for (const key of ["GIT_DIR", "GIT_WORK_TREE", "GIT_INDEX_FILE"]) delete env[key];
  return env;
};

// The real runners; the tests hand main() fakes instead.
export const runners = {
  suite(root) {
    const r = spawnSync("npm", ["run", "--silent", "check"], { cwd: root, encoding: "utf8", maxBuffer: 64 << 20 });
    return { status: r.status ?? 1, output: `${r.stdout ?? ""}${r.stderr ?? ""}${r.error ? r.error.message : ""}` };
  },
  score(root) {
    const env = { ...process.env, NODE_ENV: "test" };
    for (const key of MODEL_KEYS) delete env[key];
    const r = spawnSync(process.execPath, ["scripts/score.mjs"], { cwd: root, env, encoding: "utf8", maxBuffer: 16 << 20 });
    return { status: r.status ?? 1, output: `${r.stdout ?? ""}${r.stderr ?? ""}` };
  },
  commits(root) {
    try {
      const out = execFileSync("git", ["rev-list", "--count", `--since=${KICKOFF}`, "HEAD"],
        { cwd: root, env: gitEnv(), encoding: "utf8", stdio: ["ignore", "pipe", "ignore"], timeout: 10000 }).trim();
      return /^\d+$/.test(out) ? Number(out) : null;
    } catch {
      return null;
    }
  },
  ci(root) {
    try {
      const out = execFileSync("gh", ["run", "list", "--workflow", CI_WORKFLOW, "--limit", String(CI_LIMIT), "--json", "status,conclusion"],
        { cwd: root, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"], timeout: 20000 });
      const ci = summarizeRuns(JSON.parse(out));
      return ci.total ? ci : null;
    } catch {
      return null;
    }
  },
  android: androidTests,
};

const tail = (text, n) => String(text ?? "").trimEnd().split(/\r?\n/).slice(-n).join("\n");

function write(root, out, err, run, now) {
  const path = join(root, README);
  if (blockOf(read(path)) === null) {
    err.write(`readme-numbers: ${README} has no numbers block: put ${START} and ${END} on their own lines where the table goes\n`);
    return 1;
  }
  out.write("readme-numbers: running every suite with coverage (npm run check, Postgres needed)...\n");
  const suite = run.suite(root);
  const tests = parseTestSummary(suite.output);
  if (suite.status !== 0 || !tests || tests.fail) {
    err.write(`${tail(suite.output, 30)}\nreadme-numbers: the suite did not pass (exit ${suite.status}${tests ? `, ${tests.fail} failing` : ""}); numbers come from a green run only: fix it, then make readme-numbers again\n`);
    return 1;
  }
  const coverage = lcovLineCoverage(read(join(root, LCOV))).percent ?? parseCoverageTable(suite.output);
  if (coverage === null) {
    err.write(`readme-numbers: no line coverage in ${LCOV} or in the run's output\n`);
    return 1;
  }
  const scoreRun = run.score(root);
  const score = parseScore(scoreRun.output);
  if (!score || scoreRun.status !== 0 || score.pass !== score.total || score.falseScam) {
    err.write(`${tail(scoreRun.output, 15)}\nreadme-numbers: the seed cases do not all pass${score ? ` (${score.pass}/${score.total}, ${score.falseScam} false Scam)` : ""}: fix them (make score), then make readme-numbers again\n`);
    return 1;
  }
  const date = localDate(now);
  const numbers = {
    tests, coverage, score,
    threshold: coverageThreshold(read(join(root, "package.json"))),
    android: run.android(root),
    commits: run.commits(root),
    days: daysBetween(KICKOFF_DAY, date),
    ci: run.ci(root),
  };
  const readme = read(path);
  const block = renderBlock(numbers, blockOf(readme), { date });
  const { text, missing } = updateBadges(replaceBlock(readme, block.text), badgeUrls(numbers));
  writeFileSync(path, text);
  const ci = numbers.ci ? `CI ${numbers.ci.failed} failed of the last ${numbers.ci.total}` : "CI runs not measured (gh did not answer)";
  out.write(`readme-numbers: ${README} as of ${date}: ${tests.pass} tests passing, ${coverage.toFixed(2)}% line coverage, seed cases ${score.pass}/${score.total}, `
    + `${numbers.android ?? "no"} Android tests, ${numbers.commits ?? "no count of"} commits, ${ci}\n`);
  if (block.kept.length) out.write(`readme-numbers: not measured this time, kept with their old date: ${block.kept.join(", ")}\n`);
  if (missing.length) out.write(`readme-numbers: no ${missing.join(", ")} badge in ${README} (shields.io URLs), nothing to update there\n`);
  out.write(`Next: git diff ${README}, then commit it\n`);
  return 0;
}

function check(root, out, err) {
  const result = checkReadme(read(join(root, README)), read(join(root, LCOV)));
  (result.ok ? out : err).write(`${result.message}\n`);
  return result.ok ? 0 : 1;
}

// ---------------------------------------------------------------- cli

const USAGE = "usage: node scripts/readme-numbers.mjs --write | --check [--root <dir>]\n";
export const REPO_ROOT = resolve(fileURLToPath(new URL("../", import.meta.url)));

export function main(argv = process.argv.slice(2), out = process.stdout, err = process.stderr, { run = runners, now = new Date() } = {}) {
  let root = REPO_ROOT;
  let mode = null;
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--write" || a === "--check") mode = a.slice(2);
    else if (a === "--root" && argv[i + 1]) root = resolve(argv[++i]);
    else if (a.startsWith("--root=")) root = resolve(a.slice("--root=".length));
    else if (a === "--help" || a === "-h") { out.write(USAGE); return 0; }
    else { err.write(`readme-numbers: unknown argument ${a}\n${USAGE}`); return 2; }
  }
  if (!mode) { err.write(USAGE); return 2; }
  return mode === "check" ? check(root, out, err) : write(root, out, err, run, now);
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) process.exitCode = main();
