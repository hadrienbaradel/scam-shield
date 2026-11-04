// The public scam library over Postgres and HTTP: the seed entries, the
// submissions store (redaction, duplicates, Muse Spark's proposal, approve
// and reject), then the public API, the senior's share endpoints and the
// admin queue through Fastify's inject. Needs Postgres; skipped without it.
import { pool, resetDb, dbAvailable } from "./helpers/db.js";
import { test, before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { one, many } from "../src/db/pool.js";
import { getProvider } from "../lib/llm/index.js";
import { loadLibraryFiles, validateEntry, bodyHash } from "../lib/library.js";
import { classifyExample, CLASSIFY_SCHEMA } from "../lib/libraryMuse.js";
import { getLibrary, submit, submissionStatus, listSubmissions, approveSubmission, rejectSubmission, sharedCounts, withdrawShared } from "../src/library/store.js";

const load = async (p) => JSON.parse(await readFile(new URL(`../${p}`, import.meta.url), "utf8"));
const hasDb = await dbAvailable();
const opts = { skip: hasDb ? false : "Postgres test database not available" };

// The families the seed maps the demo cases to (scripts/library-seed.mjs).
const SEED_FAMILIES = ["utility", "bank", "delivery", "toll-fine", "government", "tech-support", "renewal", "sextortion",
  "family-emergency", "health", "account", "recovery", "romance", "new-number", "investment", "job"];

before(async () => {
  if (!hasDb) return;
  await resetDb();
});
after(async () => { await pool.end(); });
beforeEach(() => { delete process.env.LLM_PROVIDER; getProvider("mock").reset(); });

const SMS = { from: "+1 555-013-0199", subject: null, body: "USPS: your package could not be delivered. Pay the $2.99 fee at https://usps-redelivery-fee.com/pay today.", links: [{ text: "pay", href: "https://usps-redelivery-fee.com/pay" }] };

test("the seed entries validate and cover the non-safe cases", async () => {
  const { cases } = await load("testcases/cases.json");
  const lib = await loadLibraryFiles();
  const seed = lib.entries.filter((e) => e.id.startsWith("lib-demo-"));
  const expected = cases.filter((c) => c.expected !== "safe");
  assert.equal(seed.length, expected.length, "one entry per case that is not Safe");
  assert.deepEqual(seed.map((e) => e.id).sort(), expected.map((c) => `lib-demo-${c.id.toLowerCase()}`).sort());
  for (const e of seed) assert.deepEqual(validateEntry(e, lib), [], e.id);
  assert.deepEqual([...new Set(seed.map((e) => e.family))].sort(), [...SEED_FAMILIES].sort(), "every family of the table");
  const a3b = seed.find((e) => e.id === "lib-demo-a3b");
  assert.ok(a3b.message.body.includes("[bank account number]") && !/FR76/.test(a3b.message.body), "the IBAN of A3b is gone");
  const b8 = seed.find((e) => e.id === "lib-demo-b8");
  assert.ok(!/Françoise/.test(b8.message.body + b8.message.subject) && b8.message.body.includes("[name]"), "the recipient's name is gone");
  assert.ok(seed.every((e) => e.source.id === "prudence-demo" && e.source.licence === "CC BY 4.0"));
  assert.ok(seed.every((e) => ["scam", "be_careful"].includes(e.verdict.verdict) && e.verdict.headline && e.verdict.reasons.length));
  assert.ok(seed.every((e) => e.lure && e.ask && /^[A-Za-z]/.test(e.lure)), "the lure and the ask are written, in English");
  assert.deepEqual(seed.find((e) => e.id === "lib-demo-d6").channel, "web", "a screenshot of a pop-up is the web");
  assert.deepEqual(seed.find((e) => e.id === "lib-demo-b1").channel, "voice");
  assert.deepEqual(seed.find((e) => e.id === "lib-demo-b14").channel, "chat");
  assert.deepEqual([seed.find((e) => e.id === "lib-demo-a4").country, seed.find((e) => e.id === "lib-demo-a4").language], ["FR", "fr"]);
  assert.deepEqual([seed.find((e) => e.id === "lib-demo-d1").country, seed.find((e) => e.id === "lib-demo-d1").language], ["US", "en"]);
});

test("classifyExample asks Muse Spark for the family and keeps only what the schema knows", async () => {
  const families = (await loadLibraryFiles()).families;
  await assert.rejects(classifyExample({ channel: "sms", message: SMS, families }), /not configured/, "no provider, no classification");
  process.env.LLM_PROVIDER = "mock";
  const mock = getProvider("mock");
  mock.script({ family: "delivery", brand: "USPS", lure: "a parcel could not be delivered", ask: "a small fee on a link", language: "en", country: "US", extra: "ignored" });
  const out = await classifyExample({ channel: "sms", message: SMS, families });
  assert.deepEqual(out, { family: "delivery", brand: "USPS", lure: "a parcel could not be delivered", ask: "a small fee on a link", language: "en", country: "US" });
  const req = mock.calls[0];
  assert.equal(req.json.name, "library_classification");
  assert.deepEqual(req.json.schema, CLASSIFY_SCHEMA);
  assert.ok(req.system.includes("delivery:") && req.system.includes("recovery:"), "every family with its definition");
  assert.ok(req.messages[0].content.includes("usps-redelivery-fee.com") && !req.messages[0].content.includes("<script"), "the example, as data");
  mock.script({ family: "nope", brand: null, lure: "", ask: "", language: "English", country: "usa" });
  assert.deepEqual(await classifyExample({ channel: "sms", message: { ...SMS, body: "<script>alert(1)</script> pay now" }, families }),
    { family: null, brand: null, lure: "", ask: "", language: null, country: null }, "an unknown family or code becomes null");
  assert.ok(!mock.calls[1].messages[0].content.includes("<script"), "tags are escaped in the block");
});

test("submit stores a redacted body and refuses a duplicate", opts, async () => {
  const body = "Hi Linda, your card 4111 1111 1111 1111 was charged $399. Reply with the code 123456 or call +1 555-013-0199.";
  const row = await submit({ channel: "email", message: { from: "billing@antivirus-renewal-call.net", subject: "Renewed, Linda", body, links: [] },
    country: "us", language: "EN", note: "got this today", submitterHash: "abc" });
  assert.equal(row.status, "pending");
  assert.ok(row.message.body.includes("[card number]") && row.message.body.includes("code [code]") && !row.message.body.includes("4111"));
  assert.ok(row.message.body.includes("+1 555-013-0199"), "the number stays");
  assert.equal(row.message.from, "billing@antivirus-renewal-call.net");
  assert.deepEqual([row.country, row.language, row.note, row.from_app, row.user_id, row.submitter_hash], ["US", "en", "got this today", false, null, "abc"]);
  assert.deepEqual(row.proposed, { may_carry_name: true }, "no classifier: only the name warning for the reviewer");
  assert.equal(row.body_hash, bodyHash(row.message));
  const stored = await one("SELECT message FROM library_submissions WHERE id = $1", [row.id]);
  assert.ok(!stored.message.body.includes("4111"), "never stored unredacted");

  const again = await submit({ channel: "email", message: { body: body.toUpperCase() }, submitterHash: "def" });
  assert.deepEqual(again, { duplicate: true, entryId: null, submissionId: row.id }, "the same words again: the pending one");
  const seed = (await getLibrary()).entries[0];
  const copy = await submit({ channel: seed.channel, message: { body: `${seed.message.body}!!!` }, submitterHash: "ghi" });
  assert.deepEqual(copy, { duplicate: true, entryId: seed.id, submissionId: null }, "a message already in the library");
  assert.equal((await many("SELECT id FROM library_submissions")).length, 1, "no pending row for a duplicate");

  assert.deepEqual(await submissionStatus(row.id), { id: row.id, status: "pending", reason: null, entryId: null });
  assert.equal(await submissionStatus("00000000-0000-0000-0000-000000000000"), null);
});

test("submit asks the classifier when given one and survives its failure", opts, async () => {
  const families = (await getLibrary()).families;
  const calls = [];
  const classify = async (input) => { calls.push(input); return { family: "renewal", brand: "Norton", lure: "a renewal", ask: "call to cancel", language: "en", country: null }; };
  const row = await submit({ channel: "email", message: { body: "Your antivirus renewed for $399 today, call now to cancel and be refunded." }, classify });
  assert.deepEqual(row.proposed, { family: "renewal", brand: "Norton", lure: "a renewal", ask: "call to cancel", language: "en", country: null });
  assert.equal(calls[0].channel, "email");
  assert.equal(calls[0].families, families);
  assert.ok(calls[0].message.body.startsWith("Your antivirus"), "the redacted message");
  const down = await submit({ channel: "sms", message: { body: "Your Prime membership could not be renewed, update the card on the link." }, classify: async () => { throw new Error("down"); } });
  assert.equal(down.status, "pending");
  assert.equal(down.proposed, null, "a model outage never blocks a submission");
});

test("approve builds a valid entry and reject keeps the reason", opts, async () => {
  const row = await submit({ channel: "sms", message: SMS, country: "US", language: "en",
    classify: async () => ({ family: "delivery", brand: "USPS", lure: "a parcel could not be delivered", ask: "a small fee on a link", language: "en", country: "US" }) });
  const bad = await approveSubmission(row.id, { family: "nope" });
  assert.ok(bad.errors.includes("unknown family nope"), "a bad override is refused with the reason");
  assert.equal((await submissionStatus(row.id)).status, "pending", "and nothing changed");
  const { entry } = await approveSubmission(row.id, { brand: "USPS (United States Postal Service)", lure: "your parcel could not be delivered" });
  const lib = await getLibrary();
  assert.deepEqual(validateEntry(entry, lib), []);
  assert.match(entry.id, /^lib-\d{8}-[0-9a-f]{6}$/);
  assert.deepEqual([entry.family, entry.brand, entry.lure, entry.ask, entry.country, entry.language, entry.channel, entry.status, entry.verdict],
    ["delivery", "USPS (United States Postal Service)", "your parcel could not be delivered", "a small fee on a link", "US", "en", "sms", "published", null]);
  assert.equal(entry.source.id, "prudence-submissions");
  assert.equal(entry.first_seen, new Date().toISOString().slice(0, 10));
  assert.deepEqual(entry.message, { ...SMS }, "the redacted message as stored");
  assert.ok(lib.entries.some((e) => e.id === entry.id), "served at once");
  assert.deepEqual(await submissionStatus(row.id), { id: row.id, status: "approved", reason: null, entryId: entry.id });
  assert.deepEqual(await approveSubmission(row.id), { errors: ["submission is approved"] }, "only once");
  assert.equal(await approveSubmission("00000000-0000-0000-0000-000000000000"), null);

  const other = await submit({ channel: "email", message: { body: "Dear Customer, your account will be closed unless you confirm your details on the link today." } });
  assert.equal(await rejectSubmission(other.id, "no link, nothing to learn"), true);
  assert.deepEqual(await submissionStatus(other.id), { id: other.id, status: "rejected", reason: "no link, nothing to learn", entryId: null });
  assert.equal(await rejectSubmission("00000000-0000-0000-0000-000000000000", "x"), false);
  const { submissions, counts } = await listSubmissions();
  assert.deepEqual(counts, { pending: 3, approved: 1, rejected: 1 }, "the three pending rows of the tests above, the approved one, the rejected one");
  assert.ok(submissions.every((s) => !("user_id" in s) && !("submitter_hash" in s)), "the console never sees who");
  assert.equal(submissions[0].status, "pending", "pending first");
  const missingFamily = await submit({ channel: "letter", message: { body: "A letter says a parcel waits at the depot and a fee is due by card over the phone." } });
  assert.ok((await approveSubmission(missingFamily.id)).errors.some((e) => /family/.test(e)), "no proposal and no override: the family is missing");
});

test("sharedCounts and withdrawShared follow one senior's rows", opts, async () => {
  const { makeUser } = await import("./helpers/db.js");
  const linda = await makeUser({ email: "linda-lib@example.test" });
  const carol = await makeUser({ email: "carol-lib@example.test" });
  const verdict = { verdict: "scam", headline: "This is not your bank.", reasons: ["The link is not on chase.com.", "A bank never asks for codes."] };
  const a = await submit({ channel: "sms", message: { from: "+1 555-013-0177", body: "Chase fraud alert: did you send $1,250? Reply NO then move your money to the safe account." }, userId: linda.id, fromApp: true, verdict });
  assert.deepEqual([a.from_app, a.user_id, a.verdict], [true, linda.id, verdict]);
  await submit({ channel: "email", message: { body: "Your Social Security benefits are suspended, call this number now to restore them." }, userId: linda.id, fromApp: true, verdict });
  await submit({ channel: "email", message: { body: "Hi Grandma, I changed my number, send $300 today and I will explain later." }, userId: carol.id, fromApp: true, verdict });
  await approveSubmission(a.id, { family: "bank", brand: "Chase", lure: "a fraud alert", ask: "move the money to a safe account" });
  assert.deepEqual(await sharedCounts(linda.id), { count: 2, pending: 1, approved: 1 });
  assert.deepEqual(await withdrawShared(linda.id), { withdrawn: 1 });
  assert.deepEqual(await sharedCounts(linda.id), { count: 2, pending: 0, approved: 1 }, "the approved one is published already");
  assert.deepEqual(await sharedCounts(carol.id), { count: 1, pending: 1, approved: 0 }, "Carol's row is untouched");
  assert.deepEqual(await withdrawShared(linda.id), { withdrawn: 0 });
  await pool.query("DELETE FROM users WHERE id = $1", [linda.id]);
  assert.equal((await one("SELECT user_id FROM library_submissions WHERE id = $1", [a.id])).user_id, null, "the account goes, the published entry stays anonymous");
});
