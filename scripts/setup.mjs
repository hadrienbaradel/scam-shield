// First-time local setup: creates .env with a fresh token-encryption key
// (never overwrites an existing one), then applies database migrations.
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { randomBytes } from "node:crypto";

const path = new URL("../.env", import.meta.url);
if (existsSync(path)) {
  const has = /^TOKEN_ENC_KEY=.{40,}/m.test(readFileSync(path, "utf8"));
  console.log(has ? ".env exists and has TOKEN_ENC_KEY — left untouched." : ".env exists but TOKEN_ENC_KEY is missing: add one with `node -e \"console.log(require('crypto').randomBytes(32).toString('base64'))\"`.");
} else {
  const template = readFileSync(new URL("../.env.example", import.meta.url), "utf8");
  writeFileSync(path, template.replace(/^TOKEN_ENC_KEY=.*$/m, `TOKEN_ENC_KEY=${randomBytes(32).toString("base64")}`), { mode: 0o600 });
  console.log("Created .env with a new TOKEN_ENC_KEY. Fill in GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET (docs/GOOGLE_SETUP.md) and META_MODEL_API_KEY.");
}
const { migrate } = await import("../src/db/migrate.js");
const { pool } = await import("../src/db/pool.js");
const applied = await migrate();
console.log(applied.length ? `Database migrated: ${applied.join(", ")}` : "Database is up to date.");
await pool.end();
