// Re-judges the messages Scam Shield labelled "Check first" or "Scam" for
// one person, with the current rules and Muse Spark, after a fix to the
// engine. Where the new verdict is Safe, our own label comes off; otherwise
// only the explanation is updated. It never moves mail, never touches a
// message the person already put back, and never learns anything about a
// sender. Prints sender sites and verdicts only, never message text.
//   node --env-file-if-exists=.env --import ./lib/credentials.js scripts/recheck-flagged.mjs [--email you@gmail.com] [--dry-run]
import { many, one, q, pool } from "../src/db/pool.js";
import { clientFor } from "../src/sync/worker.js";
import { normalizeMessage } from "../src/google/gmail.js";
import { runCheck } from "../src/sync/checker.js";
import { audit } from "../src/sync/actions.js";

const args = process.argv.slice(2);
const email = args.includes("--email") ? args[args.indexOf("--email") + 1] : null;
const dry = args.includes("--dry-run");
const users = await many(`SELECT * FROM users WHERE EXISTS (SELECT 1 FROM google_tokens t WHERE t.user_id = users.id AND t.status = 'ok')
  ${email ? "AND lower(email) = lower($1)" : ""}`, email ? [email] : []);
if (users.length !== 1) { console.error(`Expected one connected account, found ${users.length}. Use --email.`); await pool.end(); process.exit(1); }
const user = users[0];

// The same per-person lock as the sync worker: never two writers on one mailbox.
const lease = await pool.connect();
const locked = (await lease.query("SELECT pg_try_advisory_lock(hashtext($1)) AS ok", [`sync:${user.id}`])).rows[0].ok;
if (!locked) { console.error("A sync is running for this account; try again in a minute."); lease.release(); await pool.end(); process.exit(1); }

try {
  const state = await one("SELECT label_scam, label_careful FROM gmail_state WHERE user_id = $1", [user.id]);
  const labelOf = { scam: state.label_scam, be_careful: state.label_careful };
  const flagged = await many(`SELECT * FROM checks WHERE user_id = $1 AND gmail_message_id IS NOT NULL AND verdict_value <> 'safe'
    AND action IN ('labeled', 'none') AND restored_at IS NULL AND user_feedback IS NULL ORDER BY created_at`, [user.id]);
  const client = clientFor(user.id);
  const tally = { cleared: 0, kept: 0, changed: 0, gone: 0 };
  console.log(`${flagged.length} flagged message(s) to re-check${dry ? " (dry run: nothing is changed)" : ""}`);
  for (const check of flagged) {
    let message;
    try { message = normalizeMessage(await client.getMessage(check.gmail_message_id)); } catch (e) {
      if (e.status === 404) { tally.gone++; continue; }
      throw e;
    }
    const { verdict } = await runCheck({ user, message });
    const now = verdict.verdict;
    console.log(`  ${String(check.sender_domain || "-").padEnd(30)} ${check.verdict_value.padEnd(10)} → ${now}${verdict.degraded ? " (rules only)" : ""}`);
    if (dry) continue;
    if (now === "safe") {
      if (check.action === "labeled") await client.modifyLabels(check.gmail_message_id, { add: [], remove: [state.label_scam, state.label_careful].filter(Boolean) });
      await q("UPDATE checks SET verdict = $2, verdict_value = 'safe', source = $3, action = 'none', planned = NULL WHERE id = $1", [check.id, verdict, verdict.source]);
      await audit(user.id, "recheck_cleared", { checkId: check.id });
      tally.cleared++;
    } else {
      if (check.action === "labeled" && now !== check.verdict_value) {
        await client.modifyLabels(check.gmail_message_id, { add: [labelOf[now]].filter(Boolean), remove: [labelOf[check.verdict_value]].filter(Boolean) });
        tally.changed++;
      } else tally.kept++;
      await q("UPDATE checks SET verdict = $2, verdict_value = $3, source = $4 WHERE id = $1", [check.id, verdict, now, verdict.source]);
    }
  }
  console.log(`cleared ${tally.cleared} · still flagged ${tally.kept} · label switched ${tally.changed} · no longer in the mailbox ${tally.gone}`);
} finally {
  await lease.query("SELECT pg_advisory_unlock(hashtext($1))", [`sync:${user.id}`]).catch(() => {});
  lease.release();
  await pool.end();
}
