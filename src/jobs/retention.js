// Housekeeping (PRD privacy rules): verdicts are kept 90 days, sign-in
// leftovers an hour, the local outbox a week, job runs 30 days. Pattern
// cards with no sighting for 90 days retire. The public database's queues:
// a rejected or withdrawn library submission goes after 30 days, a pending
// one nobody reviewed after 180; a rejected watch item, or one classified
// as neither a breach nor a technique, after 90. An early-access request
// goes 90 days after it was marked added; an open one stays.

import { q } from "../db/pool.js";

export async function runRetention() {
  const counts = {};
  const del = async (name, sql) => { counts[name] = (await q(sql)).rowCount; };
  await del("checks", "DELETE FROM checks WHERE created_at < now() - interval '90 days'");
  await del("alerts", "DELETE FROM alerts WHERE created_at < now() - interval '90 days'");
  await del("audit", "DELETE FROM audit_log WHERE at < now() - interval '180 days'");
  await del("sessions", "DELETE FROM sessions WHERE expires_at < now()");
  await del("oauthStates", "DELETE FROM oauth_states WHERE created_at < now() - interval '1 hour'");
  await del("outbox", "DELETE FROM outbox WHERE created_at < now() - interval '7 days'");
  await del("llmCache", "DELETE FROM llm_cache WHERE created_at < now() - interval '30 days'");
  await del("jobRuns", "DELETE FROM job_runs WHERE started_at < now() - interval '30 days'");
  await del("pairCodes", "UPDATE devices SET pair_code_hash = NULL WHERE pair_code_hash IS NOT NULL AND pair_expires_at < now()");
  await del("retiredCards", `UPDATE pattern_cards SET status = 'retired', updated_at = now()
                             WHERE status IN ('active', 'candidate') AND (card->>'last_seen') IS NOT NULL
                               AND (card->>'last_seen')::date < now() - interval '90 days'`);
  await del("librarySubmissions", `DELETE FROM library_submissions
                                   WHERE (status IN ('rejected', 'withdrawn') AND decided_at < now() - interval '30 days')
                                      OR (status = 'pending' AND created_at < now() - interval '180 days')`);
  await del("watchItems", `DELETE FROM watch_items
                           WHERE (status = 'rejected' OR kind = 'other') AND coalesce(decided_at, fetched_at) < now() - interval '90 days'`);
  await del("earlyAccess", "DELETE FROM early_access_requests WHERE status = 'added' AND added_at < now() - interval '90 days'");
  return counts;
}
