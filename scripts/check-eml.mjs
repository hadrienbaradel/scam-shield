// Check .eml files from the command line with the same engine as the app.
// Usage: node --env-file-if-exists=.env scripts/check-eml.mjs [--profile linda|francoise] file.eml...
// Prints the verdict and reasons, never the message body.
import { readFile } from "node:fs/promises";
import { parseEml } from "../src/google/eml.js";
import { checkMessage } from "../lib/muse.js";
import { inspectMessageLinks } from "../src/links/resolver.js";

const args = process.argv.slice(2);
const pi = args.indexOf("--profile");
const profile = pi >= 0 ? args.splice(pi, 2)[1] : null;
const ctx = profile ? JSON.parse(await readFile(new URL(`../data/profiles/${profile}.json`, import.meta.url), "utf8")) : null;
const cards = JSON.parse(await readFile(new URL("../data/patterns/cards.json", import.meta.url), "utf8"));

for (const file of args) {
  const message = await parseEml(await readFile(file));
  const linkInspection = await inspectMessageLinks(message, ctx || {});
  const v = await checkMessage({ locale: profile === "francoise" ? "fr-FR" : "en-US", message, personalContext: ctx, patternCards: cards, mockLinkInspection: linkInspection, linkInspection });
  console.log(`\n${file.split("/").pop()}`);
  console.log(`  from: "${message.fromName}" <${message.from}>  auth: ${message.auth}  links: ${message.links.length}`);
  console.log(`  VERDICT: ${v.verdict.toUpperCase()} (${Math.round(v.confidence * 100)}%) via ${v.source}`);
  for (const r of v.reasons) console.log(`   - [${r.evidence}] ${r.text}`);
  if (v.matched_pattern_ids?.length) console.log(`  patterns: ${v.matched_pattern_ids.join(", ")}`);
}
