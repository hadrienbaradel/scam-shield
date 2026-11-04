// Early access (_product/specs/landing-page.md, line 6): the pure part first
// (the address as stored, whose it is, the language, the plain line for a
// malformed request), then the routes over Postgres through Fastify's
// inject: a request is stored once, a duplicate gets the same answer and
// stores nothing more, a malformed address is refused in plain words, 10 a
// minute from one place, the console's list and "Mark added" are admins
// only, and retention deletes a request 90 days after it was marked added.
// The Postgres parts skip without a database.
import "./helpers/env.js";
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { parseRequest, normalizeEmail, languageOf } from "../src/routes/earlyAccess.js";
import { pool, resetDb, makeUser, sessionFor, dbAvailable } from "./helpers/db.js";
import { one, many } from "../src/db/pool.js";
import { buildApp } from "../src/server.js";
import { runRetention } from "../src/jobs/retention.js";

// ---------------------------------------------------------------- pure ---

test("the address is stored lower-cased and trimmed; a malformed one is refused", () => {
  assert.equal(normalizeEmail("  Linda.Smith@Gmail.COM "), "linda.smith@gmail.com");
  assert.equal(normalizeEmail("linda+prudence@googlemail.com"), "linda+prudence@googlemail.com");
  assert.equal(normalizeEmail("Mary-Jo.O'Brien_2@mail.example.co.uk"), "mary-jo.o'brien_2@mail.example.co.uk", "letters, digits and . _ + ' - pass");
  for (const bad of ["", "   ", "linda", "linda@", "@gmail.com", "linda gmail.com", "linda@gmail", "linda@@gmail.com", "linda smith@gmail.com",
    "<linda@gmail.com>", "linda@gmail.c", "linda@-gmail.com", `${"a".repeat(250)}@gmail.com`, null, undefined, 42, { email: "x@y.com" },
    "linda?cc=boss@gmail.com", "linda&bcc=x@gmail.com", "linda=x@gmail.com", "linda%0abcc@gmail.com", "a/b@gmail.com", "linda!@gmail.com",
    "linda@gmail.com?subject=hi", "linda@gmail.com%0D%0Abcc:x@evil.test", "linda@gmail_com.com", "linda@gmail.com.", "élodie@gmail.com"]) {
    assert.equal(normalizeEmail(bad), null, `${JSON.stringify(bad)} is not an address`);
  }
});

test("the language is the page's primary tag, or nothing", () => {
  assert.equal(languageOf("fr"), "fr");
  assert.equal(languageOf("fr-FR"), "fr");
  assert.equal(languageOf("EN_us"), "en");
  assert.equal(languageOf(""), null);
  assert.equal(languageOf("français"), null);
  assert.equal(languageOf(undefined), null);
});

test("a request needs an address and whose it is; the name and the note are optional; the line is in the page's language", () => {
  assert.deepEqual(parseRequest({ email: " Linda@Gmail.com", whose: "parent", name: "  Linda ", note: " She clicks on everything ", language: "en" }),
    { request: { email: "linda@gmail.com", whose: "parent", name: "Linda", note: "She clicks on everything", language: "en" } });
  assert.deepEqual(parseRequest({ email: "me@gmail.com", whose: "MINE" }), { request: { email: "me@gmail.com", whose: "mine", name: null, note: null, language: null } });
  assert.equal(parseRequest({ email: "me@gmail.com", whose: "mine", name: "x".repeat(300), note: "y".repeat(3000) }).request.name.length, 100, "a name is cut at 100 characters");
  assert.equal(parseRequest({ email: "me@gmail.com", whose: "mine", note: "y".repeat(3000) }).request.note.length, 1000, "a note at 1000");

  assert.equal(parseRequest(null).field, "body");
  assert.equal(parseRequest("email=linda@gmail.com").field, "body");
  const bad = parseRequest({ email: "linda@gmail", whose: "parent" });
  assert.equal(bad.field, "email");
  assert.match(bad.error, /does not look like an email address/);
  assert.equal(parseRequest({ email: "linda@gmail.com" }).field, "whose");
  assert.match(parseRequest({ email: "linda@gmail.com", whose: "neighbour" }).error, /your parent's or yours/);
  assert.match(parseRequest({ email: "linda@gmail", whose: "parent", language: "fr-FR" }).error, /ne semble pas correcte/, "a French page gets a French line");
  assert.match(parseRequest({ email: "linda@gmail.com", language: "fr" }).error, /à votre parent ou à vous/);
  assert.match(parseRequest({ email: "linda@gmail", whose: "parent", language: "de" }).error, /does not look like/, "another language gets English");
});

// ------------------------------------------------------------- the routes ---

const ORIGIN = "http://localhost:3999";
const hasDb = await dbAvailable();
const opts = { skip: hasDb ? false : "Postgres test database not available" };
let app;
before(async () => { if (!hasDb) return; await resetDb(); app = await buildApp({ logger: false }); });
after(async () => { await app?.close(); await pool.end(); });

const get = (url, headers = {}) => app.inject({ url, headers });
const post = (url, payload, headers = {}, remoteAddress = undefined) => app.inject({ method: "POST", url, headers: { origin: ORIGIN, ...headers }, payload, remoteAddress });
const count = async () => (await one("SELECT count(*)::int AS n FROM early_access_requests")).n;
const REQUEST = { email: "  Linda.Parent@Gmail.com ", whose: "parent", name: "Linda", note: "She is 78 and banks with Chase.", language: "en" };

test("a request is stored without a session and answers ok with the address; the server mails nobody", opts, async () => {
  await pool.query("TRUNCATE early_access_requests, outbox");
  const res = await post("/api/early-access", REQUEST, {}, "10.1.0.1");
  assert.equal(res.statusCode, 200, res.body);
  assert.deepEqual(res.json(), { ok: true, email: "linda.parent@gmail.com" });
  const row = await one("SELECT * FROM early_access_requests");
  assert.deepEqual([row.email, row.whose, row.name, row.note, row.language, row.status, row.added_at],
    ["linda.parent@gmail.com", "parent", "Linda", "She is 78 and banks with Chase.", "en", "open", null]);
  assert.ok(row.created_at instanceof Date);
  assert.equal((await one("SELECT count(*)::int AS n FROM outbox")).n, 0, "nothing mailed, not even to the local outbox");

  const mine = await post("/api/early-access", { email: "thomas@gmail.com", whose: "mine" }, {}, "10.1.0.1");
  assert.deepEqual(mine.json(), { ok: true, email: "thomas@gmail.com" });
  assert.deepEqual(await one("SELECT whose, name, note, language FROM early_access_requests WHERE email = 'thomas@gmail.com'"), { whose: "mine", name: null, note: null, language: null });

  const form = await post("/api/early-access", "email=francoise%40gmail.com&whose=parent&language=fr", { "content-type": "application/x-www-form-urlencoded" }, "10.1.0.1");
  assert.deepEqual(form.json(), { ok: true, email: "francoise@gmail.com" }, "a plain form post works too");
  assert.equal((await one("SELECT language FROM early_access_requests WHERE email = 'francoise@gmail.com'")).language, "fr");

  assert.equal((await app.inject({ method: "POST", url: "/api/early-access", payload: REQUEST })).statusCode, 403, "no Origin, no post");
});

test("a second request for the same address gets the same answer and stores nothing more", opts, async () => {
  await pool.query("TRUNCATE early_access_requests");
  const first = await post("/api/early-access", REQUEST, {}, "10.1.1.1");
  const before = await one("SELECT * FROM early_access_requests");
  const again = await post("/api/early-access", { email: "LINDA.PARENT@gmail.com", whose: "mine", name: "Someone else", note: "Changed my mind", language: "fr" }, {}, "10.1.1.2");
  assert.equal(again.statusCode, first.statusCode);
  assert.equal(again.body, first.body, "the same line, byte for byte");
  assert.equal(await count(), 1, "one row for one address");
  assert.deepEqual(await one("SELECT * FROM early_access_requests"), before, "the first request is kept as it was");
});

test("a malformed address is refused with a plain line and stores nothing", opts, async () => {
  await pool.query("TRUNCATE early_access_requests");
  for (const [i, email] of ["linda@gmail", "linda", "", "linda smith@gmail.com"].entries()) {
    const res = await post("/api/early-access", { ...REQUEST, email }, {}, `10.1.2.${i + 1}`);
    assert.equal(res.statusCode, 400, `${email}: ${res.body}`);
    assert.deepEqual(res.json(), { field: "email", error: "That does not look like an email address. Check it and try again, for example linda@gmail.com." });
  }
  const fr = await post("/api/early-access", { ...REQUEST, email: "linda@", language: "fr" }, {}, "10.1.2.9");
  assert.equal(fr.statusCode, 400);
  assert.match(fr.json().error, /ne semble pas correcte/);
  const whose = await post("/api/early-access", { ...REQUEST, whose: "" }, {}, "10.1.2.10");
  assert.deepEqual([whose.statusCode, whose.json().field], [400, "whose"]);
  const text = await post("/api/early-access", "linda@gmail.com", { "content-type": "text/plain" }, "10.1.2.11");
  assert.deepEqual([text.statusCode, text.json().field], [400, "body"]);
  assert.equal(await count(), 0);
});

test("an address carrying ?, &, =, % or / is refused with 400, so nothing a mailto link could read is ever stored", opts, async () => {
  await pool.query("TRUNCATE early_access_requests");
  for (const [i, email] of ["linda?cc=boss@gmail.com", "linda%0abcc@gmail.com", "linda&bcc=x@gmail.com", "linda=x@gmail.com", "a/b@gmail.com", "linda@gmail.com?subject=hi"].entries()) {
    const res = await post("/api/early-access", { email, whose: "parent" }, {}, `10.1.5.${i + 1}`);
    assert.equal(res.statusCode, 400, `${email}: ${res.body}`);
    assert.equal(res.json().field, "email");
  }
  assert.equal(await count(), 0);
});

test("10 requests a minute from one place, then 429; another place goes on", opts, async () => {
  await pool.query("TRUNCATE early_access_requests");
  for (let i = 0; i < 10; i++) {
    assert.equal((await post("/api/early-access", { email: `rate${i}@gmail.com`, whose: "parent" }, {}, "10.1.3.1")).statusCode, 200, `request ${i + 1}`);
  }
  const limited = await post("/api/early-access", { email: "rate10@gmail.com", whose: "parent" }, {}, "10.1.3.1");
  assert.equal(limited.statusCode, 429, "the 11th within the minute");
  assert.equal((await post("/api/early-access", { email: "rate11@gmail.com", whose: "parent" }, {}, "10.1.3.2")).statusCode, 200, "another place goes on");
  assert.equal(await count(), 11, "the limited request stored nothing");
});

test("the console's list and Mark added are admins only; newest first with the counts; Mark added keeps its first date", opts, async () => {
  await pool.query("TRUNCATE early_access_requests");
  const admin = await makeUser({ email: "admin@example.test", name: "Vlad" });
  const adminHeaders = { cookie: await sessionFor(admin) };
  const senior = await makeUser({ email: "not-admin-early@example.test" });
  const seniorHeaders = { cookie: await sessionFor(senior) };

  await post("/api/early-access", REQUEST, {}, "10.1.4.1");
  await pool.query("UPDATE early_access_requests SET created_at = now() - interval '1 hour'");
  await post("/api/early-access", { email: "thomas@gmail.com", whose: "mine", name: "<b>Thomas</b>", note: "<script>alert(1)</script>", language: "fr" }, {}, "10.1.4.1");

  assert.equal((await get("/api/admin/early-access")).statusCode, 401);
  assert.equal((await get("/api/admin/early-access", seniorHeaders)).statusCode, 403);
  const res = await get("/api/admin/early-access", adminHeaders);
  assert.equal(res.statusCode, 200, res.body);
  const { requests, counts } = res.json();
  assert.deepEqual(counts, { open: 2, added: 0 });
  assert.deepEqual(requests.map((r) => r.email), ["thomas@gmail.com", "linda.parent@gmail.com"], "newest first");
  assert.deepEqual(Object.keys(requests[0]).sort(), ["added_at", "created_at", "email", "id", "language", "name", "note", "status", "whose"]);
  assert.deepEqual([requests[0].whose, requests[0].name, requests[0].note, requests[0].language, requests[0].status, requests[0].added_at],
    ["mine", "<b>Thomas</b>", "<script>alert(1)</script>", "fr", "open", null], "stored as text; escaping is the page's job");

  const linda = requests[1].id;
  assert.equal((await app.inject({ method: "POST", url: `/api/admin/early-access/${linda}/added`, headers: { origin: ORIGIN } })).statusCode, 401);
  assert.equal((await post(`/api/admin/early-access/${linda}/added`, {}, seniorHeaders)).statusCode, 403);
  assert.equal((await one("SELECT status FROM early_access_requests WHERE id = $1", [linda])).status, "open", "a refused click changes nothing");

  const added = await post(`/api/admin/early-access/${linda}/added`, {}, adminHeaders);
  assert.equal(added.statusCode, 200, added.body);
  const { ok, id, status, addedAt } = added.json();
  assert.deepEqual([ok, id, status], [true, linda, "added"]);
  assert.ok(addedAt);
  const again = await post(`/api/admin/early-access/${linda}/added`, {}, adminHeaders);
  assert.equal(again.statusCode, 200);
  assert.equal(again.json().addedAt, addedAt, "a second click keeps the first date");
  const after = (await get("/api/admin/early-access", adminHeaders)).json();
  assert.deepEqual(after.counts, { open: 1, added: 1 });
  assert.deepEqual(after.requests.find((r) => r.id === linda).status, "added");

  assert.equal((await post("/api/admin/early-access/not-a-uuid/added", {}, adminHeaders)).statusCode, 404);
  assert.equal((await post("/api/admin/early-access/00000000-0000-0000-0000-000000000000/added", {}, adminHeaders)).statusCode, 404);
});

test("retention deletes a request 90 days after it was marked added and keeps the open ones, however old", opts, async () => {
  await pool.query("TRUNCATE early_access_requests");
  const row = async (email, status, addedDaysAgo, createdDaysAgo = 200) => (await one(
    `INSERT INTO early_access_requests (email, whose, status, created_at, added_at)
     VALUES ($1, 'parent', $2, now() - make_interval(days => $4), CASE WHEN $3::int IS NULL THEN NULL ELSE now() - make_interval(days => $3::int) END) RETURNING id`,
    [email, status, addedDaysAgo, createdDaysAgo])).id;
  const oldAdded = await row("old-added@gmail.com", "added", 91);
  const freshAdded = await row("fresh-added@gmail.com", "added", 89);
  const oldOpen = await row("old-open@gmail.com", "open", null, 400);
  const freshOpen = await row("fresh-open@gmail.com", "open", null, 1);

  const counts = await runRetention();
  assert.equal(counts.earlyAccess, 1, "the one added 91 days ago");
  const left = new Set((await many("SELECT id FROM early_access_requests")).map((r) => r.id));
  assert.ok(!left.has(oldAdded));
  assert.ok(left.has(freshAdded) && left.has(oldOpen) && left.has(freshOpen), "added 89 days ago, and open ones of any age, stay");
});
