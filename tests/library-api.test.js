// The public scam library over Postgres and HTTP: the seed entries, the
// submissions store (redaction, duplicates, Muse Spark's proposal, approve
// and reject), then the public API, the senior's share endpoints and the
// admin queue through Fastify's inject. Needs Postgres; skipped without it.
import { pool, resetDb, makeUser, sessionFor, dbAvailable } from "./helpers/db.js";
import { test, before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { one, many } from "../src/db/pool.js";
import { buildApp } from "../src/server.js";
import { config } from "../src/config.js";
import { runRetention } from "../src/jobs/retention.js";
import { submitterHashOf } from "../src/routes/db.js";
import { getProvider } from "../lib/llm/index.js";
import { loadLibraryFiles, validateEntry, bodyHash } from "../lib/library.js";
import { classifyExample, CLASSIFY_SCHEMA } from "../lib/libraryMuse.js";
import { getLibrary, submit, submissionStatus, listSubmissions, approveSubmission, rejectSubmission, sharedCounts, withdrawShared } from "../src/library/store.js";

const load = async (p) => JSON.parse(await readFile(new URL(`../${p}`, import.meta.url), "utf8"));
const ORIGIN = "http://localhost:3999";
const hasDb = await dbAvailable();
const opts = { skip: hasDb ? false : "Postgres test database not available" };
let app;

// The families the seed maps the demo cases to (scripts/library-seed.mjs).
const SEED_FAMILIES = ["utility", "bank", "delivery", "toll-fine", "government", "tech-support", "renewal", "sextortion",
  "family-emergency", "health", "account", "recovery", "romance", "new-number", "investment", "job"];

before(async () => {
  if (!hasDb) return;
  await resetDb();
  app = await buildApp({ logger: false });
});
after(async () => { await app?.close(); await pool.end(); });
beforeEach(() => { delete process.env.LLM_PROVIDER; getProvider("mock").reset(); });

const get = (url, headers = {}) => app.inject({ url, headers });
const post = (url, payload, headers = {}, remoteAddress = undefined) => app.inject({ method: "POST", url, headers: { origin: ORIGIN, ...headers }, payload, remoteAddress });

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

  const again = await submit({ channel: "email", message: { body: body.toUpperCase() }, submitterHash: "abc" });
  assert.deepEqual(again, { duplicate: true, entryId: null, submissionId: row.id }, "the same words again from the same address: the pending one");
  const someoneElse = await submit({ channel: "email", message: { body: body.toUpperCase() }, submitterHash: "def" });
  assert.deepEqual(someoneElse, { duplicate: true, entryId: null, submissionId: null }, "another address learns no id");
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
  assert.deepEqual(await approveSubmission(row.id), { errors: ["submission is approved"], decided: true }, "only once");
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

// ------------------------------------------------------------- HTTP ---

test("about and families answer with the operator, the licence and the counts", opts, async () => {
  const about = await get("/api/public/about");
  assert.equal(about.statusCode, 200);
  const a = about.json();
  assert.equal(a.operator, config.publicDb.operator);
  assert.equal(a.contact, "https://github.com/hadrienbaradel/scam-shield/issues");
  assert.equal(a.licence, "CC BY 4.0");
  assert.equal(a.repo, "https://github.com/hadrienbaradel/scam-shield");
  assert.ok(a.counts.entries >= 31 && a.counts.families === 21);
  const { families } = (await get("/api/public/families")).json();
  assert.equal(families.length, 21);
  assert.equal(families.reduce((n, f) => n + f.count, 0), a.counts.entries, "the counts add up");
  const delivery = families.find((f) => f.id === "delivery");
  assert.ok(delivery.count >= 2 && delivery.name.fr === "Colis et livraison" && delivery.refs.ic3 === "Phishing/Spoofing");
});

test("the list filters and pages, newest first; the detail carries the brand's cards; the export carries the licence", opts, async () => {
  const all = (await get("/api/public/library")).json();
  assert.deepEqual([all.page, all.pageSize], [1, 50]);
  assert.ok(all.total >= 31 && all.entries.length === Math.min(all.total, 50));
  for (let i = 1; i < all.entries.length; i++) assert.ok(all.entries[i - 1].first_seen >= all.entries[i].first_seen, "newest first_seen first");
  const delivery = (await get("/api/public/library?family=delivery&channel=sms")).json();
  assert.ok(delivery.total >= 2 && delivery.entries.every((e) => e.family === "delivery" && e.channel === "sms"));
  const fr = (await get("/api/public/library?country=fr&language=fr&q=chronopost")).json();
  assert.ok(fr.entries.some((e) => e.id === "lib-demo-a4") && fr.entries.every((e) => e.country === "FR"));
  const page2 = (await get("/api/public/library?page=2")).json();
  assert.deepEqual([page2.page, page2.total, page2.entries.length], [2, all.total, Math.max(0, all.total - 50)]);
  assert.equal((await get("/api/public/library?page=zero")).json().page, 1, "a bad page is the first");

  assert.equal((await get("/api/public/library/lib-nope")).statusCode, 404);
  assert.deepEqual((await get("/api/public/library/lib-nope")).json(), { error: "unknown entry" });
  const a3b = (await get("/api/public/library/lib-demo-a3b")).json();
  assert.equal(a3b.entry.brand, "Bouygues Telecom");
  assert.ok(a3b.cards.some((c) => c.id === "fr-iban-debit-6990"), "the active card that impersonates the same brand");
  assert.ok(a3b.cards.every((c) => c.status === "active"));
  const b6 = (await get("/api/public/library/lib-demo-b6")).json();
  assert.deepEqual(b6.cards, [], "no brand, no cards");
  assert.deepEqual((await get("/api/public/library/lib-demo-a4")).json().indicators, { domains: [], senders: [], phones: ["+337550199"] }, "the server's indicators: the number, never the .test site");
  assert.deepEqual((await get("/api/public/library/lib-demo-c8")).json().indicators, { domains: [], senders: [], phones: [] }, "a Be careful entry names nobody");
  assert.deepEqual((await get("/api/public/library/lib-demo-a6")).json().indicators.phones, [], "a share capital is not a phone number");
  const { cards } = (await get("/api/public/cards")).json();
  assert.ok(cards.length >= 1 && cards.every((c) => c.status === "active"));

  const res = await get("/api/public/library.json");
  assert.equal(res.statusCode, 200);
  assert.equal(res.headers["cache-control"], "public, max-age=60");
  assert.match(res.headers["content-type"], /application\/json/);
  const file = res.json();
  assert.equal(file.licence, "CC BY 4.0");
  assert.equal(file.entries.length, all.total);
  assert.ok(file.sources.some((s) => s.id === "prudence-demo") && file.families.length === 21);
  assert.equal((await get("/api/public/library.json")).json().generated, file.generated, "one string per cache, not a serialisation per hit");
  // 30 downloads a minute per address: the 31st is refused, another address goes on.
  let last;
  for (let i = 0; i < 31; i++) last = await app.inject({ url: "/api/public/library.json", remoteAddress: "10.0.0.31" });
  assert.equal(last.statusCode, 429);
  assert.equal((await app.inject({ url: "/api/public/library.json", remoteAddress: "10.0.0.32" })).statusCode, 200);
});

test("submit: 202 then pending, 400 on a bad body, 409 on a duplicate, stored as text and redacted", opts, async () => {
  const body = { channel: "email", message: { from: "billing@amazon-prime-renewal.net", subject: "Prime renewal failed", body: "Your Prime renewal of $139 failed. Update your card at https://amazon-prime-renewal.net/pay within 24 hours.", links: [{ text: "Update", href: "https://amazon-prime-renewal.net/pay" }] }, country: "us", language: "en", note: "received today" };
  const res = await post("/api/public/library/submit", body);
  assert.equal(res.statusCode, 202, res.body);
  const { id, status, statusUrl } = res.json();
  assert.equal(status, "pending");
  assert.equal(statusUrl, `/api/public/library/submit/${id}`);
  assert.deepEqual((await get(statusUrl)).json(), { id, status: "pending", reason: null, entryId: null });
  assert.equal((await get("/api/public/library/submit/not-a-uuid")).statusCode, 404);
  assert.equal((await get("/api/public/library/submit/00000000-0000-0000-0000-000000000000")).statusCode, 404);
  const row = await one("SELECT * FROM library_submissions WHERE id = $1", [id]);
  assert.deepEqual([row.country, row.language, row.note, row.from_app, row.user_id], ["US", "en", "received today", false, null]);
  assert.equal(row.submitter_hash, submitterHashOf("127.0.0.1"), "the address keyed-hashed with TOKEN_ENC_KEY, never kept");
  assert.notEqual(row.submitter_hash, createHash("sha256").update("127.0.0.1").digest("hex"), "not a plain hash anyone can walk back");

  assert.equal((await post("/api/public/library/submit", { ...body, message: { body: "Hello" } })).statusCode, 400);
  assert.match((await post("/api/public/library/submit", { ...body, message: { body: "Hello" } })).json().error, /20 to 10,000 characters/);
  assert.match((await post("/api/public/library/submit", { ...body, channel: "fax" })).json().error, /channel/);
  assert.equal((await post("/api/public/library/submit", "not json", { "content-type": "text/plain" })).statusCode, 400);
  assert.equal((await app.inject({ method: "POST", url: "/api/public/library/submit", payload: body })).statusCode, 403, "no Origin, no post");

  const again = await post("/api/public/library/submit", { ...body, message: { body: body.message.body.toUpperCase() } });
  assert.equal(again.statusCode, 409);
  assert.deepEqual(again.json(), { error: "This message was already submitted and waits for a reviewer.", entryId: null, submissionId: id }, "the same address gets its own id back");
  const elsewhere = await post("/api/public/library/submit", { ...body, message: { body: body.message.body.toUpperCase() } }, {}, "10.0.0.7");
  assert.equal(elsewhere.statusCode, 409);
  assert.deepEqual(elsewhere.json(), { error: "This message was already submitted and waits for a reviewer.", entryId: null }, "another address learns no id");
  const seed = (await get("/api/public/library/lib-demo-d1")).json().entry;
  const copy = await post("/api/public/library/submit", { channel: "sms", message: { body: seed.message.body } });
  assert.equal(copy.statusCode, 409);
  assert.deepEqual(copy.json(), { error: "This message is already in the library.", entryId: "lib-demo-d1" }, "an entry's id is public anyway");

  const html = await post("/api/public/library/submit", { channel: "sms", message: { body: "Click <script>alert(1)</script> to claim your <b>prize</b> today" } });
  assert.equal(html.statusCode, 202);
  const htmlRow = await one("SELECT message FROM library_submissions WHERE id = $1", [html.json().id]);
  assert.equal(htmlRow.message.body, "Click <script>alert(1)</script> to claim your <b>prize</b> today", "stored as text; escaping is the page's job");
  const iban = await post("/api/public/library/submit", { channel: "email", message: { body: "Un prélèvement de 69,90 € sera effectué sur votre compte FR76 3000 6000 0112 3456 7890 189 demain." } });
  const ibanRow = await one("SELECT message FROM library_submissions WHERE id = $1", [iban.json().id]);
  assert.equal(ibanRow.message.body, "Un prélèvement de 69,90 € sera effectué sur votre compte [bank account number] demain.");
});

test("submit: Muse Spark's proposal is stored when a model is configured", opts, async () => {
  process.env.LLM_PROVIDER = "mock";
  const mock = getProvider("mock");
  mock.script({ family: "toll-fine", brand: "E-ZPass", lure: "an unpaid toll", ask: "pay on a link today", language: "en", country: "US" });
  const res = await post("/api/public/library/submit", { channel: "sms", message: { body: "E-ZPass: unpaid toll of $6.50. Pay today at https://ezpass-toll-pay.net/x to avoid a $50 late fee." } });
  assert.equal(res.statusCode, 202, res.body);
  const row = await one("SELECT proposed FROM library_submissions WHERE id = $1", [res.json().id]);
  assert.deepEqual(row.proposed, { family: "toll-fine", brand: "E-ZPass", lure: "an unpaid toll", ask: "pay on a link today", language: "en", country: "US" });
  assert.equal(mock.calls.length, 1);
  // The tenth submission from this address in a minute (the test above made nine): the eleventh is refused.
  const eleventh = await post("/api/public/library/submit", { channel: "sms", message: { body: "One more text message about a parcel waiting at the depot for a fee." } });
  assert.equal(eleventh.statusCode, 429, "10 a minute per address");
  assert.equal((await post("/api/public/library/submit", { channel: "sms", message: { body: "One more text message about a parcel waiting at the depot for a fee." } }, {}, "10.0.0.2")).statusCode, 202, "another address goes on");
});

test("the senior's share: signed in only, counted and withdrawn per person", opts, async () => {
  const body = { channel: "sms", message: { from: "+1 555-013-0161", body: "Hi Grandma Linda, it's Ethan. I changed my number, this is my new one. Can you send $300 today?" },
    verdict: { verdict: "be_careful", confidence: 0.8, headline: "Be careful: this may not be Ethan.", reasons: [{ text: "A new number that asks for money at once.", evidence: "pattern" }], action: "verify_with_real_person" } };
  assert.equal((await post("/api/library/share", body)).statusCode, 401);
  assert.equal((await get("/api/library/shared")).statusCode, 401);
  const senior = await makeUser({ email: "share-lib@example.test", locale: "fr-FR" });
  const headers = { cookie: await sessionFor(senior) };
  const res = await post("/api/library/share", body, headers);
  assert.equal(res.statusCode, 202, res.body);
  const { id } = res.json();
  const row = await one("SELECT * FROM library_submissions WHERE id = $1", [id]);
  assert.deepEqual([row.from_app, row.user_id, row.country, row.language], [true, senior.id, "FR", "fr"], "her locale fills the country and language");
  assert.equal(row.message.body, "Hi Grandma [name], it's Ethan. I changed my number, this is my new one. Can you send $300 today?", "her name goes, the impostor's stays");
  assert.deepEqual(row.verdict, { verdict: "be_careful", headline: "Be careful: this may not be Ethan.", reasons: ["A new number that asks for money at once."] }, "the verdict reduced to its lines");
  assert.equal((await post("/api/library/share", body, headers)).statusCode, 409, "the same message twice");
  assert.equal((await post("/api/library/share", { channel: "sms", message: { body: "short" } }, headers)).statusCode, 400);
  const spoofed = await post("/api/library/share", { channel: "email", message: { from: senior.email, subject: "I filmed you", body: "I filmed you through your webcam. Your old password is: sunshine42. Pay $1,500 in Bitcoin in 48 hours." }, verdict: body.verdict }, headers);
  assert.equal(spoofed.statusCode, 202, spoofed.body);
  const spoofedRow = await one("SELECT message FROM library_submissions WHERE id = $1", [spoofed.json().id]);
  assert.equal(spoofedRow.message.from, "[someone]@example.test", "her own address as the sender is nobody's");
  assert.ok(spoofedRow.message.body.includes("password is: [password]"), "the quoted password goes");
  assert.deepEqual((await get("/api/library/shared", headers)).json(), { count: 2, pending: 2, approved: 0 });
  assert.deepEqual((await post("/api/library/shared/withdraw", {}, headers)).json(), { withdrawn: 2 });
  assert.equal((await get(`/api/public/library/submit/${id}`)).json().status, "withdrawn");
  assert.deepEqual((await get("/api/library/shared", headers)).json(), { count: 2, pending: 0, approved: 0 });
  const withdrawn = await one("SELECT message, note, proposed, submitter_hash FROM library_submissions WHERE id = $1", [id]);
  assert.deepEqual([withdrawn.message, withdrawn.note, withdrawn.proposed, withdrawn.submitter_hash], [{}, null, null, null], "withdrawn means her message is gone from the row");
});

test("the admin queue: admins only, approve publishes a valid entry at once, reject keeps the reason", opts, async () => {
  const admin = await makeUser({ email: "admin@example.test", name: "Vlad" });
  const adminHeaders = { cookie: await sessionFor(admin) };
  const senior = await makeUser({ email: "not-admin-lib@example.test" });
  assert.equal((await get("/api/admin/db/submissions")).statusCode, 401);
  assert.equal((await get("/api/admin/db/submissions", { cookie: await sessionFor(senior) })).statusCode, 403);

  const sub = await post("/api/public/library/submit", { channel: "email", message: { from: "claims@recovery-law-fees.net", subject: "We can recover your lost money", body: "Our law firm can recover money you lost to scams. Pay an upfront fee of $850 today by wire transfer and we start your case." } }, {}, "10.0.0.3");
  assert.equal(sub.statusCode, 202, sub.body);
  const id = sub.json().id;
  const list = (await get("/api/admin/db/submissions", adminHeaders)).json();
  assert.ok(list.submissions.some((s) => s.id === id && s.status === "pending" && s.message.body.includes("$850")), "the reviewer reads the redacted message");
  assert.ok(list.counts.pending >= 1 && "approved" in list.counts && "rejected" in list.counts);
  assert.ok(list.submissions.every((s) => !("user_id" in s) && !("submitter_hash" in s)));
  assert.deepEqual(list.submissions.find((s) => s.id === id).warnings, [], "no name in this one");
  const named = (await post("/api/public/library/submit", { channel: "email", message: { subject: "Hi Linda", body: "Dear Linda, your parcel waits at the depot, pay the fee on the link today please." } }, {}, "10.0.0.3")).json().id;
  const namedRow = (await get("/api/admin/db/submissions", adminHeaders)).json().submissions.find((s) => s.id === named);
  assert.deepEqual([namedRow.proposed, namedRow.warnings], [{ may_carry_name: true }, ["may carry a name: Linda"]], "the reviewer is told which word to read twice");

  assert.equal((await post(`/api/admin/db/submissions/${id}/approve`, { family: "nope" }, adminHeaders)).statusCode, 400);
  assert.match((await post(`/api/admin/db/submissions/${id}/approve`, {}, adminHeaders)).json().error, /family/, "no family proposed, none given");
  const ok = await post(`/api/admin/db/submissions/${id}/approve`, { family: "recovery", brand: null, lure: "a law firm recovers lost money", ask: "wire an upfront fee", country: "US", language: "en" }, adminHeaders);
  assert.equal(ok.statusCode, 200, ok.body);
  const { entry } = ok.json();
  assert.deepEqual([entry.family, entry.brand, entry.lure, entry.country, entry.source.id, entry.status], ["recovery", null, "a law firm recovers lost money", "US", "prudence-submissions", "published"]);
  assert.equal((await get(`/api/public/library/${entry.id}`)).statusCode, 200, "served at once");
  assert.equal((await get(`/api/public/library/submit/${id}`)).json().entryId, entry.id, "the submitter is told");
  assert.equal((await one("SELECT submitter_hash FROM library_submissions WHERE id = $1", [id])).submitter_hash, null, "the submitter's hash goes with the decision");
  assert.equal((await post(`/api/admin/db/submissions/${id}/approve`, {}, adminHeaders)).statusCode, 409, "decided already");
  assert.equal((await post("/api/admin/db/submissions/not-a-uuid/approve", {}, adminHeaders)).statusCode, 404);
  assert.equal((await post(`/api/admin/db/submissions/${id}/approve`, {}, { cookie: await sessionFor(senior) })).statusCode, 403);

  const other = (await post("/api/public/library/submit", { channel: "letter", message: { body: "A letter says a prize of 5,000 euros waits, call the number and pay the release fee." } }, {}, "10.0.0.3")).json().id;
  assert.equal((await post(`/api/admin/db/submissions/${other}/reject`, {}, adminHeaders)).statusCode, 400, "a reason is needed");
  assert.deepEqual((await post(`/api/admin/db/submissions/${other}/reject`, { reason: "no sender, no number: nothing to learn" }, adminHeaders)).json(), { ok: true });
  assert.deepEqual((await get(`/api/public/library/submit/${other}`)).json(), { id: other, status: "rejected", reason: "no sender, no number: nothing to learn", entryId: null });
  const rejected = await one("SELECT message, note, proposed, submitter_hash, body_hash FROM library_submissions WHERE id = $1", [other]);
  assert.deepEqual([rejected.message, rejected.note, rejected.proposed, rejected.submitter_hash], [{}, null, null, null], "a rejected row keeps nothing of the message");
  assert.match(rejected.body_hash, /^[0-9a-f]{64}$/, "but its hash, for the duplicate rule");
  assert.equal((await post(`/api/admin/db/submissions/${other}/reject`, { reason: "again" }, adminHeaders)).statusCode, 404, "decided already");
});

test("the public site is served at /public/, apart from the senior's app", opts, async () => {
  const index = await get("/public/");
  assert.equal(index.statusCode, 200);
  assert.match(index.headers["content-type"], /text\/html/);
  assert.match(index.body, /<title>Prudence scam database<\/title>/);
  const js = await get("/public/db.js");
  assert.equal(js.statusCode, 200);
  assert.match(js.headers["content-type"], /javascript/);
  assert.equal((await get("/public/nothing-here.js")).statusCode, 404);
  assert.equal((await get("/public/../package.json")).statusCode, 404, "no way out of the folder");
  assert.match((await get("/public/")).headers["content-security-policy"], /script-src 'self'/, "the same strict CSP");
});

test("retention: decided submissions go after 30 days, unreviewed ones after 180, dead watch items after 90", opts, async () => {
  const sub = async (body, patch) => {
    const row = await submit({ channel: "sms", message: { body } });
    if (patch) await pool.query(`UPDATE library_submissions SET ${patch} WHERE id = $1`, [row.id]);
    return row.id;
  };
  const oldRejected = await sub("Retention one: a parcel waits at the depot, pay the fee on the link today.", "status = 'rejected', decided_at = now() - interval '31 days'");
  const freshRejected = await sub("Retention two: a parcel waits at the depot, pay the fee on the link today.", "status = 'rejected', decided_at = now() - interval '29 days'");
  const oldWithdrawn = await sub("Retention three: a parcel waits at the depot, pay the fee on the link today.", "status = 'withdrawn', decided_at = now() - interval '40 days'");
  const stalePending = await sub("Retention four: a parcel waits at the depot, pay the fee on the link today.", "created_at = now() - interval '181 days'");
  const freshPending = await sub("Retention five: a parcel waits at the depot, pay the fee on the link today.", "created_at = now() - interval '179 days'");
  const oldApproved = await sub("Retention six: a parcel waits at the depot, pay the fee on the link today.", "status = 'approved', decided_at = now() - interval '400 days'");
  const watch = async (patch) => (await one(`INSERT INTO watch_items (source, url, title, kind, status, fetched_at, decided_at) VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id`,
    [patch.source || "krebs", `https://watch.example/${Math.random()}`, "An item", patch.kind ?? "technique", patch.status ?? "candidate", patch.fetched, patch.decided ?? null])).id;
  const oldRejectedItem = await watch({ status: "rejected", fetched: new Date(Date.now() - 100 * 86400000), decided: new Date(Date.now() - 91 * 86400000) });
  const freshRejectedItem = await watch({ status: "rejected", fetched: new Date(Date.now() - 100 * 86400000), decided: new Date(Date.now() - 10 * 86400000) });
  const oldOther = await watch({ kind: "other", fetched: new Date(Date.now() - 91 * 86400000) });
  const oldApprovedBreach = await watch({ kind: "breach", status: "approved", fetched: new Date(Date.now() - 200 * 86400000), decided: new Date(Date.now() - 200 * 86400000) });
  const oldCandidate = await watch({ kind: "technique", fetched: new Date(Date.now() - 200 * 86400000) });

  const counts = await runRetention();
  assert.equal(counts.librarySubmissions, 3, "the old rejected, the old withdrawn and the stale pending rows");
  assert.equal(counts.watchItems, 2, "the old rejected item and the old 'other' item");
  const left = new Set((await many("SELECT id FROM library_submissions")).map((r) => r.id));
  assert.ok(!left.has(oldRejected) && !left.has(oldWithdrawn) && !left.has(stalePending));
  assert.ok(left.has(freshRejected) && left.has(freshPending) && left.has(oldApproved), "a fresh decision, a recent pending row and a published entry stay");
  const items = new Set((await many("SELECT id FROM watch_items")).map((r) => r.id));
  assert.ok(!items.has(oldRejectedItem) && !items.has(oldOther));
  assert.ok(items.has(freshRejectedItem) && items.has(oldApprovedBreach) && items.has(oldCandidate), "a fresh rejection, an approved breach and an unreviewed candidate stay");
});
