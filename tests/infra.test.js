// Local infrastructure: the per-agent test database resolution (src/db/testDatabase.js)
// without a Postgres, and the shape of the compose and CI files (.infra, .github).
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { execFile } from "node:child_process";
import { sanitizeSuffix, testDatabaseUrl, maintenanceUrl, databaseName, ensureDatabase, dropSuffixedDatabases, SUFFIX_MAX } from "../src/db/testDatabase.js";

const read = (p) => readFileSync(new URL(`../${p}`, import.meta.url), "utf8");

test("TEST_DB_SUFFIX is sanitized to [a-z0-9_], at most 40 characters, and appended to the database name", () => {
  assert.equal(sanitizeSuffix("Agent-7"), "agent_7");
  assert.equal(sanitizeSuffix("__x__"), "x");
  assert.equal(sanitizeSuffix("a".repeat(60)).length, SUFFIX_MAX);
  assert.equal(sanitizeSuffix("---"), "");
  assert.equal(sanitizeSuffix(undefined), "");
  assert.equal(testDatabaseUrl({}), "postgres://localhost/scam_shield_test");
  assert.equal(testDatabaseUrl({ TEST_DB_SUFFIX: "" }), "postgres://localhost/scam_shield_test");
  assert.equal(testDatabaseUrl({ TEST_DB_SUFFIX: "Agent-7" }), "postgres://localhost/scam_shield_test_agent_7");
  assert.equal(testDatabaseUrl({ TEST_DATABASE_URL: "postgres://u:p@db:6543/x_test?sslmode=require", TEST_DB_SUFFIX: "b" }),
    "postgres://u:p@db:6543/x_test_b?sslmode=require");
  assert.equal(maintenanceUrl("postgres://u:p@db:6543/x_test_b?sslmode=require"), "postgres://u:p@db:6543/postgres?sslmode=require");
  assert.equal(databaseName("postgres://localhost/scam_shield_test_a"), "scam_shield_test_a");
});

// tests/helpers/env.js must stay a leaf module (see its header), so its inlined rule is
// checked against testDatabaseUrl() in a child process, where importing it is harmless.
test("tests/helpers/env.js applies the same test database rule as src/db/testDatabase.js", async () => {
  const cases = [{}, { TEST_DB_SUFFIX: "Agent-7" }, { TEST_DB_SUFFIX: "---" }, { TEST_DATABASE_URL: "postgres://u:p@db:6543/x_test?sslmode=require", TEST_DB_SUFFIX: "b" },
    { TEST_DATABASE_URL: "postgres://localhost:5433/other_test", TEST_DB_SUFFIX: "a".repeat(50) }];
  for (const env of cases) {
    const got = await new Promise((resolve, reject) => execFile(process.execPath,
      ["--input-type=module", "-e", "await import('./tests/helpers/env.js'); console.log(process.env.DATABASE_URL)"],
      { cwd: new URL("../", import.meta.url), env: { PATH: process.env.PATH, TEST_DATABASE_URL: "", TEST_DB_SUFFIX: "", ...env } },
      (err, stdout) => (err ? reject(err) : resolve(stdout.trim()))));
    assert.equal(got, testDatabaseUrl(env), JSON.stringify(env));
  }
});

// A pg stand-in: connect() rejects with the code set for that database, queries are recorded.
function fakePg({ missing = [], rows = [] } = {}) {
  const queries = [];
  class Client {
    constructor({ connectionString }) { this.db = databaseName(connectionString); this.url = connectionString; }
    async connect() { if (missing.includes(this.db)) { const e = new Error("does not exist"); e.code = "3D000"; throw e; } }
    async query(text, params) { queries.push({ db: this.db, text, params }); return { rows }; }
    async end() {}
  }
  return { pg: { Client }, queries };
}

test("a missing test database is created through the maintenance database, an existing one is left alone", async () => {
  const { pg, queries } = fakePg({ missing: ["scam_shield_test_agent_7"] });
  assert.equal(await ensureDatabase("postgres://localhost/scam_shield_test_agent_7", { pg }), true);
  assert.deepEqual(queries.map((q) => [q.db, q.text]), [["postgres", 'CREATE DATABASE "scam_shield_test_agent_7"']]);
  const present = fakePg();
  assert.equal(await ensureDatabase("postgres://localhost/scam_shield_test", { pg: present.pg }), false);
  assert.deepEqual(present.queries, []);
});

test("db-test-clean drops the suffixed databases and never the base one", async () => {
  const { pg, queries } = fakePg({ rows: [{ datname: "scam_shield_test_a" }, { datname: "scam_shield_test_b" }] });
  const dropped = await dropSuffixedDatabases("postgres://localhost/scam_shield_test", { pg });
  assert.deepEqual(dropped, ["scam_shield_test_a", "scam_shield_test_b"]);
  assert.equal(queries[0].db, "postgres");
  assert.deepEqual(queries[0].params, ["scam\\_shield\\_test\\_%", "scam_shield_test"]);
  assert.deepEqual(queries.slice(1).map((q) => q.text), ['DROP DATABASE "scam_shield_test_a" WITH (FORCE)', 'DROP DATABASE "scam_shield_test_b" WITH (FORCE)']);
});

test("the dev compose Postgres is loopback only, bind-mounted under .infra/dev/_volumes, and creates both databases", () => {
  const compose = read(".infra/dev/docker-compose.yml");
  assert.match(compose, /^name: scam-shield$/m);
  assert.match(compose, /127\.0\.0\.1:\$\{PG_PORT:-5432\}:5432/);
  assert.match(compose, /\.\/_volumes\/postgres:\/var\/lib\/postgresql\/data/);
  assert.match(compose, /healthcheck:/);
  assert.match(compose, /POSTGRES_DB: scam_shield$/m);
  assert.match(read(".infra/dev/postgres/initdb/10-test-database.sql"), /CREATE DATABASE scam_shield_test;/);
  const ignore = read(".gitignore");
  assert.match(ignore, /^\.infra\/\*\*\/_volumes\/\*$/m);
  assert.match(ignore, /^!\.infra\/\*\*\/_volumes\/\.gitkeep$/m);
});

test("CI runs the Node checks against the same compose file, and the Android build apart", () => {
  const ci = read(".github/workflows/ci.yml");
  assert.match(ci, /^on:\n  push:\n  pull_request:/m);
  assert.match(ci, /cancel-in-progress: true/);
  assert.match(ci, /node-version-file: \.nvmrc/);
  assert.match(ci, /docker compose -f \.infra\/dev\/docker-compose\.yml up -d --wait/);
  assert.match(ci, /run: make check/);
  assert.match(ci, /run: make score/);
  assert.match(ci, /coverage\/lcov\.info/);
  assert.match(ci, /^  android:/m);
  assert.match(ci, /assembleDebug/);
  assert.doesNotMatch(ci, /secrets\./, "no secret is needed in CI");
});
