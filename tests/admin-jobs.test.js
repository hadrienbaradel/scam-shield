// The admin console's background jobs without a database: the health rules
// of the spec (line 6) on a fake registry with a fake clock, the schedule
// wording, and what Run now refuses. The job_runs writes are injected, so
// nothing here opens a connection.
import "./helpers/env.js";
import { test } from "node:test";
import assert from "node:assert/strict";
import { jobsReport, runJob, scheduleLabel, jobStatus } from "../src/jobs/scheduler.js";

const MIN = 60000;
const NOW = Date.parse("2026-10-29T15:00:00Z");
const at = (minutesAgo) => new Date(NOW - minutesAgo * MIN).toISOString();
const fake = (over = {}) => ({ id: "poll", name: "Gmail poll", what: "polls", kind: "interval", everyMs: 2 * MIN,
  run: async () => ({ users: 1 }), running: false, lastRun: null, nextDueAt: null, ...over });
const ran = (minutesAgo, ok = true) => ({ id: 1, job: "poll", trigger: "schedule", startedAt: at(minutesAgo + 1), finishedAt: at(minutesAgo),
  durationMs: MIN, ok, result: ok ? { users: 1 } : null, error: ok ? null : "boom" });
const health = (j, over = {}) => jobsReport({ jobs: [j], now: NOW, started: NOW - 60 * MIN, worker: true, pubsub: "off", errors: [], ...over }).jobs[0].health;

test("a scheduled job is OK within twice its interval, Stale past it, Failing after a failed run, Pending before its first run, Off without the worker, Running in flight", () => {
  assert.equal(health(fake({ lastRun: ran(3) })), "ok", "ran 3 min ago, window 4 min");
  assert.equal(health(fake({ lastRun: ran(5) })), "stale", "ran 5 min ago, window 4 min");
  assert.equal(health(fake({ lastRun: ran(1, false) })), "failing");
  assert.equal(health(fake(), { started: NOW - 1 * MIN }), "pending", "started 1 min ago, no run yet");
  assert.equal(health(fake(), { started: NOW - 5 * MIN }), "stale", "started 5 min ago and still no run");
  assert.equal(health(fake({ lastRun: ran(1) }), { worker: false }), "off");
  assert.equal(health(fake({ running: true, lastRun: ran(1, false) })), "running");
  // The window follows the interval: a 6 h job that ran 5 h ago is fine.
  assert.equal(health(fake({ everyMs: 360 * MIN, lastRun: ran(300) })), "ok");
});

test("the listener is OK while listening, Failing on an error, Off when not configured", () => {
  const loop = fake({ id: "pubsub", name: "Instant checks listener", kind: "loop", everyMs: null, run: null });
  assert.equal(health(loop, { pubsub: "listening" }), "ok");
  assert.equal(health(loop, { pubsub: "error: pull failed" }), "failing");
  assert.equal(health(loop, { pubsub: "off" }), "off");
  const r = jobsReport({ jobs: [loop], now: NOW, pubsub: "listening" }).jobs[0];
  assert.equal(r.schedule, "continuous");
  assert.equal(r.canRun, false);
  assert.equal(r.everyMs, null);
  assert.equal(r.state, "listening");
  assert.equal(r.lastRun, null);
});

test("the schedule reads as the operator says it: every 2 min, every 12 h, every 24 h, every 6 h, continuous", () => {
  const { jobs } = jobsReport({ now: NOW });
  assert.deepEqual(jobs.map((j) => [j.id, j.schedule]),
    [["poll", "every 2 min"], ["watch", "every 12 h"], ["threatfeed", "every 24 h"], ["retention", "every 6 h"], ["pubsub", "continuous"]]);
  assert.deepEqual(jobs.map((j) => j.canRun), [true, true, true, true, false]);
  assert.ok(jobs.every((j) => j.name && j.what), "every job says what it does");
  assert.equal(scheduleLabel(90000), "every 90 s");
  // WORKER=0 in tests: every scheduled job is Off and nothing is due.
  assert.ok(jobs.every((j) => j.health === "off" && j.nextDueAt === null && j.running === false));
});

const memoryStore = () => {
  const rows = [];
  return { rows, async start(run) { rows.push({ ...run }); return rows.length; }, async end(run) { rows[run.id - 1] = { ...run }; } };
};

test("Run now: a second run while one is in flight is refused (409); the record says who started it and how long it took", async () => {
  let release;
  const gate = new Promise((r) => { release = r; });
  const store = memoryStore();
  const jobs = [fake({ id: "slow", run: () => gate.then(() => ({ users: 2 })) })];
  const first = runJob("slow", { jobs, store });
  await assert.rejects(async () => runJob("slow", { jobs, store }), { statusCode: 409, message: "already running" });
  assert.equal(jobsReport({ jobs, now: NOW, worker: true, started: NOW }).jobs[0].health, "running");
  assert.equal(jobsReport({ jobs, now: NOW, worker: true, started: NOW }).jobs[0].running, true);
  release();
  const run = await first;
  assert.equal(run.ok, true);
  assert.deepEqual(run.result, { users: 2 });
  assert.equal(run.trigger, "manual");
  assert.equal(run.id, 1);
  assert.equal(run.error, null);
  assert.ok(typeof run.durationMs === "number" && run.durationMs >= 0);
  assert.ok(Date.parse(run.finishedAt) >= Date.parse(run.startedAt));
  assert.equal(jobs[0].running, false);
  assert.equal(jobs[0].lastRun, run);
  assert.equal(store.rows[0].ok, true, "the row was closed");
  // Once it is done, the job can run again, whoever asks.
  const again = await runJob("slow", { jobs, store, trigger: "schedule" });
  assert.equal(again.id, 2);
  assert.equal(again.trigger, "schedule");
  assert.equal(jobsReport({ jobs, now: Date.now(), worker: true, started: NOW }).jobs[0].health, "ok");
});

test("Run now refuses an unknown job (404) and the listener, which runs on its own (400)", async () => {
  const jobs = [fake(), fake({ id: "pubsub", kind: "loop", run: null, everyMs: null })];
  await assert.rejects(async () => runJob("nope", { jobs }), { statusCode: 404, message: "unknown job" });
  await assert.rejects(async () => runJob("pubsub", { jobs }), { statusCode: 400, message: "this job runs on its own" });
  assert.ok(jobs.every((j) => !j.running && !j.lastRun), "a refusal leaves no trace");
});

test("a failing job is a record with the error line, and a failing job_runs write never stops the job", async () => {
  const logged = [];
  const original = console.error;
  console.error = (line) => logged.push(String(line));
  try {
    const broken = { async start() { throw new Error("no database"); }, async end() { throw new Error("no database"); } };
    const jobs = [fake({ id: "fast" }), fake({ id: "bad", run: async () => { throw new Error("feed 503"); } })];
    const run = await runJob("fast", { jobs, store: broken });
    assert.equal(run.ok, true);
    assert.equal(run.id, null, "no row could be written");
    assert.deepEqual(run.result, { users: 1 });
    assert.ok(logged.some((l) => l.includes("could not record the start of fast") && l.includes("no database")), "the bookkeeping failure is logged");
    const failed = await runJob("bad", { jobs, store: broken });
    assert.equal(failed.ok, false);
    assert.equal(failed.error, "feed 503");
    assert.equal(failed.result, null);
    assert.equal(jobsReport({ jobs, now: Date.now(), worker: true, started: NOW }).jobs[1].health, "failing");
    assert.ok(jobStatus.errors[0].endsWith("bad: feed 503"), "the error line joins the recent errors");
    assert.ok(jobsReport({ jobs }).errors.includes(jobStatus.errors[0]));
  } finally {
    console.error = original;
  }
});
