// First-time local setup: makes sure the encrypted credentials hold a
// TOKEN_ENC_KEY (never replacing one), then applies the database migrations.
//   node scripts/setup.mjs [--no-db]      (make setup runs it after make secrets-init)
// Nothing is printed but key names. Without a usable master key it says so and
// leaves the migration for `make db-migrate`; it never fails a fresh clone.
import { randomBytes } from "node:crypto";
import { REQUIRED_KEYS, credentialsStatus, loadCredentials, rel, setKeys } from "../lib/credentialStore.js";

const st = credentialsStatus();
const file = rel(st.file);
const has = (k) => st.keys.includes(k) && !st.empty.includes(k);
if (!st.exists) console.log(`${file} missing: make secrets-init creates it, then run make setup again.`);
else if (st.error) console.log(`Credentials not readable yet: ${st.error}`);
else if (has("TOKEN_ENC_KEY")) console.log(`${file} has a TOKEN_ENC_KEY, left untouched.`);
else {
  setKeys([["TOKEN_ENC_KEY", randomBytes(32).toString("base64")]]);
  const still = REQUIRED_KEYS.filter((k) => k !== "TOKEN_ENC_KEY" && !has(k));
  console.log(`Added a fresh TOKEN_ENC_KEY to ${file} (commit the file).${still.length ? ` Still to set: ${still.join(", ")} (make secrets-set KEY=value, docs/GOOGLE_SETUP.md).` : ""}`);
}

if (process.argv.includes("--no-db")) process.exit(0);
if (st.exists && st.error) { console.log("Database migration skipped until the master key is in place: make db-migrate then."); process.exit(0); }
if (st.ok) loadCredentials(); // DATABASE_URL may live in the credentials; the shell and .env still win
const { migrate } = await import("../src/db/migrate.js");
const { pool } = await import("../src/db/pool.js");
const applied = await migrate();
console.log(applied.length ? `Database migrated: ${applied.join(", ")}` : "Database is up to date.");
await pool.end();
