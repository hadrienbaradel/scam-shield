// Session brief for Claude Code: what happened since this developer's last
// commit, where the product stands and the team log (who is working on what
// right now, what you owe the other person), printed at the start of every session.
// .claude/settings.json runs it on the SessionStart hook (startup, resume);
// its stdout becomes context for Claude, which greets the developer and offers
// what to do next (the footer below).
//
//   node scripts/session-brief.mjs            this checkout
//   node scripts/session-brief.mjs <dir>      another checkout (the tests use this)
//
// Plain Node, no dependencies, under a second, at most 60 lines, always exits 0:
// every failure becomes a one-line note instead of a crash. It prints git
// metadata and names from _product/spec.md, _product/research/feasibility.md
// and _product/log.md only; it never reads .env and never prints a secret.

import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { basename, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

export const MAX_LINES = 60;
export const MAX_CHARS = 9000;
export const MAX_COMMITS = 15;
export const MAX_ITEMS = 5;
export const MAX_LOG_LINE = 110; // characters of a team-log item (what, to-do text) before it is shortened
export const SPEC_PATH = "_product/spec.md";
export const FEASIBILITY_PATH = "_product/research/feasibility.md";
export const LOG_PATH = "_product/log.md";
export const STATUSES = ["Built", "Partial", "Planned", "Idea", "Dropped"];
export const DEADLINE = { label: "Nov 4, 2026, 9 PM ET", at: Date.parse("2026-11-04T21:00:00-04:00") };
export const FOOTER = "Greet the developer by name in English, summarize the above in three lines (what is in progress and what you owe the other person first), then offer: 1) what happened since last time, 2) discuss new or undiscussed ideas, 3) brainstorm, 4) implement a Planned or Partial feature, 5) marketing, pitch and the demo video, 6) research (competitors, hackathon, Meta stack), 7) technical feasibility: research or prototype an open question from _product/research/feasibility.md (Gmail, SMS, voice, real-time intervention, app vs web). Follow _product/docs/product-process.md for whatever they pick.";

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

// Every markdown table in the text: header cells (cleaned, lower-cased) and
// rows (cleaned cells). A table is a run of lines starting with "|"; the
// "|---|" separator is skipped; a table without one still has a header.
export function parseTables(text) {
  const tables = [];
  let table = null;
  for (const raw of (typeof text === "string" ? text : "").split(/\r?\n/)) {
    const line = raw.trim();
    if (!line.startsWith("|")) { table = null; continue; }
    const cells = line.replace(/^\|/, "").replace(/\|$/, "").replace(/\\\|/g, "\u0000")
      .split("|").map((c) => c.replace(/\u0000/g, "|"));
    if (!table) { table = { header: cells.map((c) => cleanCell(c).toLowerCase()), rows: [] }; tables.push(table); continue; }
    if (cells.every((c) => /^\s*:?-+:?\s*$/.test(c))) continue;
    table.rows.push(cells.map(cleanCell));
  }
  return tables;
}

const column = (table, test) => table.header.findIndex(test);
const isStatus = (h) => h === "status" || h.startsWith("status");
const isIdea = (h) => h === "idea" || h === "ideas" || h.startsWith("idea ");
const isNumber = (h) => ["#", "no", "no.", "n°", "id", "number"].includes(h);
const firstWord = (cell) => (cleanCell(cell).match(/\p{L}+/u) || [""])[0].toLowerCase();

// "Built (unverified live)" → "Built"; "**Partial**" → "Partial"; anything else → null.
export function statusOf(cell) {
  const word = firstWord(cell);
  return STATUSES.find((s) => s.toLowerCase() === word) || null;
}

// The Discussed column of the Ideas table: "no", "not yet", "-" or empty mean
// no conversation yet; a date (with whom) means it was discussed.
export function isUndiscussed(cell) {
  const v = cleanCell(cell).toLowerCase();
  return v === "" || v === "-" || v === "—" || /^no(t\b|\b)/.test(v);
}

// _product/spec.md → counts per Status (the Ideas table counts as Idea, the
// "## Dropped" bullets as Dropped), the undiscussed ideas and the Planned or
// Partial features. Never throws; an absent or odd table gives zeros.
export function parseSpec(text) {
  const counts = Object.fromEntries(STATUSES.map((s) => [s, 0]));
  const out = { found: false, counts, ideas: 0, undiscussed: [], undiscussedTotal: 0, next: [], nextTotal: 0 };
  const tables = parseTables(text);
  const features = tables.find((t) => column(t, isStatus) >= 0 && column(t, (h) => h.startsWith("feature")) >= 0)
    || tables.find((t) => column(t, isStatus) >= 0);
  if (features) {
    out.found = true;
    const statusIdx = column(features, isStatus);
    const nameIdx = Math.max(0, column(features, (h) => h.startsWith("feature")));
    for (const row of features.rows) {
      const status = statusOf(row[statusIdx]);
      if (!status) continue;
      counts[status]++;
      if (status === "Planned" || status === "Partial") {
        out.nextTotal++;
        if (out.next.length < MAX_ITEMS) out.next.push({ name: row[nameIdx] || "(unnamed)", status });
      }
    }
  }
  const ideas = tables.find((t) => t !== features && column(t, isIdea) >= 0);
  if (ideas) {
    out.found = true;
    const nameIdx = column(ideas, isIdea);
    const discussedIdx = column(ideas, (h) => h.includes("discussed"));
    for (const row of ideas.rows) {
      const name = row[nameIdx];
      if (!name) continue;
      out.ideas++;
      counts.Idea++;
      if (discussedIdx < 0 || isUndiscussed(row[discussedIdx])) {
        out.undiscussedTotal++;
        if (out.undiscussed.length < MAX_ITEMS) out.undiscussed.push(name);
      }
    }
  }
  let inDropped = false;
  for (const line of (typeof text === "string" ? text : "").split(/\r?\n/)) {
    if (/^#{1,6}\s/.test(line)) { inDropped = /^#{1,6}\s+dropped\b/i.test(line); continue; }
    if (inDropped && /^\s*[-*]\s+\S/.test(line)) counts.Dropped++;
  }
  return out;
}

// _product/research/feasibility.md → counts per Status (Open, Researched,
// Decided) and the open questions (number + question). Never throws.
export function parseFeasibility(text) {
  const out = { found: false, counts: { Open: 0, Researched: 0, Decided: 0, Other: 0 }, total: 0, open: [], openTotal: 0 };
  const table = parseTables(text).find((t) => column(t, isStatus) >= 0 && column(t, (h) => h.includes("question")) >= 0);
  if (!table) return out;
  out.found = true;
  const questionIdx = column(table, (h) => h.includes("question"));
  const statusIdx = column(table, isStatus);
  const numberIdx = column(table, isNumber);
  table.rows.forEach((row, i) => {
    const question = row[questionIdx];
    if (!question) return;
    out.total++;
    const word = firstWord(row[statusIdx]);
    const status = ["open", "researched", "decided"].includes(word) ? word[0].toUpperCase() + word.slice(1) : "Other";
    out.counts[status]++;
    if (status !== "Open") return;
    out.openTotal++;
    if (out.open.length < MAX_ITEMS) out.open.push({ n: (numberIdx >= 0 && row[numberIdx]) || String(i + 1), question });
  });
  return out;
}

// _product/log.md → the In progress rows (who, since, what, touches) and the
// To do rows (for, item, askedBy, since). The In progress table is the one with
// a Who column, the To do table the one with a For column; the Done bullets
// are not read (git shows them). Never throws; found is false without a table.
export function parseLog(text) {
  const out = { found: false, inProgress: [], todo: [] };
  const tables = parseTables(text);
  const cell = (row, i) => (i >= 0 && row[i]) || "";
  const is = (name) => (h) => h === name || h.startsWith(`${name} `);
  const progress = tables.find((t) => column(t, is("who")) >= 0);
  if (progress) {
    out.found = true;
    const who = column(progress, is("who"));
    const since = column(progress, is("since"));
    const what = column(progress, (h) => h.startsWith("working on") || is("what")(h));
    const touches = column(progress, (h) => is("touches")(h) || is("files")(h));
    for (const row of progress.rows) {
      if (!cell(row, who) && !cell(row, what)) continue;
      out.inProgress.push({ who: cell(row, who), since: cell(row, since), what: cell(row, what), touches: cell(row, touches) });
    }
  }
  const todo = tables.find((t) => t !== progress && column(t, is("for")) >= 0);
  if (todo) {
    out.found = true;
    const who = column(todo, is("for"));
    const item = column(todo, (h) => is("item")(h) || is("what")(h));
    const askedBy = column(todo, (h) => h.startsWith("asked"));
    const since = column(todo, is("since"));
    for (const row of todo.rows) {
      if (!cell(row, who) && !cell(row, item)) continue;
      out.todo.push({ for: cell(row, who), item: cell(row, item), askedBy: cell(row, askedBy), since: cell(row, since) });
    }
  }
  return out;
}

// ---------------------------------------------------------------- git

// Branch, distance to main, uncommitted count, and the commits by others since
// this developer's last commit on any branch (fallback: the last 7 days).
// Each git call has a short timeout and the whole thing a 900 ms budget; a
// call that fails or runs late yields null and the brief says "unknown".
export function gitState(root, budgetMs = 900) {
  const started = Date.now();
  const git = (...args) => {
    if (Date.now() - started > budgetMs) return null;
    try {
      return execFileSync("git", ["--no-pager", ...args], {
        cwd: root, encoding: "utf8", timeout: 700, stdio: ["ignore", "pipe", "ignore"],
        env: { ...process.env, GIT_OPTIONAL_LOCKS: "0" },
      }).replace(/\n$/, "");
    } catch {
      return null;
    }
  };
  const top = git("rev-parse", "--show-toplevel");
  if (top === null) return { git: false, repo: basename(root), me: git("config", "user.name") || "" };
  const branch = git("rev-parse", "--abbrev-ref", "HEAD") || "";
  const head = git("rev-parse", "--short", "HEAD") || "";
  const main = ["main", "origin/main"].find((ref) => git("rev-parse", "--verify", "--quiet", `${ref}^{commit}`) !== null) || null;
  let ahead = null;
  let behind = null;
  const counts = main && git("rev-list", "--left-right", "--count", `${main}...HEAD`);
  const m = counts && counts.match(/^(\d+)\s+(\d+)$/);
  if (m) { behind = Number(m[1]); ahead = Number(m[2]); }
  const status = git("status", "--porcelain", "--untracked-files=all");
  const uncommitted = status === null ? null : status.split("\n").filter(Boolean).length;
  const me = git("config", "user.name") || "";
  const myEmail = git("config", "user.email") || "";
  const same = (a, b) => Boolean(a) && Boolean(b) && a.trim().toLowerCase() === b.trim().toLowerCase();
  const isMine = (c) => same(c.author, me) || same(c.email, myEmail);
  const parse = (log) => (log || "").split("\n").filter(Boolean)
    .map((l) => { const [hash, iso, date, author, email, subject] = l.split("\x1f"); return { hash, iso, date, author, email, subject }; });
  const format = "--format=%h%x1f%cI%x1f%ad%x1f%an%x1f%ae%x1f%s";
  // --author is a substring match ("Vlad" also finds "Vladimir"), so the exact name or email decides.
  const last = me ? parse(git("log", "--all", "-i", "-F", `--author=${me}`, "-n", "50", format)).find(isMine) || null : null;
  const since = last ? last.iso : new Date(Date.now() - 7 * 86400e3).toISOString().replace(/\.\d+Z$/, "Z");
  const others = parse(git("log", "--all", `--since=${since}`, "--date=short", format, "-n", "300")).filter((c) => !isMine(c));
  return { git: true, repo: basename(top), branch, head, main, ahead, behind, uncommitted, me, last, others };
}

// ---------------------------------------------------------------- brief

const shorten = (s, n) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);
const plural = (n, word) => `${n} ${word}${n === 1 ? "" : "s"}`;
const readText = (path) => { try { return existsSync(path) ? readFileSync(path, "utf8") : null; } catch { return null; } };
const attempt = (fn, fallback) => { try { return fn(); } catch (e) { return fallback(e && e.message ? e.message : String(e)); } };

function localDate(d = new Date()) {
  const p = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

function deadlineText(now = Date.now()) {
  const days = Math.floor((DEADLINE.at - now) / 86400e3);
  if (days > 0) return `${plural(days, "day")} left before the hackathon deadline (${DEADLINE.label})`;
  if (days === 0) return `the hackathon deadline is today (${DEADLINE.label})`;
  return `the hackathon deadline (${DEADLINE.label}) has passed`;
}

function headerLines(g) {
  const lines = [];
  if (!g.git) {
    lines.push(`Session brief: ${g.repo} is not a git checkout (or git is unavailable)`);
  } else {
    const where = g.branch && g.branch !== "HEAD" ? `branch ${g.branch}` : `detached at ${g.head || "?"}`;
    const distance = !g.main ? "no main or origin/main ref"
      : g.ahead === null ? `distance to ${g.main} unknown` : `${g.ahead} ahead, ${g.behind} behind ${g.main}`;
    const dirty = g.uncommitted === null ? "uncommitted changes unknown" : plural(g.uncommitted, "uncommitted change");
    lines.push(`Session brief: repo ${g.repo}, ${where} (${distance}), ${dirty}`);
  }
  lines.push(`Developer: ${g.me || "unknown (git config user.name is empty)"} · today ${localDate()} · ${deadlineText()}`);
  return lines;
}

function sinceLines(g) {
  if (!g.git) return ["Since you last committed: unknown (no git history here)"];
  const who = g.me ? "others" : "anyone";
  const label = g.last
    ? `Since your last commit (${g.last.hash}, ${g.last.iso.slice(0, 16).replace("T", " ")})`
    : `No commit by ${g.me || "you"} found; in the last 7 days`;
  const n = g.others.length;
  const lines = [`${label}: ${n ? plural(n, "commit") : "no commits"} by ${who} on any branch`];
  const shown = n > MAX_COMMITS ? g.others.slice(0, MAX_COMMITS - 1) : g.others;
  for (const c of shown) lines.push(`  ${c.date}  ${c.author}  ${shorten(c.subject || "", 100)}`);
  if (n > shown.length) lines.push(`  … and ${n - shown.length} more`);
  lines.push(g.main && g.behind !== null
    ? `Commits on ${g.main} not on this branch: ${g.behind}`
    : "Commits on main not on this branch: unknown (no main or origin/main ref)");
  return lines;
}

function productLines(root) {
  const lines = [];
  const spec = readText(join(root, SPEC_PATH));
  const p = spec === null ? null : parseSpec(spec);
  if (!p) lines.push(`Product state: ${SPEC_PATH} not found`);
  else if (!p.found) lines.push(`Product state: no feature or idea table found in ${SPEC_PATH}`);
  else {
    lines.push(`Product state (${SPEC_PATH}): ${STATUSES.map((s) => `${s} ${p.counts[s]}`).join(", ")}`);
    const firstOf = (shown, total) => (total > shown ? `${total}, first ${shown}` : `${total}`);
    lines.push(p.undiscussedTotal ? `Undiscussed ideas (${firstOf(p.undiscussed.length, p.undiscussedTotal)}):` : "Undiscussed ideas: none");
    for (const name of p.undiscussed) lines.push(`  - ${shorten(name, 90)}`);
    lines.push(p.nextTotal ? `Planned or Partial features (${firstOf(p.next.length, p.nextTotal)}):` : "Planned or Partial features: none");
    for (const f of p.next) lines.push(`  - ${shorten(f.name, 90)} (${f.status})`);
  }
  const feas = readText(join(root, FEASIBILITY_PATH));
  const f = feas === null ? null : parseFeasibility(feas);
  if (!f) lines.push(`Feasibility: ${FEASIBILITY_PATH} not found`);
  else if (!f.found) lines.push(`Feasibility: no question table found in ${FEASIBILITY_PATH}`);
  else {
    const other = f.counts.Other ? `, other ${f.counts.Other}` : "";
    const open = !f.openTotal ? "" : f.openTotal > f.open.length ? `; first ${f.open.length} of ${f.openTotal} open questions:` : "; open questions:";
    lines.push(`Feasibility (${FEASIBILITY_PATH}): Open ${f.counts.Open}, Researched ${f.counts.Researched}, Decided ${f.counts.Decided}${other}${open}`);
    for (const q of f.open) lines.push(`  #${q.n} ${shorten(q.question, 100)}`);
  }
  return lines;
}

// The team log: the totals, every In progress row (who, since, what; the first
// MAX_ITEMS when there are more), then this developer's To do rows: For is
// their first name (first word of git config user.name, case-insensitive) or Both.
function teamLogLines(root, me) {
  const text = readText(join(root, LOG_PATH));
  if (text === null) return [`Team log: ${LOG_PATH} not found (claim your task there first)`];
  const log = parseLog(text);
  if (!log.found) return [`Team log: no In progress or To do table found in ${LOG_PATH}`];
  const name = firstWord(me);
  const mine = name ? log.todo.filter((r) => [name, "both"].includes(firstWord(r.for))) : [];
  const lines = [`Team log (${LOG_PATH}): ${log.inProgress.length} in progress, ${log.todo.length} to do${name ? ` (${mine.length} yours)` : ""}`];
  lines.push(log.inProgress.length ? "In progress:" : "In progress: none");
  const progress = log.inProgress.slice(0, MAX_ITEMS);
  for (const r of progress) lines.push(`  ${r.who || "(nobody)"}  since ${r.since || "?"}  ${shorten(r.what, MAX_LOG_LINE)}`);
  if (log.inProgress.length > progress.length) lines.push(`  … and ${log.inProgress.length - progress.length} more`);
  if (!name) { lines.push("Your to do: unknown (git config user.name is empty)"); return lines; }
  const shown = mine.slice(0, MAX_ITEMS);
  lines.push(!mine.length ? "Your to do: none" : mine.length > shown.length ? `Your to do (first ${shown.length} of ${mine.length}):` : `Your to do (${mine.length}):`);
  for (const r of shown) {
    const by = [r.askedBy, r.since].filter(Boolean).join(", ");
    lines.push(`  - ${shorten(r.item, MAX_LOG_LINE)}${by ? ` (${by})` : ""}`);
  }
  return lines;
}

// The whole brief as lines: header, commits since the last one, product state, team log, footer.
export function buildBrief(root) {
  const g = attempt(() => gitState(root), (why) => ({ git: false, repo: basename(root), me: "", note: why }));
  const lines = [
    ...attempt(() => headerLines(g), (why) => [`Session brief: header unavailable (${why})`]),
    "",
    ...attempt(() => sinceLines(g), (why) => [`Since you last committed: unavailable (${why})`]),
    "",
    ...attempt(() => productLines(root), (why) => [`Product state: unavailable (${why})`]),
    "",
    ...attempt(() => teamLogLines(root, g.me), (why) => [`Team log: unavailable (${why})`]),
    "",
    `Session start: ${FOOTER}`,
  ];
  // Claude Code keeps at most 10,000 characters of hook output; the per-item caps
  // above keep the brief far below that, and this guard keeps the footer whole.
  if (lines.length > MAX_LINES) lines.splice(MAX_LINES - 2, lines.length - MAX_LINES + 1, "  … (brief truncated)");
  while (lines.join("\n").length > MAX_CHARS && lines.length > 3) lines.splice(lines.length - 3, 1);
  return lines;
}

export function main(argv = process.argv.slice(2)) {
  let lines;
  try {
    const root = argv[0] ? resolve(argv[0]) : fileURLToPath(new URL("../", import.meta.url));
    lines = buildBrief(root);
  } catch (e) {
    lines = [`Session brief unavailable: ${e && e.message ? e.message : e}`, `Session start: ${FOOTER}`];
  }
  process.stdout.write(`${lines.join("\n")}\n`);
  return 0;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.stdout.on("error", () => {});
  process.exitCode = main();
}
