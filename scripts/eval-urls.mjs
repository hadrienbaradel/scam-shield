// How well do the link checks alone recognise known phishing links?
//   node scripts/eval-urls.mjs urls.txt [--out results.json]
// Purely static: no link is ever opened and no lookup is made. Each URL is
// judged in two plain settings, with no brand claimed and no lure wording,
// so only what the address itself reveals can raise the alarm:
//   text   — a text message from an unknown number containing just the link
//   email  — an unknown sender: "Please sign in to review your account: <link>"
// The URL list stays outside the repo (e.g. a research sample of a feed).

import { readFile, writeFile } from "node:fs/promises";
import { detect } from "../lib/detector.js";
import { domainOf } from "../lib/brands.js";
import { inspectLink } from "../lib/linkInspector.js";

const args = process.argv.slice(2);
const oi = args.indexOf("--out");
const out = oi >= 0 ? args.splice(oi, 2)[1] : null;
const urls = [...new Set((await readFile(args[0], "utf8")).split(/\r?\n/).map((s) => s.trim()).filter((s) => /^https?:\/\//i.test(s)))];

const settings = {
  text: (u) => ({ channel: "sms", from: "+1 555-0100", fromName: "", subject: "", body: u, links: [{ text: u, href: u }], auth: "" }),
  email: (u) => ({ channel: "email", from: "notice@mailer.test", fromName: "Customer Service", subject: "Account notice", auth: "",
    body: `Please sign in to review your account: ${u}`, links: [{ text: u, href: u }] }),
};
const tally = Object.fromEntries(Object.keys(settings).map((k) => [k, { scam: 0, be_careful: 0, safe: 0 }]));
const rows = [];
for (const url of urls) {
  const row = { url, domain: domainOf(url), ...inspectLink({ href: url, text: url }) };
  for (const [name, make] of Object.entries(settings)) {
    const v = detect({ locale: "en-US", message: make(url), personalContext: {}, patternCards: [] });
    tally[name][v.verdict]++;
    row[name] = { verdict: v.verdict, reasons: (v._signals || []).map((s) => s.text) };
  }
  rows.push(row);
}
const n = urls.length;
const pct = (x) => `${((100 * x) / n).toFixed(1)}%`;
console.log(`${n} distinct URLs`);
for (const [name, t] of Object.entries(tally)) {
  console.log(`  ${name.padEnd(6)} Scam ${pct(t.scam)} · Be careful ${pct(t.be_careful)} · flagged ${pct(t.scam + t.be_careful)} · missed (Safe) ${pct(t.safe)}`);
}
const missed = rows.filter((r) => r.email.verdict === "safe");
const hosts = {};
for (const r of missed) { const h = r.domain.split(".").slice(-2).join("."); hosts[h] = (hosts[h] || 0) + 1; }
console.log("  most common hosts among misses (email setting):", Object.entries(hosts).sort((a, b) => b[1] - a[1]).slice(0, 12).map(([h, c]) => `${h} ${c}`).join(", "));
if (out) await writeFile(out, JSON.stringify({ tally, rows }, null, 1));
