#!/usr/bin/env node
// Docs consistency checker: keeps the product docs in _product/ in step with
// the code and with each other. CI and `make check` run it; exit 1 on any error.
//
//   node scripts/docs-check.mjs                 this checkout
//   node scripts/docs-check.mjs --warn-only     everything becomes a warning, exit 0
//   node scripts/docs-check.mjs --json          findings as JSON
//   node scripts/docs-check.mjs --root <dir>    another checkout (the tests use this)
//   node scripts/docs-check.mjs --no-git        skip the git calls (checks 6, 8 and 9)
//
// Output: "docs-check: N errors, M warnings", then one line per finding,
// "<file>[:<line>]: <severity>: <problem>", sorted by file.
//
// Checks:
//   1 spec-links    every _product/specs/*.md is linked from a spec.md table (Features or Ideas);
//                   every link in those tables points to an existing file
//   2 status        statuses are Idea, Planned, Partial, Built or Dropped (first word of the cell);
//                   a specs/ file's "Status:" matches its spec.md row (warning when it differs)
//   3 keywords      _product/docs/*.md and _product/research/*.md open with "Keywords:"
//   4 index         every file in research/, competitors/, marketing/ is listed in _product/<name>.md;
//                   a missing index is one error naming the file to create
//   5 links         relative links and backticked paths in CLAUDE.md and _product/README.md exist
//   6 last-updated  spec.md has "Last updated: YYYY-MM-DD"; warning when older than the newest
//                   commit touching _product/specs/ (git optional: no git, no warning)
//   7 stale         old advice (warnings): scripts/set-env.mjs as the way to set keys,
//                   .env.example, docs/PRD.md as the source of truth
//   8 architecture  README.md links docs/ARCHITECTURE.md, which has "Last updated: YYYY-MM-DD" and
//                   names every file under lib/ and src/: by its own name (lessons.js or lessons) or,
//                   inside a module folder such as lib/llm/, by the folder's name; files directly in
//                   one of ARCH_UNIT_DIRS need their own. Migrations and test helpers are skipped;
//                   <!-- docs-check: ignore <name> --> in the doc opts a file or a folder out.
//                   Warning when Last updated is older than the newest commit touching lib/ or src/
//                   (git optional, as in 6)
//   9 markers       no git-tracked text file has a line starting with "<<<<<<< " or ">>>>>>> ", the
//                   merge-conflict markers a careless rebase commits ("=======" alone is a Markdown
//                   underline, so it is not flagged); binary files and node_modules are skipped
//                   (needs git: no git, no check)
//
// Plain Node (fs, path, three optional git calls), under a second. Checks 1-8
// read only markdown files, plus the names (never the contents) of the files
// under lib/ and src/; check 9 reads the files git tracks, which never include
// .env or config/master.key (.gitignore; make check fails if master.key is tracked).

import { execFileSync } from "node:child_process";
import { existsSync, lstatSync, readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

export const STATUSES = ["Idea", "Planned", "Partial", "Built", "Dropped"];
export const SPEC = "_product/spec.md";
export const SPECS_DIR = "_product/specs";
export const KEYWORD_DIRS = ["_product/docs", "_product/research"];
export const INDEXED_DIRS = ["research", "competitors", "marketing"]; // _product/<name>/ listed in _product/<name>.md
export const LINK_FILES = ["CLAUDE.md", "_product/README.md"];
export const PATH_PREFIXES = ["_product/", "docs/", "scripts/", ".infra/"];
export const STALE_RULES = [
  {
    id: "set-env",
    test: (line) => /set-env\.mjs/.test(line) && !/deprecated|shim|still works|forwards/i.test(line),
    message: "stale: scripts/set-env.mjs is a deprecated shim; keys live in config/credentials.enc (see _product/docs/secrets.md)",
  },
  {
    id: "env-example",
    test: (line) => /\.env\.example/.test(line) && !/credentials\.example/.test(line),
    message: "stale: .env.example was renamed to config/credentials.example",
  },
  {
    id: "prd-source-of-truth",
    test: (line) => /\bPRD(\.md)?\b/.test(line) && /source of truth/i.test(line),
    message: "stale: docs/PRD.md named as the source of truth; _product/spec.md is",
  },
];

// Check 8: the architecture doc, the code it must name, and the folders whose
// files are separate units that each need their own name. Any other folder
// below lib/ or src/ is a module the doc may name as a whole ("lib/llm/").
export const ARCH = "docs/ARCHITECTURE.md";
export const CODE_DIRS = ["lib", "src"];
export const ARCH_UNIT_DIRS = ["lib", "src", "src/routes", "src/jobs", "src/db", "src/channels"];
const SKIPPED_DIRS = ["node_modules", "migrations", "fixtures", "__tests__", "__mocks__"];
const TEST_HELPER = /^test[A-Z0-9_.-]|\.(test|spec)\.[cm]?[jt]sx?$/;

// Check 9: the outer markers of a merge conflict at the start of a line. The
// middle one, "=======", is also a Markdown heading underline, so it is left out.
export const CONFLICT_MARKER = /^(?:<{7}|>{7})(?: |$)/;
// As git does: a NUL byte in the first 8000 bytes makes a file binary.
const BINARY_PROBE = 8000;

// ---------------------------------------------------------------- markdown

// "[text](url)" → "text"; bold, code marks and tags removed; whitespace collapsed.
export function cleanCell(cell) {
  return String(cell ?? "")
    .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/<[^>]*>/g, "")
    .replace(/\*\*|__|[*`]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

const splitRow = (line) => line.replace(/^\|/, "").replace(/\|$/, "").replace(/\\\|/g, "\u0000")
  .split("|").map((c) => c.replace(/\u0000/g, "|"));

// Every markdown table in the text, with 1-based line numbers: header cells
// (cleaned, lower-cased) and rows ({ line, raw, cells }). A table is a run of
// lines starting with "|"; the "|---|" separator is skipped.
export function parseTables(text) {
  const tables = [];
  let table = null;
  const lines = String(text ?? "").split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line.startsWith("|")) { table = null; continue; }
    const raw = splitRow(line);
    if (!table) { table = { line: i + 1, header: raw.map((c) => cleanCell(c).toLowerCase()), rows: [] }; tables.push(table); continue; }
    if (raw.every((c) => /^\s*:?-+:?\s*$/.test(c))) continue;
    table.rows.push({ line: i + 1, raw, cells: raw.map(cleanCell) });
  }
  return tables;
}

// Targets of "[text](target)" and "![alt](target)" in a line, titles dropped.
export function linksIn(line) {
  return [...String(line ?? "").matchAll(/!?\[[^\]]*\]\(([^)\s]+)(?:\s+"[^"]*")?\)/g)].map((m) => m[1]);
}

// A link that should resolve on disk: not a URL, a mailto, an anchor or a placeholder.
export function isLocalLink(target) {
  return !/^(?:[a-z][a-z0-9+.-]*:|#|<|\/\/)/i.test(target) && !/[<>*{}]/.test(target);
}

// Backticked strings that look like repo paths: `_product/...`, `docs/...`,
// `scripts/...`, `.infra/...`; a placeholder (`specs/<feature>.md`) or a
// command (`node scripts/x.mjs`) is not one.
export function backtickedPathsIn(line) {
  const out = [];
  for (const m of String(line ?? "").matchAll(/`([^`]+)`/g)) {
    const t = m[1].trim();
    if (PATH_PREFIXES.some((p) => t.startsWith(p)) && !/[\s<>*{}]/.test(t)) out.push(t);
  }
  return out;
}

// Does a relative target exist, resolved from the file's folder first, then
// from the repo root ("_product/spec.md" written inside _product/README.md)?
export function resolves(root, file, target) {
  const clean = target.replace(/[#?].*$/, "");
  if (!clean) return true;
  let path = clean;
  try { path = decodeURIComponent(clean); } catch { /* keep as written */ }
  return [resolve(root, dirname(file), path), resolve(root, path)].some((p) => existsSync(p));
}

const firstWord = (text) => (String(text ?? "").match(/^[A-Za-z]+/) || [""])[0];

// The "Last updated:" line of a doc: its 1-based number (null when absent) and
// its YYYY-MM-DD date (null when the line has none).
export function lastUpdated(text) {
  const lines = String(text ?? "").split(/\r?\n/);
  const at = lines.findIndex((l) => /last updated:/i.test(l));
  if (at < 0) return { line: null, date: null };
  const m = lines[at].match(/last updated:\**\s*(\d{4}-\d{2}-\d{2})/i);
  return { line: at + 1, date: m ? m[1] : null };
}

// Is `name` written in `text` as a whole name ("lessons" in "lib/lessons.js",
// not in "lessonsLearned")? Letters, digits and "_" continue a name.
export function mentionsName(text, name) {
  const escaped = String(name).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`(?<![A-Za-z0-9_])${escaped}(?![A-Za-z0-9_])`).test(String(text ?? ""));
}

// Names opted out of check 8 by <!-- docs-check: ignore <name> [<name> ...] -->:
// a file (lessons.js, lessons, lib/lessons.js) or a folder (promptGuard, lib/promptGuard/).
export function ignoredNames(text) {
  const names = new Set();
  for (const m of String(text ?? "").matchAll(/<!--\s*docs-check:\s*ignore\b([\s\S]*?)-->/gi)) {
    // A placeholder such as <name> (the doc explaining the opt-out) names nothing.
    for (const name of m[1].split(/[\s,]+/)) if (name && !/[<>]/.test(name)) names.add(name.replace(/\/+$/, ""));
  }
  return names;
}

// ---------------------------------------------------------------- files

const read = (path) => {
  try { return readFileSync(path, "utf8").replace(/^\uFEFF/, ""); } catch { return null; }
};

const isDir = (path) => { try { return statSync(path).isDirectory(); } catch { return false; } };

// Markdown files directly inside a folder, sorted basenames; [] when absent.
export function listMd(dir) {
  if (!isDir(dir)) return [];
  return readdirSync(dir).filter((f) => f.endsWith(".md") && !isDir(join(dir, f))).sort();
}

// Markdown files under a folder, recursively, as paths relative to root.
export function walkMd(root, dir) {
  const abs = join(root, dir);
  if (!isDir(abs)) return [];
  const out = [];
  for (const entry of readdirSync(abs, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
    const rel = `${dir}/${entry.name}`;
    if (entry.isDirectory()) out.push(...walkMd(root, rel));
    else if (entry.name.endsWith(".md")) out.push(rel);
  }
  return out;
}

// Date (YYYY-MM-DD) of the newest commit touching any of `paths`, or null when
// git is missing, the folder is not a repository, or nothing is committed there.
export function newestCommit(root, paths) {
  const out = gitOutput(root, ["log", "-1", "--format=%cs", "--", ...paths])?.trim();
  return out && /^\d{4}-\d{2}-\d{2}$/.test(out) ? out : null;
}

// Paths git tracks under root, sorted and unique (a conflicted file is listed
// once per stage), or null when git is missing or root is not a repository.
export function trackedFiles(root) {
  const out = gitOutput(root, ["ls-files", "-z"]);
  return out === null ? null : [...new Set(out.split("\0").filter(Boolean))].sort();
}

// Runs git in root without the caller's GIT_DIR, GIT_WORK_TREE or
// GIT_INDEX_FILE (a hook or a test runner may set them); stdout, or null on
// any failure.
function gitOutput(root, args) {
  const env = { ...process.env };
  for (const key of ["GIT_DIR", "GIT_WORK_TREE", "GIT_INDEX_FILE"]) delete env[key];
  try {
    return execFileSync("git", args,
      { cwd: root, env, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"], timeout: 3000, maxBuffer: 16 * 1024 * 1024 });
  } catch {
    return null;
  }
}

export const newestSpecsCommit = (root) => newestCommit(root, [SPECS_DIR]);

// Check 8: the files under lib/ and src/ that the architecture doc must name,
// as sorted paths relative to root. Dot files, node_modules, migrations,
// fixtures and test helpers (testDatabase.js, *.test.js) are left out.
export function codeFiles(root, dirs = CODE_DIRS) {
  const out = [];
  const walk = (dir) => {
    const abs = join(root, dir);
    if (!isDir(abs)) return;
    for (const entry of readdirSync(abs, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
      if (entry.name.startsWith(".")) continue;
      const rel = `${dir}/${entry.name}`;
      if (entry.isDirectory()) { if (!SKIPPED_DIRS.includes(entry.name)) walk(rel); } else if (entry.isFile() && !TEST_HELPER.test(entry.name)) out.push(rel);
    }
  };
  for (const dir of dirs) walk(dir);
  return out;
}

// ---------------------------------------------------------------- checks

class Report {
  constructor() { this.findings = []; }
  add(severity, check, file, line, message) { this.findings.push({ severity, check, file, line, message }); }
  error(check, file, line, message) { this.add("error", check, file, line, message); }
  warn(check, file, line, message) { this.add("warning", check, file, line, message); }
}

const expected = `expected ${STATUSES.slice(0, -1).join(", ")} or ${STATUSES.at(-1)}`;

// Checks 1 (table side), 2 (table statuses) and 6. Fills `linked`:
// "_product/specs/x.md" → [{ line, name, status }] for every table row linking to it.
function checkSpecIndex(root, text, r, linked, git) {
  const tables = parseTables(text);
  let features = 0;
  for (const t of tables) {
    const isFeatures = t.header.includes("feature") && t.header.includes("status");
    const isIdeas = t.header.includes("idea");
    if (!isFeatures && !isIdeas) continue;
    if (isFeatures) features++;
    const statusCol = t.header.indexOf("status");
    for (const row of t.rows) {
      const name = row.cells[0] || `row ${row.line}`;
      let status = "Idea"; // the Ideas table has no Status column
      if (statusCol >= 0) {
        status = firstWord(row.cells[statusCol]);
        if (!status) r.error("status", SPEC, row.line, `missing status for "${name}" (${expected})`);
        else if (!STATUSES.includes(status)) r.error("status", SPEC, row.line, `invalid status "${status}" for "${name}" (${expected})`);
        if (!STATUSES.includes(status)) status = null; // reported once; no mismatch warning on top
      }
      for (const target of row.raw.flatMap(linksIn).filter(isLocalLink)) {
        const clean = target.replace(/[#?].*$/, "");
        if (!clean) continue;
        const abs = resolve(root, dirname(SPEC), clean);
        if (!existsSync(abs)) { r.error("spec-links", SPEC, row.line, `link ${target}: file not found`); continue; }
        const key = relative(root, abs).split("\\").join("/");
        if (!linked.has(key)) linked.set(key, []);
        linked.get(key).push({ line: row.line, name, status });
      }
    }
  }
  if (!features) r.error("spec-links", SPEC, null, 'no Features table (header "| Feature | Status | One-line spec | Details |")');

  const stamp = lastUpdated(text);
  if (stamp.line === null) { r.error("last-updated", SPEC, null, 'no "Last updated: YYYY-MM-DD" line'); return; }
  if (!stamp.date) { r.error("last-updated", SPEC, stamp.line, '"Last updated:" needs a YYYY-MM-DD date'); return; }
  if (!git) return;
  const newest = newestSpecsCommit(root);
  if (newest && newest > stamp.date) {
    r.warn("last-updated", SPEC, stamp.line, `Last updated ${stamp.date} is older than the newest commit touching ${SPECS_DIR}/ (${newest}); refresh the index`);
  }
}

// Checks 1 (orphans) and 2 (specs/ file statuses, mismatch with spec.md).
function checkSpecFiles(root, r, linked, haveIndex) {
  for (const name of listMd(join(root, SPECS_DIR))) {
    const file = `${SPECS_DIR}/${name}`;
    const lines = (read(join(root, file)) ?? "").split(/\r?\n/);
    if (!/^# \S/.test(lines[0] ?? "")) r.error("status", file, 1, 'first line must be a "# <Feature>" title');
    const at = lines.findIndex((l) => /^\*{0,2}Status\*{0,2}:/.test(l));
    let status = null;
    if (at < 0) {
      r.error("status", file, null, `no "Status:" line (${expected})`);
    } else {
      status = firstWord(lines[at].replace(/^\*{0,2}Status\*{0,2}:\s*\**/, ""));
      if (!STATUSES.includes(status)) {
        r.error("status", file, at + 1, status ? `invalid status "${status}" (${expected})` : `missing status (${expected})`);
        status = null;
      }
    }
    const rows = linked.get(file);
    const known = (rows ?? []).filter((row) => row.status); // rows whose own status was valid
    if (!rows) {
      if (haveIndex) r.error("spec-links", file, null, `not linked from ${SPEC} (Features or Ideas table)`);
    } else if (status && known.length && !known.some((row) => row.status === status)) {
      const where = known.map((row) => `"${row.name}" is ${row.status} (line ${row.line})`).join(", ");
      r.warn("status", file, at + 1, `Status "${status}" differs from ${SPEC}: ${where}`);
    }
  }
}

// Check 3.
function checkKeywords(root, r) {
  for (const dir of KEYWORD_DIRS) {
    for (const name of listMd(join(root, dir))) {
      const file = `${dir}/${name}`;
      const first = (read(join(root, file)) ?? "").split(/\r?\n/)[0];
      if (!/^Keywords:/.test(first)) r.error("keywords", file, 1, 'first line must start with "Keywords:"');
    }
  }
}

// Check 4.
function checkIndexes(root, r) {
  for (const name of INDEXED_DIRS) {
    const files = listMd(join(root, "_product", name));
    if (!files.length) continue;
    const index = `_product/${name}.md`;
    const text = read(join(root, index));
    if (text === null) {
      r.error("index", index, null, `missing: create it and list the ${files.length} file(s) in _product/${name}/ (${files.join(", ")})`);
      continue;
    }
    for (const f of files) if (!text.includes(f)) r.error("index", `_product/${name}/${f}`, null, `not listed in ${index}`);
  }
}

// Check 5.
function checkLinks(root, r) {
  for (const file of LINK_FILES) {
    const text = read(join(root, file));
    if (text === null) continue;
    let fenced = false;
    text.split(/\r?\n/).forEach((line, i) => {
      if (/^\s*(```|~~~)/.test(line)) { fenced = !fenced; return; }
      if (fenced) return;
      for (const target of linksIn(line).filter(isLocalLink)) {
        if (!resolves(root, file, target)) r.error("links", file, i + 1, `link ${target}: file not found`);
      }
      for (const path of backtickedPathsIn(line)) {
        if (!resolves(root, file, path)) r.error("links", file, i + 1, `path ${path}: file not found`);
      }
    });
  }
}

// Check 7.
function checkStale(root, r) {
  const files = ["CLAUDE.md", "README.md", ...listMd(join(root, "docs")).map((f) => `docs/${f}`), ...walkMd(root, "_product")];
  for (const file of files) {
    const text = read(join(root, file));
    if (text === null) continue;
    text.split(/\r?\n/).forEach((line, i) => {
      for (const rule of STALE_RULES) if (rule.test(line)) r.warn("stale", file, i + 1, rule.message);
    });
  }
}

// What may stand for a file in check 8: its own names (path, basename, stem)
// and, while it sits in a module folder (not one of ARCH_UNIT_DIRS), that
// folder's path and name. An opt-out may also name any folder above it.
function archNames(file) {
  const parts = file.split("/");
  const base = parts.at(-1);
  const own = [file, base, base.replace(/\.[^.]+$/, "")];
  const modules = [];
  const above = [];
  for (let i = parts.length - 1, inModule = true; i >= 1; i--) {
    const dir = parts.slice(0, i).join("/");
    if (ARCH_UNIT_DIRS.includes(dir)) inModule = false;
    (inModule ? modules : above).push(dir, parts[i - 1]);
  }
  return { own, modules, folders: [...modules, ...above] };
}

// Check 8.
function checkArchitecture(root, r, git) {
  let fenced = false;
  const linked = (read(join(root, "README.md")) ?? "").split(/\r?\n/).some((line) => {
    if (/^\s*(```|~~~)/.test(line)) { fenced = !fenced; return false; }
    return !fenced && linksIn(line).filter(isLocalLink).some((target) => {
      let path = target.replace(/[#?].*$/, "");
      try { path = decodeURIComponent(path); } catch { /* keep as written */ }
      return Boolean(path) && relative(root, resolve(root, path)).split("\\").join("/") === ARCH;
    });
  });
  if (!linked) r.error("architecture", "README.md", null, `no link to ${ARCH} (add "Architecture and the reasons behind it: [${ARCH}](${ARCH})")`);

  const text = read(join(root, ARCH));
  if (text === null) { r.error("architecture", ARCH, null, "missing: the technical architecture doc (pipeline, components, data model, decisions and why)"); return; }
  const stamp = lastUpdated(text);
  if (stamp.line === null) r.error("architecture", ARCH, null, 'no "Last updated: YYYY-MM-DD" line');
  else if (!stamp.date) r.error("architecture", ARCH, stamp.line, '"Last updated:" needs a YYYY-MM-DD date');

  // A name inside an HTML comment does not document anything; opt-outs are explicit.
  const visible = text.replace(/<!--[\s\S]*?-->/g, " ");
  const ignored = ignoredNames(text);
  for (const file of codeFiles(root)) {
    const { own, modules, folders } = archNames(file);
    if ([...own, ...folders].some((name) => ignored.has(name))) continue;
    if ([...own, ...modules].some((name) => mentionsName(visible, name))) continue;
    r.error("architecture", file, null, modules.length
      ? `not named in ${ARCH}, nor is its folder ${modules.at(-2)}/: say what it does under Components, or opt out with <!-- docs-check: ignore ${modules.at(-1)} -->`
      : `not named in ${ARCH}: say what ${own[1]} does under Components, or opt out with <!-- docs-check: ignore ${own[1]} -->`);
  }

  if (!git || !stamp.date) return;
  const newest = newestCommit(root, CODE_DIRS);
  if (newest && newest > stamp.date) {
    r.warn("architecture", ARCH, stamp.line, `Last updated ${stamp.date} is older than the newest commit touching lib/ or src/ (${newest}); check the doc against the code, then move the date`);
  }
}

// Check 9.
function checkConflictMarkers(root, r, git) {
  for (const file of (git && trackedFiles(root)) || []) {
    if (file.split("/").includes("node_modules")) continue;
    const abs = join(root, file);
    let buf;
    try {
      if (!lstatSync(abs).isFile()) continue; // a symlink, a submodule, or deleted since the last add
      buf = readFileSync(abs);
    } catch { continue; }
    if (buf.subarray(0, BINARY_PROBE).includes(0)) continue;
    buf.toString("utf8").split(/\r?\n/).forEach((line, i) => {
      if (CONFLICT_MARKER.test(line)) {
        r.error("markers", file, i + 1, `merge-conflict marker ${line.slice(0, 7)} left by a merge or rebase: resolve the conflict, then delete the marker lines`);
      }
    });
  }
}

const byFile = (a, b) => a.file.localeCompare(b.file) || (a.line ?? 0) - (b.line ?? 0)
  || a.severity.localeCompare(b.severity) || a.message.localeCompare(b.message);

// Runs every check against a checkout. { git: false } skips the git call.
export function runDocsCheck(root, { git = true } = {}) {
  root = resolve(root);
  const r = new Report();
  const linked = new Map();
  const spec = read(join(root, SPEC));
  if (spec === null) r.error("spec-links", SPEC, null, "missing: the product spec index (Features table, Ideas table, Dropped list)");
  else checkSpecIndex(root, spec, r, linked, git);
  checkSpecFiles(root, r, linked, spec !== null);
  checkKeywords(root, r);
  checkIndexes(root, r);
  checkLinks(root, r);
  checkStale(root, r);
  checkArchitecture(root, r, git);
  checkConflictMarkers(root, r, git);
  const findings = r.findings.sort(byFile);
  return {
    root,
    errors: findings.filter((f) => f.severity === "error").length,
    warnings: findings.filter((f) => f.severity === "warning").length,
    findings,
  };
}

export function formatReport({ errors, warnings, findings }) {
  const lines = [`docs-check: ${errors} errors, ${warnings} warnings`];
  for (const f of findings) lines.push(`${f.file}${f.line ? `:${f.line}` : ""}: ${f.severity}: ${f.message}`);
  return `${lines.join("\n")}\n`;
}

// ---------------------------------------------------------------- cli

const USAGE = "usage: node scripts/docs-check.mjs [--root <dir>] [--warn-only] [--json] [--no-git]\n";
export const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");

export function main(argv = process.argv.slice(2), out = process.stdout, err = process.stderr) {
  const opts = { root: REPO_ROOT, warnOnly: false, json: false, git: true };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--warn-only") opts.warnOnly = true;
    else if (a === "--json") opts.json = true;
    else if (a === "--no-git") opts.git = false;
    else if (a === "--root" && argv[i + 1]) opts.root = argv[++i];
    else if (a.startsWith("--root=")) opts.root = a.slice("--root=".length);
    else if (a === "--help" || a === "-h") { out.write(USAGE); return 0; }
    else { err.write(`docs-check: unknown argument ${a}\n${USAGE}`); return 2; }
  }
  const result = runDocsCheck(opts.root, { git: opts.git });
  if (opts.warnOnly) {
    result.findings = result.findings.map((f) => ({ ...f, severity: "warning" }));
    result.warnings = result.findings.length;
    result.errors = 0;
  }
  out.write(opts.json ? `${JSON.stringify(result, null, 2)}\n` : formatReport(result));
  return result.errors ? 1 : 0;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) process.exitCode = main();
