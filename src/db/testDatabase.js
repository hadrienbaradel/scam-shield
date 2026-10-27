// The test database and its per-agent copies. The suite runs against
// TEST_DATABASE_URL (default postgres://localhost/scam_shield_test); with
// TEST_DB_SUFFIX=<name> it runs against <database>_<name> instead, so several
// agents can run `make test` or `make check` on one Postgres at the same time
// (each suite truncates its database). The helper creates a missing database
// on first use through the maintenance database (`postgres`, same
// credentials); `make db-test-clean` drops the suffixed ones.
//   node src/db/testDatabase.js name     the resolved database name
//   node src/db/testDatabase.js clean    drop every <database>_<suffix>, never <database> itself
// No side effects on import (scripts/doctor.mjs and tests/helpers/env.js use it).

import { pathToFileURL } from "node:url";

export const DEFAULT_TEST_DATABASE_URL = "postgres://localhost/scam_shield_test";
export const SUFFIX_MAX = 40;

// "Agent-7" → "agent_7": lower case, [a-z0-9_] only, no edge underscores, at most SUFFIX_MAX characters.
export function sanitizeSuffix(raw) {
  return String(raw ?? "").toLowerCase().replace(/[^a-z0-9_]+/g, "_").replace(/^_+|_+$/g, "").slice(0, SUFFIX_MAX).replace(/_+$/, "");
}

export function databaseName(url) {
  return decodeURIComponent(new URL(url).pathname.replace(/^\//, ""));
}

// The URL the tests use: TEST_DATABASE_URL (or the default) with the sanitized suffix appended to the database name.
export function testDatabaseUrl(env = process.env) {
  const base = env.TEST_DATABASE_URL || DEFAULT_TEST_DATABASE_URL;
  const suffix = sanitizeSuffix(env.TEST_DB_SUFFIX);
  if (!suffix) return base;
  const u = new URL(base);
  u.pathname = `/${databaseName(base) || "scam_shield_test"}_${suffix}`;
  return u.toString();
}

// Same server and credentials, the maintenance database.
export function maintenanceUrl(url) {
  const u = new URL(url);
  u.pathname = "/postgres";
  return u.toString();
}

const quoteIdent = (name) => `"${String(name).replace(/"/g, '""')}"`;
const escapeLike = (s) => String(s).replace(/[\\%_]/g, "\\$&");

async function pgClient(url, pg) {
  const Client = (pg || (await import("pg")).default).Client;
  return new Client({ connectionString: url, connectionTimeoutMillis: 2500, application_name: "scam-shield-testdb" });
}

// Creates the database of `url` when it is missing. Resolves true when created,
// false when it was there; rejects when Postgres itself is unreachable or
// refuses (no CREATEDB right). Two agents racing: the loser sees 42P04
// (duplicate) or 55006 (template1 busy) and simply retries or returns.
export async function ensureDatabase(url, { pg } = {}) {
  const probe = await pgClient(url, pg);
  try {
    await probe.connect();
    return false;
  } catch (e) {
    if (e.code !== "3D000") throw e; // 3D000: database does not exist
  } finally {
    await probe.end().catch(() => {});
  }
  const name = databaseName(url);
  for (let attempt = 1; ; attempt++) {
    const admin = await pgClient(maintenanceUrl(url), pg);
    await admin.connect();
    try {
      await admin.query(`CREATE DATABASE ${quoteIdent(name)}`);
      return true;
    } catch (e) {
      if (e.code === "42P04") return false;
      if (e.code === "55006" && attempt < 10) { await new Promise((r) => setTimeout(r, 200 * attempt)); continue; }
      throw e;
    } finally {
      await admin.end().catch(() => {});
    }
  }
}

// Drops every "<base>_<something>" database, never <base> itself. Returns the names dropped.
export async function dropSuffixedDatabases(baseUrl = testDatabaseUrl({ ...process.env, TEST_DB_SUFFIX: "" }), { pg } = {}) {
  const base = databaseName(baseUrl);
  const admin = await pgClient(maintenanceUrl(baseUrl), pg);
  await admin.connect();
  try {
    const { rows } = await admin.query(
      "SELECT datname FROM pg_database WHERE datname LIKE $1 AND datname <> $2 AND NOT datistemplate ORDER BY datname",
      [`${escapeLike(base)}\\_%`, base]);
    const dropped = [];
    for (const { datname } of rows) {
      await admin.query(`DROP DATABASE ${quoteIdent(datname)} WITH (FORCE)`); // FORCE: Postgres 13+, ends the sessions still on it
      dropped.push(datname);
    }
    return dropped;
  } finally {
    await admin.end().catch(() => {});
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const command = process.argv[2];
  if (command === "name") {
    console.log(databaseName(testDatabaseUrl()));
  } else if (command === "clean") {
    const base = databaseName(testDatabaseUrl({ ...process.env, TEST_DB_SUFFIX: "" }));
    const dropped = await dropSuffixedDatabases();
    console.log(dropped.length ? `dropped ${dropped.join(", ")} (kept ${base})` : `no ${base}_<suffix> database to drop`);
  } else {
    console.error("usage: node src/db/testDatabase.js name|clean");
    process.exit(2);
  }
}
