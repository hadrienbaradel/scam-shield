// Which database a process ends up on, now that config/credentials.enc carries the team's shared
// production database as DATABASE_URL (_product/docs/ops.md, The shared database): the real
// environment wins over the credentials (so the host's container keeps its compose Postgres and
// make server DB=dev its local one), a laptop never runs the background jobs on a database
// elsewhere, and a test run never sees that DATABASE_URL, whether it comes from the environment or
// from the credentials. Child processes run the real modules with a throwaway credentials file.
import "./helpers/env.js";
import { test } from "node:test";
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { generateKey, writeStore } from "../lib/credentialStore.js";
import { databaseOnThisMachine, describeDatabase, workerOff } from "../src/config.js";

const repo = new URL("../", import.meta.url);
const href = (p) => new URL(p, repo).href;
const read = (p) => readFileSync(new URL(p, repo), "utf8");
const SHARED = "postgres://scam_shield:Sh4redSecret@100.64.0.10:5432/scam_shield";
const COMPOSE = "postgres://scam_shield:C0mposeSecret@postgres:5432/scam_shield";
const LOCAL = "postgres://localhost:5432/scam_shield";

// A credentials file of our own holding the shared DATABASE_URL, opened by MASTER_KEY as on the host.
function sandbox(t) {
  const dir = mkdtempSync(join(tmpdir(), "shared-db-test-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const key = generateKey();
  const file = join(dir, "credentials.enc");
  writeStore(`DATABASE_URL=${SHARED}\n`, { file }, Buffer.from(key, "hex"));
  // Built from nothing: no NODE_TEST_CONTEXT (that would switch the autoload off), no developer key or URL.
  const env = (extra = {}) => ({ PATH: process.env.PATH, HOME: process.env.HOME, MASTER_KEY: key, CREDENTIALS_FILE: file, MASTER_KEY_FILE: join(dir, "absent.key"), ...extra });
  return { dir, env };
}

const node = (args, env, cwd) => new Promise((resolve) => execFile(process.execPath, args, { env, cwd, timeout: 30000 },
  (err, stdout, stderr) => resolve({ code: err ? err.code : 0, stdout, stderr })));

// What an entry point sees: lib/credentials.js first (as src/server.js and migrate.js import it), then the config.
const entryProbe = `await import(${JSON.stringify(href("lib/credentials.js"))});
const { config } = await import(${JSON.stringify(href("src/config.js"))});
console.log(JSON.stringify({ url: config.databaseUrl, worker: config.worker, off: config.workerOff }));`;
const entry = async (env) => {
  const r = await node(["--input-type=module", "-e", entryProbe], env);
  assert.equal(r.code, 0, r.stderr);
  return JSON.parse(r.stdout);
};

test("the host's container: the compose DATABASE_URL beats the credentials' shared one, and the jobs run", async (t) => {
  const { env } = sandbox(t);
  const container = await entry(env({ NODE_ENV: "production", DATABASE_URL: COMPOSE }));
  assert.deepEqual(container, { url: COMPOSE, worker: true, off: "" });
  // Without it the container would dial the tailnet address from inside Docker: compose must always set it.
  assert.equal((await entry(env({ NODE_ENV: "production" }))).url, SHARED, "the credentials do fill DATABASE_URL when nothing set it");
  assert.equal((await entry(env({ NODE_ENV: "production", DATABASE_URL: "" }))).url, SHARED, "an empty value counts as unset");
  const compose = read(".infra/prod/docker-compose.yml");
  assert.match(compose, /^ {6}DATABASE_URL: postgres:\/\/scam_shield:\$\{POSTGRES_PASSWORD:\?[^}]+\}@postgres:5432\/scam_shield$/m,
    "the app service sets DATABASE_URL to the compose Postgres, never empty (POSTGRES_PASSWORD is required)");
  assert.match(read(".infra/prod/Dockerfile"), /^COPY config\/credentials\.enc /m, "the image carries the credentials, so this precedence is what keeps production on its own database");
  assert.match(read(".infra/prod/ansible/playbook.yml"), /exec -T app node src\/db\/migrate\.js/, "the deploy migrates inside the container, with the container's environment");
});

test("a laptop: make server DB=dev's override beats the credentials; on the shared database the jobs stay off unless WORKER=1", async (t) => {
  const { env } = sandbox(t);
  assert.deepEqual(await entry(env({ DATABASE_URL: LOCAL })), { url: LOCAL, worker: true, off: "" }, "DB=dev: the local database, jobs on");
  const shared = await entry(env());
  assert.equal(shared.url, SHARED, "nothing set: the team's shared database, from the credentials");
  assert.equal(shared.worker, false, "a laptop never runs a second scheduler on the production data");
  assert.match(shared.off, /^the database is on another machine, whose host runs them/);
  assert.equal((await entry(env({ WORKER: "1" }))).worker, true, "WORKER=1 forces them");
  assert.deepEqual(await entry(env({ DATABASE_URL: LOCAL, WORKER: "0" })), { url: LOCAL, worker: false, off: "WORKER=0" });
});

test("the jobs' default and the startup line come from where the database is, never from its password", () => {
  for (const url of ["postgres://localhost/scam_shield", "postgres://u:p@127.0.0.1:5433/x", "postgres://[::1]/x", "postgres:///scam_shield", "postgres://u@pg/x?host=/var/run/postgresql"]) {
    assert.equal(databaseOnThisMachine(url), true, url);
  }
  for (const url of [SHARED, COMPOSE, "postgres://u:p@meikit.tail2c017.ts.net:5432/x", "not a url"]) assert.equal(databaseOnThisMachine(url), false, url);
  assert.equal(workerOff({}), "", "nothing set: the default local database, jobs on");
  assert.equal(workerOff({ DATABASE_URL: SHARED, NODE_ENV: "production" }), "");
  assert.equal(workerOff({ DATABASE_URL: SHARED, WORKER: "0", NODE_ENV: "production" }), "WORKER=0");
  assert.equal(describeDatabase(SHARED), "100.64.0.10:5432/scam_shield");
  assert.equal(describeDatabase("postgres://localhost/scam_shield"), "localhost:5432/scam_shield");
  assert.ok(!describeDatabase(SHARED).includes("Sh4redSecret"));
});

test("a test run never sees a DATABASE_URL from the environment or the credentials: the suite's database is the test one", async (t) => {
  const { dir, env } = sandbox(t);
  // A suite as the repository writes them (tests/helpers/env.js first), with the credentials' autoload and
  // the pool imported too, run by a real node --test in a clean environment that names the shared database.
  const fixture = join(dir, "where.test.js");
  writeFileSync(fixture, `import { writeFileSync } from "node:fs";
import ${JSON.stringify(href("tests/helpers/env.js"))};
import ${JSON.stringify(href("lib/credentials.js"))};
import { pool } from ${JSON.stringify(href("src/db/pool.js"))};
import { config } from ${JSON.stringify(href("src/config.js"))};
import { test } from "node:test";
test("where", () => {
  writeFileSync(process.env.RESULT_FILE, JSON.stringify({ env: process.env.DATABASE_URL, config: config.databaseUrl, pool: pool.options.connectionString, worker: config.worker }));
});
`);
  const result = join(dir, "result.json");
  for (const [suffix, expected] of [["", "postgres://localhost/scam_shield_test"], ["dbflip", "postgres://localhost/scam_shield_test_dbflip"]]) {
    const r = await node(["--test", "--test-reporter=tap", fixture], env({ DATABASE_URL: SHARED, TEST_DB_SUFFIX: suffix, RESULT_FILE: result }), dir);
    assert.equal(r.code, 0, `${r.stdout}${r.stderr}`);
    const seen = JSON.parse(readFileSync(result, "utf8"));
    assert.deepEqual(seen, { env: expected, config: expected, pool: expected, worker: false });
    assert.ok(!readFileSync(result, "utf8").includes("100.64.0.10"));
  }
  // Every suite that imports src/ (beyond the pure test-database resolver) loads tests/helpers/env.js before
  // anything else, itself or through tests/helpers/db.js, whose first import it is.
  assert.match(read("tests/helpers/db.js"), /^import "\.\/env\.js";/);
  const { readdirSync } = await import("node:fs");
  for (const name of readdirSync(new URL("tests/", repo)).filter((f) => f.endsWith(".test.js"))) {
    const text = read(`tests/${name}`);
    const imports = [...text.matchAll(/^import .*?["']([^"']+)["'];?$/gm)].map((m) => m[1]);
    if (!imports.some((p) => p.startsWith("../src/") && p !== "../src/db/testDatabase.js")) continue;
    assert.ok(["./helpers/env.js", "./helpers/db.js"].includes(imports[0]), `${name}: its first import must be ./helpers/env.js (or ./helpers/db.js)`);
  }
});

test("make test needs no credentials for its database: npm test never loads them and the doctor names the test database alone", async (t) => {
  const { dir } = sandbox(t);
  const scripts = JSON.parse(read("package.json")).scripts;
  for (const name of ["test", "coverage", "check"]) {
    assert.doesNotMatch(scripts[name], /credentials\.js|--env-file/, `npm run ${name} loads neither the credentials nor .env`);
  }
  const base = { PATH: process.env.PATH, HOME: process.env.HOME, TEST_DB_SUFFIX: "", MASTER_KEY_FILE: join(dir, "absent.key") };
  const none = await node([new URL("scripts/doctor.mjs", repo).pathname, "testdb"], { ...base, CREDENTIALS_FILE: join(dir, "absent.enc") });
  assert.match(none.stdout, /test database (not reachable at )?localhost:5432\/scam_shield_test \(TEST_DATABASE_URL default\)/, none.stdout);
  // With the team's file (the shared DATABASE_URL in it), the test database is still the local one.
  const { env } = sandbox(t);
  const withFile = await node([new URL("scripts/doctor.mjs", repo).pathname, "testdb"], { ...env(), TEST_DB_SUFFIX: "" });
  assert.match(withFile.stdout, /localhost:5432\/scam_shield_test \(TEST_DATABASE_URL default\)/, withFile.stdout);
  assert.ok(!withFile.stdout.includes("100.64.0.10"));
});

test("the doctor calls the credentials' DATABASE_URL the team's shared database and gives the Tailscale fix, never its password", async (t) => {
  const dir = mkdtempSync(join(tmpdir(), "shared-db-doctor-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const key = generateKey();
  const file = join(dir, "credentials.enc");
  writeStore("DATABASE_URL=postgres://scam_shield:Sh4redSecret@127.0.0.1:1/scam_shield\n", { file }, Buffer.from(key, "hex"));
  const r = await node([new URL("scripts/doctor.mjs", repo).pathname, "db", "--quiet"],
    { PATH: process.env.PATH, HOME: process.env.HOME, MASTER_KEY: key, CREDENTIALS_FILE: file, MASTER_KEY_FILE: join(dir, "absent.key") });
  assert.equal(r.code, 1, r.stdout);
  assert.match(r.stdout, /FAIL {2}Postgres not reachable at 127\.0\.0\.1:1\/scam_shield \(DATABASE_URL from credentials: the team's shared database\): .*Tailscale running on this laptop, with meikit shared with you .*make server DB=dev/);
  assert.ok(!r.stdout.includes("Sh4redSecret"));
});
