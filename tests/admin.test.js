// The admin console over HTTP and Postgres: who gets in, the health list,
// the server and the counts, the jobs list and Run now, the persisted run
// history, the people pages, the privacy line, Sync now, the outbox, and
// that nothing deletes. One test per behavior line of
// _product/specs/admin-console.md the API can show. Needs Postgres; skipped
// without it.

import { pool, resetDb, makeUser, sessionFor, dbAvailable } from "./helpers/db.js";
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { one } from "../src/db/pool.js";
import { buildApp } from "../src/server.js";
import { config } from "../src/config.js";
import { JOBS, jobsReport } from "../src/jobs/scheduler.js";
import { runRetention } from "../src/jobs/retention.js";

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

test("job runs are written to the database: the history and the health survive a restart, newest first", opts, async () => {
  await pool.query(`INSERT INTO job_runs (job, trigger, started_at, finished_at, ok, result, error) VALUES
    ('poll', 'schedule', now() - interval '3 hours', now() - interval '3 hours' + interval '840 milliseconds', true, '{"users": 2}', NULL),
    ('threatfeed', 'startup', now() - interval '2 hours', now() - interval '2 hours' + interval '5 seconds', false, NULL, 'ic3-psa: HTTP 503')`);
  const { runs } = (await get("/api/admin/jobs")).json();
  assert.ok(runs.length >= 3);
  const times = runs.map((r) => Date.parse(r.startedAt));
  assert.deepEqual(times, [...times].sort((a, b) => b - a), "newest first");
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
  for (const url of ["/api/admin/users", `/api/admin/users/${linda.id}`, "/api/admin/health", "/api/admin/jobs"]) {
    const res = await get(url);
    assert.equal(res.statusCode, 200, url);
    for (const word of [HEADLINE, REASON, SENDER, "msg-zebra", "ZEBRA", "hash-7731"]) assert.ok(!res.body.includes(word), `${url} shows ${word}`);
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

test("Outbox lists the emails Prudence sent or would have sent; the text only outside production", opts, async () => {
  await pool.query(`INSERT INTO outbox (to_email, subject, text_body, sent_via, created_at)
                    VALUES ('thomas-admin@example.test', 'Earlier mail', 'OUTBOX-TEXT-OLDER', 'local-outbox', now() - interval '1 hour'),
                           ('thomas-admin@example.test', 'Linda needs your advice', 'OUTBOX-TEXT-ZEBRA https://localhost:3999/answer/x', 'local-outbox', now())`);
  const res = await get("/api/admin/outbox");
  assert.equal(res.statusCode, 200);
  const { mails } = res.json();
  assert.equal(mails[0].subject, "Linda needs your advice", "newest first");
  assert.equal(mails[1].subject, "Earlier mail");
  const mail = mails[0];
  assert.equal(mail.to, "thomas-admin@example.test");
  assert.equal(mail.via, "local-outbox");
  assert.ok(isIso(mail.createdAt));
  assert.match(mail.text, /OUTBOX-TEXT-ZEBRA/);
  assert.equal((await get("/api/admin/health")).json().counts.outboxWaiting, 2);
  config.production = true;
  try {
    const prod = (await get("/api/admin/outbox")).json();
    assert.equal(prod.mails.find((m) => m.id === mail.id).text, null);
    assert.ok(!JSON.stringify(prod).includes("OUTBOX-TEXT"), "no text in production");
    assert.equal(prod.mails[0].subject, "Linda needs your advice", "to, subject, channel and time stay");
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
