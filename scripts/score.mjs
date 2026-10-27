// Regression harness: runs the detector over testcases/cases.json and
// compares to PRD ground truth. Usage:
//   node scripts/score.mjs            (human report)
//   node scripts/score.mjs --json out.json
import { readFile, writeFile } from "node:fs/promises";
import { detect } from "../lib/detector.js";
import { validateVerdict } from "../lib/schema.js";

const root = new URL("../", import.meta.url);
const load = async (p) => JSON.parse(await readFile(new URL(p, root), "utf8"));

const profiles = {
  linda: await load("data/profiles/linda.json"),
  francoise: await load("data/profiles/francoise.json"),
};
const cards = await load("data/patterns/cards.json");
const { cases } = await load("testcases/cases.json");

const rows = [];
for (const c of cases) {
  const started = Date.now();
  const v = detect({
    locale: c.locale,
    message: c.message,
    personalContext: profiles[c.profile],
    patternCards: cards,
    threadHistory: c.threadHistory || [],
    mockLinkInspection: c.mockLinkInspection || {},
  });
  const schemaErrs = validateVerdict(v);
  const allowed = [c.expected, ...(c.acceptable || [])];
  const pass = allowed.includes(v.verdict) && schemaErrs.length === 0;
  const falseScam = c.set === "C" && v.verdict === "scam";
  rows.push({ id: c.id, set: c.set, expected: c.expected, got: v.verdict, pass, falseScam,
    confidence: v.confidence, ms: Date.now() - started, schemaErrs,
    reasons: v.reasons.map((r) => r.text) });
}

const bySet = {};
for (const r of rows) {
  bySet[r.set] ??= { pass: 0, total: 0 };
  bySet[r.set].total++;
  if (r.pass) bySet[r.set].pass++;
}
const falseScams = rows.filter((r) => r.falseScam);
console.log("Scam Shield regression (PRD pass criteria: A 100%, C no false Scam)");
for (const r of rows) console.log(`${r.pass ? "PASS" : "FAIL"} ${r.id.padEnd(4)} set ${r.set} expected=${r.expected} got=${r.got} conf=${r.confidence}`);
for (const [s, v] of Object.entries(bySet)) console.log(`Set ${s}: ${v.pass}/${v.total}`);
console.log(`False Scam on legit (C): ${falseScams.length} (target 0 in this seed set)`);
console.log(`Overall: ${rows.filter((r) => r.pass).length}/${rows.length}`);
if (process.argv.includes("--json")) {
  const out = process.argv[process.argv.indexOf("--json") + 1] || "predictions.json";
  await writeFile(out, JSON.stringify(rows, null, 2));
}
process.exit(rows.every((r) => r.pass) && falseScams.length === 0 ? 0 : 1);
