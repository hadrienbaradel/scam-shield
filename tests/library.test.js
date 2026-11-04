// The public scam library, the pure part (lib/library.js): the 21
// families, the entry schema and what validateEntry names, redaction (what
// goes, what stays as evidence), the body hash, the indicators behind the
// suspect list, the filters, the export and the file loader. No network,
// no database.
import "./helpers/env.js";
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { CHANNELS, validateEntry } from "../lib/library.js";

const load = async (p) => JSON.parse(await readFile(new URL(`../${p}`, import.meta.url), "utf8"));
const FAMILY_IDS = ["delivery", "bank", "government", "tech-support", "family-emergency", "new-number", "romance", "investment", "prize",
  "charity", "job", "rental", "renewal", "toll-fine", "utility", "account", "sextortion", "invoice", "marketplace", "health", "recovery"];

// The example entry of the plan (docs/plans/2026-11-04-public-database.md).
export const EXAMPLE = {
  id: "lib-demo-a4", family: "delivery", channel: "sms", country: "FR", language: "fr", brand: "Chronopost",
  lure: "a parcel is waiting", ask: "pay a small redelivery fee on a link",
  message: { from: "+33 7 00 00 00 01", subject: null, body: "Chronopost : votre colis est en attente. Payez 1,99 € de frais pour le reprogrammer.",
    links: [{ text: "chronopost.fr", href: "https://chronopost-colis.test/pay" }] },
  first_seen: "2026-10-20", last_seen: "2026-10-20",
  source: { id: "prudence-demo", url: null, licence: "CC BY 4.0", attribution: "Prudence demo cases" },
  verdict: { verdict: "scam", headline: "This is not Chronopost.", reasons: ["The link is not on chronopost.fr.", "A fee by text message is the parcel scam."] },
  status: "published",
};
const refs = async () => ({ families: await load("data/library/families.json"), sources: await load("data/library/sources.json") });
const withMessage = (patch) => ({ ...EXAMPLE, message: { ...EXAMPLE.message, ...patch } });

test("the 21 families carry both names, both definitions and their references", async () => {
  const families = await load("data/library/families.json");
  assert.deepEqual(families.map((f) => f.id), FAMILY_IDS);
  for (const f of families) {
    for (const lang of ["en", "fr"]) {
      assert.ok(f.name?.[lang]?.trim(), `${f.id}: name.${lang}`);
      assert.ok(f.definition?.[lang]?.trim(), `${f.id}: definition.${lang}`);
    }
    assert.deepEqual(Object.keys(f.refs).sort(), ["fr", "ftc", "ic3", "nfib", "scamclassifier", "scamwatch"], `${f.id}: the six references`);
  }
  const sources = await load("data/library/sources.json");
  assert.ok(sources.find((s) => s.id === "prudence-demo")?.licence === "CC BY 4.0");
  assert.deepEqual(CHANNELS, ["email", "sms", "chat", "voice", "web", "letter"]);
});

test("validateEntry accepts the example entry and names what is wrong", async () => {
  const ctx = await refs();
  assert.deepEqual(validateEntry(EXAMPLE, ctx), []);
  const { family, ...noFamily } = EXAMPLE;
  assert.ok(validateEntry(noFamily, ctx).includes("missing family"));
  assert.ok(validateEntry({ ...EXAMPLE, family: "x" }, ctx).includes("unknown family x"));
  assert.ok(validateEntry({ ...EXAMPLE, channel: "fax" }, ctx).some((e) => /channel/.test(e)), "channel fax");
  assert.ok(validateEntry(withMessage({ body: "Hello" }), ctx).some((e) => /body/.test(e)), "a 5-character body");
  assert.ok(validateEntry(withMessage({ body: "x".repeat(10001) }), ctx).some((e) => /body/.test(e)), "a body over 10,000 characters");
  assert.ok(validateEntry({ ...EXAMPLE, source: { ...EXAMPLE.source, id: "nope" } }, ctx).some((e) => /source/.test(e)), "an unknown source");
  assert.ok(validateEntry(withMessage({ body: "Un prélèvement sur votre compte FR76 3000 6000 0112 3456 7890 189 sera effectué." }), ctx).includes("body carries personal data"));
  assert.ok(validateEntry(withMessage({ subject: "Pour Françoise Dupont, code 123456" }), ctx).includes("body carries personal data"), "the subject too");
  assert.ok(validateEntry({ ...EXAMPLE, first_seen: "20/10/2026" }, ctx).some((e) => /first_seen/.test(e)), "a date not YYYY-MM-DD");
  assert.ok(validateEntry({ ...EXAMPLE, last_seen: "2026-10-19" }, ctx).some((e) => /last_seen/.test(e)), "last_seen before first_seen");
  assert.ok(validateEntry({ ...EXAMPLE, id: "Demo A4" }, ctx).some((e) => /id/.test(e)), "an id with spaces");
  assert.ok(validateEntry({ ...EXAMPLE, country: "France" }, ctx).some((e) => /country/.test(e)), "a country not alpha-2");
  assert.ok(validateEntry({ ...EXAMPLE, language: "FR" }, ctx).some((e) => /language/.test(e)), "a language not ISO 639-1");
  assert.ok(validateEntry({ ...EXAMPLE, verdict: { verdict: "safe", headline: "x", reasons: [] } }, ctx).some((e) => /verdict/.test(e)), "a safe verdict is no library entry");
  assert.deepEqual(validateEntry({ ...EXAMPLE, verdict: null, country: null, language: null, brand: null }, ctx), [], "nulls where allowed");
  assert.ok(validateEntry({ ...EXAMPLE, extra: 1 }, ctx).some((e) => /extra/.test(e)), "no unknown field");
  assert.deepEqual(validateEntry(null, ctx), ["entry is not an object"]);
});
