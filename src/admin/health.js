// The admin console's Overview: one line per dependency with a status word
// (ok, warn, fail, off), the server, and today's counts. Counts, statuses
// and error lines only: never a message, a verdict's words or a secret
// value (key names may be named, values never).

import { readFileSync } from "node:fs";
import { readdir } from "node:fs/promises";
import { performance } from "node:perf_hooks";
import { config, googleConfigured, pubsubConfigured } from "../config.js";
import { pool, many, one } from "../db/pool.js";
import { breaker, museConfigured, museEffort, museLabel, museModel, voiceConfigured, VOICE_MODEL } from "../../lib/muse.js";
import { urlhausState } from "../links/resolver.js";
import { jobStatus, startedAt } from "../jobs/scheduler.js";
import { streamStats } from "../notify/sse.js";

const { version } = JSON.parse(readFileSync(new URL("../../package.json", import.meta.url), "utf8"));
const migrationsDir = new URL("../db/migrations/", import.meta.url);
// "off" has no rank: it never counts against the overall status.
const RANK = { ok: 0, warn: 1, fail: 2 };
const ok = (detail) => ({ status: "ok", detail });
const warn = (detail) => ({ status: "warn", detail });
const fail = (detail) => ({ status: "fail", detail });
const off = (detail) => ({ status: "off", detail });

export function serverInfo() {
  return {
    version, node: process.version, pid: process.pid, startedAt: startedAt.toISOString(),
    uptimeSeconds: Math.round(process.uptime()), memoryMb: Math.round(process.memoryUsage().rss / 1048576),
    baseUrl: config.baseUrl, host: config.host, port: config.port,
    production: config.production, worker: config.worker, pollSeconds: config.pollSeconds,
  };
}

// Two statements, whatever the number of people.
export async function countsReport() {
  const row = await one(`SELECT
      (SELECT count(*)::int FROM users) AS users,
      (SELECT count(*)::int FROM gmail_state) AS seniors,
      (SELECT count(DISTINCT guardian_id)::int FROM guardianships WHERE status = 'active' AND guardian_id IS NOT NULL) AS guardians,
      (SELECT count(*)::int FROM users WHERE lower(email) = ANY($1::text[])) AS admins,
      (SELECT count(*)::int FROM google_tokens WHERE status = 'ok') AS gmail_connected,
      (SELECT count(*)::int FROM google_tokens WHERE status = 'reauth_needed') AS reconnect_needed,
      (SELECT count(*)::int FROM checks) AS checks_total,
      (SELECT count(*)::int FROM alerts WHERE answer IS NULL) AS alerts_waiting,
      (SELECT count(*)::int FROM pattern_cards WHERE status = 'candidate') AS cards_candidate,
      (SELECT count(*)::int FROM pattern_cards WHERE status = 'active') AS cards_active,
      (SELECT count(*)::int FROM outbox WHERE sent_via = 'local-outbox' AND created_at > now() - interval '7 days') AS outbox_waiting,
      (SELECT count(*)::int FROM llm_cache) AS cached_answers`, [config.adminEmails]);
  const day = await one(`SELECT count(*)::int AS total,
                                (count(*) FILTER (WHERE verdict_value = 'safe'))::int AS safe,
                                (count(*) FILTER (WHERE verdict_value = 'be_careful'))::int AS be_careful,
                                (count(*) FILTER (WHERE verdict_value = 'scam'))::int AS scam
                         FROM checks WHERE created_at > now() - interval '24 hours'`);
  return {
    users: row.users, seniors: row.seniors, guardians: row.guardians, admins: row.admins,
    gmailConnected: row.gmail_connected, reconnectNeeded: row.reconnect_needed,
    checks24h: { total: day.total, safe: day.safe, be_careful: day.be_careful, scam: day.scam }, checksTotal: row.checks_total,
    alertsWaiting: row.alerts_waiting, cardsCandidate: row.cards_candidate, cardsActive: row.cards_active,
    outboxWaiting: row.outbox_waiting, liveConnections: streamStats().connections, cachedAnswers: row.cached_answers,
  };
}

async function databaseCheck() {
  const t0 = performance.now();
  try {
    await pool.query("SELECT 1");
    const ms = Math.round(performance.now() - t0);
    const applied = (await many("SELECT name FROM schema_migrations ORDER BY name")).map((r) => r.name);
    const files = (await readdir(migrationsDir)).filter((f) => f.endsWith(".sql")).sort();
    const pending = files.filter((f) => !applied.includes(f));
    const latest = applied.at(-1)?.replace(/\.sql$/, "") || "none";
    const busy = pool.totalCount - pool.idleCount;
    const detail = `${ms < 1 ? "<1" : ms} ms; ${applied.length} migrations, latest ${latest}; pool ${busy} busy of ${pool.options?.max ?? 10}, ${pool.waitingCount} waiting`;
    return pending.length ? warn(`${detail}; not applied: ${pending.map((f) => f.replace(/\.sql$/, "")).join(", ")}`) : ok(detail);
  } catch (e) {
    return fail(String(e.message || e));
  }
}

function modelCheck(cachedAnswers) {
  if (!museConfigured()) return off(`Off (no API key for ${museLabel()}); detector only`);
  const base = `${museLabel()} (${museModel()}), effort ${museEffort() || "none"}; ${breaker.failures} failures in a row; ${cachedAnswers ?? "?"} cached answers`;
  if (breaker.openUntil > Date.now()) return fail(`Paused after errors until ${new Date(breaker.openUntil).toISOString()}; ${base}`);
  return breaker.failures > 0 ? warn(base) : ok(base);
}

function instantChecksCheck() {
  if (!pubsubConfigured()) return off("Not configured (GMAIL_PUBSUB_TOPIC, GMAIL_PUBSUB_SUBSCRIPTION); polling only");
  const state = String(jobStatus.pubsub);
  if (state === "listening") return ok("Listening for Gmail push events");
  if (state.startsWith("error")) return fail(state);
  return warn("Configured but not listening (worker off in this process)");
}

export async function healthReport() {
  const now = new Date().toISOString();
  const counts = await countsReport().catch(() => null);
  const database = await databaseCheck();
  const live = streamStats();
  const list = [
    ["database", "Postgres", database],
    ["model", museLabel(), modelCheck(counts?.cachedAnswers)],
    ["google", "Google sign-in", googleConfigured() ? ok("Client configured; tokens encrypted")
      : off("Not configured (GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, TOKEN_ENC_KEY); demo only")],
    ["instant_checks", "Instant checks (Gmail push)", instantChecksCheck()],
    ["worker", "Background worker", config.worker ? ok(`On in this process; poll every ${config.pollSeconds} s`)
      : warn("Off in this process (WORKER=0): nothing runs in the background")],
    ["email", "Email", config.resend.apiKey ? ok("Resend configured")
      : off(`Local outbox (no RESEND_API_KEY); ${counts?.outboxWaiting ?? "?"} emails waiting`)],
    ["links", "Link lookups (URLhaus)", !config.abusechKey ? off("Off (no ABUSECH_AUTH_KEY)")
      : urlhausState.off ? warn(`Refused: ${urlhausState.off}`) : ok("On (host names only)")],
    ["breaches", "Breach lookups (HIBP)", config.hibpKey ? ok("HIBP configured") : off("Off (no HIBP_API_KEY); curated list only")],
    ["voice", "Voice notes (Muse Voice Transcribe)", voiceConfigured() ? ok(VOICE_MODEL) : off("Off (no META_MODEL_API_KEY)")],
    ["live_updates", "Live updates (SSE)", ok(`${live.connections} open connections for ${live.people} people`)],
  ];
  const checks = list.map(([id, name, c]) => ({ id, name, status: c.status, detail: c.detail, checkedAt: now }));
  const overall = checks.reduce((worst, c) => ((RANK[c.status] ?? -1) > RANK[worst] ? c.status : worst), "ok");
  return { generatedAt: now, overall, server: serverInfo(), checks, counts };
}
