// Regression harness: runs the detector over testcases/cases.json and
// compares to PRD ground truth. Usage:
//   node scripts/score.mjs            (human report)
//   node scripts/score.mjs --json out.json
//   node --env-file-if-exists=.env scripts/score.mjs --muse   (full Muse Spark check, paid API;
//     answers are cached in .runtime/eval/muse-cache.json so a re-run is free)
//   LLM_PROVIDER=baseten node scripts/score.mjs --muse   (make score-open: the same on Muse Spark
//     Open, Meta's open weights, served by Baseten; BASETEN_API_KEY; _product/research/open-weights.md)
import "../lib/credentials.js";
import { readFile, writeFile } from "node:fs/promises";
import { detect } from "../lib/detector.js";
import { validateVerdict, pickVerdictFields } from "../lib/schema.js";
import { checkMessage, museConfigured, museLabel, museModel } from "../lib/muse.js";
import { fileCache, usageSummary } from "./muse-file-cache.mjs";

const root = new URL("../", import.meta.url);
const load = async (p) => JSON.parse(await readFile(new URL(p, root), "utf8"));

const profiles = {
  linda: await load("data/profiles/linda.json"),
  francoise: await load("data/profiles/francoise.json"),
};
const cards = await load("data/patterns/cards.json");
const { cases } = await load("testcases/cases.json");

const useMuse = process.argv.includes("--muse");
if (useMuse && !museConfigured()) {
  console.error("--muse needs a model key: META_MODEL_API_KEY for Muse Spark (make secrets-set META_MODEL_API_KEY=...), BASETEN_API_KEY for Muse Spark Open (make score-open), or another provider via LLM_PROVIDER (_product/docs/llm.md)");
  process.exit(2);
}
const cache = useMuse ? await fileCache(new URL(".runtime/eval/muse-cache.json", root).pathname) : null;

// The Muse calls run side by side (lib/muse.js allows four at a time).
const rows = await Promise.all(cases.map(async (c) => {
  const started = Date.now();
  const input = {
    locale: c.locale,
    message: c.message,
    personalContext: profiles[c.profile],
    patternCards: cards,
    threadHistory: c.threadHistory || [],
    mockLinkInspection: c.mockLinkInspection || {},
    linkInspection: c.mockLinkInspection || {},
  };
  const detector = detect(input);
  const v = useMuse ? await checkMessage(input, { cache }) : detector;
  const schemaErrs = validateVerdict(useMuse ? pickVerdictFields(v) : v);
  const allowed = [c.expected, ...(c.acceptable || [])];
  const pass = allowed.includes(v.verdict) && schemaErrs.length === 0;
  const falseScam = c.set === "C" && v.verdict === "scam";
  return { id: c.id, set: c.set, expected: c.expected, got: v.verdict, detector: detector.verdict, pass, falseScam,
    confidence: v.confidence, ms: Date.now() - started, schemaErrs, source: v.source, degraded: Boolean(v.degraded),
    guardrail: v.guardrail || null, usage: v.usage || null, latency_ms: v.latency_ms, error: v.error || null,
    reasons: v.reasons.map((r) => r.text) };
}));
if (cache) await cache.save();

const bySet = {};
for (const r of rows) {
  bySet[r.set] ??= { pass: 0, total: 0 };
  bySet[r.set].total++;
  if (r.pass) bySet[r.set].pass++;
}
const falseScams = rows.filter((r) => r.falseScam);
console.log(`Scam Shield regression (PRD pass criteria: A 100%, C no false Scam)${useMuse ? ` with ${museLabel()} (${museModel()})` : ""}`);
for (const r of rows) {
  const extra = useMuse ? ` detector=${r.detector}${r.degraded ? " DEGRADED" : ""}${r.guardrail ? ` guardrail=${JSON.stringify(r.guardrail).slice(0, 60)}` : ""}` : "";
  console.log(`${r.pass ? "PASS" : "FAIL"} ${r.id.padEnd(4)} set ${r.set} expected=${r.expected} got=${r.got} conf=${r.confidence}${extra}`);
}
for (const [s, v] of Object.entries(bySet)) console.log(`Set ${s}: ${v.pass}/${v.total}`);
console.log(`False Scam on legit (C): ${falseScams.length} (target 0 in this seed set)`);
console.log(`Overall: ${rows.filter((r) => r.pass).length}/${rows.length}`);
if (useMuse) {
  const u = usageSummary(rows.map((r) => ({ source: r.source, usage: r.usage, latency_ms: r.latency_ms, degraded: r.degraded })));
  console.log(`Muse: ${u.calls} paid calls, ${u.cached} cached, ${u.degraded} degraded (fell back to the detector) · tokens in ${u.promptTokens} / out ${u.completionTokens} · median ${u.medianMs} ms`);
  console.log(`Muse changed the detector's verdict on ${rows.filter((r) => r.got !== r.detector).length} of ${rows.length} cases.`);
  const errors = [...new Set(rows.map((r) => r.error).filter(Boolean))];
  if (errors.length) console.log(`Muse errors (those cases were judged by the detector alone): ${errors.map((e) => e.slice(0, 160)).join(" | ")}`);
}
if (process.argv.includes("--json")) {
  const out = process.argv[process.argv.indexOf("--json") + 1] || "predictions.json";
  await writeFile(out, JSON.stringify(rows, null, 2));
}
process.exit(rows.every((r) => r.pass) && falseScams.length === 0 ? 0 : 1);
