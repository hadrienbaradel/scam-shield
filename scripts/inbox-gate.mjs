// Live Gmail gate: is a real inbox being checked safely? Reads only the
// database (no Gmail call, no email bodies printed): sign-in state, sync,
// verdicts, who judged them (Muse Spark or the detector fallback) and what
// was done in Gmail.
//   node --env-file-if-exists=.env scripts/inbox-gate.mjs [--email you@gmail.com]
// Exit 0 when every gate passes, 1 otherwise.
import "../lib/credentials.js";
import { many, one, pool } from "../src/db/pool.js";

const args = process.argv.slice(2);
const wanted = args.includes("--email") ? args[args.indexOf("--email") + 1] : null;
// Only people who connected a real Gmail (demo users have no Google tokens).
const users = await many(`SELECT id, email, act_mode, move_consent_at FROM users
  WHERE EXISTS (SELECT 1 FROM google_tokens t WHERE t.user_id = users.id) ${wanted ? "AND lower(email) = lower($1)" : ""} ORDER BY created_at`, wanted ? [wanted] : []);
if (!users.length) { console.log("No Gmail connected yet: open the app and sign in with Google."); await pool.end(); process.exit(1); }

let ok = true;
const gate = (pass, text) => { console.log(`  ${pass ? "PASS" : "FAIL"} ${text}`); if (!pass) ok = false; };
for (const u of users) {
  console.log(`\n== ${u.email} · mode ${u.act_mode}${u.move_consent_at ? ` (move consent ${u.move_consent_at.toISOString().slice(0, 16)})` : ""}`);
  const tok = await one("SELECT status, scopes FROM google_tokens WHERE user_id = $1", [u.id]);
  const st = await one("SELECT sync_status, sync_error, backfill_done, last_sync_at, watch_expiration, label_scam, label_careful FROM gmail_state WHERE user_id = $1", [u.id]);
  const by = await many(`SELECT verdict_value AS v, action, count(*)::int AS n,
      count(*) FILTER (WHERE (verdict->>'degraded')::boolean)::int AS degraded,
      count(*) FILTER (WHERE source LIKE 'Muse Spark%')::int AS muse,
      count(*) FILTER (WHERE restored_at IS NOT NULL)::int AS restored,
      percentile_cont(0.5) WITHIN GROUP (ORDER BY latency_ms) AS median_ms
    FROM checks WHERE user_id = $1 AND channel = 'email' GROUP BY 1, 2`, [u.id]);
  const total = by.reduce((n, r) => n + r.n, 0);
  const sum = (f) => by.filter(f).reduce((n, r) => n + r.n, 0);
  const muse = by.reduce((n, r) => n + r.muse, 0);
  const degraded = by.reduce((n, r) => n + r.degraded, 0);
  const pendingOld = await one("SELECT count(*)::int AS n FROM checks WHERE user_id = $1 AND action = 'pending' AND created_at < now() - interval '10 minutes'", [u.id]);

  console.log(`  checked ${total}: scam ${sum((r) => r.v === "scam")} · be careful ${sum((r) => r.v === "be_careful")} · safe ${sum((r) => r.v === "safe")}`);
  console.log(`  judged by Muse Spark ${muse} · detector fallback ${total - muse} (degraded ${degraded})`);
  const restored = by.reduce((n, r) => n + r.restored, 0);
  console.log(`  in Gmail: labeled ${sum((r) => r.action === "labeled") - restored} · moved ${sum((r) => r.action === "moved")} · put back by the person ${restored} · pending ${sum((r) => r.action === "pending")} · untouched ${sum((r) => r.action === "none")}`);
  console.log(`  sync ${st?.sync_status || "-"}${st?.sync_error ? ` (${st.sync_error.slice(0, 120)})` : ""} · last ${st?.last_sync_at ? st.last_sync_at.toISOString().slice(0, 16) : "never"} · instant checks ${st?.watch_expiration > new Date() ? "on" : "off"}`);

  gate(tok?.status === "ok" && /gmail\.modify/.test(tok?.scopes || ""), "Gmail access granted (gmail.modify)");
  gate(Boolean(st?.backfill_done), "first pass over recent mail finished");
  gate(st?.sync_status !== "error", "last sync had no error");
  gate(total > 0, "messages were checked");
  gate(Boolean(u.move_consent_at) || sum((r) => r.action === "moved") === 0, "nothing moved without the person's consent");
  gate(pendingOld.n === 0, "no Gmail change left half-done for over 10 minutes");
  gate(total === 0 || degraded / total < 0.1, `Muse Spark failures under 10% (${total ? Math.round((100 * degraded) / total) : 0}%)`);
  gate(Boolean(st?.label_scam && st?.label_careful), "Scam Shield labels exist in Gmail");

  // What was flagged, without opening the email: sender's site and headline.
  const flagged = await many(`SELECT verdict_value AS v, sender_domain, verdict->>'headline' AS headline, source, action
    FROM checks WHERE user_id = $1 AND channel = 'email' AND verdict_value <> 'safe' ORDER BY created_at DESC LIMIT 15`, [u.id]);
  if (flagged.length) console.log("  latest flagged:");
  for (const f of flagged) console.log(`    ${f.v.padEnd(10)} ${String(f.sender_domain || "-").padEnd(26)} ${f.action.padEnd(8)} ${String(f.headline || "").slice(0, 70)}${/^Muse/.test(f.source || "") ? "" : "  [detector]"}`);
}
await pool.end();
process.exit(ok ? 0 : 1);
