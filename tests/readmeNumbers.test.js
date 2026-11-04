// scripts/readme-numbers.mjs: the README's numbers are measured, not typed.
// Fixtures stand in for the suite's output, lcov.info, scripts/score.mjs and
// gh; the real suite never runs here, nor git, gh or the network.
import { test } from "node:test";
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import {
  androidTests, badgeCoverage, badgeUrl, blockOf, checkReadme, countAnnotatedTests, coverageThreshold, daysBetween, END, lcovLineCoverage,
  main, parseCoverageTable, parseScore, parseTestSummary, readmeCoverage, renderBlock, replaceBlock, START, summarizeRuns, updateBadges,
} from "../scripts/readme-numbers.mjs";

const script = new URL("../scripts/readme-numbers.mjs", import.meta.url).pathname;

// The tail of `npm run check` (node --test, spec reporter, coverage table).
const SUITE = `✔ HTTP: deleting the account erases every row (31.2ms)
ℹ tests 411
ℹ suites 0
ℹ pass 411
ℹ fail 0
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
ℹ duration_ms 27189.629833
ℹ start of coverage report
ℹ ----------------------------------------------------------------------
ℹ file                   | line % | branch % | funcs % | uncovered lines
ℹ ----------------------------------------------------------------------
ℹ lib/brands.js          |  98.10 |    90.00 |  100.00 | 12-14
ℹ ----------------------------------------------------------------------
ℹ all files              |  94.85 |    84.43 |   88.36 |
ℹ ----------------------------------------------------------------------
ℹ end of coverage report
`;

// Two files: 7722 of 8141 lines, the 94.85% of the run above.
const LCOV = `TN:
SF:lib/brands.js
FN:116,platformFor
DA:1,1
LF:141
LH:122
end_of_record
TN:
SF:src/server.js
LF:8000
LH:7600
end_of_record
`;

const SCORE = `Scam Shield regression (PRD pass criteria: A 100%, C no false Scam)
PASS A1   set A expected=scam got=scam conf=0.9
Set A: 9/9
Set C: 11/11
False Scam on legit (C): 0 (target 0 in this seed set)
Overall: 37/37
`;

const PACKAGE = JSON.stringify({ scripts: { check: "node scripts/doctor.mjs testdb && node --test --experimental-test-coverage --test-coverage-lines=93 \"tests/**/*.test.js\"" } });

const BADGES = "[![CI](https://github.com/o/r/actions/workflows/ci.yml/badge.svg)](https://github.com/o/r/actions/workflows/ci.yml) "
  + "![coverage](https://img.shields.io/badge/coverage-90.0%25-brightgreen) ![tests](https://img.shields.io/badge/tests-400%20passing-brightgreen) "
  + "![seed cases](https://img.shields.io/badge/seed%20cases-36%2F36-brightgreen) ![license](https://img.shields.io/badge/license-MIT-blue)";

const OLD_BLOCK = `
| What | Measured |
|---|---|
| Tests (\`make check\`, the Postgres suites included) | **400 passing**, 0 failing |
| Line coverage of \`lib/\` and \`src/\` | **94.80%**; \`make check\` and CI fail below 93% |
| CI runs (\`ci.yml\` on GitHub Actions) | **0 failed** of the last 100 (60 passed, 40 cancelled by a newer push) |
| Median time to a verdict with Muse Spark (prompt v4, 500 public emails, Oct 31) | **5.8 s** per email |

As of 2026-11-03, measured by \`make readme-numbers\`.
`;

const README = `# Prudence\n\n*Ask twice.*\n${BADGES}\n\n## Built to be trusted\n\n${START}${OLD_BLOCK}${END}\n\nMore text.\n`;

const sink = () => { const s = { text: "", write(t) { s.text += t; return true; } }; return s; };

// A checkout in a temp folder: README.md, package.json, and the files given.
function fixture(files = {}) {
  const root = mkdtempSync(join(tmpdir(), "readme-numbers-"));
  for (const [path, text] of Object.entries({ "README.md": README, "package.json": PACKAGE, ...files })) {
    mkdirSync(dirname(join(root, path)), { recursive: true });
    writeFileSync(join(root, path), text);
  }
  return root;
}

// Fake runners: the suite writes coverage/lcov.info as npm run check does.
const fakeRun = (overrides = {}) => ({
  suite: (root) => { mkdirSync(join(root, "coverage"), { recursive: true }); writeFileSync(join(root, "coverage/lcov.info"), LCOV); return { status: 0, output: SUITE }; },
  score: () => ({ status: 0, output: SCORE }),
  commits: () => 243,
  ci: () => ({ total: 100, failed: 0, passed: 54, cancelled: 46, running: 0 }),
  android: () => 64,
  ...overrides,
});
const NOW = new Date(2026, 10, 4, 1, 30);

test("the test counts are read from node's summary, spec reporter or TAP", () => {
  assert.deepEqual(parseTestSummary(SUITE), { tests: 411, suites: 0, pass: 411, fail: 0, cancelled: 0, skipped: 0, todo: 0 });
  assert.deepEqual(parseTestSummary("# tests 12\n# pass 11\n# fail 1\n"), { tests: 12, pass: 11, fail: 1 });
  assert.equal(parseTestSummary("✔ one test (1ms)\n"), null, "no summary, no numbers");
  assert.equal(parseTestSummary(""), null);
});

test("the line coverage of all files is read from node's coverage table", () => {
  assert.equal(parseCoverageTable(SUITE), 94.85);
  assert.equal(parseCoverageTable("ℹ tests 3\n"), null);
});

test("lcov line coverage is every LH over every LF", () => {
  const c = lcovLineCoverage(LCOV);
  assert.equal(c.found, 8141);
  assert.equal(c.hit, 7722);
  assert.equal(c.percent.toFixed(2), "94.85");
  assert.equal(lcovLineCoverage("TN:\nend_of_record\n").percent, null, "no line totals");
  assert.equal(lcovLineCoverage(null).percent, null);
});

test("the seed cases and the false Scams are read from scripts/score.mjs", () => {
  assert.deepEqual(parseScore(SCORE), { pass: 37, total: 37, falseScam: 0 });
  assert.deepEqual(parseScore("Overall: 35/37\n"), { pass: 35, total: 37, falseScam: null });
  assert.equal(parseScore("--muse needs a model key\n"), null);
});

test("the coverage floor comes from package.json's check script", () => {
  assert.equal(coverageThreshold(PACKAGE), 93);
  assert.equal(coverageThreshold(JSON.stringify({ scripts: { check: "node --test" } })), null);
  assert.equal(coverageThreshold("not json"), null);
});

test("Android tests are the @Test annotations under src/test, build output left out", () => {
  assert.equal(countAnnotatedTests("class A {\n  @Test\n  fun a() {}\n  @Test fun b() {}\n  // @Test in a comment\n}\n"), 2);
  const root = fixture({
    "android/app/src/test/java/a/ATest.kt": "@Test fun a() {}\n@Test fun b() {}\n",
    "android/app/src/test/java/a/BTest.java": "  @Test\n  public void c() {}\n",
    "android/app/src/main/java/a/Main.kt": "@Test fun notATest() {}\n",
    "android/app/build/tmp/src/test/Copy.kt": "@Test fun copied() {}\n",
  });
  try {
    assert.equal(androidTests(root), 3);
    assert.equal(androidTests(join(root, "nowhere")), null, "no android/ folder");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("CI runs: failures, passes, cancellations and runs in flight are counted apart", () => {
  const runs = [
    { status: "completed", conclusion: "success" }, { status: "completed", conclusion: "cancelled" },
    { status: "completed", conclusion: "failure" }, { status: "completed", conclusion: "timed_out" },
    { status: "in_progress", conclusion: "" },
  ];
  assert.deepEqual(summarizeRuns(runs), { total: 5, failed: 2, passed: 1, cancelled: 1, running: 1 });
  assert.deepEqual(summarizeRuns(null), { total: 0, failed: 0, passed: 0, cancelled: 0, running: 0 });
});

test("days since the kickoff are calendar days", () => {
  assert.equal(daysBetween("2026-10-26", "2026-11-04"), 9);
  assert.equal(daysBetween("2026-10-26", "2026-10-26"), 0);
});

test("shields.io badges: spaces, percent and slash encoded, dashes doubled", () => {
  assert.equal(badgeUrl("coverage", "94.9%", "brightgreen"), "https://img.shields.io/badge/coverage-94.9%25-brightgreen");
  assert.equal(badgeUrl("tests", "411 passing", "brightgreen"), "https://img.shields.io/badge/tests-411%20passing-brightgreen");
  assert.equal(badgeUrl("seed cases", "37/37", "brightgreen"), "https://img.shields.io/badge/seed%20cases-37%2F37-brightgreen");
  assert.equal(badgeUrl("pre-release", "v1_0", "blue"), "https://img.shields.io/badge/pre--release-v1__0-blue");
});

test("the three measured badges are rewritten; the others stay", () => {
  const urls = { coverage: "https://img.shields.io/badge/coverage-94.9%25-brightgreen", tests: "https://img.shields.io/badge/tests-411%20passing-brightgreen",
    seed: "https://img.shields.io/badge/seed%20cases-37%2F37-brightgreen" };
  const { text, missing } = updateBadges(README, urls);
  assert.deepEqual(missing, []);
  for (const url of Object.values(urls)) assert.ok(text.includes(url), url);
  assert.ok(text.includes("https://img.shields.io/badge/license-MIT-blue"));
  assert.ok(text.includes("actions/workflows/ci.yml/badge.svg"));
  assert.deepEqual(updateBadges("# No badges\n", urls).missing, ["coverage", "tests", "seed"]);
});

test("the block gets the measured rows; a row the script does not own is kept, one it could not measure keeps its date", () => {
  const numbers = { tests: { tests: 411, pass: 411, fail: 0 }, coverage: 94.8532, threshold: 93, score: { pass: 37, total: 37, falseScam: 0 },
    android: 64, commits: 243, days: 9, ci: null };
  const { text, kept } = renderBlock(numbers, OLD_BLOCK, { date: "2026-11-04" });
  assert.match(text, /\| Tests \(`make check`, the Postgres suites included\) \| \*\*411 passing\*\*, 0 failing \|/);
  assert.match(text, /\| Line coverage of `lib\/` and `src\/` \| \*\*94\.85%\*\*; `make check` and CI fail below 93% \|/);
  assert.match(text, /\| \*\*37\/37\*\*, 0 genuine messages called Scam \|/);
  assert.match(text, /\| Android companion unit tests \(JVM, run by CI\) \| \*\*64\*\* \|/);
  assert.match(text, /\| \*\*243\*\* in 9 days \|/);
  assert.match(text, /\| \*\*0 failed\*\* of the last 100 \(60 passed, 40 cancelled by a newer push\) \(as of 2026-11-03\) \|/, "gh did not answer: the old row, dated");
  assert.match(text, /\| Median time to a verdict with Muse Spark \(prompt v4, 500 public emails, Oct 31\) \| \*\*5\.8 s\*\* per email \|/);
  assert.match(text, /As of 2026-11-04, measured by `make readme-numbers`/);
  assert.deepEqual(kept, ["ci"]);
  assert.equal((text.match(/^\| Tests/gm) || []).length, 1, "no duplicate rows");
  assert.ok(text.indexOf("CI runs") < text.indexOf("Median time"), "the rows the script owns come first");
  // Measured again with gh: the CI row is fresh, without the old date.
  const again = renderBlock({ ...numbers, ci: { total: 100, failed: 0, passed: 54, cancelled: 46, running: 1 } }, text, { date: "2026-11-05" });
  assert.match(again.text, /\| \*\*0 failed\*\* of the last 100 \(54 passed, 46 cancelled by a newer push, 1 running\) \|/);
  assert.deepEqual(again.kept, []);
});

test("the block is found and replaced between the markers only", () => {
  assert.equal(blockOf(README), OLD_BLOCK);
  assert.equal(blockOf("# no markers\n"), null);
  assert.equal(blockOf(`${END}\n${START}\n`), null, "markers in the wrong order");
  const replaced = replaceBlock(README, "\nNEW\n");
  assert.ok(replaced.startsWith("# Prudence"));
  assert.ok(replaced.includes(`${START}\nNEW\n${END}`));
  assert.ok(replaced.endsWith("More text.\n"));
  assert.throws(() => replaceBlock("# no markers\n", "x"), /no numbers block/);
});

test("the coverage the README states is read from the table row and the badge", () => {
  assert.equal(readmeCoverage(README), 94.8);
  assert.equal(badgeCoverage(README), 90);
  assert.equal(readmeCoverage(`${START}\n| What | Measured |\n|---|---|\n| Tests | 3 |\n${END}`), null, "no coverage row");
});

test("check: within one point passes, more fails and names make readme-numbers", () => {
  const synced = updateBadges(README, { coverage: badgeUrl("coverage", "94.9%", "brightgreen"), tests: "t", seed: "s" }).text;
  const ok = checkReadme(synced, LCOV);
  assert.equal(ok.ok, true, ok.message);
  assert.match(ok.message, /94\.8% line coverage, this run measured 94\.85%/);
  const close = checkReadme(synced, "LF:100\nLH:94\n");
  assert.equal(close.ok, true, `0.8 and 0.9 points apart pass: ${close.message}`);
  const tableOnly = README.replace(/!\[coverage\]\([^)]*\) /, "");
  assert.equal(badgeCoverage(tableOnly), null);
  assert.equal(checkReadme(tableOnly, "LF:1000\nLH:938\n").ok, true, "exactly one point apart passes");
  assert.equal(checkReadme(tableOnly, "LF:1000\nLH:937\n").ok, false, "1.1 points apart fails");
  const drifted = checkReadme(synced, "LF:100\nLH:92\n");
  assert.equal(drifted.ok, false);
  assert.match(drifted.message, /says 94\.8% line coverage, this run measured 92\.00% \(2\.80 points apart, more than 1\.0\): run make readme-numbers/);
  const badge = checkReadme(README, LCOV);
  assert.equal(badge.ok, false, "the badge's 90.0% is 4.85 points off");
  assert.match(badge.message, /the coverage badge/);
});

test("check: a missing block, coverage row or lcov file fails with the fix", () => {
  assert.match(checkReadme("# Prudence\n", LCOV).message, /no numbers block: put <!-- numbers:start --> and <!-- numbers:end -->/);
  assert.match(checkReadme(`${START}\n| What | Measured |\n|---|---|\n| Tests | 3 |\n${END}`, LCOV).message, /no "Line coverage" row: run make readme-numbers/);
  assert.match(checkReadme(README, null).message, /coverage\/lcov\.info not found: run make check/);
  assert.match(checkReadme(README, "TN:\n").message, /no line totals/);
});

test("write: the block and the badges are rewritten from the runs, and check then passes", () => {
  const root = fixture();
  try {
    const out = sink();
    const err = sink();
    assert.equal(main(["--write", "--root", root], out, err, { run: fakeRun(), now: NOW }), 0, err.text);
    const readme = readFileSync(join(root, "README.md"), "utf8");
    assert.match(readme, /\*\*411 passing\*\*, 0 failing/);
    assert.match(readme, /\*\*94\.85%\*\*; `make check` and CI fail below 93%/);
    assert.match(readme, /\*\*37\/37\*\*, 0 genuine messages called Scam/);
    assert.match(readme, /\*\*243\*\* in 9 days/);
    assert.match(readme, /\*\*0 failed\*\* of the last 100 \(54 passed, 46 cancelled by a newer push\)/);
    assert.match(readme, /\*\*5\.8 s\*\* per email/, "the latency row is kept");
    assert.match(readme, /As of 2026-11-04/);
    assert.ok(readme.includes("https://img.shields.io/badge/coverage-94.9%25-brightgreen"));
    assert.ok(readme.includes("https://img.shields.io/badge/tests-411%20passing-brightgreen"));
    assert.ok(readme.includes("https://img.shields.io/badge/seed%20cases-37%2F37-brightgreen"));
    assert.ok(readme.endsWith("More text.\n"), "nothing outside the block moves");
    assert.match(out.text, /411 tests passing, 94\.85% line coverage, seed cases 37\/37, 64 Android tests, 243 commits, CI 0 failed of the last 100/);

    assert.equal(main(["--write", "--root", root], sink(), sink(), { run: fakeRun(), now: NOW }), 0);
    assert.equal(readFileSync(join(root, "README.md"), "utf8"), readme, "a second run with the same numbers changes nothing");

    const checked = sink();
    assert.equal(main(["--check", "--root", root], checked, sink()), 0);
    assert.match(checked.text, /within 1\.0 point/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("write: a red suite or a failing seed case leaves the README alone", () => {
  const root = fixture();
  try {
    const red = sink();
    const failing = { status: 1, output: SUITE.replace("ℹ pass 411", "ℹ pass 410").replace("ℹ fail 0", "ℹ fail 1") };
    assert.equal(main(["--write", "--root", root], sink(), red, { run: fakeRun({ suite: () => failing }), now: NOW }), 1);
    assert.match(red.text, /the suite did not pass \(exit 1, 1 failing\); numbers come from a green run only/);
    const score = sink();
    assert.equal(main(["--write", "--root", root], sink(), score, { run: fakeRun({ score: () => ({ status: 1, output: "Overall: 36/37\n" }) }), now: NOW }), 1);
    assert.match(score.text, /the seed cases do not all pass \(36\/37/);
    assert.equal(readFileSync(join(root, "README.md"), "utf8"), README);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("write: without the markers nothing runs", () => {
  const root = fixture({ "README.md": "# Prudence\n" });
  try {
    let ran = false;
    const err = sink();
    assert.equal(main(["--write", "--root", root], sink(), err, { run: fakeRun({ suite: () => { ran = true; return { status: 0, output: SUITE }; } }), now: NOW }), 1);
    assert.equal(ran, false);
    assert.match(err.text, /no numbers block/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("cli: --check exits 1 on drift and 0 in step; an unknown argument exits 2", async () => {
  const run = (args) => new Promise((resolve) => {
    execFile(process.execPath, [script, ...args], { timeout: 20000 }, (e, stdout, stderr) => resolve({ code: e ? e.code : 0, stdout, stderr }));
  });
  const root = fixture({ "coverage/lcov.info": "LF:100\nLH:80\n" });
  try {
    const drift = await run(["--check", "--root", root]);
    assert.equal(drift.code, 1);
    assert.match(drift.stderr, /run make readme-numbers and commit README\.md/);
    writeFileSync(join(root, "coverage/lcov.info"), "LF:1000\nLH:948\n");
    writeFileSync(join(root, "README.md"), README.replace("coverage-90.0%25", "coverage-94.8%25"));
    const fine = await run(["--check", "--root", root]);
    assert.equal(fine.code, 0, fine.stderr);
    assert.equal((await run(["--bogus"])).code, 2);
    assert.equal((await run([])).code, 2, "a mode is required");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
