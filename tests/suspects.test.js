// The suspect list (_product/specs/public-database.md, lines 6 and 7): the
// pure part first (one indicator out of whatever was typed, the lookup
// with its age weights, the phone match on the last 9 digits, what a
// contest does to a listing), then the routes over Postgres through
// Fastify's inject: the public lookup, the notice with its four elements,
// the status of a notice, the admin queue and its decisions. The Postgres
// parts skip without a database.
import "./helpers/env.js";
import { test } from "node:test";
import assert from "node:assert/strict";
import { normalizeIndicator, lookupSuspect, phoneKey, sameIndicator, ageWeight, AGE_WEIGHTS, INDICATOR_KINDS, CONTEST_STATUSES } from "../lib/suspects.js";
import { loadLibraryFiles } from "../lib/library.js";

const NOW = new Date("2026-11-04T12:00:00Z");
const daysAgo = (n) => new Date(NOW - n * 86400000).toISOString().slice(0, 10);
const SOURCE = { id: "prudence-demo", url: null, licence: "CC BY 4.0", attribution: "Prudence demo cases" };
const VERDICT = { verdict: "scam", headline: "Not your bank.", reasons: ["The link is not the bank's."] };
const entry = (id, over = {}) => ({
  id, family: "bank", channel: "email", country: "US", language: "en", brand: "Chase", lure: "a fraud alert", ask: "verify on a link",
  message: { from: "Alerts@Secure-Chase-Login.com", subject: null, body: "Chase: unusual sign-in. Verify at https://www.secure-chase-login.com/verify or call +1 555-013-0199 now.", links: [{ text: "verify", href: "https://secure-chase-login.com/verify" }] },
  first_seen: daysAgo(10), last_seen: daysAgo(10), source: SOURCE, verdict: VERDICT, status: "published", ...over,
});

// ---------------------------------------------------------------- pure ---

test("normalizeIndicator: a website from a pasted URL, an address lowercased, a number as digits, nothing for what is reserved or not an indicator", () => {
  assert.deepEqual(INDICATOR_KINDS, ["domain", "email", "phone"]);
  assert.deepEqual(CONTEST_STATUSES, ["open", "upheld", "dismissed"]);
  assert.deepEqual(normalizeIndicator("https://www.Secure-Chase-Login.com/verify?x=1"), { kind: "domain", value: "secure-chase-login.com" });
  assert.deepEqual(normalizeIndicator("  www.Secure-Chase-Login.com:8443/verify#top "), { kind: "domain", value: "secure-chase-login.com" }, "no scheme: still a website, port and path dropped");
  assert.deepEqual(normalizeIndicator("http://user:pw@secure-chase-login.com/"), { kind: "domain", value: "secure-chase-login.com" }, "a URL with credentials is a website, not an address");
  assert.deepEqual(normalizeIndicator("xn--bcher-kva.de"), { kind: "domain", value: "xn--bcher-kva.de" }, "punycode left as is");
  assert.deepEqual(normalizeIndicator("bücher.de"), { kind: "domain", value: "xn--bcher-kva.de" }, "an IDN compares in its punycode form, as the entries' hosts do");
  assert.deepEqual(normalizeIndicator("8.8.8.8"), { kind: "domain", value: "8.8.8.8" });
  assert.deepEqual(normalizeIndicator("Alerts@Secure-Chase-Login.com"), { kind: "email", value: "alerts@secure-chase-login.com" });
  assert.deepEqual(normalizeIndicator("mailto:Alerts@Secure-Chase-Login.com"), { kind: "email", value: "alerts@secure-chase-login.com" });
  assert.deepEqual(normalizeIndicator("<alerts@secure-chase-login.com>"), { kind: "email", value: "alerts@secure-chase-login.com" });
  assert.deepEqual(normalizeIndicator("+33 6 12 34 56 78"), { kind: "phone", value: "+33612345678" });
  assert.deepEqual(normalizeIndicator("0612345678"), { kind: "phone", value: "0612345678" });
  assert.deepEqual(normalizeIndicator("06.12.34.56.78"), { kind: "phone", value: "0612345678" });
  assert.deepEqual(normalizeIndicator("tel:+1 (555) 013-0199"), { kind: "phone", value: "+15550130199" });
  for (const [a, b] of [["+33 6 12 34 56 78", "0612345678"], ["0612345678", "06.12.34.56.78"], ["+33 (0)6 12 34 56 78", "0612345678"]]) {
    assert.ok(sameIndicator(normalizeIndicator(a), normalizeIndicator(b)), `${a} and ${b} are one number`);
  }
  assert.equal(phoneKey("+33612345678"), "612345678");
  assert.equal(sameIndicator(normalizeIndicator("0612345678"), normalizeIndicator("0612345679")), false);
  assert.equal(sameIndicator(normalizeIndicator("0612345678"), normalizeIndicator("secure-chase-login.com")), false, "a kind never matches another");
  assert.equal(sameIndicator(null, normalizeIndicator("0612345678")), false);
  assert.equal(normalizeIndicator("contestation-bouygues.test"), null, "reserved");
  assert.equal(normalizeIndicator("service@contestation-bouygues.test"), null, "a reserved host's address");
  assert.equal(normalizeIndicator("[someone]@gmail.com"), null, "a redacted placeholder is nobody");
  assert.equal(normalizeIndicator("http://192.168.1.10/login"), null, "a private IP");
  assert.equal(normalizeIndicator("http://[::1]/"), null);
  assert.equal(normalizeIndicator(""), null);
  assert.equal(normalizeIndicator("   "), null);
  assert.equal(normalizeIndicator(null), null);
  assert.equal(normalizeIndicator("chase"), null, "a bare word is not a website");
  assert.equal(normalizeIndicator("hello world"), null);
  assert.equal(normalizeIndicator("not an@address"), null);
  assert.equal(normalizeIndicator("123"), null, "too short for a number, not a website");
  assert.equal(normalizeIndicator("12345678901234567"), null, "too long for a number");
  assert.equal(normalizeIndicator("-bad-.com"), null, "not a hostname");
});

test("ageWeight: 1 within 90 days, 0.5 within a year, 0.25 after; whole days; a bad date is old", () => {
  assert.deepEqual(AGE_WEIGHTS, [[90, 1], [365, 0.5], [Infinity, 0.25]]);
  assert.equal(ageWeight(daysAgo(0), NOW), 1);
  assert.equal(ageWeight(daysAgo(90), NOW), 1, "90 days ago at midnight, now at noon: still within 90 days");
  assert.equal(ageWeight(daysAgo(91), NOW), 0.5);
  assert.equal(ageWeight(daysAgo(365), NOW), 0.5);
  assert.equal(ageWeight(daysAgo(366), NOW), 0.25);
  assert.equal(ageWeight("2020-01-01", NOW), 0.25);
  assert.equal(ageWeight(daysAgo(-5), NOW), 1, "a date ahead of the clock counts as fresh");
  assert.equal(ageWeight("not a date", NOW), 0.25);
  assert.equal(ageWeight(undefined, NOW), 0.25);
});

test("lookupSuspect: the entries that used the indicator, reports and weight by age, first and last seen; a website, an address and a number written three ways", () => {
  const entries = [
    entry("lib-a"),
    entry("lib-b", { first_seen: daysAgo(200), last_seen: daysAgo(200), channel: "sms", country: "FR", brand: null, message: { from: "alerts@secure-chase-login.com", body: "Your account is locked, call 555 013 0199 today." } }),
    entry("lib-c", { message: { from: "support@other-bank-help.com", body: "Dear Customer, confirm your card at https://other-bank-help.com/x" } }),
  ];
  const out = lookupSuspect(entries, "Alerts@Secure-Chase-Login.com", { now: NOW });
  assert.deepEqual(out.indicator, { kind: "email", value: "alerts@secure-chase-login.com" });
  assert.deepEqual([out.reports, out.weight, out.firstSeen, out.lastSeen, out.contested, out.removed, out.removedAt], [2, 1.5, daysAgo(200), daysAgo(10), false, false, null]);
  assert.deepEqual(out.entries, [
    { id: "lib-a", family: "bank", channel: "email", country: "US", brand: "Chase", first_seen: daysAgo(10), last_seen: daysAgo(10) },
    { id: "lib-b", family: "bank", channel: "sms", country: "FR", brand: null, first_seen: daysAgo(200), last_seen: daysAgo(200) },
  ], "newest first, the fields the table shows and nothing of the message");

  const site = lookupSuspect(entries, "https://www.secure-chase-login.com/verify?x=1", { now: NOW });
  assert.deepEqual([site.indicator.value, site.reports, site.weight, site.entries.map((e) => e.id)], ["secure-chase-login.com", 1, 1, ["lib-a"]], "the link's host and the URL in the body are one website");
  assert.deepEqual(lookupSuspect(entries, "other-bank-help.com", { now: NOW }).entries.map((e) => e.id), ["lib-c"], "a URL in the body alone");
  for (const written of ["+1 555-013-0199", "555.013.0199", "(555) 013-0199", "15550130199"]) {
    const phone = lookupSuspect(entries, written, { now: NOW });
    assert.deepEqual([phone.indicator.kind, phone.reports, phone.weight], ["phone", 2, 1.5], `${written}: the sender's number and the number in a body, one number`);
  }
  assert.equal(lookupSuspect(entries, "+1 555-013-0100", { now: NOW }).reports, 0, "another number");
  const old = lookupSuspect([entry("lib-old", { last_seen: daysAgo(400) }), entry("lib-mid", { last_seen: daysAgo(100) })], "secure-chase-login.com", { now: NOW });
  assert.deepEqual([old.reports, old.weight], [2, 0.75]);
  assert.deepEqual(lookupSuspect(entries, "nobody@nowhere-at-all.com", { now: NOW }),
    { indicator: { kind: "email", value: "nobody@nowhere-at-all.com" }, reports: 0, weight: 0, firstSeen: null, lastSeen: null, contested: false, removed: false, removedAt: null, entries: [] }, "nothing reported: an empty listing, never a verdict");
  assert.equal(lookupSuspect(entries, "chronopost-colis.test", { now: NOW }), null, "a reserved host is no indicator");
  assert.equal(lookupSuspect(entries, "", { now: NOW }), null);
  assert.equal(lookupSuspect([entry("lib-x", { status: "retired" })], "secure-chase-login.com", { now: NOW }).reports, 0, "a retired entry is evidence no more");
  assert.equal(lookupSuspect([entry("lib-y", { verdict: { ...VERDICT, verdict: "be_careful" } }), null], "secure-chase-login.com", { now: NOW }).reports, 0, "a Be careful entry accuses nobody");
  assert.equal(lookupSuspect([entry("lib-z", { verdict: null })], "secure-chase-login.com", { now: NOW }).reports, 1, "an entry without a verdict (a corpus sample) counts");
  assert.equal(lookupSuspect([entry("lib-w", { last_seen: "2026-13-45" })], "secure-chase-login.com", { now: NOW }).weight, 0.25);
});

test("a contest marks the listing contested while open and removes it when upheld; a dismissed one changes nothing", () => {
  const entries = [entry("lib-a"), entry("lib-b", { last_seen: daysAgo(200) })];
  const open = { indicator_kind: "email", indicator: "alerts@secure-chase-login.com", status: "open", decided_at: null };
  const contested = lookupSuspect(entries, "alerts@secure-chase-login.com", { now: NOW, contests: [open] });
  assert.deepEqual([contested.contested, contested.removed, contested.reports, contested.weight], [true, false, 2, 1.5], "contested at once, the count stays until a decision");
  const upheld = { indicator_kind: "email", indicator: "alerts@secure-chase-login.com", status: "upheld", decided_at: "2026-11-03T10:00:00.000Z" };
  const removed = lookupSuspect(entries, "ALERTS@secure-chase-login.com", { now: NOW, contests: [upheld, { ...upheld, decided_at: "2026-11-01T10:00:00.000Z" }] });
  assert.deepEqual([removed.contested, removed.removed, removed.removedAt, removed.reports, removed.weight, removed.firstSeen, removed.lastSeen, removed.entries],
    [false, true, "2026-11-03T10:00:00.000Z", 0, 0, null, null, []], "removed: the latest decision's date, no count, no entries");
  const dismissed = lookupSuspect(entries, "alerts@secure-chase-login.com", { now: NOW, contests: [{ ...open, status: "dismissed", decided_at: "2026-11-02T10:00:00.000Z" }] });
  assert.deepEqual([dismissed.contested, dismissed.removed, dismissed.reports], [false, false, 2]);
  const other = lookupSuspect(entries, "alerts@secure-chase-login.com", { now: NOW, contests: [{ ...open, indicator: "other@secure-chase-login.com" }, { ...open, indicator_kind: "domain", indicator: "secure-chase-login.com" }] });
  assert.deepEqual([other.contested, other.removed], [false, false], "a contest on another address or on the website is not one on this address");
  const phone = lookupSuspect(entries, "555-013-0199", { now: NOW, contests: [{ kind: "phone", value: "+15550130199", status: "open" }] });
  assert.equal(phone.contested, true, "a number's contest matches on the last 9 digits, rows given as kind and value too");
  const both = lookupSuspect(entries, "alerts@secure-chase-login.com", { now: NOW, contests: [open, upheld] });
  assert.deepEqual([both.contested, both.removed], [true, true], "an open contest on a removed listing is still shown as such");
});

test("the seed: a website two demo entries used is reported twice; a number two entries used is one number however it is written", async () => {
  const { entries } = await loadLibraryFiles();
  const site = lookupSuspect(entries, "https://calendar.adecco-hrjobs.com/x", { now: NOW });
  assert.equal(site.reports, 2, "lib-demo-a8 and a9 share it");
  assert.deepEqual(site.entries.map((e) => e.id).sort(), ["lib-demo-a8", "lib-demo-a9"]);
  assert.ok(site.weight > 0 && site.firstSeen <= site.lastSeen);
  const number = lookupSuspect(entries, "1.555.0177", { now: NOW });
  assert.ok(number.reports >= 2, `+1 555-0177 is the sender of two demo cases: ${number.reports}`);
  assert.equal(lookupSuspect(entries, "messaging-service@post.xero.com", { now: NOW }).reports, 0, "a real sending platform's address is no suspect");
  assert.equal(lookupSuspect(entries, "chronopost-colis.test", { now: NOW }), null, "the demo's .test hosts are never listed");
});

// ------------------------------------------------------------- the routes ---
import { before, after } from "node:test";
import { pool, resetDb, makeUser, sessionFor, dbAvailable } from "./helpers/db.js";
import { one } from "../src/db/pool.js";
import { buildApp } from "../src/server.js";

const ORIGIN = "http://localhost:3999";
const hasDb = await dbAvailable();
const opts = { skip: hasDb ? false : "Postgres test database not available" };
let app;
before(async () => { if (!hasDb) return; await resetDb(); app = await buildApp({ logger: false }); });
after(async () => { await app?.close(); await pool.end(); });

const get = (url, headers = {}) => app.inject({ url, headers });
const post = (url, payload, headers = {}, remoteAddress = undefined) => app.inject({ method: "POST", url, headers: { origin: ORIGIN, ...headers }, payload, remoteAddress });
const NOTICE = { indicator: "calendar.adecco-hrjobs.com", name: "Jean Dupont", email: "jean@adecco-hrjobs.com",
  url: "http://localhost:3999/public/#/suspects?q=calendar.adecco-hrjobs.com", reason: "Our calendar host was abused in August; it has been cleaned since.", goodFaith: true };

test("the public lookup: 400 without a usable q, the seed's website and number with their entries, nothing for an unknown address", opts, async () => {
  assert.equal((await get("/api/public/suspects")).statusCode, 400);
  assert.match((await get("/api/public/suspects?q=%20")).json().error, /website, a sender address or a phone number/);
  assert.equal((await get("/api/public/suspects?q=chase")).statusCode, 400, "a bare word");
  assert.match((await get("/api/public/suspects?q=chronopost-colis.test")).json().error, /reserved and private addresses never are/);
  const site = await get(`/api/public/suspects?q=${encodeURIComponent("https://calendar.adecco-hrjobs.com/x")}`);
  assert.equal(site.statusCode, 200, site.body);
  const s = site.json();
  assert.deepEqual([s.indicator, s.reports, s.contested, s.removed, s.removedAt], [{ kind: "domain", value: "calendar.adecco-hrjobs.com" }, 2, false, false, null]);
  assert.ok(s.weight > 0 && s.firstSeen <= s.lastSeen, "weighted by age against today's clock");
  assert.deepEqual(Object.keys(s.entries[0]).sort(), ["brand", "channel", "country", "family", "first_seen", "id", "last_seen"], "the table's fields, never the message");
  const number = (await get(`/api/public/suspects?q=${encodeURIComponent("+1 (555) 0177")}`)).json();
  assert.ok(number.reports >= 2, `the sender of two demo cases: ${number.reports}`);
  const none = (await get("/api/public/suspects?q=nobody@nowhere-at-all.com")).json();
  assert.deepEqual([none.reports, none.weight, none.firstSeen, none.entries], [0, 0, null, []], "nothing reported: no verdict, no entry");
});

test("a notice: each missing element is named, no Origin no post, 202 with an id and a status URL, the listing contested at once, nothing to contest when nothing is listed, 5 a minute from one place", opts, async () => {
  const cases = [
    ["not json", "body", /JSON notice/],
    [{ ...NOTICE, indicator: "" }, "indicator", /website, address or number it is about/],
    [{ ...NOTICE, indicator: "chase" }, "indicator", /not a website/],
    [{ ...NOTICE, name: " " }, "name", /your name/],
    [{ ...NOTICE, email: "" }, "email", /email address/],
    [{ ...NOTICE, email: "not-an-address" }, "email", /does not look like an address/],
    [{ ...NOTICE, url: "" }, "url", /URL of the listing/],
    [{ ...NOTICE, reason: "   " }, "reason", /reason/],
    [{ ...NOTICE, goodFaith: "yes" }, "goodFaith", /good-faith statement/],
    [{ ...NOTICE, goodFaith: false }, "goodFaith", /good-faith statement/],
  ];
  for (const [i, [payload, missing, re]] of cases.entries()) {
    const res = await post("/api/public/suspects/contest", payload, typeof payload === "string" ? { "content-type": "text/plain" } : {}, `10.0.1.${i + 1}`);
    assert.equal(res.statusCode, 400, `${missing}: ${res.body}`);
    assert.equal(res.json().missing, missing);
    assert.match(res.json().error, re);
  }
  assert.equal((await app.inject({ method: "POST", url: "/api/public/suspects/contest", payload: NOTICE })).statusCode, 403, "no Origin, no post");
  assert.equal((await one("SELECT count(*)::int AS n FROM suspect_contests")).n, 0, "nothing stored so far");

  const res = await post("/api/public/suspects/contest", NOTICE, {}, "10.0.2.1");
  assert.equal(res.statusCode, 202, res.body);
  const { id, status, statusUrl } = res.json();
  assert.equal(status, "open");
  assert.equal(statusUrl, `/api/public/suspects/contest/${id}`);
  const row = await one("SELECT * FROM suspect_contests WHERE id = $1", [id]);
  assert.deepEqual([row.indicator_kind, row.indicator, row.name, row.email, row.url, row.reason, row.good_faith, row.status, row.decision, row.decided_at],
    ["domain", "calendar.adecco-hrjobs.com", "Jean Dupont", "jean@adecco-hrjobs.com", NOTICE.url, NOTICE.reason, true, "open", null, null]);
  const listing = (await get("/api/public/suspects?q=CALENDAR.adecco-hrjobs.com")).json();
  assert.deepEqual([listing.contested, listing.removed, listing.reports], [true, false, 2], "contested at once; the count stays until a decision");
  const st = await get(statusUrl);
  assert.equal(st.statusCode, 200);
  assert.deepEqual(st.json(), { id, status: "open", decision: null, createdAt: row.created_at.toISOString(), decidedAt: null }, "the status, never the notice");
  assert.equal((await get("/api/public/suspects/contest/not-a-uuid")).statusCode, 404);
  assert.equal((await get("/api/public/suspects/contest/00000000-0000-0000-0000-000000000000")).statusCode, 404);

  const nothing = await post("/api/public/suspects/contest", { ...NOTICE, indicator: "nobody@nowhere-at-all.com" }, {}, "10.0.2.2");
  assert.equal(nothing.statusCode, 400);
  assert.deepEqual([nothing.json().missing, /Nothing is listed/.test(nothing.json().error)], ["listing", true]);

  const phone = await post("/api/public/suspects/contest", { ...NOTICE, indicator: "+1 (555) 0177" }, {}, "10.0.2.3");
  assert.equal(phone.statusCode, 202, phone.body);
  assert.deepEqual(await one("SELECT indicator_kind, indicator FROM suspect_contests WHERE id = $1", [phone.json().id]), { indicator_kind: "phone", indicator: "+15550177" }, "stored normalised");
  assert.equal((await get(`/api/public/suspects?q=${encodeURIComponent("1.555.0177")}`)).json().contested, true, "found on its last 9 digits however it is written");

  for (let i = 0; i < 5; i++) assert.equal((await post("/api/public/suspects/contest", NOTICE, {}, "10.0.3.1")).statusCode, 202);
  assert.equal((await post("/api/public/suspects/contest", NOTICE, {}, "10.0.3.1")).statusCode, 429, "5 a minute from one place");
  assert.equal((await post("/api/public/suspects/contest", NOTICE, {}, "10.0.3.2")).statusCode, 202, "another place goes on");
});

test("the admin queue: admins only, open first with counts, a decision needs a status and a text, Dismiss keeps the listing, Uphold removes it, each once", opts, async () => {
  await pool.query("TRUNCATE suspect_contests");
  const admin = await makeUser({ email: "admin@example.test", name: "Vlad" });
  const adminHeaders = { cookie: await sessionFor(admin) };
  const senior = await makeUser({ email: "not-admin-suspects@example.test" });
  const seniorHeaders = { cookie: await sessionFor(senior) };
  assert.equal((await get("/api/admin/db/contests")).statusCode, 401);
  assert.equal((await get("/api/admin/db/contests", seniorHeaders)).statusCode, 403);

  const first = (await post("/api/public/suspects/contest", NOTICE, {}, "10.0.5.1")).json().id;
  const second = (await post("/api/public/suspects/contest", { ...NOTICE, indicator: "+1 555-0177", name: "<b>Pat</b>", reason: "<script>alert(1)</script> it is my own number, spoofed" }, {}, "10.0.5.2")).json().id;
  const list = (await get("/api/admin/db/contests", adminHeaders)).json();
  assert.deepEqual(list.counts, { open: 2, upheld: 0, dismissed: 0 });
  assert.deepEqual(list.contests.map((c) => c.id), [second, first], "open ones newest first");
  const c2 = list.contests[0];
  assert.deepEqual([c2.indicator_kind, c2.indicator, c2.name, c2.email, c2.url, c2.reason, c2.good_faith, c2.status],
    ["phone", "+15550177", "<b>Pat</b>", NOTICE.email, NOTICE.url, "<script>alert(1)</script> it is my own number, spoofed", true, "open"], "the reviewer reads the notice; stored as text, escaping is the page's job");

  assert.equal((await post(`/api/admin/db/contests/${first}/decide`, { status: "nope", decision: "x" }, adminHeaders)).statusCode, 400);
  assert.match((await post(`/api/admin/db/contests/${first}/decide`, { status: "dismissed" }, adminHeaders)).json().error, /decision text/);
  assert.equal((await post(`/api/admin/db/contests/${first}/decide`, { status: "dismissed", decision: "x" }, seniorHeaders)).statusCode, 403);
  assert.deepEqual((await post(`/api/admin/db/contests/${first}/decide`, { status: "dismissed", decision: "Two entries from August and September name this host with their dates; the listing stays." }, adminHeaders)).json(), { ok: true });
  const site = (await get("/api/public/suspects?q=calendar.adecco-hrjobs.com")).json();
  assert.deepEqual([site.contested, site.removed, site.reports], [false, false, 2], "dismissed: the listing stays, contested no more");
  const st = (await get(`/api/public/suspects/contest/${first}`)).json();
  assert.equal(st.status, "dismissed");
  assert.match(st.decision, /listing stays/);
  assert.ok(st.decidedAt, "the person who contested reads the decision and its reason");
  assert.equal((await post(`/api/admin/db/contests/${first}/decide`, { status: "upheld", decision: "again" }, adminHeaders)).statusCode, 404, "decided already");

  assert.deepEqual((await post(`/api/admin/db/contests/${second}/decide`, { status: "upheld", decision: "A spoofed number: whoever owns it is a victim too." }, adminHeaders)).json(), { ok: true });
  const number = (await get(`/api/public/suspects?q=${encodeURIComponent("+1 555 0177")}`)).json();
  assert.deepEqual([number.contested, number.removed, number.reports, number.weight, number.entries], [false, true, 0, 0, []], "upheld: removed, no count, no entries");
  assert.ok(number.removedAt);
  const again = await post("/api/public/suspects/contest", { ...NOTICE, indicator: "+1 555-0177" }, {}, "10.0.5.3");
  assert.equal(again.statusCode, 400);
  assert.match(again.json().error, /removed after a contest already/);
  assert.deepEqual((await get("/api/admin/db/contests", adminHeaders)).json().counts, { open: 0, upheld: 1, dismissed: 1 });
  assert.equal((await post("/api/admin/db/contests/not-a-uuid/decide", { status: "upheld", decision: "x" }, adminHeaders)).statusCode, 404);
  assert.equal((await post("/api/admin/db/contests/00000000-0000-0000-0000-000000000000/decide", { status: "upheld", decision: "x" }, adminHeaders)).statusCode, 404);
});
