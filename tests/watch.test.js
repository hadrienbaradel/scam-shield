// The scam watch (_product/specs/public-database.md, lines 8 to 10): the
// pure part first (a HIBP breach turned into watch fields, what makes an
// item important, the one action in both languages), then the daily job
// over fixture feeds with an injected fetch and classifier, the review
// (approve, reject) and the public week, then the routes. The Postgres
// parts skip without a database; nothing here opens the network.
import "./helpers/env.js";
import { test } from "node:test";
import assert from "node:assert/strict";
import { WATCH_KINDS, HIGH_DATA_CLASSES, breachFromHibp, importanceOf, oneActionFor } from "../lib/watch.js";

const NOW = new Date("2026-11-04T12:00:00Z");
const daysAgo = (n) => new Date(NOW - n * 86400000).toISOString();
const HIBP = {
  Name: "AcmeShop", Title: "Acme Shop", Domain: "acme-shop.example", BreachDate: "2026-10-20", AddedDate: daysAgo(3), PwnCount: 2500000,
  DataClasses: ["Email addresses", "Passwords"], IsVerified: true, IsFabricated: false, IsSpamList: false, IsMalware: false, IsStealerLog: false,
  Description: "In October 2026, <a href=\"https://acme-shop.example\">Acme Shop</a> had a breach.",
};

test("a HIBP breach becomes a watch item: the fields a reviewer needs, verified only when every HIBP flag agrees", () => {
  assert.deepEqual(WATCH_KINDS, ["breach", "technique", "other"]);
  assert.ok(HIGH_DATA_CLASSES.includes("Passwords") && HIGH_DATA_CLASSES.includes("Bank account numbers"));
  const item = breachFromHibp(HIBP);
  assert.equal(item.kind, "breach");
  assert.equal(item.title, "Acme Shop");
  assert.equal(item.url, "https://haveibeenpwned.com/PwnedWebsites#AcmeShop");
  assert.equal(item.source, "hibp");
  assert.equal(item.published_at, HIBP.AddedDate);
  assert.deepEqual(item.fields, { org: "Acme Shop", domain: "acme-shop.example", people: 2500000, dataClasses: ["Email addresses", "Passwords"], verified: true,
    breachDate: "2026-10-20", addedDate: HIBP.AddedDate, country: null, sourceKind: "hibp" });
  assert.equal(breachFromHibp({ ...HIBP, IsSpamList: true }).fields.verified, false, "a spam list is not a breach");
  assert.equal(breachFromHibp({ ...HIBP, IsVerified: false }).fields.verified, false);
  assert.equal(breachFromHibp({ ...HIBP, IsStealerLog: true }).fields.verified, false);
});

test("important: a verified breach of 1M+ people or of high-value data added within 30 days; a new technique in the senior's country", () => {
  const big = importanceOf(breachFromHibp(HIBP), { now: NOW });
  assert.equal(big.important, true);
  assert.ok(big.reasons.some((r) => r.includes("2,500,000")), `the count is named: ${big.reasons}`);
  assert.ok(big.reasons.some((r) => r.includes("Passwords")), `the data class is named: ${big.reasons}`);
  // Small and harmless: not important.
  const small = importanceOf(breachFromHibp({ ...HIBP, PwnCount: 1000, DataClasses: ["Email addresses"] }), { now: NOW });
  assert.equal(small.important, false);
  // High-value data makes a small breach important.
  assert.equal(importanceOf(breachFromHibp({ ...HIBP, PwnCount: 1000, DataClasses: ["Email addresses", "Dates of birth"] }), { now: NOW }).important, true);
  // Old news and unverified claims are not.
  assert.equal(importanceOf(breachFromHibp({ ...HIBP, AddedDate: daysAgo(45) }), { now: NOW }).important, false);
  assert.equal(importanceOf(breachFromHibp({ ...HIBP, IsVerified: false }), { now: NOW }).important, false);
  assert.equal(importanceOf(breachFromHibp({ ...HIBP, AddedDate: "not a date" }), { now: NOW }).important, false);
  // Techniques: new and here.
  const technique = (fields) => ({ kind: "technique", fields: { channel: "sms", family: "delivery", novelty: "new", country: "FR", ...fields } });
  const fresh = importanceOf(technique({}), { now: NOW });
  assert.equal(fresh.important, true);
  assert.ok(fresh.reasons.length >= 1);
  assert.equal(importanceOf(technique({ novelty: "variant" }), { now: NOW }).important, false);
  assert.equal(importanceOf(technique({ country: "DE" }), { now: NOW }).important, false);
  assert.equal(importanceOf(technique({ country: null }), { now: NOW }).important, true, "a technique with no country is everyone's");
  assert.equal(importanceOf(technique({ country: "US" }), { now: NOW, countries: ["FR"] }).important, false, "the countries are a parameter");
  // Nothing classified, nothing important.
  assert.deepEqual(importanceOf({ kind: null, fields: null }, { now: NOW }), { important: false, reasons: [] });
  assert.deepEqual(importanceOf({ kind: "other", fields: {} }, { now: NOW }), { important: false, reasons: [] });
});

test("the one action in English and French: passwords, bank or card data, any other leak; a technique's own line or its family's", () => {
  const pw = oneActionFor(breachFromHibp(HIBP));
  assert.match(pw.en, /password/i);
  assert.match(pw.fr, /mot de passe/i);
  assert.match(pw.en, /Acme Shop/);
  const bank = oneActionFor(breachFromHibp({ ...HIBP, DataClasses: ["Email addresses", "Bank account numbers"] }));
  assert.match(bank.en, /bank statement/i);
  assert.match(bank.fr, /relev/i);
  const card = oneActionFor(breachFromHibp({ ...HIBP, DataClasses: ["Credit cards"] }));
  assert.match(card.en, /statement/i);
  const other = oneActionFor(breachFromHibp({ ...HIBP, DataClasses: ["Email addresses", "Names"] }));
  assert.match(other.en, /prove nothing/i);
  assert.match(other.fr, /ne prouve/i);
  // A breach with no data classes at all still gets the generic line.
  assert.match(oneActionFor({ kind: "breach", fields: { org: "Somewhere" } }).en, /prove nothing/i);
  // A technique keeps the classifier's line when it gave both languages.
  const own = { en: "Hang up and call your bank on the number on your card.", fr: "Raccrochez et rappelez votre banque au numéro de votre carte." };
  assert.deepEqual(oneActionFor({ kind: "technique", fields: { family: "bank", one_action: own } }), own);
  // Half a line is no line: the family template answers.
  const half = oneActionFor({ kind: "technique", fields: { family: "delivery", one_action: { en: "Only English", fr: "" } } });
  assert.ok(half.en && half.fr && half.en !== "Only English");
  const delivery = oneActionFor({ kind: "technique", fields: { family: "delivery" } });
  const bankT = oneActionFor({ kind: "technique", fields: { family: "bank" } });
  assert.ok(delivery.en && delivery.fr && bankT.en && bankT.fr);
  assert.notEqual(delivery.en, bankT.en, "each family has its own line");
  const unknown = oneActionFor({ kind: "technique", fields: { family: "something-else" } });
  assert.ok(unknown.en && unknown.fr, "an unknown family gets the general line");
  assert.deepEqual(oneActionFor({ kind: "technique", fields: null }), unknown);
  assert.deepEqual(oneActionFor({ kind: "other", fields: {} }), unknown);
  assert.deepEqual(oneActionFor({ kind: null }), unknown);
});

// ------------------------------------------------------------ the job ---
import { before, after } from "node:test";
import { pool, resetDb, dbAvailable } from "./helpers/db.js";
import { one, many } from "../src/db/pool.js";
import { getProvider } from "../lib/llm/index.js";
import { runScamWatch, WATCH_SOURCES, WATCH_FAMILIES, watchQueue, approveWatchItem, rejectWatchItem, publicWatch } from "../src/jobs/scamwatch.js";
import { JOBS, scamWatchRun, runJob, jobStatus, jobsReport } from "../src/jobs/scheduler.js";
import { classifyWatchItem, CLASSIFY_WATCH_SCHEMA } from "../lib/watchMuse.js";

const hasDb = await dbAvailable();
const opts = { skip: hasDb ? false : "Postgres test database not available" };
before(async () => { if (hasDb) await resetDb(); });
after(async () => { await pool.end(); });

const src = (id) => WATCH_SOURCES.find((s) => s.id === id);
const rss = (items) => `<?xml version="1.0"?><rss><channel><title>Feed</title>${items.map((i) => `<item><title>${i.title}</title><link>${i.url}</link>
  <description><![CDATA[${i.summary || ""}]]></description><pubDate>Tue, 03 Nov 2026 10:00:00 GMT</pubDate></item>`).join("")}</channel></rss>`;
const OLD_BREACH = { ...HIBP, Name: "OldCo", Title: "Old Co", AddedDate: daysAgo(45) };
const MASTODON = [{ url: "https://mastodon.social/@someone/1", content: "<p>New <b>scam</b> doing the rounds: fake parcel texts.</p>", created_at: daysAgo(1) },
  { url: "https://mastodon.social/@someone/2", content: "", created_at: daysAgo(1) }, { content: "<p>no link</p>", created_at: daysAgo(1) }];
// Every feed answers one item of its own; Which? gets two (one about a scam, one not); HIBP a fresh and a stale breach.
function fixtures(over = {}) {
  const bodies = {};
  for (const s of WATCH_SOURCES) {
    if (s.kind === "rss") bodies[s.url] = rss([{ title: `${s.name} alert`, url: `https://example.test/${s.id}/1`, summary: `A new scam seen by ${s.name}.` }]);
  }
  bodies[src("which").url] = rss([{ title: "Scam warning: fake parcel texts", url: "https://example.test/which/scam" }, { title: "Best washing machines", url: "https://example.test/which/washers" }]);
  bodies[src("hibp").url] = JSON.stringify([HIBP, OLD_BREACH]);
  bodies[src("mastodon-scam").url] = JSON.stringify(MASTODON);
  Object.assign(bodies, over);
  const calls = [];
  const fetchImpl = async (url, options) => {
    calls.push({ url, options });
    const body = bodies[url];
    if (body instanceof Error) throw body;
    if (typeof body === "number") return new Response("down", { status: body });
    return new Response(body, { status: 200 });
  };
  return { fetchImpl, calls };
}
const TECHNIQUE = { kind: "technique", fields: { channel: "sms", family: "delivery", brand: "Chronopost", lure: "a parcel is waiting", ask: "pay a redelivery fee", firstSeen: "2026-11-01", novelty: "new", country: "FR", language: "fr" },
  one_action: { en: "Track the parcel on the carrier's own site.", fr: "Suivez le colis sur le site du transporteur." } };
const PRESS_BREACH = { kind: "breach", fields: { org: "Big Retailer", domain: "bigretailer.example", people: 3000000, dataClasses: ["Email addresses", "Phone numbers"], verified: true, breachDate: "2026-10-30", addedDate: null, country: "US" }, one_action: null };
function classifier(answer = TECHNIQUE) {
  const calls = [];
  const classify = async (input) => { calls.push(input); return typeof answer === "function" ? answer(input) : answer; };
  return { classify, calls };
}

test("a run reads every source once: HIBP rows are breaches without the classifier, the others are classified, Which? keeps only scam titles, Mastodon loses its tags, a second run adds nothing", opts, async () => {
  const { fetchImpl, calls } = fixtures();
  const press = classifier((input) => (input.source === "Krebs on Security" ? PRESS_BREACH : TECHNIQUE));
  const report = await runScamWatch({ fetchImpl, classify: press.classify, now: NOW });
  const rssCount = WATCH_SOURCES.filter((s) => s.kind === "rss").length;
  // Fetched: one per RSS feed, plus Which?'s second, plus the fresh breach, plus the two Mastodon posts with a link.
  assert.deepEqual(report, { fetched: rssCount + 1 + 1 + 2, newItems: rssCount + 1 + 1, breaches: 2, techniques: rssCount - 1 + 1, errors: [] });
  assert.equal(calls.length, WATCH_SOURCES.length, "each source fetched once");
  assert.ok(calls.every((c) => c.options.headers["user-agent"].startsWith("ScamShield/1.0") && c.options.signal), "a user agent and a timeout on every fetch");
  const rows = await many("SELECT * FROM watch_items ORDER BY source, url");
  const hibp = rows.filter((r) => r.source === "hibp");
  assert.equal(hibp.length, 1, "the 45-day-old breach is not fetched");
  assert.equal(hibp[0].kind, "breach");
  assert.equal(hibp[0].title, "Acme Shop");
  assert.equal(hibp[0].fields.verified, true);
  assert.equal(hibp[0].important, true);
  assert.ok(hibp[0].importance_reasons.some((r) => r.includes("Passwords")));
  assert.match(hibp[0].one_action.fr, /mot de passe/);
  assert.equal(hibp[0].summary, "In October 2026, Acme Shop had a breach.", "the description is text");
  assert.equal(hibp[0].status, "candidate");
  assert.ok(press.calls.every((c) => c.source !== "Have I Been Pwned"), "HIBP never goes through the model");
  assert.deepEqual(press.calls[0].families, WATCH_FAMILIES);
  assert.ok(press.calls[0].title && press.calls[0].url && typeof press.calls[0].summary === "string");
  const which = rows.filter((r) => r.source === "which");
  assert.deepEqual(which.map((r) => r.title), ["Scam warning: fake parcel texts"]);
  const technique = which[0];
  assert.equal(technique.kind, "technique");
  assert.equal(technique.fields.family, "delivery");
  assert.deepEqual(technique.fields.one_action, TECHNIQUE.one_action, "the classifier's line travels with the fields");
  assert.deepEqual(technique.one_action, TECHNIQUE.one_action);
  assert.equal(technique.important, true, "new, in FR");
  const krebs = rows.find((r) => r.source === "krebs");
  assert.equal(krebs.kind, "breach");
  assert.equal(krebs.fields.sourceKind, "press");
  assert.equal(krebs.fields.addedDate, "2026-11-03", "no date from the model: the item's own date");
  assert.equal(krebs.important, true);
  const toot = rows.filter((r) => r.source === "mastodon-scam");
  assert.equal(toot.length, 1, "an empty post and one without a link are not items");
  assert.ok(!toot[0].summary.includes("<") && toot[0].summary.includes("fake parcel texts"), toot[0].summary);
  assert.equal(toot[0].title, "New scam doing the rounds: fake parcel texts.");
  assert.equal(new Date(toot[0].published_at).toISOString(), daysAgo(1));
  // Again: nothing new, nothing classified twice.
  const before = press.calls.length;
  const again = await runScamWatch({ fetchImpl, classify: press.classify, now: NOW });
  assert.deepEqual(again, { fetched: report.fetched, newItems: 0, breaches: 0, techniques: 0, errors: [] });
  assert.equal(press.calls.length, before);
  // The queue: candidates first, the important ones on top.
  const queue = await watchQueue();
  assert.equal(queue.length, rows.length);
  assert.ok(queue[0].important);
});

test("one feed down, one answering something that is not a feed, one not JSON: each is an error line and the others go on; without a classifier the rows wait for a human", opts, async () => {
  await resetDb();
  const { fetchImpl } = fixtures({ [src("krebs").url]: 500, [src("cisa-news").url]: "<html>Service unavailable</html>", [src("hibp").url]: "not json", [src("therecord").url]: new Error("socket hang up") });
  const report = await runScamWatch({ fetchImpl, classify: null, now: NOW });
  assert.deepEqual(report.errors.sort(), ["cisa-news: not a feed", "krebs: HTTP 500", "therecord: socket hang up", "hibp: Unexpected token 'o', \"not json\" is not valid JSON"].sort());
  assert.equal(report.breaches + report.techniques, 0, "nothing classified");
  assert.ok(report.newItems > 5);
  const rows = await many("SELECT source, kind, status FROM watch_items");
  assert.ok(rows.every((r) => r.kind === null && r.status === "candidate"));
  assert.ok(!rows.some((r) => ["krebs", "cisa-news", "hibp", "therecord"].includes(r.source)));
  const mastodonSlice = fixtures({ [src("mastodon-scam").url]: JSON.stringify({ error: "rate limited" }) });
  const bad = await runScamWatch({ fetchImpl: mastodonSlice.fetchImpl, classify: null, now: NOW });
  assert.deepEqual(bad.errors, ["mastodon-scam: not a list of posts"]);
  const hibpObject = fixtures({ [src("hibp").url]: JSON.stringify({ error: "nope" }) });
  assert.deepEqual((await runScamWatch({ fetchImpl: hibpObject.fetchImpl, classify: null, now: NOW })).errors, ["hibp: not a list of breaches"]);
});

test("a classifier that fails or answers nonsense marks the row error with the reason; an 'other' item gets no action", opts, async () => {
  await resetDb();
  const { fetchImpl } = fixtures();
  let n = 0;
  const flaky = classifier(async (input) => {
    n++;
    if (input.source === "Krebs on Security") throw new Error("model timeout");
    if (input.source === "The Record") return { kind: "other", fields: {}, one_action: null };
    return TECHNIQUE;
  });
  const report = await runScamWatch({ fetchImpl, classify: flaky.classify, now: NOW });
  assert.equal(report.errors.length, 0, "a classifier failure is the row's, not the source's");
  const krebs = await one("SELECT * FROM watch_items WHERE source = 'krebs'");
  assert.equal(krebs.status, "error");
  assert.equal(krebs.error, "model timeout");
  assert.equal(krebs.kind, null);
  const other = await one("SELECT * FROM watch_items WHERE source = 'therecord'");
  assert.equal(other.kind, "other");
  assert.equal(other.status, "candidate");
  assert.equal(other.one_action, null);
  assert.equal(other.important, false);
  assert.ok(n > 2);
});

test("the scam watch job fails when every source failed and notes each source error otherwise", async () => {
  const realFetch = globalThis.fetch;
  const savedErrors = jobStatus.errors;
  const original = console.error;
  const offline = async () => { throw new Error("offline"); };
  const noted = () => jobStatus.errors.map((l) => l.replace(/^\S+ /, "")).sort();
  const linesFor = (sources) => sources.map((s) => `scamwatch: ${s.id}: offline`).sort();
  console.error = () => {};
  jobStatus.errors = [];
  try {
    await assert.rejects(scamWatchRun({ fetchImpl: offline }), (e) => WATCH_SOURCES.every((s) => e.message.includes(`${s.id}: offline`)) && e.noted && e.result?.errors?.length === WATCH_SOURCES.length,
      "the error line names every source and the run keeps its counts");
    assert.deepEqual(noted(), linesFor(WATCH_SOURCES));
    // The registry's job is that run; the global fetch is its default.
    globalThis.fetch = offline;
    jobStatus.errors = [];
    const rows = [];
    const store = { async start(run) { rows.push({ ...run }); return rows.length; }, async end(run) { rows[run.id - 1] = { ...run }; } };
    const failed = await runJob("scamwatch", { store });
    assert.equal(failed.ok, false);
    assert.equal(failed.result.fetched, 0);
    assert.equal(jobsReport({ worker: true }).jobs.find((j) => j.id === "scamwatch").health, "failing");
    assert.deepEqual(noted(), linesFor(WATCH_SOURCES), "not noted a second time");
    // One source answering an empty feed is a partial outage: OK.
    globalThis.fetch = async (url) => (url === src("ic3-csa").url ? new Response("<rss><channel></channel></rss>") : offline());
    jobStatus.errors = [];
    const partial = await runJob("scamwatch", { store });
    assert.equal(partial.ok, true);
    assert.equal(partial.result.errors.length, WATCH_SOURCES.length - 1);
    assert.equal(jobsReport({ worker: true }).jobs.find((j) => j.id === "scamwatch").health, "ok");
    const entry = jobsReport().jobs.find((j) => j.id === "scamwatch");
    assert.equal(entry.schedule, "every 24 h");
    assert.ok(entry.what.includes("Have I Been Pwned"));
  } finally {
    globalThis.fetch = realFetch;
    console.error = original;
    jobStatus.errors = savedErrors;
    JOBS.find((j) => j.id === "scamwatch").lastRun = null;
  }
});

test("approve: a technique becomes a candidate card (watch-<slug>, the source and the link as its sources) unless the threat feed carded that link already; a breach gives no card; reject keeps the reason; the public week lists approved rows only", opts, async () => {
  await resetDb();
  const { fetchImpl } = fixtures();
  await runScamWatch({ fetchImpl, classify: classifier().classify, now: NOW });
  const technique = await one("SELECT * FROM watch_items WHERE source = 'which'");
  const edited = { en: "Open the carrier's app yourself.", fr: "Ouvrez vous-même l'application du transporteur." };
  const approved = await approveWatchItem(technique.id, { one_action: edited });
  assert.equal(approved.cardId, "watch-scam-warning-fake-parcel-texts");
  const card = await one("SELECT * FROM pattern_cards WHERE id = $1", [approved.cardId]);
  assert.equal(card.status, "candidate");
  assert.deepEqual(card.card.sources, ["Which? news", technique.url]);
  assert.deepEqual(card.card.channels, ["sms"]);
  assert.deepEqual(card.card.impersonated_brands, ["Chronopost"]);
  assert.deepEqual(card.card.countries, ["FR"]);
  assert.equal(card.card.lure, "a parcel is waiting");
  assert.equal(card.card.safe_action, edited.en);
  const row = await one("SELECT * FROM watch_items WHERE id = $1", [technique.id]);
  assert.equal(row.status, "approved");
  assert.equal(row.card_id, approved.cardId);
  assert.deepEqual(row.one_action, edited, "the reviewer's wording wins");
  assert.ok(row.decided_at);
  // A half-edited action is ignored: the classifier's line stays.
  const ic3 = await one("SELECT * FROM watch_items WHERE source = 'ic3-csa'");
  await approveWatchItem(ic3.id, { one_action: { en: "only English" } });
  assert.deepEqual((await one("SELECT one_action FROM watch_items WHERE id = $1", [ic3.id])).one_action, TECHNIQUE.one_action);
  // The same card twice (same title) is not inserted twice, and the second approval still says which card.
  const ncsc = await one("SELECT * FROM watch_items WHERE source = 'ncsc-news'");
  await pool.query("UPDATE watch_items SET title = $2 WHERE id = $1", [ncsc.id, technique.title]);
  assert.equal((await approveWatchItem(ncsc.id)).cardId, approved.cardId);
  assert.equal((await one("SELECT count(*)::int AS n FROM pattern_cards WHERE id LIKE 'watch-%'")).n, 2);
  // A link the threat feed already turned into a card gets no second card.
  const cisa = await one("SELECT * FROM watch_items WHERE source = 'cisa-news'");
  await pool.query("INSERT INTO feed_items (source, url, title, status, card_id) VALUES ('ic3-psa', $1, 'same alert', 'carded', 'feed-same-alert')", [cisa.url]);
  assert.deepEqual(await approveWatchItem(cisa.id), { cardId: null });
  assert.equal((await one("SELECT status, card_id FROM watch_items WHERE id = $1", [cisa.id])).status, "approved");
  // A breach is public knowledge, not a card.
  const breach = await one("SELECT * FROM watch_items WHERE source = 'hibp'");
  assert.deepEqual(await approveWatchItem(breach.id), { cardId: null });
  // A technique with no classification fields still makes a card from its title.
  const bare = await one("SELECT * FROM watch_items WHERE source = 'europol-news'");
  await pool.query("UPDATE watch_items SET fields = NULL, one_action = NULL WHERE id = $1", [bare.id]);
  const bareCard = await approveWatchItem(bare.id);
  assert.equal(bareCard.cardId, "watch-europol-news-alert");
  const bareRow = await one("SELECT card FROM pattern_cards WHERE id = $1", [bareCard.cardId]);
  assert.deepEqual(bareRow.card.channels, ["email"]);
  assert.deepEqual(bareRow.card.countries, []);
  assert.equal(bareRow.card.lure, "Europol news alert");
  assert.equal(await approveWatchItem("00000000-0000-0000-0000-000000000000"), null);
  // Reject.
  const krebs = await one("SELECT * FROM watch_items WHERE source = 'krebs'");
  assert.equal(await rejectWatchItem(krebs.id, "a duplicate of the IC3 alert"), true);
  const rejected = await one("SELECT status, reason, decided_at FROM watch_items WHERE id = $1", [krebs.id]);
  assert.equal(rejected.status, "rejected");
  assert.equal(rejected.reason, "a duplicate of the IC3 alert");
  assert.ok(rejected.decided_at);
  assert.equal(await rejectWatchItem("00000000-0000-0000-0000-000000000000", "x"), false);
  // The public week.
  await pool.query("UPDATE watch_items SET decided_at = now() - interval '10 days' WHERE id = $1", [ncsc.id]);
  const week = await publicWatch({ days: 7 });
  assert.deepEqual(week.map((r) => r.source).sort(), ["cisa-news", "europol-news", "hibp", "ic3-csa", "which"]);
  assert.ok(week.every((r) => !("summary" in r) && !("status" in r) && !("error" in r)), "the public gets the item, not the queue");
  const pub = week.find((r) => r.source === "which");
  assert.deepEqual(Object.keys(pub).sort(), ["decided_at", "fields", "id", "important", "kind", "one_action", "published_at", "source", "source_name", "title", "url"]);
  assert.equal(pub.source_name, "Which? news");
  assert.deepEqual(pub.one_action, edited);
  assert.equal((await publicWatch({ days: 30 })).length, 6, "a wider window reaches the older approval");
  assert.ok(Date.parse(week[0].decided_at) >= Date.parse(week[week.length - 1].decided_at), "newest first");
});

// ----------------------------------------------------------- the routes ---
import { makeUser, sessionFor } from "./helpers/db.js";
import { buildApp } from "../src/server.js";

const ORIGIN = "http://localhost:3999";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

test("routes: the public week needs no session and lists approved items only; the review is admins only; approve answers the card id, reject takes a reason, run now is a manual run of the Scam watch job", opts, async () => {
  await resetDb();
  const app = await buildApp({ logger: false });
  const realFetch = globalThis.fetch;
  const scamwatch = JOBS.find((j) => j.id === "scamwatch");
  try {
    const admin = await makeUser({ email: "admin@example.test", name: "Vlad" });
    const adminHeaders = { cookie: await sessionFor(admin), origin: ORIGIN };
    const senior = await makeUser({ email: "linda-watch@example.test" });
    const seniorHeaders = { cookie: await sessionFor(senior), origin: ORIGIN };
    const post = (url, headers, payload = {}) => app.inject({ method: "POST", url, headers, payload });
    await runScamWatch({ fetchImpl: fixtures().fetchImpl, classify: classifier().classify, now: NOW });
    // Nothing approved yet: an empty week, no session needed.
    let res = await app.inject({ url: "/api/public/watch" });
    assert.equal(res.statusCode, 200);
    assert.deepEqual(res.json(), { items: [] });
    // The review needs an admin.
    const which = await one("SELECT id FROM watch_items WHERE source = 'which'");
    assert.equal((await app.inject({ url: "/api/admin/db/watch" })).statusCode, 401);
    assert.equal((await app.inject({ url: "/api/admin/db/watch", headers: seniorHeaders })).statusCode, 403);
    assert.equal((await post(`/api/admin/db/watch/${which.id}/approve`, seniorHeaders)).statusCode, 403);
    assert.equal((await post(`/api/admin/db/watch/${which.id}/reject`, seniorHeaders, { reason: "x" })).statusCode, 403);
    assert.equal((await post("/api/admin/db/watch/run", seniorHeaders)).statusCode, 403);
    assert.equal((await one("SELECT status FROM watch_items WHERE id = $1", [which.id])).status, "candidate", "nothing moved");
    // The queue, the sources and the last run.
    res = await app.inject({ url: "/api/admin/db/watch", headers: adminHeaders });
    assert.equal(res.statusCode, 200);
    const queue = res.json();
    assert.ok(queue.items.length > 10 && queue.items.every((i) => i.status === "candidate"));
    assert.deepEqual(queue.sources.map((s) => s.id), WATCH_SOURCES.map((s) => s.id));
    assert.equal(queue.lastRun, null);
    // Approve with an edited action; a breach gives no card.
    const edited = { en: "Open the carrier's app yourself.", fr: "Ouvrez vous-même l'application du transporteur." };
    res = await post(`/api/admin/db/watch/${which.id}/approve`, adminHeaders, { one_action: edited });
    assert.equal(res.statusCode, 200);
    assert.deepEqual(res.json(), { ok: true, cardId: "watch-scam-warning-fake-parcel-texts" });
    const hibpRow = await one("SELECT id FROM watch_items WHERE source = 'hibp'");
    assert.deepEqual((await post(`/api/admin/db/watch/${hibpRow.id}/approve`, adminHeaders)).json(), { ok: true, cardId: null });
    // Reject with a reason.
    const krebs = await one("SELECT id FROM watch_items WHERE source = 'krebs'");
    assert.deepEqual((await post(`/api/admin/db/watch/${krebs.id}/reject`, adminHeaders, { reason: "not for seniors" })).json(), { ok: true });
    assert.equal((await one("SELECT reason FROM watch_items WHERE id = $1", [krebs.id])).reason, "not for seniors");
    // Unknown and malformed ids.
    assert.equal((await post("/api/admin/db/watch/00000000-0000-0000-0000-000000000000/approve", adminHeaders)).statusCode, 404);
    assert.equal((await post("/api/admin/db/watch/not-a-uuid/approve", adminHeaders)).statusCode, 404);
    assert.equal((await post("/api/admin/db/watch/not-a-uuid/reject", adminHeaders, { reason: "x" })).statusCode, 404);
    // The public week now: the two approved, the reviewer's wording, no summary.
    res = await app.inject({ url: "/api/public/watch?days=7" });
    const { items } = res.json();
    assert.deepEqual(items.map((i) => i.source).sort(), ["hibp", "which"]);
    assert.deepEqual(items.find((i) => i.source === "which").one_action, edited);
    assert.ok(items.every((i) => !("summary" in i) && !("status" in i)));
    assert.equal((await app.inject({ url: "/api/public/watch?days=0" })).json().items.length, 2, "0 reads as the default week");
    assert.equal((await app.inject({ url: "/api/public/watch?days=abc" })).json().items.length, 2);
    assert.equal((await app.inject({ url: "/api/public/watch?days=400" })).json().items.length, 2, "400 reads as the default week");
    assert.equal((await app.inject({ url: "/api/public/watch?days=30" })).json().items.length, 2);
    // Run now: 202, then a job_runs row (the feeds are the fixtures: nothing is new).
    globalThis.fetch = fixtures().fetchImpl;
    res = await post("/api/admin/db/watch/run", adminHeaders);
    assert.equal(res.statusCode, 202);
    assert.deepEqual(res.json(), { started: true, job: "scamwatch" });
    let row = null;
    for (let i = 0; i < 50 && !row?.finished_at; i++) {
      await sleep(100);
      row = await one("SELECT * FROM job_runs WHERE job = 'scamwatch' ORDER BY id DESC LIMIT 1");
    }
    assert.ok(row?.finished_at, "the run finished within 5 s");
    assert.equal(row.ok, true);
    assert.equal(row.trigger, "manual");
    assert.equal(row.result.newItems, 0);
    res = await app.inject({ url: "/api/admin/db/watch", headers: adminHeaders });
    assert.equal(res.json().lastRun.job, "scamwatch");
    assert.equal(res.json().lastRun.trigger, "manual");
    // Refused while one runs.
    scamwatch.running = true;
    assert.equal((await post("/api/admin/db/watch/run", adminHeaders)).statusCode, 409);
  } finally {
    globalThis.fetch = realFetch;
    scamwatch.running = false;
    scamwatch.lastRun = null;
    await app.close();
  }
});

test("the classifier: the mock provider's JSON answer becomes kind, fields and the one action; nonsense is refused; no provider, no classifier", async () => {
  const mock = getProvider("mock").reset();
  delete process.env.LLM_PROVIDER;
  await assert.rejects(classifyWatchItem({ title: "x", summary: "y", url: "https://example.test/x", source: "Test", families: WATCH_FAMILIES }), /needs/);
  process.env.LLM_PROVIDER = "mock";
  try {
    mock.script({ ...TECHNIQUE, fields: { ...TECHNIQUE.fields, surprise: "<script>" } });
    const out = await classifyWatchItem({ title: "Fake parcel texts", summary: "Chronopost texts ask for a fee", url: "https://example.test/x", source: "Which? news", families: WATCH_FAMILIES });
    assert.deepEqual(out, TECHNIQUE, "unknown fields are dropped");
    const call = mock.calls[0];
    assert.equal(call.json.schema, CLASSIFY_WATCH_SCHEMA);
    assert.ok(call.system.includes("delivery") && call.system.includes("recovery"), "the families are in the prompt");
    assert.ok(call.messages[0].content.includes("Fake parcel texts") && call.messages[0].content.includes("Which? news"));
    // Families given with their names: both appear.
    mock.script(`Sure: ${JSON.stringify(PRESS_BREACH)}`);
    const breach = await classifyWatchItem({ title: "Big Retailer hacked", summary: "3M customers", url: "https://example.test/y", source: "Krebs on Security", families: [{ id: "bank", name: "Bank or card" }] });
    assert.deepEqual(breach, PRESS_BREACH, "text around the JSON is ignored");
    assert.ok(mock.calls[1].system.includes("bank: Bank or card"));
    // Codes and counts are tidied: a country name is no code, a language code is lowercased, a count in quotes is a number, an unreadable one is null.
    mock.script({ kind: "breach", fields: { org: "X", people: "12000", country: "France", language: "FR", dataClasses: [] }, one_action: null });
    assert.deepEqual((await classifyWatchItem({ title: "t", url: "https://example.test/z", source: "S" })).fields, { org: "X", people: 12000, country: null, language: "fr", dataClasses: [] });
    mock.script({ kind: "breach", fields: { org: "X", people: "many" }, one_action: null });
    assert.equal((await classifyWatchItem({ title: "t", url: "https://example.test/z", source: "S" })).fields.people, null);
    // A missing summary and no families: still a request.
    mock.script({ kind: "other", fields: {}, one_action: null });
    assert.deepEqual(await classifyWatchItem({ title: "t", url: "https://example.test/z", source: "S" }), { kind: "other", fields: {}, one_action: null });
    // Nonsense.
    mock.script({ kind: "rumour", fields: {}, one_action: null });
    await assert.rejects(classifyWatchItem({ title: "t", url: "https://example.test/z", source: "S" }), /classifier answer/);
    mock.script({ kind: "technique", fields: { channel: "carrier pigeon" }, one_action: { en: "x" } });
    await assert.rejects(classifyWatchItem({ title: "t", url: "https://example.test/z", source: "S" }), /channel/);
    mock.script("no json here");
    await assert.rejects(classifyWatchItem({ title: "t", url: "https://example.test/z", source: "S" }));
  } finally {
    delete process.env.LLM_PROVIDER;
    mock.reset();
  }
});
