// Gmail sync for one user.
// First run: create the Prudence labels, learn the personal context
// from ~180 days of mail and the Sent folder, then check the latest inbox
// messages. After that: only new inbox messages, via Gmail's history
// (triggered by push notifications, or by the poller as a backup).

import { config } from "../config.js";
import { many, one, q, pool } from "../db/pool.js";
import { gmailClient, ensureLabels, normalizeMessage } from "../google/gmail.js";
import { accessTokenFor } from "../google/tokens.js";
import { ReauthNeeded } from "../google/oauth.js";
import { buildContext, hibpBreaches } from "../context/builder.js";
import { decideAction, applyDecision, audit } from "./actions.js";
import { runCheck, recordCheck } from "./checker.js";
import { publish } from "../notify/sse.js";
import { alertGuardians } from "../guardians.js";

export async function mapLimit(items, limit, fn) {
  const out = new Array(items.length);
  let i = 0;
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (i < items.length) {
      const idx = i++;
      out[idx] = await fn(items[idx], idx);
    }
  }));
  return out;
}

export const clientFor = (userId, opts) => gmailClient(() => accessTokenFor(userId), opts);

async function listIds(client, query, max) {
  const ids = [];
  let pageToken;
  do {
    const res = await client.listMessages({ ...query, maxResults: Math.min(100, max - ids.length), pageToken });
    ids.push(...(res.messages || []).map((m) => m.id));
    pageToken = res.nextPageToken;
  } while (pageToken && ids.length < max);
  return ids;
}

const running = new Map();
// One sync per user at a time; a trigger arriving mid-sync queues one rerun.
export function syncUser(userId, opts = {}) {
  const cur = running.get(userId);
  if (cur) { cur.again = true; return cur.promise; }
  const entry = { again: false };
  entry.promise = (async () => {
    try {
      do { entry.again = false; await syncOnce(userId, opts); } while (entry.again);
    } finally { running.delete(userId); }
  })();
  running.set(userId, entry);
  return entry.promise;
}

// One sync per user across ALL server processes: a Postgres advisory lock,
// held for the duration of the sync. A second process simply skips.
async function syncOnce(userId, opts = {}) {
  const lease = await pool.connect();
  try {
    const { rows } = await lease.query("SELECT pg_try_advisory_lock(hashtext($1)) AS ok", [`sync:${userId}`]);
    if (!rows[0].ok) return { skipped: "another process is syncing this user" };
    try { return await syncLocked(userId, opts); } finally {
      await lease.query("SELECT pg_advisory_unlock(hashtext($1))", [`sync:${userId}`]).catch(() => {});
    }
  } finally {
    lease.release();
  }
}

async function syncLocked(userId, { client: injected } = {}) {
  const user = await one("SELECT * FROM users WHERE id = $1", [userId]);
  const state = await one("SELECT * FROM gmail_state WHERE user_id = $1", [userId]);
  if (!user || !state) return;
  const client = injected || clientFor(userId);
  await q("UPDATE gmail_state SET sync_status = 'syncing' WHERE user_id = $1", [userId]);
  publish(userId, "sync", { status: "syncing" });
  try {
    let labels = { scam: state.label_scam, careful: state.label_careful };
    if (!labels.scam || !labels.careful) {
      labels = await ensureLabels(client);
      await q("UPDATE gmail_state SET label_scam = $2, label_careful = $3 WHERE user_id = $1", [userId, labels.scam, labels.careful]);
    }
    await reconcilePending({ user, client, labels });
    const stats = state.backfill_done
      ? await incremental({ user, state: await one("SELECT * FROM gmail_state WHERE user_id = $1", [userId]), client, labels })
      : await backfill({ user, state, client, labels });
    await q("UPDATE gmail_state SET sync_status = 'ok', sync_error = NULL, last_sync_at = now() WHERE user_id = $1", [userId]);
    publish(userId, "sync", { status: "ok", ...stats });
    return stats;
  } catch (e) {
    const status = e instanceof ReauthNeeded ? "reauth_needed" : "error";
    await q("UPDATE gmail_state SET sync_status = $2, sync_error = $3 WHERE user_id = $1", [userId, status, String(e.message || e).slice(0, 500)]);
    publish(userId, "sync", { status, error: status === "error" ? "Gmail could not be read just now." : undefined });
    if (status === "error") console.error(`[sync] ${user.email}: ${e.message}`);
  }
}

export async function rebuildContext({ user, client }) {
  const profileEmail = (await one("SELECT email FROM gmail_state WHERE user_id = $1", [user.id]))?.email || user.email;
  const recentIds = await listIds(client, { q: "newer_than:180d -in:spam -in:trash -in:sent -in:chats" }, config.contextScanCount);
  const recent = (await mapLimit(recentIds, 5, async (id) => {
    try { return normalizeMessage(await client.getMessage(id)); } catch { return null; }
  })).filter(Boolean);
  const sentIds = await listIds(client, { q: "in:sent newer_than:365d" }, 200);
  const sent = (await mapLimit(sentIds, 5, async (id) => {
    try { return await client.getMessage(id, "metadata", ["To", "Cc"]); } catch { return null; }
  })).filter(Boolean);
  const previous = (await one("SELECT data FROM contexts WHERE user_id = $1", [user.id]))?.data || null;
  const ctx = buildContext({ userName: user.name, selfEmail: profileEmail.toLowerCase(), messages: recent, sent, previous });
  try {
    const found = await hibpBreaches(profileEmail, config.hibpKey);
    const have = new Set((ctx.breaches || []).map((b) => b.id || b.source));
    ctx.breaches = [...(ctx.breaches || []), ...found.filter((b) => !have.has(b.id))];
  } catch (e) { console.warn(`[hibp] ${e.message}`); }
  await q(`INSERT INTO contexts (user_id, data, built_at, updated_at) VALUES ($1, $2, now(), now())
           ON CONFLICT (user_id) DO UPDATE SET data = EXCLUDED.data, built_at = now(), updated_at = now()`, [user.id, ctx]);
  publish(user.id, "context", { scanned: recent.length, sent: sent.length });
  return { recent, ctx };
}

async function backfill({ user, client, labels }) {
  const profile = await client.profile();
  await q("UPDATE gmail_state SET email = $2 WHERE user_id = $1", [user.id, profile.emailAddress]);
  const { recent } = await rebuildContext({ user, client });
  const byId = new Map(recent.map((m) => [m.id, m]));
  const inboxIds = await listIds(client, { labelIds: ["INBOX"] }, config.backfillCount);
  let checked = 0;
  for (const id of inboxIds) {
    if (await checkAndAct({ user, client, labels, id, known: byId.get(id) })) checked++;
  }
  await q("UPDATE gmail_state SET history_id = $2, backfill_done = true WHERE user_id = $1", [user.id, profile.historyId]);
  return { checked, backfill: true };
}

async function incremental({ user, state, client, labels }) {
  const ids = new Set();
  let latest = state.history_id;
  try {
    let pageToken;
    do {
      const res = await client.listHistory(state.history_id, pageToken);
      for (const h of res.history || []) {
        for (const a of h.messagesAdded || []) if ((a.message.labelIds || []).includes("INBOX")) ids.add(a.message.id);
        for (const a of h.labelsAdded || []) if ((a.labelIds || []).includes("INBOX")) ids.add(a.message.id);
      }
      latest = res.historyId || latest;
      pageToken = res.nextPageToken;
    } while (pageToken);
  } catch (e) {
    if (e.status !== 404) throw e;
    // Gmail no longer has history that old (about a week). Take the NEW
    // position first, so nothing arriving during the rescan is lost, then
    // rescan everything since the last good sync (a day of margin),
    // page by page. Already-checked messages are skipped cheaply.
    latest = (await client.profile()).historyId;
    const since = Math.floor(((state.last_sync_at?.getTime() || Date.now() - 7 * 86400000) - 86400000) / 1000);
    for (const id of await listIds(client, { labelIds: ["INBOX"], q: `after:${since}` }, 2000)) ids.add(id);
  }
  let checked = 0;
  for (const id of ids) if (await checkAndAct({ user, client, labels, id })) checked++;
  await q("UPDATE gmail_state SET history_id = $2 WHERE user_id = $1", [user.id, latest]);
  return { checked };
}

async function threadHistoryFor(client, msg) {
  if (!msg.threadId || msg.threadId === msg.id) return [];
  try {
    const thread = await client.getThread(msg.threadId);
    return (thread.messages || []).filter((m) => m.id !== msg.id).slice(-5)
      .map(normalizeMessage).map((m) => ({ from: m.from, date: m.date, body: m.body.slice(0, 1000) }));
  } catch { return []; }
}

export async function checkAndAct({ user, client, labels, id, known, resolveLinks = false }) {
  if (await one("SELECT 1 FROM checks WHERE user_id = $1 AND gmail_message_id = $2", [user.id, id])) return false;
  let raw;
  try { raw = await client.getMessage(id); } catch (e) { if (e.status === 404) return false; throw e; }
  const message = known || normalizeMessage(raw);
  if (!message.labelIds.includes("INBOX")) return false;
  const self = (await one("SELECT email FROM gmail_state WHERE user_id = $1", [user.id]))?.email || user.email;
  if (message.from === String(self).toLowerCase()) return false;

  const { verdict, ctx } = await runCheck({ user, message, threadHistory: await threadHistoryFor(client, raw), resolveLinks });
  const decision = decideAction({ verdict, message, ctx, actMode: user.act_mode, moveConsent: Boolean(user.move_consent_at) });
  // Claim the message and write down what we are about to do BEFORE
  // touching Gmail: if we crash in between, the next sync finishes it.
  const check = await recordCheck({ userId: user.id, message, verdict, channel: "email",
    action: decision.label ? "pending" : "none", planned: decision.label ? decision : null });
  if (!check) return false;
  const action = decision.label ? await finishAction({ client, labels, check, decision, userId: user.id }) : "none";
  publish(user.id, "check", { checkId: check.id, messageId: id, verdict: verdict.verdict, action });
  if (user.auto_alert && verdict.escalate_to_guardian && verdict.verdict !== "safe") {
    await alertGuardians({ senior: user, checkId: check.id, shared: sharedFrom(message, verdict, false), auto: true });
  }
  return true;
}

// Applying a decision is idempotent (adding a label twice is harmless), so
// a pending action can be retried until it is recorded as done.
export async function finishAction({ client, labels, check, decision, userId }) {
  const action = await applyDecision(client, labels, check.gmail_message_id, decision);
  await q("UPDATE checks SET action = $2, planned = NULL WHERE id = $1", [check.id, action]);
  if (action !== "none") {
    await audit(userId, action === "moved" ? "moved_out_of_inbox" : "labeled",
      { checkId: check.id, messageId: check.gmail_message_id, verdict: check.verdict_value, protectedSender: decision.protectedSender });
  }
  return action;
}

async function reconcilePending({ user, client, labels }) {
  const pending = await many(`SELECT * FROM checks WHERE user_id = $1 AND action = 'pending' AND created_at > now() - interval '7 days'`, [user.id]);
  for (const check of pending) {
    try {
      await finishAction({ client, labels, check, decision: check.planned, userId: user.id });
    } catch (e) {
      if (e.status !== 404) throw e;
      await q("UPDATE checks SET action = 'none', planned = NULL WHERE id = $1", [check.id]);
    }
  }
}

// Exactly what a guardian gets to see. The email text itself is included
// only when the senior ticks "include the message text".
export function sharedFrom(message, verdict, includeText) {
  return {
    channel: message.channel || "email",
    fromName: message.fromName || "", from: message.from || "", subject: message.subject || "",
    verdict: verdict.verdict, headline: verdict.headline,
    reasons: (verdict.reasons || []).map((r) => r.text),
    guardianSummary: verdict.guardian_summary || null,
    text: includeText ? String(message.body || "").slice(0, 2000) : null,
  };
}

export async function usersToSync() {
  return many(`SELECT u.id FROM users u JOIN gmail_state s ON s.user_id = u.id JOIN google_tokens t ON t.user_id = u.id
               WHERE t.status = 'ok' AND t.scopes LIKE '%gmail.modify%'`);
}
