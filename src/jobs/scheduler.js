// Background work inside the server process (single local process):
// - Gmail push events from Pub/Sub, when configured (instant checks)
// - polling every SYNC_POLL_SECONDS as a backup, or as the only trigger
// - daily: renew Gmail watches, threat feed, retention
// Failures are logged loudly and retried on the next tick; nothing here
// is allowed to crash the server.

import { config, pubsubConfigured } from "../config.js";
import { many, one, q } from "../db/pool.js";
import { syncUser, usersToSync, clientFor } from "../sync/worker.js";
import { pullGmailEvents } from "../google/pubsub.js";
import { runThreatFeed } from "./threatfeed.js";
import { runRetention } from "./retention.js";

const HOUR = 3600000;
const timers = [];
let stopping = false;
export const jobStatus = { pubsub: "off", lastPoll: null, lastFeed: null, lastRetention: null, lastWatchRenewal: null, errors: [] };

function note(err, where) {
  const line = `${new Date().toISOString()} ${where}: ${err.message || err}`;
  console.error(`[jobs] ${line}`);
  jobStatus.errors = [line, ...jobStatus.errors].slice(0, 20);
}

async function pollAll() {
  for (const { id } of await usersToSync()) await syncUser(id).catch((e) => note(e, "sync"));
  jobStatus.lastPoll = new Date().toISOString();
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

function every(ms, fn, name, runNow = false) {
  const wrapped = () => fn().catch((e) => note(e, name));
  if (runNow) setTimeout(wrapped, 2000);
  timers.push(setInterval(wrapped, ms));
}

export function startJobs() {
  if (!config.worker) return;
  every(config.pollSeconds * 1000, pollAll, "poll", true);
  every(12 * HOUR, renewWatches, "watch", true);
  every(24 * HOUR, async () => { jobStatus.lastFeed = { at: new Date().toISOString(), ...(await runThreatFeed()) }; }, "threatfeed", true);
  every(6 * HOUR, async () => { jobStatus.lastRetention = { at: new Date().toISOString(), ...(await runRetention()) }; }, "retention", true);
  if (pubsubConfigured()) pubsubLoop();
}

export function stopJobs() {
  stopping = true;
  timers.forEach(clearInterval);
}
