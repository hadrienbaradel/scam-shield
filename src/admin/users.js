// The admin console's people pages: every account with its roles, Gmail
// state and counts; one person's page (context coverage, recent checks,
// trusted people, phones, audit); the outbox. Counts, statuses, timestamps
// and ids only: never a message's text, subject or sender, a verdict's
// headline or reasons, or anything a senior shared with a guardian.

import { isAdmin } from "../config.js";
import { many, one } from "../db/pool.js";

const iso = (d) => (d ? new Date(d).toISOString() : null);

// One statement for the list, whatever the number of people: the per-person
// counts are LATERAL subqueries over indexed columns, never a loop.
const USER_SQL = `
  SELECT u.id, u.email, u.name, u.locale, u.created_at, u.last_seen_at, u.onboarded, u.act_mode, u.auto_alert,
         (s.user_id IS NOT NULL) AS is_senior, s.email AS gmail_email, s.sync_status, s.sync_error, s.last_sync_at, s.backfill_done, s.watch_expiration,
         t.status AS token_status,
         EXISTS (SELECT 1 FROM guardianships g WHERE g.guardian_id = u.id AND g.status = 'active') AS is_guardian,
         c.total, c.safe, c.be_careful, c.scam, c.last24h,
         g.active AS guardians_active, g.invited AS guardians_invited,
         d.active AS devices_active,
         a.waiting AS alerts_waiting, a.answered AS alerts_answered,
         x.active AS sessions_active
  FROM users u
  LEFT JOIN gmail_state s ON s.user_id = u.id
  LEFT JOIN google_tokens t ON t.user_id = u.id
  LEFT JOIN LATERAL (SELECT count(*)::int AS total,
                            (count(*) FILTER (WHERE verdict_value = 'safe'))::int AS safe,
                            (count(*) FILTER (WHERE verdict_value = 'be_careful'))::int AS be_careful,
                            (count(*) FILTER (WHERE verdict_value = 'scam'))::int AS scam,
                            (count(*) FILTER (WHERE created_at > now() - interval '24 hours'))::int AS last24h
                     FROM checks WHERE user_id = u.id) c ON true
  LEFT JOIN LATERAL (SELECT (count(*) FILTER (WHERE status = 'active'))::int AS active,
                            (count(*) FILTER (WHERE status = 'invited'))::int AS invited
                     FROM guardianships WHERE senior_id = u.id) g ON true
  LEFT JOIN LATERAL (SELECT count(*)::int AS active FROM devices WHERE user_id = u.id AND token_hash IS NOT NULL AND revoked_at IS NULL) d ON true
  LEFT JOIN LATERAL (SELECT (count(*) FILTER (WHERE answer IS NULL))::int AS waiting,
                            (count(*) FILTER (WHERE answer IS NOT NULL))::int AS answered
                     FROM alerts WHERE senior_id = u.id) a ON true
  LEFT JOIN LATERAL (SELECT count(*)::int AS active FROM sessions WHERE user_id = u.id AND expires_at > now()) x ON true`;

function toUser(r) {
  const roles = [];
  if (r.is_senior) roles.push("senior");
  if (r.is_guardian) roles.push("guardian");
  if (isAdmin(r.email)) roles.push("admin");
  return {
    id: r.id, email: r.email, name: r.name, locale: r.locale, roles,
    createdAt: iso(r.created_at), lastSeenAt: iso(r.last_seen_at), onboarded: r.onboarded, actMode: r.act_mode, autoAlert: r.auto_alert,
    gmail: r.is_senior ? {
      email: r.gmail_email, tokenStatus: r.token_status || "none", syncStatus: r.sync_status, syncError: r.sync_error,
      lastSyncAt: iso(r.last_sync_at), backfillDone: r.backfill_done, watchExpiration: iso(r.watch_expiration),
      pushActive: Boolean(r.watch_expiration && new Date(r.watch_expiration) > new Date()),
    } : null,
    checks: { total: r.total, safe: r.safe, be_careful: r.be_careful, scam: r.scam, last24h: r.last24h },
    guardians: { active: r.guardians_active, invited: r.guardians_invited },
    devices: { active: r.devices_active },
    alerts: { waiting: r.alerts_waiting, answered: r.alerts_answered },
    sessions: r.sessions_active,
  };
}

export async function listUsers() {
  return (await many(`${USER_SQL} ORDER BY u.created_at DESC, u.id`)).map(toUser);
}

const CONTEXT_KINDS = ["providers", "orders", "subscriptions", "trustedContacts", "knownSenders", "breaches", "knownLinkDomains"];
// Audit details hold ids and modes, but one event (put_back) also notes the
// sender it learned: only these keys reach the console.
const SAFE_DETAIL_KEYS = ["checkId", "guardianshipId", "alertId", "deviceId", "actMode", "kind", "to", "answer", "wasAction", "verdict", "action"];
const safeDetail = (detail) => (detail && typeof detail === "object"
  ? Object.fromEntries(Object.entries(detail).filter(([k]) => SAFE_DETAIL_KEYS.includes(k))) : null);

export async function userDetail(id) {
  const row = await one(`${USER_SQL} WHERE u.id = $1`, [id]);
  if (!row) return null;
  const [ctx, guardians, devices, checks, audit] = await Promise.all([
    one("SELECT data, built_at FROM contexts WHERE user_id = $1", [id]),
    many(`SELECT id, guardian_name, guardian_email, relation, status, created_at, accepted_at
          FROM guardianships WHERE senior_id = $1 ORDER BY created_at DESC`, [id]),
    many(`SELECT id, name, created_at, last_seen_at, revoked_at FROM devices
          WHERE user_id = $1 AND token_hash IS NOT NULL ORDER BY created_at DESC`, [id]),
    // Never the verdict itself (headline, reasons), the subject, the sender or the Gmail id.
    many(`SELECT id, created_at, channel, verdict_value, source, COALESCE(verdict->'degraded' = 'true'::jsonb, false) AS degraded,
                 latency_ms, action, restored_at, user_feedback
          FROM checks WHERE user_id = $1 ORDER BY created_at DESC LIMIT 20`, [id]),
    many("SELECT event, detail, at FROM audit_log WHERE user_id = $1 ORDER BY at DESC LIMIT 30", [id]),
  ]);
  const data = ctx?.data || null;
  return {
    user: toUser(row),
    context: ctx ? {
      builtAt: iso(ctx.built_at),
      coverage: data?.coverage ? { emailsRead: data.coverage.emailsRead ?? null, since: data.coverage.since ?? null } : null,
      counts: Object.fromEntries(CONTEXT_KINDS.map((k) => [k, Array.isArray(data?.[k]) ? data[k].length : 0])),
    } : null,
    guardians: guardians.map((g) => ({ id: g.id, name: g.guardian_name, email: g.guardian_email, relation: g.relation, status: g.status,
      createdAt: iso(g.created_at), acceptedAt: iso(g.accepted_at) })),
    devices: devices.map((d) => ({ id: d.id, name: d.name, createdAt: iso(d.created_at), lastSeenAt: iso(d.last_seen_at), revokedAt: iso(d.revoked_at) })),
    recentChecks: checks.map((c) => ({ id: c.id, createdAt: iso(c.created_at), channel: c.channel, verdict: c.verdict_value, source: c.source,
      degraded: c.degraded, latencyMs: c.latency_ms, action: c.action, restoredAt: iso(c.restored_at), userFeedback: c.user_feedback })),
    audit: audit.map((a) => ({ event: a.event, at: iso(a.at), detail: safeDetail(a.detail) })),
  };
}

// The emails Prudence sent or would have sent: to, subject, channel and
// time, never the text. An alert's text is what the senior shared with the
// guardian, and a local-outbox copy holds live one-tap links.
export async function outboxList() {
  const rows = await many("SELECT id, to_email, subject, sent_via, created_at FROM outbox ORDER BY created_at DESC LIMIT 50");
  return rows.map((m) => ({ id: m.id, to: m.to_email, subject: m.subject, via: m.sent_via, createdAt: iso(m.created_at) }));
}
