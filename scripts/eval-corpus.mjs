// Accuracy on public email corpora (e.g. Zenodo 8339691 "Phishing Email
// Curated Datasets": Nazario, Nigerian_Fraud, SpamAssasin, CEAS_08...).
// The data never enters the repo: pass the CSV paths as arguments.
//
//   node scripts/eval-corpus.mjs [--limit N] [--out results.json] file.csv...
//
// Each row (sender, receiver, date, subject, body, urls, label) becomes the
// same message shape Gmail sync produces and goes through the detector as a
// brand-new user would see it: no personal context, no authentication
// headers (these corpora do not keep them), no link lookups (no network).
// label 1 = phishing/spam, 0 = legitimate. Only subjects and sender domains
// are printed, never bodies.

import { readFile, writeFile } from "node:fs/promises";
import { basename } from "node:path";
import { detect } from "../lib/detector.js";
import { emptyContext } from "../lib/context.js";
import { domainOf } from "../lib/brands.js";
import { htmlToText, linksFromHtml, linksFromText, parseAddress } from "../src/google/gmail.js";

const args = process.argv.slice(2);
const opt = (name, fallback) => { const i = args.indexOf(name); if (i < 0) return fallback; const v = args[i + 1]; args.splice(i, 2); return v; };
const limit = Number(opt("--limit", 0));
const out = opt("--out", null);
const cards = JSON.parse(await readFile(new URL("../data/patterns/cards.json", import.meta.url), "utf8"));

// RFC 4180 CSV: quoted fields may hold commas, quotes ("") and newlines.
function parseCsv(text) {
  const rows = [];
  let row = [], field = "", quoted = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quoted) {
      if (c === '"') { if (text[i + 1] === '"') { field += '"'; i++; } else quoted = false; } else field += c;
    } else if (c === '"') quoted = true;
    else if (c === ",") { row.push(field); field = ""; }
    else if (c === "\n" || c === "\r") {
      if (c === "\r" && text[i + 1] === "\n") i++;
      row.push(field); rows.push(row); row = []; field = "";
    } else field += c;
  }
  if (field || row.length) { row.push(field); rows.push(row); }
  const [head, ...data] = rows;
  return data.filter((r) => r.length >= head.length).map((r) => Object.fromEntries(head.map((h, j) => [h.trim(), r[j]])));
}

function toMessage(row) {
  const from = parseAddress(row.sender || "");
  const raw = String(row.body || "");
  const isHtml = /<(html|body|div|p|a|table|br)\b/i.test(raw);
  const body = isHtml ? htmlToText(raw) : raw;
  const seen = new Set();
  const links = [...(isHtml ? linksFromHtml(raw) : []), ...linksFromText(body)].filter((l) => (seen.has(l.href) ? false : seen.add(l.href))).slice(0, 40);
  return { channel: "email", fromName: from.name, from: from.email, replyTo: "", subject: row.subject || "", body: body.slice(0, 6000), links, auth: "", date: row.date };
}

const pct = (a, b) => (b ? `${((100 * a) / b).toFixed(1)}%` : "-");
const summary = [];
const details = [];

for (const file of args) {
  const started = Date.now();
  let rows = parseCsv(await readFile(file, "utf8"))
    .filter((r) => (r.body || "").trim() && !/MAILER-DAEMON/i.test(r.sender || "") && !/FOLDER INTERNAL DATA/.test(r.subject || ""));
  if (limit) rows = rows.slice(0, limit);
  const by = { 1: { scam: 0, be_careful: 0, safe: 0 }, 0: { scam: 0, be_careful: 0, safe: 0 } };
  const misses = [], falseAlarms = [];
  for (const row of rows) {
    const label = String(row.label).trim() === "1" ? 1 : 0;
    const message = toMessage(row);
    let v;
    try { v = detect({ locale: "en-US", message, personalContext: emptyContext(""), patternCards: cards }); } catch (e) { v = { verdict: "safe", reasons: [{ text: `error: ${e.message}` }] }; }
    by[label][v.verdict]++;
    const item = { file: basename(file), label, verdict: v.verdict, subject: String(row.subject || "").slice(0, 80), senderDomain: domainOf(message.from), reason: v.reasons?.[0]?.text || "" };
    details.push(item);
    if (label === 1 && v.verdict === "safe") misses.push(item);
    if (label === 0 && v.verdict === "scam") falseAlarms.push(item);
  }
  const p = by[1], l = by[0];
  const nP = p.scam + p.be_careful + p.safe, nL = l.scam + l.be_careful + l.safe;
  summary.push({ file: basename(file), rows: rows.length, ms: Date.now() - started,
    positives: nP, scam: p.scam, careful: p.be_careful, missed: p.safe,
    legit: nL, legitScam: l.scam, legitCareful: l.be_careful, legitSafe: l.safe, misses, falseAlarms });
}

for (const s of summary) {
  console.log(`\n== ${s.file}: ${s.rows} messages in ${s.ms} ms`);
  if (s.positives) console.log(`   label 1 (${s.positives}): Scam ${pct(s.scam, s.positives)} · Be careful ${pct(s.careful, s.positives)} · flagged ${pct(s.scam + s.careful, s.positives)} · missed (Safe) ${pct(s.missed, s.positives)}`);
  if (s.legit) console.log(`   label 0 (${s.legit}): wrongly Scam ${pct(s.legitScam, s.legit)} · Be careful ${pct(s.legitCareful, s.legit)} · Safe ${pct(s.legitSafe, s.legit)}`);
  const top = (items) => Object.entries(items.reduce((m, x) => ((m[x.reason] = (m[x.reason] || 0) + 1), m), {})).sort((a, b) => b[1] - a[1]).slice(0, 4);
  if (s.falseAlarms.length) console.log("   top reasons for false Scam:", top(s.falseAlarms).map(([r, n]) => `${n}× ${r.slice(0, 90)}`).join(" | "));
}
// Confusion matrix and the usual metrics. Phishing = label 1 rows of
// phishing/fraud corpora (Nazario, Nigerian…); legitimate = label 0 rows.
// Plain spam (label 1 of SpamAssassin/CEAS) is not a scam and is left out.
const isPhishFile = (f) => /nazario|nigerian|phish|fraud/i.test(f);
const phish = summary.filter((s) => isPhishFile(s.file));
const totals = {
  P: phish.reduce((n, s) => n + s.positives, 0),
  Pscam: phish.reduce((n, s) => n + s.scam, 0),
  Pflag: phish.reduce((n, s) => n + s.scam + s.careful, 0),
  N: summary.reduce((n, s) => n + s.legit, 0),
  Nscam: summary.reduce((n, s) => n + s.legitScam, 0),
  Nflag: summary.reduce((n, s) => n + s.legitScam + s.legitCareful, 0),
};
const metrics = (TP, P, FP, N) => {
  const FN = P - TP, TN = N - FP;
  const precision = TP / (TP + FP || 1), recall = TP / (P || 1);
  return { TP, FN, FP, TN, accuracy: (TP + TN) / (P + N || 1), precision, recall, f1: (2 * precision * recall) / (precision + recall || 1), falsePositiveRate: FP / (N || 1) };
};
const report = {
  scamOnly: metrics(totals.Pscam, totals.P, totals.Nscam, totals.N),
  scamOrCareful: metrics(totals.Pflag, totals.P, totals.Nflag, totals.N),
};
if (totals.P && totals.N) {
  const f = (x) => `${(100 * x).toFixed(1)}%`;
  console.log(`
== Phishing (${totals.P}) vs legitimate (${totals.N})`);
  for (const [name, m] of Object.entries(report)) {
    console.log(`   ${name.padEnd(14)} TP ${m.TP} FN ${m.FN} FP ${m.FP} TN ${m.TN} | accuracy ${f(m.accuracy)} precision ${f(m.precision)} recall ${f(m.recall)} F1 ${f(m.f1)} false-alarm rate ${f(m.falsePositiveRate)}`);
  }
}
if (out) await writeFile(out, JSON.stringify({ summary: summary.map(({ misses, falseAlarms, ...s }) => s), report, details }, null, 1));
