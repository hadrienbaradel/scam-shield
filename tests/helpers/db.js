import "./env.js";
import { pool, one } from "../../src/db/pool.js";
import { migrate } from "../../src/db/migrate.js";
import { ensureDatabase } from "../../src/db/testDatabase.js";
import { randomToken, sha256 } from "../../src/crypto.js";

// Postgres reachable? A missing test database (the TEST_DB_SUFFIX copy of a
// fresh agent, or scam_shield_test itself) is created first; resetDb migrates it.
export async function dbAvailable() {
  try { await ensureDatabase(process.env.DATABASE_URL); } catch { return false; }
  try { await pool.query("SELECT 1"); return true; } catch { return false; }
}

export async function resetDb() {
  await migrate();
  await pool.query(`TRUNCATE users, google_tokens, gmail_state, contexts, checks, guardianships, alerts, feed_items, devices,
                    sessions, oauth_states, audit_log, outbox, job_runs, lesson_progress, library_submissions CASCADE`);
  await pool.query("DELETE FROM pattern_cards");
  await pool.query("TRUNCATE watch_items");
  await pool.query("TRUNCATE suspect_contests");
  await migrate();
}

let n = 0;
export async function makeUser({ email, name = "Linda", locale = "en-US", gmail = false, actMode = "move" } = {}) {
  n++;
  const user = await one(`INSERT INTO users (google_sub, email, name, locale, act_mode, onboarded, move_consent_at)
                          VALUES ($1, $2, $3, $4, $5, true, CASE WHEN $5 = 'move' THEN now() END) RETURNING *`,
    [`sub-${n}-${Date.now()}`, email || `user${n}-${Date.now()}@example.test`, name, locale, actMode]);
  if (gmail) {
    await pool.query("INSERT INTO gmail_state (user_id, email) VALUES ($1, $2)", [user.id, user.email]);
    await pool.query("INSERT INTO google_tokens (user_id, scopes, status) VALUES ($1, 'https://www.googleapis.com/auth/gmail.modify', 'ok')", [user.id]);
  }
  return user;
}

export async function sessionFor(user) {
  const token = randomToken();
  await pool.query("INSERT INTO sessions (id_hash, user_id, expires_at) VALUES ($1, $2, now() + interval '1 day')", [sha256(token), user.id]);
  return `ss_sid=${token}`;
}

export { pool };
