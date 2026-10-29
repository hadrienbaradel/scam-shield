// The admin console over HTTP and Postgres: who gets in, the health list
// (and its Failing path), the server and the counts, the jobs list and Run
// now, Fetch now as a run of the threat feed, a partial feed outage, the
// Gmail poll and its failing mailboxes, the persisted run history and the
// runs a restart cut, the people pages and a token that can no longer be
// refreshed, the privacy line, Sync now, the outbox and the local outbox's
// door, and that nothing deletes. One test per behavior line of
// _product/specs/admin-console.md the API can show. Needs Postgres; skipped
// without it.

import { pool, resetDb, makeUser, sessionFor, dbAvailable } from "./helpers/db.js";
import { fakeGmail } from "./helpers/fake-gmail.js";
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { connect } from "node:net";
import { one } from "../src/db/pool.js";
import { buildApp } from "../src/server.js";
import { config } from "../src/config.js";
import { encrypt } from "../src/crypto.js";
import { JOBS, jobsReport, jobStatus, threatFeedRun, closeInterruptedRuns, startJobs, stopJobs, runJob, pollAll } from "../src/jobs/scheduler.js";
import { SOURCES } from "../src/jobs/threatfeed.js";
import { runRetention } from "../src/jobs/retention.js";
import { syncUser } from "../src/sync/worker.js";
import { accessTokenFor } from "../src/google/tokens.js";
import { ReauthNeeded } from "../src/google/oauth.js";
import { breaker } from "../lib/muse.js";

const ORIGIN = "http://localhost:3999";
const hasDb = await dbAvailable();
const opts = { skip: hasDb ? false : "Postgres test database not available" };
let app;
let admin;
let adminHeaders;

before(async () => {
  if (!hasDb) return;
  await resetDb();
  app = await buildApp({ logger: false });
  admin = await makeUser({ email: "admin@example.test", name: "Vlad" });
  adminHeaders = { cookie: await sessionFor(admin), origin: ORIGIN };
});
after(async () => { await app?.close(); await pool.end(); });

const get = (url, headers = adminHeaders) => app.inject({ url, headers });
const post = (url, headers = adminHeaders) => app.inject({ method: "POST", url, headers, payload: {} });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const isIso = (s) => typeof s === "string" && s.endsWith("Z") && !Number.isNaN(Date.parse(s));

// Words that must never reach the console: a verdict's headline and reasons,
// the sender, the Gmail ids, what the senior shared with her grandson.
const HEADLINE = "HEADLINE-ZEBRA-7731";
const REASON = "REASON-GIRAFFE-4412";
const SENDER = "zebra-sender-7731.test";

// Linda: a senior with checks, a trusted person and an invited one, an
// alert waiting, a phone, a context and an audit trail. Built once.
let linda;
let thomas;
async function seniorWithEverything() {
  if (linda) return { linda, thomas };
  linda = await makeUser({ email: "linda-admin@example.test", name: "Linda", gmail: true });
  thomas = await makeUser({ email: "thomas-admin@example.test", name: "Thomas" });
  const verdict = (v, extra = {}) => ({ verdict: v, headline: HEADLINE, reasons: [REASON], ...extra });
  const scam = await one(`INSERT INTO checks (user_id, gmail_message_id, sender_domain, verdict, verdict_value, source, latency_ms, action)
                          VALUES ($1, 'msg-zebra-1', $2, $3, 'scam', 'Muse Spark (muse-spark-1.3)', 3800, 'moved') RETURNING id`,
  [linda.id, SENDER, verdict("scam", { degraded: true })]);
  await pool.query(`INSERT INTO checks (user_id, gmail_message_id, sender_domain, verdict, verdict_value, source, latency_ms, action, created_at)
                    VALUES ($1, 'msg-zebra-2', $2, $3, 'safe', 'detector', 12, 'none', now() - interval '1 minute'),
                           ($1, 'msg-zebra-3', $2, $4, 'be_careful', 'detector', 15, 'labeled', now() - interval '2 days')`,
  [linda.id, SENDER, verdict("safe"), verdict("be_careful")]);
  const g = await one(`INSERT INTO guardianships (senior_id, guardian_id, guardian_name, guardian_email, relation, status, accepted_at)
                       VALUES ($1, $2, 'Thomas', 'thomas-admin@example.test', 'grandson', 'active', now()) RETURNING id`, [linda.id, thomas.id]);
  await pool.query(`INSERT INTO guardianships (senior_id, guardian_name, guardian_email, relation, status)
                    VALUES ($1, 'Anne', 'anne-admin@example.test', 'daughter', 'invited')`, [linda.id]);
  await pool.query("INSERT INTO alerts (senior_id, guardianship_id, check_id, shared) VALUES ($1, $2, $3, $4)",
    [linda.id, g.id, scam.id, { subject: "SHARED-SUBJECT-ZEBRA", text: "shared text ZEBRA" }]);
  await pool.query("INSERT INTO devices (user_id, name, token_hash, last_seen_at) VALUES ($1, 'Pixel 7', 'hash-7731', now())", [linda.id]);
  await pool.query("INSERT INTO contexts (user_id, data, built_at) VALUES ($1, $2, now())", [linda.id, {
    userName: "Linda", coverage: { emailsRead: 300, since: "2026-05-01" },
    providers: [{ name: "Chase" }, { name: "Medicare" }], orders: [{ carrier: "Amazon Logistics" }], subscriptions: [],
    trustedContacts: [{ name: "Thomas", email: "thomas-admin@example.test" }], knownSenders: [{ email: `alerts@${SENDER}` }],
    breaches: [{ id: "b1" }], knownLinkDomains: ["amazon.com", "chase.com"],
  }]);
  await pool.query("INSERT INTO audit_log (user_id, event, detail) VALUES ($1, 'moved_out_of_inbox', $2), ($1, 'put_back', $3)",
    [linda.id, { checkId: scam.id, verdict: "scam", messageId: "msg-zebra-1" }, { checkId: scam.id, wasAction: "moved", learned: `alerts@${SENDER}` }]);
  await sessionFor(linda);
  return { linda, thomas };
}

test("the console is admins only: a visitor is told to sign in, a signed-in senior is told admins only, an admin gets the console", opts, async () => {
  const anon = await app.inject({ url: "/admin/" });
  assert.equal(anon.statusCode, 403);
  assert.match(anon.headers["content-type"], /text\/html/);
  assert.ok(anon.body.includes("Sign in first") && anon.body.includes('href="/auth/google?mode=basic"'), "a visitor gets the sign-in link");
  const senior = await makeUser({ email: "senior-at-the-door@example.test", gmail: true });
  const seniorHeaders = { cookie: await sessionFor(senior), origin: ORIGIN };
  const refused = await get("/admin/", seniorHeaders);
  assert.equal(refused.statusCode, 403);
  assert.match(refused.headers["content-type"], /text\/html/);
  assert.ok(refused.body.includes("Admins only"));
  for (const url of ["/admin", "/admin/"]) {
    const res = await get(url);
    assert.equal(res.statusCode, 200, url);
    assert.match(res.headers["content-type"], /text\/html/);
    assert.match(res.body, /<!doctype html>/i);
  }
  // The API answers JSON: 401 without a session, 403 for anyone else.
  const noSession = await app.inject({ url: "/api/admin/health" });
  assert.equal(noSession.statusCode, 401);
  assert.deepEqual(noSession.json(), { error: "Please sign in." });
  assert.equal((await get("/api/admin/health", seniorHeaders)).statusCode, 403);
  assert.equal((await get("/api/admin/users", seniorHeaders)).statusCode, 403);
  assert.equal((await post("/api/admin/jobs/retention/run", seniorHeaders)).statusCode, 403);
});

test("Overview lists every dependency with a status word, a plain detail and the time it was checked", opts, async () => {
  const res = await get("/api/admin/health");
  assert.equal(res.statusCode, 200);
  const { checks, overall, generatedAt } = res.json();
  assert.ok(isIso(generatedAt));
  assert.deepEqual(checks.map((c) => c.id), ["database", "model", "google", "instant_checks", "worker", "email", "links", "breaches", "voice", "live_updates"]);
  for (const c of checks) {
    assert.ok(["ok", "warn", "fail", "off"].includes(c.status), `${c.id}: ${c.status}`);
    assert.ok(typeof c.name === "string" && c.name && typeof c.detail === "string" && c.detail, `${c.id} has a name and a detail`);
    assert.ok(isIso(c.checkedAt), `${c.id} says when it was checked`);
  }
  const by = Object.fromEntries(checks.map((c) => [c.id, c]));
  assert.equal(by.database.status, "ok");
  assert.match(by.database.detail, /^(\d+|<1) ms; \d+ migrations, latest \d{3}_\w+; pool \d+ busy of \d+, \d+ waiting$/);
  assert.equal(by.model.status, "off", "no model key under test");
  assert.equal(by.model.name, "Muse Spark");
  assert.equal(by.google.status, "ok");
  assert.equal(by.instant_checks.status, "off");
  assert.equal(by.worker.status, "warn");
  assert.match(by.worker.detail, /WORKER=0/);
  for (const id of ["email", "links", "breaches", "voice"]) assert.equal(by[id].status, "off", id);
  assert.equal(by.live_updates.status, "ok");
  assert.equal(overall, "warn", "the worst status, ignoring what is off");
  for (const c of checks) assert.ok(!/[A-Za-z0-9+/]{40,}/.test(c.detail), `${c.id}: no secret-looking value in the detail`);
});

test("Overview reads Failing while Muse Spark is paused after errors, and Warning after one failure", opts, async () => {
  const saved = { ...breaker };
  // With a key the model check looks at the breaker (museConfigured() reads the environment at call time); nothing calls the model here.
  process.env.META_MODEL_API_KEY = "test-model-key-not-real";
  try {
    Object.assign(breaker, { failures: 3, openUntil: Date.now() + 60000 });
    const tripped = await get("/api/admin/health");
    const model = tripped.json().checks.find((c) => c.id === "model");
    assert.equal(model.status, "fail");
    assert.match(model.detail, /^Paused after errors until \S+Z; Muse Spark \(.+\), effort \w+; 3 failures in a row;/);
    assert.equal(tripped.json().overall, "fail", "one failing dependency makes the whole Failing");
    assert.ok(!tripped.body.includes(process.env.META_MODEL_API_KEY), "the key's value never shows");
    Object.assign(breaker, { failures: 1, openUntil: 0 });
    const shaky = (await get("/api/admin/health")).json();
    assert.equal(shaky.checks.find((c) => c.id === "model").status, "warn");
    assert.equal(shaky.overall, "warn");
  } finally {
    delete process.env.META_MODEL_API_KEY;
    Object.assign(breaker, saved);
  }
});

test("when today's counts cannot be read, Overview still answers and the error line goes to the log", opts, async () => {
  const query = pool.query;
  const own = Object.hasOwn(pool, "query");
  const original = console.error;
  const logged = [];
  pool.query = function (text, ...rest) {
    if (String(text).includes("AS cached_answers")) return Promise.reject(new Error("counts query refused (test)"));
    return query.call(this, text, ...rest);
  };
  console.error = (...args) => logged.push(args.join(" "));
  try {
    const res = await get("/api/admin/health");
    assert.equal(res.statusCode, 200);
    const { counts, checks } = res.json();
    assert.equal(counts, null);
    assert.match(checks.find((c) => c.id === "email").detail, /; \? emails waiting$/);
    assert.ok(logged.some((l) => l.includes("counts unavailable: counts query refused (test)")), logged.join("\n"));
  } finally {
    if (own) pool.query = query;
    else delete pool.query;
    console.error = original;
  }
});

test("Overview shows the server and today's counts", opts, async () => {
  await seniorWithEverything();
  const { server, counts, jobs } = (await get("/api/admin/health")).json();
  const pkg = JSON.parse(await readFile(new URL("../package.json", import.meta.url), "utf8"));
  assert.equal(server.version, pkg.version);
  assert.equal(server.node, process.version);
  assert.equal(server.pid, process.pid);
  assert.ok(isIso(server.startedAt));
  assert.ok(server.uptimeSeconds >= 0 && server.memoryMb > 0);
  assert.equal(server.baseUrl, ORIGIN);
  assert.equal(server.production, false);
  assert.equal(server.worker, false);
  assert.equal(server.pollSeconds, 120);
  assert.ok(typeof server.host === "string" && typeof server.port === "number");
  assert.ok(counts.users >= 4, "the admin, Linda, Thomas, the senior at the door");
  assert.ok(counts.seniors >= 2);
  assert.equal(counts.guardians, 1);
  assert.equal(counts.admins, 1);
  assert.ok(counts.gmailConnected >= 2);
  assert.equal(counts.reconnectNeeded, 0);
  assert.deepEqual(counts.checks24h, { total: 2, safe: 1, be_careful: 0, scam: 1 });
  assert.equal(counts.checksTotal, 3);
  assert.equal(counts.alertsWaiting, 1);
  assert.ok(typeof counts.cardsCandidate === "number" && typeof counts.cardsActive === "number");
  assert.equal(counts.outboxWaiting, 0);
  assert.equal(counts.liveConnections, 0);
  assert.equal(jobs.length, 5, "the jobs come with the health report");
});

test("Jobs lists every piece of background work with its schedule and health, and Run now starts a run", opts, async () => {
  const res = await get("/api/admin/jobs");
  assert.equal(res.statusCode, 200);
  const { jobs, runs, errors } = res.json();
  assert.deepEqual(jobs.map((j) => j.id), ["poll", "watch", "threatfeed", "retention", "pubsub"]);
  assert.deepEqual(jobs.map((j) => j.schedule), ["every 2 min", "every 12 h", "every 24 h", "every 6 h", "continuous"]);
  assert.deepEqual(jobs.map((j) => j.canRun), [true, true, true, true, false]);
  assert.ok(jobs.every((j) => j.name && j.what && ["interval", "loop"].includes(j.kind)), "each job says what it does");
  assert.ok(jobs.every((j) => j.health === "off" && j.running === false && j.nextDueAt === null), "WORKER=0: nothing is scheduled in the test process");
  assert.ok(Array.isArray(runs) && Array.isArray(errors));

  const started = await post("/api/admin/jobs/retention/run");
  assert.equal(started.statusCode, 202);
  assert.deepEqual(started.json(), { started: true, job: "retention" });
  let row = null;
  for (let i = 0; i < 50 && !row?.finished_at; i++) {
    await sleep(100);
    row = await one("SELECT * FROM job_runs WHERE job = 'retention' ORDER BY id DESC LIMIT 1");
  }
  assert.ok(row?.finished_at, "the run finished within 5 s");
  assert.equal(row.ok, true);
  assert.equal(row.trigger, "manual");
  assert.equal(row.error, null);
  assert.equal(typeof row.result.jobRuns, "number");
  assert.equal(typeof row.result.checks, "number");

  const after = (await get("/api/admin/jobs")).json();
  const retention = after.jobs.find((j) => j.id === "retention");
  assert.equal(retention.running, false);
  assert.equal(retention.lastRun.id, Number(row.id));
  assert.equal(retention.lastRun.trigger, "manual");
  assert.equal(retention.lastRun.ok, true);
  assert.deepEqual(retention.lastRun.result, row.result);
  assert.ok(isIso(retention.lastRun.startedAt) && isIso(retention.lastRun.finishedAt) && retention.lastRun.durationMs >= 0);
  assert.equal(retention.health, "off", "with the worker off in this process the health stays Off, as the spec says");
  assert.equal(after.runs[0].id, Number(row.id), "the history lists it first");

  assert.equal((await post("/api/admin/jobs/nope/run")).statusCode, 404);
  assert.deepEqual((await post("/api/admin/jobs/nope/run")).json(), { error: "unknown job" });
  assert.equal((await post("/api/admin/jobs/pubsub/run")).statusCode, 400);
  assert.deepEqual((await post("/api/admin/jobs/pubsub/run")).json(), { error: "this job runs on its own" });
});

test("Fetch now is a manual run of the Threat feed job: it shows in the run history and is refused while one runs", opts, async () => {
  const feed = JOBS.find((j) => j.id === "threatfeed");
  const original = feed.run;
  const log = console.error;
  const report = { fetched: 1, newItems: 0, cards: 0, errors: [] };
  let release = () => {};
  let pending = null;
  try {
    feed.run = async () => report;
    const res = await post("/api/admin/feed/run");
    assert.equal(res.statusCode, 200);
    const body = res.json();
    assert.deepEqual(body.report, report, "the page reads the same report as before");
    assert.deepEqual([body.run.job, body.run.trigger, body.run.ok], ["threatfeed", "manual", true]);
    const row = await one("SELECT job, trigger, ok, result FROM job_runs WHERE id = $1", [body.run.id]);
    assert.deepEqual(row, { job: "threatfeed", trigger: "manual", ok: true, result: report });
    assert.equal((await get("/api/admin/jobs")).json().runs[0].id, body.run.id, "first in the run history");

    // While a run is in flight, Fetch now and the Jobs page's Run now are both refused.
    let started;
    const inFlight = new Promise((r) => { started = r; });
    const gate = new Promise((r) => { release = r; });
    feed.run = async () => { started(); await gate; return report; };
    pending = post("/api/admin/feed/run");
    await inFlight;
    const refused = await post("/api/admin/feed/run");
    assert.equal(refused.statusCode, 409);
    assert.deepEqual(refused.json(), { error: "already running" });
    assert.equal((await post("/api/admin/jobs/threatfeed/run")).statusCode, 409, "Run now is the same run");
    release();
    assert.equal((await pending).statusCode, 200);

    // Every source down: the run is failed and the report carries its error line.
    console.error = () => {};
    feed.run = async () => { throw new Error("ic3-psa: HTTP 503; cybermalveillance-alertes: HTTP 503"); };
    const failed = (await post("/api/admin/feed/run")).json();
    assert.deepEqual(failed.report, { fetched: 0, newItems: 0, cards: 0, errors: ["ic3-psa: HTTP 503; cybermalveillance-alertes: HTTP 503"] });
    assert.equal(failed.run.ok, false);
    assert.equal((await one("SELECT ok FROM job_runs WHERE id = $1", [failed.run.id])).ok, false);
  } finally {
    release();
    await pending;
    feed.run = original;
    console.error = log;
  }
});

test("a partial threat-feed outage keeps what the live source brought and lists the dead ones under recent errors", opts, async () => {
  const rss = "<rss><channel><item><title>Test alert</title><link>https://example.test/a</link><description>x</description></item></channel></rss>";
  const fetchImpl = async (url) => {
    if (url === SOURCES[0].url) return new Response(rss);
    throw new Error("connection refused");
  };
  const savedErrors = jobStatus.errors;
  const log = console.error;
  console.error = () => {};
  jobStatus.errors = [];
  try {
    const report = await threatFeedRun({ fetchImpl });
    assert.equal(report.fetched, 1);
    assert.equal(report.newItems, 1);
    assert.equal(report.errors.length, 2);
    assert.ok(await one("SELECT 1 FROM feed_items WHERE url = 'https://example.test/a'"), "the alert is kept for review");
    const dead = SOURCES.slice(1).map((s) => `threatfeed: ${s.id}: connection refused`);
    assert.deepEqual(jobStatus.errors.map((l) => l.replace(/^\S+ /, "")).sort(), [...dead].sort(), "one line per dead source");
    const { errors } = (await get("/api/admin/jobs")).json();
    for (const line of dead) assert.ok(errors.some((l) => l.endsWith(line)), `${line} under recent errors`);
  } finally {
    console.error = log;
    jobStatus.errors = savedErrors;
  }
});

// The poll syncs every connected mailbox in the database. For exact counts a
// test keeps only its own seniors connected, and reconnects the others after.
async function withOnlyMailboxes(ids, fn) {
  const { rows } = await pool.query(`UPDATE google_tokens SET status = 'revoked' WHERE status = 'ok' AND NOT (user_id = ANY($1::uuid[]))
                                     RETURNING user_id`, [ids]);
  try { return await fn(); } finally {
    await pool.query("UPDATE google_tokens SET status = 'ok' WHERE user_id = ANY($1::uuid[])", [rows.map((r) => r.user_id)]);
  }
}
const withoutTime = (lines) => lines.map((l) => l.replace(/^\S+ /, ""));

test("the Gmail poll fails when every mailbox failed to sync, with one line per mailbox naming its id and status, never its address", opts, async () => {
  // What makeUser gives: a token row that says ok, with no refresh token and no access token.
  const senior = await makeUser({ email: "poll-no-refresh-admin@example.test", gmail: true });
  const poll = JOBS.find((j) => j.id === "poll");
  const line = `poll mailbox ${senior.id}: reauth_needed (no refresh token)`;
  const savedErrors = jobStatus.errors;
  const log = console.error;
  console.error = () => {};
  jobStatus.errors = [];
  try {
    const run = await withOnlyMailboxes([senior.id], () => runJob("poll", { trigger: "manual" }));
    assert.equal(run.ok, false);
    assert.equal(run.error, "every mailbox failed to sync (1 of 1)");
    assert.deepEqual(run.result, { users: 1, synced: 0, failed: 1, skipped: 0 }, "the failed run keeps its counts");
    assert.deepEqual(withoutTime(jobStatus.errors), [line], "one line for the mailbox; the run's own error is not noted again");
    assert.ok(!jobStatus.errors[0].includes(senior.email), "the user id, never the address");
    assert.deepEqual(await one("SELECT ok, result, error FROM job_runs WHERE id = $1", [run.id]),
      { ok: false, result: { users: 1, synced: 0, failed: 1, skipped: 0 }, error: "every mailbox failed to sync (1 of 1)" });
    // What the Jobs page reads: the failed run, its line under recent errors, and Failing on a server whose worker is on.
    const { jobs, errors } = (await get("/api/admin/jobs")).json();
    const listed = jobs.find((j) => j.id === "poll").lastRun;
    assert.deepEqual([listed.id, listed.ok, listed.error], [run.id, false, "every mailbox failed to sync (1 of 1)"]);
    assert.ok(errors[0].endsWith(line), errors[0]);
    assert.equal(jobsReport({ worker: true }).jobs.find((j) => j.id === "poll").health, "failing");
  } finally {
    console.error = log;
    jobStatus.errors = savedErrors;
    poll.lastRun = null;
  }
});

test("a partial Gmail outage keeps the poll OK, counts the mailboxes synced, failed and skipped, and lists each failing one under recent errors", opts, async () => {
  const good = await makeUser({ email: "poll-good-admin@example.test", gmail: true });
  const bad = await makeUser({ email: "poll-bad-admin@example.test", gmail: true });
  const busy = await makeUser({ email: "poll-busy-admin@example.test", gmail: true });
  const crashed = await makeUser({ email: "poll-crashed-admin@example.test", gmail: true });
  // Real syncs: an empty mailbox that answers, one Gmail refuses with an error naming the address, one another process
  // is syncing; and one whose sync throws before it can write anything (the database dropped the connection).
  const refusing = { ...fakeGmail({ email: bad.email }),
    listLabels: async () => { throw Object.assign(new Error(`Gmail GET /labels 403: Delegation denied for ${bad.email}`), { status: 403 }); } };
  const clients = new Map([[good.id, fakeGmail({ email: good.email })], [bad.id, refusing]]);
  const sync = (id) => (id === crashed.id ? Promise.reject(new Error("Connection terminated unexpectedly")) : syncUser(id, { client: clients.get(id) }));
  const poll = JOBS.find((j) => j.id === "poll");
  const jobs = [{ ...poll, running: false, lastRun: null, run: () => pollAll({ sync }) }];
  const other = await pool.connect();
  await other.query("SELECT pg_advisory_lock(hashtext($1))", [`sync:${busy.id}`]);
  const savedErrors = jobStatus.errors;
  const log = console.error;
  console.error = () => {};
  jobStatus.errors = [];
  try {
    const run = await withOnlyMailboxes([good.id, bad.id, busy.id, crashed.id], () => runJob("poll", { trigger: "manual", jobs }));
    assert.equal(run.ok, true, run.error);
    assert.equal(run.error, null);
    assert.deepEqual(run.result, { users: 4, synced: 1, failed: 2, skipped: 1 });
    assert.deepEqual(withoutTime(jobStatus.errors).sort(), [`poll mailbox ${bad.id}: error (Gmail GET /labels 403: Delegation denied for [address])`,
      `poll mailbox ${crashed.id}: error (Connection terminated unexpectedly)`].sort(), "one line per failing mailbox, none for the others");
    assert.ok(!jobStatus.errors.some((l) => l.includes(bad.email)), "no address, even when Gmail's error names it");
    assert.equal(jobsReport({ jobs, worker: true }).jobs[0].health, "ok", "a partial outage stays OK");
    const states = await pool.query("SELECT user_id, sync_status FROM gmail_state WHERE user_id = ANY($1::uuid[])", [[good.id, bad.id, busy.id]]);
    assert.deepEqual(Object.fromEntries(states.rows.map((s) => [s.user_id, s.sync_status])), { [good.id]: "ok", [bad.id]: "error", [busy.id]: "pending" });
  } finally {
    await other.query("SELECT pg_advisory_unlock(hashtext($1))", [`sync:${busy.id}`]);
    other.release();
    console.error = log;
    jobStatus.errors = savedErrors;
  }
});

test("with no mailbox to sync, the Gmail poll is OK and counts nothing", opts, async () => {
  const run = await withOnlyMailboxes([], () => runJob("poll", { trigger: "manual" }));
  JOBS.find((j) => j.id === "poll").lastRun = null;
  assert.equal(run.ok, true, run.error);
  assert.equal(run.error, null);
  assert.deepEqual(run.result, { users: 0, synced: 0, failed: 0, skipped: 0 });
});

test("a run cut by a restart is closed as failed (interrupted) at the next start, never left Running, and the downtime is not its duration", opts, async () => {
  const start = new Date(); // stands for this process's start
  const cut = await one("INSERT INTO job_runs (job, trigger, started_at) VALUES ('watch', 'schedule', now() - interval '10 minutes') RETURNING id::int AS id");
  const ours = await one("INSERT INTO job_runs (job, trigger, started_at) VALUES ('watch', 'manual', $1) RETURNING id::int AS id", [new Date(start.getTime() + 1000)]);
  const INTERRUPTED = "interrupted: the server stopped during this run";
  try {
    assert.equal(await closeInterruptedRuns({ before: start }), 1, "it says how many it closed");
    const closed = await one("SELECT started_at, finished_at, ok, error FROM job_runs WHERE id = $1", [cut.id]);
    assert.ok(closed.finished_at instanceof Date);
    assert.equal(closed.finished_at.getTime(), closed.started_at.getTime(), "it ends where it started: when it really stopped is unknown");
    assert.deepEqual([closed.ok, closed.error], [false, INTERRUPTED]);
    assert.deepEqual(await one("SELECT finished_at, ok, error FROM job_runs WHERE id = $1", [ours.id]), { finished_at: null, ok: null, error: null },
      "a run this process started is left alone");
    const listed = (await get("/api/admin/jobs")).json().runs.find((r) => r.id === cut.id);
    assert.deepEqual([listed.ok, listed.error], [false, INTERRUPTED]);
    assert.ok(isIso(listed.finishedAt), "finished, so the page never shows it Running");
    assert.equal(listed.durationMs, 0, "not the 10 minutes the server was down");
    assert.equal(await closeInterruptedRuns({ before: start }), 0, "a second start closes nothing more");

    // The server does it when its worker starts: a run left open before this process began is closed
    // (the scheduled timers are stopped at once, so nothing else runs here).
    const left = await one("INSERT INTO job_runs (job, trigger, started_at) VALUES ('watch', 'schedule', now() - interval '1 hour') RETURNING id::int AS id");
    config.worker = true;
    try {
      startJobs();
    } finally {
      stopJobs();
      config.worker = false;
      for (const j of JOBS) j.nextDueAt = null;
    }
    let row = null;
    for (let i = 0; i < 100 && !row?.finished_at; i++) {
      await sleep(20);
      row = await one("SELECT finished_at, ok, error FROM job_runs WHERE id = $1", [left.id]);
    }
    assert.deepEqual([row.ok, row.error], [false, INTERRUPTED], "closed at the start");
    assert.equal((await one("SELECT finished_at FROM job_runs WHERE id = $1", [ours.id])).finished_at, null, "the run of this process stays open");
  } finally {
    await pool.query("DELETE FROM job_runs WHERE id = $1", [ours.id]);
  }
});

test("job runs are written to the database: the history and the health survive a restart, newest first", opts, async () => {
  // A known table: the runs this test needs, nothing left by the other tests.
  await pool.query("DELETE FROM job_runs");
  await pool.query(`INSERT INTO job_runs (job, trigger, started_at, finished_at, ok, result, error) VALUES
    ('poll', 'schedule', now() - interval '3 hours', now() - interval '3 hours' + interval '840 milliseconds', true, '{"users": 2}', NULL),
    ('threatfeed', 'startup', now() - interval '2 hours', now() - interval '2 hours' + interval '5 seconds', false, NULL, 'ic3-psa: HTTP 503'),
    ('retention', 'manual', now() - interval '1 hour', now() - interval '1 hour' + interval '30 milliseconds', true, '{"checks": 0, "jobRuns": 0}', NULL)`);
  const { runs } = (await get("/api/admin/jobs")).json();
  assert.deepEqual(runs.map((r) => r.job), ["retention", "threatfeed", "poll"], "newest first");
  const poll = runs.find((r) => r.job === "poll");
  assert.ok(Number.isInteger(poll.id) && isIso(poll.startedAt) && isIso(poll.finishedAt));
  assert.deepEqual({ ...poll, id: 0, startedAt: 0, finishedAt: 0 },
    { id: 0, job: "poll", trigger: "schedule", startedAt: 0, finishedAt: 0, durationMs: 840, ok: true, result: { users: 2 }, error: null });
  // After a restart the in-memory state is empty: the last run of each job comes back from the table.
  for (const j of JOBS) j.lastRun = null;
  const { jobs } = (await get("/api/admin/jobs")).json();
  const by = Object.fromEntries(jobs.map((j) => [j.id, j]));
  assert.deepEqual(by.poll.lastRun.result, { users: 2 });
  assert.equal(by.threatfeed.lastRun.error, "ic3-psa: HTTP 503");
  assert.equal(by.retention.lastRun.trigger, "manual");
  assert.equal(by.watch.lastRun, null, "a job that never ran has no last run");
  // ...and the health is computed from it (worker on, as on the real server).
  const live = Object.fromEntries(jobsReport({ worker: true }).jobs.map((j) => [j.id, j.health]));
  assert.equal(live.poll, "stale", "a 2 min job whose last run is 3 h old");
  assert.equal(live.threatfeed, "failing");
  assert.equal(live.retention, "ok");
});

test("retention deletes job runs older than 30 days and keeps the fresh ones", opts, async () => {
  await pool.query(`INSERT INTO job_runs (job, trigger, started_at, finished_at, ok) VALUES
    ('poll', 'schedule', now() - interval '31 days', now() - interval '31 days', true),
    ('poll', 'schedule', now() - interval '29 days', now() - interval '29 days', true)`);
  const before = (await one("SELECT count(*)::int AS n FROM job_runs")).n;
  const counts = await runRetention();
  assert.equal(counts.jobRuns, 1);
  assert.equal((await one("SELECT count(*)::int AS n FROM job_runs")).n, before - 1);
  assert.equal((await one("SELECT count(*)::int AS n FROM job_runs WHERE started_at < now() - interval '30 days'")).n, 0);
});

test("Users lists every account with roles, Gmail state and counts", opts, async () => {
  const { linda, thomas } = await seniorWithEverything();
  const res = await get("/api/admin/users");
  assert.equal(res.statusCode, 200);
  const { users } = res.json();
  const l = users.find((u) => u.id === linda.id);
  assert.deepEqual(l.roles, ["senior"]);
  assert.equal(l.email, "linda-admin@example.test");
  assert.equal(l.name, "Linda");
  assert.equal(l.locale, "en-US");
  assert.equal(l.onboarded, true);
  assert.equal(l.actMode, "move");
  assert.equal(l.autoAlert, false);
  assert.ok(isIso(l.createdAt));
  assert.ok(l.lastSeenAt === null || isIso(l.lastSeenAt));
  assert.deepEqual(l.gmail, { email: linda.email, tokenStatus: "ok", syncStatus: "pending", syncError: null, lastSyncAt: null,
    backfillDone: false, watchExpiration: null, pushActive: false });
  assert.deepEqual(l.checks, { total: 3, safe: 1, be_careful: 1, scam: 1, last24h: 2 });
  assert.deepEqual(l.guardians, { active: 1, invited: 1 });
  assert.deepEqual(l.devices, { active: 1 });
  assert.deepEqual(l.alerts, { waiting: 1, answered: 0 });
  assert.equal(l.sessions, 1);
  const t = users.find((u) => u.id === thomas.id);
  assert.deepEqual(t.roles, ["guardian"]);
  assert.equal(t.gmail, null);
  assert.deepEqual(t.checks, { total: 0, safe: 0, be_careful: 0, scam: 0, last24h: 0 });
  assert.equal(t.sessions, 0);
  assert.deepEqual(users.find((u) => u.id === admin.id).roles, ["admin"]);
  const created = users.map((u) => Date.parse(u.createdAt));
  assert.deepEqual(created, [...created].sort((a, b) => b - a), "newest first");
});

test("a Gmail token Google can no longer refresh reads reconnect needed, never connected", opts, async () => {
  // What makeUser gives: a token row that says ok, with no refresh token and no access token.
  const senior = await makeUser({ email: "no-refresh-admin@example.test", gmail: true });
  const tokenStatus = async (id) => (await get("/api/admin/users")).json().users.find((u) => u.id === id).gmail.tokenStatus;
  const reconnectNeeded = async () => (await get("/api/admin/health")).json().counts.reconnectNeeded;
  const before = await reconnectNeeded();
  assert.equal(await tokenStatus(senior.id), "ok", "nothing has used the token yet");
  await assert.rejects(accessTokenFor(senior.id), (e) => e instanceof ReauthNeeded && e.message === "no refresh token");
  assert.equal((await one("SELECT status FROM google_tokens WHERE user_id = $1", [senior.id])).status, "reauth_needed");
  assert.equal(await tokenStatus(senior.id), "reauth_needed");
  assert.equal(await reconnectNeeded(), before + 1, "counted under reconnect needed on Overview");
  // An access token still valid works until it expires: only a token nothing can renew is flagged. (No Gmail state
  // for this one, so no later poll ever sends its made-up token to Google.)
  const fresh = await makeUser({ email: "fresh-token-admin@example.test" });
  await pool.query(`INSERT INTO google_tokens (user_id, access_token_enc, expires_at, scopes, status)
                    VALUES ($1, $2, now() + interval '1 hour', 'https://www.googleapis.com/auth/gmail.modify', 'ok')`,
  [fresh.id, encrypt("test-access-token-not-real", config.tokenKey)]);
  assert.equal(await accessTokenFor(fresh.id), "test-access-token-not-real");
  assert.equal((await one("SELECT status FROM google_tokens WHERE user_id = $1", [fresh.id])).status, "ok");
});

test("a user's page adds what the context covers, the last checks, the audit, the trusted people and the phones", opts, async () => {
  const { linda } = await seniorWithEverything();
  const res = await get(`/api/admin/users/${linda.id}`);
  assert.equal(res.statusCode, 200);
  const body = res.json();
  assert.equal(body.user.id, linda.id);
  assert.deepEqual(body.user.roles, ["senior"]);
  assert.ok(isIso(body.context.builtAt));
  assert.deepEqual(body.context.coverage, { emailsRead: 300, since: "2026-05-01" });
  assert.deepEqual(body.context.counts, { providers: 2, orders: 1, subscriptions: 0, trustedContacts: 1, knownSenders: 1, breaches: 1, knownLinkDomains: 2 });
  assert.deepEqual(body.recentChecks.map((c) => c.verdict), ["scam", "safe", "be_careful"], "newest first");
  const scam = body.recentChecks[0];
  assert.deepEqual(Object.keys(scam).sort(), ["action", "channel", "createdAt", "degraded", "id", "latencyMs", "restoredAt", "source", "userFeedback", "verdict"]);
  assert.equal(scam.channel, "email");
  assert.equal(scam.source, "Muse Spark (muse-spark-1.3)");
  assert.equal(scam.degraded, true);
  assert.equal(scam.latencyMs, 3800);
  assert.equal(scam.action, "moved");
  assert.equal(scam.restoredAt, null);
  assert.equal(scam.userFeedback, null);
  assert.equal(body.recentChecks[1].degraded, false);
  assert.deepEqual(body.guardians.map((g) => [g.name, g.email, g.relation, g.status]).sort(),
    [["Anne", "anne-admin@example.test", "daughter", "invited"], ["Thomas", "thomas-admin@example.test", "grandson", "active"]]);
  assert.ok(isIso(body.guardians.find((g) => g.name === "Thomas").acceptedAt));
  assert.deepEqual(body.devices.map((d) => [d.name, d.revokedAt]), [["Pixel 7", null]]);
  assert.ok(isIso(body.devices[0].lastSeenAt));
  assert.deepEqual(body.audit.map((a) => a.event).sort(), ["moved_out_of_inbox", "put_back"]);
  assert.ok(body.audit.every((a) => isIso(a.at)));
  assert.deepEqual(body.audit.find((a) => a.event === "moved_out_of_inbox").detail, { checkId: scam.id, verdict: "scam" });
  assert.deepEqual(body.audit.find((a) => a.event === "put_back").detail, { checkId: scam.id, wasAction: "moved" }, "the sender a put-back taught us stays out");
  assert.equal((await get("/api/admin/users/00000000-0000-0000-0000-000000000000")).statusCode, 404);
  assert.deepEqual((await get("/api/admin/users/not-a-uuid")).json(), { error: "unknown user" });
});

test("the console never shows a message's text, subject or sender, a verdict's headline or reasons, or what a senior shared", opts, async () => {
  const { linda } = await seniorWithEverything();
  // The alert email to Thomas carries what Linda shared and a live one-tap link; only its to, subject, channel and time may show.
  const mail = await one(`INSERT INTO outbox (to_email, subject, text_body, sent_via, created_at)
                          VALUES ('thomas-admin@example.test', 'Linda: is this a scam?', $1, 'local-outbox', now() - interval '2 hours') RETURNING id`,
  [`Linda shared: ${HEADLINE}\n• ${REASON}\nFrom alerts@${SENDER}: shared text ZEBRA\n\nAnswer: ${ORIGIN}/answer/LIVE-TOKEN-7731`]);
  try {
    for (const url of ["/api/admin/users", `/api/admin/users/${linda.id}`, "/api/admin/health", "/api/admin/jobs", "/api/admin/outbox"]) {
      const res = await get(url);
      assert.equal(res.statusCode, 200, url);
      for (const word of [HEADLINE, REASON, SENDER, "msg-zebra", "ZEBRA", "hash-7731", "LIVE-TOKEN-7731"]) assert.ok(!res.body.includes(word), `${url} shows ${word}`);
    }
  } finally {
    await pool.query("DELETE FROM outbox WHERE id = $1", [mail.id]);
  }
});

test("Sync now starts a Gmail sync for a connected senior and refuses when Gmail is not connected", opts, async () => {
  const { linda, thomas } = await seniorWithEverything();
  const res = await post(`/api/admin/users/${linda.id}/sync`);
  assert.equal(res.statusCode, 202);
  assert.deepEqual(res.json(), { started: true });
  // The test senior has no refresh token: the sync ends in reauth_needed at once, without the network.
  let state = null;
  for (let i = 0; i < 50; i++) {
    state = await one("SELECT sync_status FROM gmail_state WHERE user_id = $1", [linda.id]);
    if (!["pending", "syncing"].includes(state.sync_status)) break;
    await sleep(100);
  }
  assert.equal(state.sync_status, "reauth_needed");
  const guardianOnly = await post(`/api/admin/users/${thomas.id}/sync`);
  assert.equal(guardianOnly.statusCode, 409);
  assert.deepEqual(guardianOnly.json(), { error: "Gmail is not connected for this person" });
  await pool.query("UPDATE google_tokens SET status = 'revoked' WHERE user_id = $1", [linda.id]);
  assert.equal((await post(`/api/admin/users/${linda.id}/sync`)).statusCode, 409, "a revoked token is not connected either");
  await pool.query("UPDATE google_tokens SET status = 'ok' WHERE user_id = $1", [linda.id]);
  assert.equal((await post("/api/admin/users/00000000-0000-0000-0000-000000000000/sync")).statusCode, 404);
  assert.deepEqual((await post("/api/admin/users/nope/sync")).json(), { error: "unknown user" });
});

test("Outbox lists the emails Prudence sent or would have sent, never their text; outside production it links to the local outbox", opts, async () => {
  await pool.query(`INSERT INTO outbox (to_email, subject, text_body, sent_via, created_at)
                    VALUES ('thomas-admin@example.test', 'Earlier mail', 'OUTBOX-TEXT-OLDER', 'local-outbox', now() - interval '1 hour'),
                           ('thomas-admin@example.test', 'Linda needs your advice', 'OUTBOX-TEXT-ZEBRA https://localhost:3999/answer/x', 'local-outbox', now())`);
  const res = await get("/api/admin/outbox");
  assert.equal(res.statusCode, 200);
  const { mails, localOutbox } = res.json();
  assert.equal(mails[0].subject, "Linda needs your advice", "newest first");
  assert.equal(mails[1].subject, "Earlier mail");
  const mail = mails[0];
  assert.deepEqual(Object.keys(mail).sort(), ["createdAt", "id", "subject", "to", "via"], "to, subject, channel and time; no text");
  assert.equal(mail.to, "thomas-admin@example.test");
  assert.equal(mail.via, "local-outbox");
  assert.ok(isIso(mail.createdAt));
  assert.ok(mails.every((m) => !("text" in m)), "never the text");
  assert.ok(!res.body.includes("OUTBOX-TEXT") && !res.body.includes("/answer/"), "nor its one-tap link");
  assert.equal(localOutbox, "/dev/outbox", "outside production the page links to the local outbox");
  assert.equal((await get("/api/admin/health")).json().counts.outboxWaiting, 2);
  config.production = true;
  try {
    const prod = (await get("/api/admin/outbox")).json();
    assert.equal(prod.localOutbox, null, "no local outbox in production");
    assert.equal(prod.mails[0].subject, "Linda needs your advice", "to, subject, channel and time stay");
  } finally {
    config.production = false;
  }
});

test("the local outbox opens only on this machine, never through a tunnel or a proxy, even one that adds no forwarding header", opts, async () => {
  const here = await app.inject({ url: "/dev/outbox" });
  assert.equal(here.statusCode, 200, "inject connects from 127.0.0.1, like a browser on this machine");
  assert.match(here.headers["content-type"], /text\/html/);
  assert.match(here.body, /<h1>Local outbox<\/h1>/);
  assert.equal((await app.inject({ url: "/dev/outbox", remoteAddress: "::1" })).statusCode, 200, "IPv6 loopback too");
  for (const [header, value] of [["cf-connecting-ip", "203.0.113.9"], ["x-forwarded-for", "203.0.113.9"], ["x-real-ip", "203.0.113.9"], ["forwarded", "for=203.0.113.9"]]) {
    assert.equal((await app.inject({ url: "/dev/outbox", headers: { [header]: value } })).statusCode, 404, `${header}: through a tunnel or a proxy`);
  }
  // The Host must name this machine: a proxy that adds no forwarding header still passes on the public name.
  for (const host of ["localhost:3999", "127.0.0.1:3000", "[::1]:3000", "LOCALHOST"]) {
    assert.equal((await app.inject({ url: "/dev/outbox", headers: { host } })).statusCode, 200, `Host ${host}: this machine`);
  }
  for (const host of ["demo.example.test", "demo.example.test:443", "localhost.example.test"]) {
    assert.equal((await app.inject({ url: "/dev/outbox", headers: { host } })).statusCode, 404, `Host ${host}: a public name`);
  }
  // No Host at all (HTTP/1.0 allows it; inject always sends one): refused too, on a real socket.
  await app.listen({ port: 0, host: "127.0.0.1" });
  const raw = (head) => new Promise((resolve, reject) => {
    const socket = connect(app.server.address().port, "127.0.0.1", () => socket.write(`${head}\r\n\r\n`));
    let answer = "";
    socket.setEncoding("utf8").on("data", (chunk) => { answer += chunk; }).on("end", () => resolve(Number(answer.split(" ")[1]))).on("error", reject);
  });
  assert.equal(await raw("GET /dev/outbox HTTP/1.0\r\nHost: localhost"), 200, "the same request naming this machine");
  assert.equal(await raw("GET /dev/outbox HTTP/1.0"), 404, "no Host header");
  assert.equal((await app.inject({ url: "/dev/outbox", remoteAddress: "203.0.113.9" })).statusCode, 404, "from another machine");
  config.production = true;
  try {
    assert.equal((await app.inject({ url: "/dev/outbox" })).statusCode, 404, "never in production");
  } finally {
    config.production = false;
  }
});

test("nothing in the console deletes an account, a message, a verdict or a run", opts, async () => {
  const { linda } = await seniorWithEverything();
  const snapshot = () => one(`SELECT (SELECT count(*) FROM users)::int AS users, (SELECT count(*) FROM checks)::int AS checks,
                                     (SELECT count(*) FROM job_runs)::int AS runs, (SELECT count(*) FROM alerts)::int AS alerts`);
  const before = await snapshot();
  for (const url of [`/api/admin/users/${linda.id}`, "/api/admin/jobs/retention", `/api/admin/jobs/runs/1`, "/api/admin/outbox", "/api/admin/cards/x"]) {
    assert.equal((await app.inject({ method: "DELETE", url, headers: adminHeaders })).statusCode, 404, `DELETE ${url} does not exist`);
  }
  for (const url of ["/api/admin/health", "/api/admin/jobs", "/api/admin/users", `/api/admin/users/${linda.id}`, "/api/admin/outbox", "/api/admin/cards"]) {
    assert.equal((await get(url)).statusCode, 200, url);
  }
  assert.deepEqual(await snapshot(), before, "reading every page changes nothing");
});
