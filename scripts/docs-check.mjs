#!/usr/bin/env node
// Docs consistency checker: keeps the product docs in _product/ in step with
// the code and with each other. CI and `make check` run it; exit 1 on any error.
//
//   node scripts/docs-check.mjs                 this checkout
//   node scripts/docs-check.mjs --warn-only     everything becomes a warning, exit 0
//   node scripts/docs-check.mjs --json          findings as JSON
//   node scripts/docs-check.mjs --root <dir>    another checkout (the tests use this)
//   node scripts/docs-check.mjs --no-git        skip the single git call (check 6)
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
//
// Plain Node (fs, path, one optional git call), under a second. It reads only
// markdown files: never .env, never config/master.key.

import { execFileSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
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

// Date (YYYY-MM-DD) of the newest commit touching _product/specs/, or null when
// git is missing, the folder is not a repository, or nothing is committed.
export function newestSpecsCommit(root) {
  const env = { ...process.env };
  for (const key of ["GIT_DIR", "GIT_WORK_TREE", "GIT_INDEX_FILE"]) delete env[key];
  try {
    const out = execFileSync("git", ["log", "-1", "--format=%cs", "--", SPECS_DIR],
      { cwd: root, env, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"], timeout: 3000 }).trim();
    return /^\d{4}-\d{2}-\d{2}$/.test(out) ? out : null;
  } catch {
    return null;
  }
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

  const lines = text.split(/\r?\n/);
  const at = lines.findIndex((l) => /last updated:/i.test(l));
  if (at < 0) { r.error("last-updated", SPEC, null, 'no "Last updated: YYYY-MM-DD" line'); return; }
  const m = lines[at].match(/last updated:\**\s*(\d{4}-\d{2}-\d{2})/i);
  if (!m) { r.error("last-updated", SPEC, at + 1, '"Last updated:" needs a YYYY-MM-DD date'); return; }
  if (!git) return;
  const newest = newestSpecsCommit(root);
  if (newest && newest > m[1]) {
    r.warn("last-updated", SPEC, at + 1, `Last updated ${m[1]} is older than the newest commit touching ${SPECS_DIR}/ (${newest}); refresh the index`);
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
