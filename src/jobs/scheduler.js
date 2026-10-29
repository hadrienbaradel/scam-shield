// Background work inside the server process (single local process):
// - Gmail push events from Pub/Sub, when configured (instant checks)
// - polling every SYNC_POLL_SECONDS as a backup, or as the only trigger
// - every 12 h: renew Gmail watches; daily: threat feed; every 6 h: retention
// Failures are logged loudly and retried on the next tick; nothing here
// is allowed to crash the server.
// Every run goes through runJob, which writes a job_runs row (start, end,
// result counts or the error line) so the admin console's jobs page and its
// health survive a restart. The bookkeeping itself never stops a job: a
// database error there is only logged. A run cut by a restart or a crash is
// closed as failed ("interrupted") at the next start.

import { config, pubsubConfigured } from "../config.js";
import { many, one, q } from "../db/pool.js";
import { syncUser, usersToSync, clientFor, mapLimit } from "../sync/worker.js";
import { pullGmailEvents } from "../google/pubsub.js";
import { runThreatFeed, SOURCES } from "./threatfeed.js";
import { runRetention } from "./retention.js";

const MINUTE = 60000;
const HOUR = 3600000;
const timers = [];
let stopping = false;
export const startedAt = new Date();
export const jobStatus = { pubsub: "off", lastPoll: null, lastFeed: null, lastRetention: null, lastWatchRenewal: null, errors: [] };

function note(err, where) {
  const line = `${new Date().toISOString()} ${where}: ${err.message || err}`;
  console.error(`[jobs] ${line}`);
  jobStatus.errors = [line, ...jobStatus.errors].slice(0, 20);
}

// Several mailboxes at a time, so one slow mailbox never delays the rest.
async function pollAll() {
  const users = await usersToSync();
  await mapLimit(users, 4, ({ id }) => syncUser(id).catch((e) => note(e, "sync")));
  jobStatus.lastPoll = new Date().toISOString();
  return { users: users.length };
}

export async function renewWatches() {
  if (!pubsubConfigured()) return 0;
  let renewed = 0;
  const due = await many(`SELECT s.user_id FROM gmail_state s JOIN google_tokens t ON t.user_id = s.user_id
                          WHERE t.status = 'ok' AND (s.watch_expiration IS NULL OR s.watch_expiration < now() + interval '2 days')`);
  for (const { user_id: userId } of due) {
    try {
      const res = await clientFor(userId).watch(config.google.pubsubTopic);
      await q("UPDATE gmail_state SET watch_expiration = $2 WHERE user_id = $1", [userId, new Date(Number(res.expiration))]);
      renewed++;
    } catch (e) { note(e, `watch ${userId}`); }
  }
  jobStatus.lastWatchRenewal = new Date().toISOString();
  return renewed;
}

// The feed reader carries on past a dead source and only lists it in
// report.errors, so the job says it: each line joins the recent errors, and
// when every source failed the run fails (Failing in the console) instead of
// passing with nothing fetched. A partial outage stays OK. fetchImpl: tests.
export async function threatFeedRun({ fetchImpl } = {}) {
  const report = await runThreatFeed({ fetchImpl });
  jobStatus.lastFeed = { at: new Date().toISOString(), ...report };
  for (const line of report.errors) note(line, "threatfeed");
  if (report.errors.length >= SOURCES.length) throw Object.assign(new Error(report.errors.join("; ")), { noted: true });
  return report;
}

async function pubsubLoop() {
  jobStatus.pubsub = "listening";
  while (!stopping) {
    try {
      for (const ev of await pullGmailEvents()) {
        const row = await one("SELECT user_id FROM gmail_state WHERE lower(email) = lower($1) AND backfill_done", [ev.emailAddress]);
        if (row) syncUser(row.user_id).catch((e) => note(e, "push sync"));
      }
    } catch (e) {
      jobStatus.pubsub = `error: ${e.message}`;
      note(e, "pubsub");
      await new Promise((r) => setTimeout(r, 15000));
      jobStatus.pubsub = "listening";
    }
  }
}

// ------------------------------------------------------------ registry ---
// Every piece of background work, with its in-memory state (running,
// lastRun, nextDueAt). The listener is listed so the console shows it, but
// it runs on its own: no Run now, no job_runs rows.
const job = (fields) => ({ running: false, lastRun: null, nextDueAt: null, ...fields });
export const JOBS = [
  job({ id: "poll", name: "Gmail poll", what: "Checks every connected mailbox for new mail (backup for push, or the only trigger)",
    kind: "interval", everyMs: config.pollSeconds * 1000, run: pollAll }),
  job({ id: "watch", name: "Gmail push renewal", what: "Renews the Gmail push subscriptions that expire within 2 days",
    kind: "interval", everyMs: 12 * HOUR, run: async () => ({ renewed: await renewWatches() }) }),
  job({ id: "threatfeed", name: "Threat feed", what: "Turns new IC3 and cybermalveillance.gouv.fr alerts into candidate scam cards",
    kind: "interval", everyMs: 24 * HOUR, run: () => threatFeedRun() }),
  job({ id: "retention", name: "Retention", what: "Deletes old verdicts, sessions, outbox mail, cached answers and job runs; retires stale cards",
    kind: "interval", everyMs: 6 * HOUR, run: async () => {
      const counts = await runRetention();
      jobStatus.lastRetention = { at: new Date().toISOString(), ...counts };
      return counts;
    } }),
  job({ id: "pubsub", name: "Instant checks listener", what: "Pulls Gmail push events from Pub/Sub and syncs the mailbox at once",
    kind: "loop", everyMs: null, run: null }),
];

export const canRun = (j) => j.kind === "interval" && typeof j.run === "function";

// "every 2 min", "every 12 h", "continuous": how the operator says it.
export function scheduleLabel(everyMs) {
  if (!everyMs) return "continuous";
  if (everyMs % HOUR === 0) return `every ${everyMs / HOUR} h`;
  if (everyMs % MINUTE === 0) return `every ${everyMs / MINUTE} min`;
  return `every ${Math.round(everyMs / 1000)} s`;
}

// ------------------------------------------------------------ job_runs ---
const iso = (d) => (d ? new Date(d).toISOString() : null);
const runFromRow = (r) => ({
  id: r.id, job: r.job, trigger: r.trigger, startedAt: iso(r.started_at), finishedAt: iso(r.finished_at),
  durationMs: r.finished_at ? new Date(r.finished_at) - new Date(r.started_at) : null, ok: r.ok, result: r.result, error: r.error,
});

// Where runs are written. Tests inject their own (a memory, or one that fails).
export const jobRunStore = {
  start: async (run) => (await one("INSERT INTO job_runs (job, trigger, started_at) VALUES ($1, $2, $3) RETURNING id::int AS id",
    [run.job, run.trigger, run.startedAt])).id,
  end: (run) => q("UPDATE job_runs SET finished_at = $2, ok = $3, result = $4::jsonb, error = $5 WHERE id = $1",
    [run.id, run.finishedAt, run.ok, run.result == null ? null : JSON.stringify(run.result), run.error]),
};

async function guarded(what, fn) {
  try { return await fn(); } catch (e) { console.error(`[jobs] ${what}: ${e.message || e}`); return null; }
}

const refuse = (statusCode, message) => Object.assign(new Error(message), { statusCode });

// Starts one run and returns a promise of its record ({ id, job, trigger,
// startedAt, finishedAt, durationMs, ok, result, error }); the promise never
// rejects (a failing job is a record with ok false). Refusals are thrown
// synchronously with a statusCode: 404 unknown, 400 runs on its own, 409
// already running.
export function runJob(id, { trigger = "manual", jobs = JOBS, store = jobRunStore } = {}) {
  const j = jobs.find((x) => x.id === id);
  if (!j) throw refuse(404, "unknown job");
  if (!canRun(j)) throw refuse(400, "this job runs on its own");
  if (j.running) throw refuse(409, "already running");
  j.running = true;
  return (async () => {
    const started = new Date();
    const run = { id: null, job: id, trigger, startedAt: started.toISOString(), finishedAt: null, durationMs: null, ok: null, result: null, error: null };
    run.id = await guarded(`could not record the start of ${id}`, () => store.start(run));
    try {
      const result = await j.run();
      run.result = result && typeof result === "object" ? result : null;
      run.ok = true;
    } catch (e) {
      run.ok = false;
      run.error = String(e?.message || e).slice(0, 500);
      // A job that already noted its own lines (the threat feed, one per
      // source) is not noted a second time.
      if (!e?.noted) note(e, id);
    } finally {
      const finished = new Date();
      run.finishedAt = finished.toISOString();
      run.durationMs = finished - started;
      j.running = false;
      j.lastRun = run;
      if (run.id != null) await guarded(`could not record the end of ${id}`, () => store.end(run));
    }
    return run;
  })();
}

// After a restart the in-memory state is empty: the last finished run of
// each job comes back from the table, so the health is honest at once.
export async function hydrateJobs({ jobs = JOBS } = {}) {
  if (!jobs.some((j) => canRun(j) && !j.lastRun)) return;
  const rows = await guarded("could not read job_runs", () => many(`SELECT DISTINCT ON (job) id::int AS id, job, trigger, started_at, finished_at, ok, result, error
                                                                       FROM job_runs WHERE finished_at IS NOT NULL ORDER BY job, started_at DESC, id DESC`));
  for (const row of rows || []) {
    const j = jobs.find((x) => x.id === row.job);
    if (j && !j.lastRun) j.lastRun = runFromRow(row);
  }
}

// A run cut by a restart or a crash never got its end written: at the next
// start it is closed as failed, so the history never shows it Running for
// the 30 days it is kept. `before` is this process's start (a run begun
// since is this process's own). Returns how many were closed; 0 when the
// database cannot be reached, which is only logged.
export async function closeInterruptedRuns({ before = startedAt } = {}) {
  const res = await guarded("could not close interrupted runs", () => q(`UPDATE job_runs SET finished_at = now(), ok = false,
    error = 'interrupted: the server stopped during this run' WHERE finished_at IS NULL AND started_at < $1`, [before]));
  return res?.rowCount ?? 0;
}

export async function recentRuns({ limit = 100 } = {}) {
  const rows = await many("SELECT id::int AS id, job, trigger, started_at, finished_at, ok, result, error FROM job_runs ORDER BY started_at DESC, id DESC LIMIT $1", [limit]);
  return rows.map(runFromRow);
}

// --------------------------------------------------------------- report ---
// Health of one job (spec line 6). Pure: the clock, the process start, the
// worker flag and the listener state are all parameters.
export function jobHealth(j, { now = Date.now(), started = startedAt.getTime(), worker = config.worker, pubsub = jobStatus.pubsub } = {}) {
  if (j.kind === "loop") return pubsub === "listening" ? "ok" : String(pubsub).startsWith("error") ? "failing" : "off";
  if (!worker) return "off";
  if (j.running) return "running";
  const last = j.lastRun;
  if (last && !last.ok) return "failing";
  const window = 2 * j.everyMs;
  if (!last) return now - started < window ? "pending" : "stale";
  return now - Date.parse(last.finishedAt || last.startedAt) > window ? "stale" : "ok";
}

export function jobsReport({ jobs = JOBS, now = Date.now(), started = startedAt.getTime(), worker = config.worker, pubsub = jobStatus.pubsub, errors = jobStatus.errors } = {}) {
  return {
    jobs: jobs.map((j) => ({
      id: j.id, name: j.name, what: j.what, kind: j.kind, schedule: scheduleLabel(j.everyMs), everyMs: j.everyMs ?? null, canRun: canRun(j),
      health: jobHealth(j, { now, started, worker, pubsub }), running: Boolean(j.running), nextDueAt: j.nextDueAt ?? null,
      state: j.kind === "loop" ? String(pubsub) : null, lastRun: j.lastRun ?? null,
    })),
    errors: [...errors],
  };
}

// ------------------------------------------------------------ schedule ---
// A tick that finds the job still running (a slow poll) is skipped silently;
// the next one is in everyMs anyway. The startup run comes 2 s after the
// interval is set, so from it the next tick is 2 s less than everyMs away.
function every(j, runNow = false) {
  const tick = (trigger) => () => {
    j.nextDueAt = new Date(Date.now() + j.everyMs - (trigger === "startup" ? 2000 : 0)).toISOString();
    if (j.running) return;
    try { runJob(j.id, { trigger }).catch((e) => note(e, j.id)); } catch (e) { note(e, j.id); }
  };
  if (runNow) {
    j.nextDueAt = new Date(Date.now() + 2000).toISOString();
    timers.push(setTimeout(tick("startup"), 2000));
  } else {
    j.nextDueAt = new Date(Date.now() + j.everyMs).toISOString();
  }
  timers.push(setInterval(tick("schedule"), j.everyMs));
}

export function startJobs() {
  if (!config.worker) return;
  closeInterruptedRuns().catch((e) => note(e, "job_runs"));
  for (const j of JOBS) if (canRun(j)) every(j, true);
  if (pubsubConfigured()) pubsubLoop();
}

export function stopJobs() {
  stopping = true;
  timers.forEach(clearInterval);
}
