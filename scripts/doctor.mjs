// Scam Shield doctor: what is missing on this machine to run the app and its
// tests. It prints names and present/missing only, never a value (API keys,
// the token key, database credentials, the master key).
//
//   node scripts/doctor.mjs                  every check
//   node scripts/doctor.mjs db testdb        only these: node, deps, secrets, docker, db, testdb, port
//   --quiet   print problems only            --strict   warnings fail too
// docker: the CLI, the daemon, the compose plugin, the compose Postgres of
// .infra/dev/docker-compose.yml, its data folder and its port (no Docker is a
// warning: a local PostgreSQL works too). testdb honours TEST_DB_SUFFIX.
//
// Exit 1 when something required is missing, 0 otherwise. `make doctor` runs
// it whole; `make setup`, `make test` and `npm run check` run single checks to
// stop early with a one-line fix instead of a stack trace.

import { execFile } from "node:child_process";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { connect as netConnect, createServer } from "node:net";
import { fileURLToPath, pathToFileURL } from "node:url";
import { promisify } from "node:util";
import { sanitizeSuffix, testDatabaseUrl } from "../src/db/testDatabase.js";
// The store module has no side effects: a missing master key is a report line here, never an exit.
import { REQUIRED_KEYS, credentialsStatus, loadCredentials, rel } from "../lib/credentialStore.js";

export { parseDotenv as parseEnvFile } from "../lib/credentialStore.js";

const root = new URL("../", import.meta.url);
const at = (p) => fileURLToPath(new URL(p, root));

// The npm scripts use --env-file-if-exists (Node 22.9+) and `npm run check`
// uses the built-in coverage thresholds (22.8+); engines in package.json says so.
export const WORKING_NODE = "22.9.0";
export const CHECKS = ["node", "deps", "secrets", "docker", "db", "testdb", "port"];
export const DB_FIX = "make server (Docker Compose; make db-up for Postgres alone) or brew services start postgresql@14 && make db-create";
export const COMPOSE_FILE = ".infra/dev/docker-compose.yml";
export const DATA_DIR = ".infra/dev/_volumes/postgres";

// "localhost:5432/scam_shield": host, port and database only, never credentials.
export function describeDbUrl(url) {
  try {
    const u = new URL(String(url));
    return `${u.hostname || "localhost"}:${u.port || 5432}${u.pathname || ""}`;
  } catch {
    return "(a connection string that could not be parsed)";
  }
}

// Lowest version a semver range accepts: ">=20" → 20.0.0, "^22.5.1" → 22.5.1, "22.x" → 22.0.0.
export function minVersion(range) {
  const m = String(range || "").match(/(\d+)(?:\.(\d+|x|\*))?(?:\.(\d+|x|\*))?/);
  if (!m) return "0.0.0";
  const n = (s) => (s && /^\d+$/.test(s) ? Number(s) : 0);
  return `${n(m[1])}.${n(m[2])}.${n(m[3])}`;
}

export function versionGte(a, b) {
  const pa = String(a).split(".").map(Number);
  const pb = String(b).split(".").map(Number);
  for (let i = 0; i < 3; i++) if ((pa[i] || 0) !== (pb[i] || 0)) return (pa[i] || 0) > (pb[i] || 0);
  return true;
}

// The credentials go into process.env first, the shell (and .env, when node
// was started with --env-file) winning, so every check sees what the app sees.
// `from` says where a value came from; values are only ever tested for presence.
function settings() {
  const status = credentialsStatus();
  const loaded = status.ok ? loadCredentials().loaded : [];
  const get = (key) => (process.env[key] ? { value: process.env[key], from: loaded.includes(key) ? "credentials" : "environment" } : null);
  return { status, get, strayEnv: existsSync(at(".env")) };
}

const results = [];
const add = (level, text) => { results.push({ level, text }); return level; };
const ok = (t) => add("ok", t);
const info = (t) => add("info", t);
const warn = (t) => add("warn", t);
const fail = (t) => add("fail", t);

function checkNode() {
  const current = process.versions.node;
  const engines = JSON.parse(readFileSync(at("package.json"), "utf8")).engines?.node || ">=0";
  const nvmrc = existsSync(at(".nvmrc")) ? readFileSync(at(".nvmrc"), "utf8").trim() : null;
  const hint = nvmrc ? ` (.nvmrc says ${nvmrc}: nvm install ${nvmrc}, or https://nodejs.org)` : "";
  if (!versionGte(current, minVersion(engines))) return fail(`Node ${current} is below engines ${engines}${hint}`);
  if (!versionGte(current, WORKING_NODE)) return fail(`Node ${current}: the npm scripts need ${WORKING_NODE}+ (--env-file-if-exists, coverage thresholds), engines ${engines} is stale${hint}`);
  return ok(`Node ${current} (engines ${engines}${nvmrc ? `, .nvmrc ${nvmrc}` : ""})`);
}

function checkDeps() {
  const marker = at("node_modules/.package-lock.json");
  if (!existsSync(marker) || !existsSync(at("node_modules/pg/package.json"))) return fail("dependencies not installed: npm ci (make setup does it)");
  const lock = at("package-lock.json");
  if (existsSync(lock) && statSync(lock).mtimeMs > statSync(marker).mtimeMs) return warn("package-lock.json changed since the last install: npm ci");
  return ok("dependencies installed (node_modules)");
}

// Master key, encrypted file, required keys by name, and a stray .env.
function checkSecrets(s) {
  const { status } = s;
  const file = rel(status.file);
  if (status.error && !status.keyFrom) fail(status.error);
  else if (!status.keyFrom) fail(`no master key and no ${file} yet: make secrets-init`);
  else {
    ok(`master key present (${status.keyFrom})`);
    if (status.ok) ok(`${file} decrypts (${status.keys.length} keys)`);
    else if (status.error) fail(status.error);
    else fail(`${file} missing: make secrets-init creates it, git checkout ${file} restores the team's`);
  }
  const key = s.get("TOKEN_ENC_KEY");
  if (key && key.value.length >= 40) ok(`TOKEN_ENC_KEY present (${key.from})`);
  else fail("TOKEN_ENC_KEY missing or too short: make setup adds one to the credentials (node scripts/setup.mjs --no-db)");
  const google = ["GOOGLE_CLIENT_ID", "GOOGLE_CLIENT_SECRET"].filter((k) => !s.get(k));
  if (google.length) warn(`Google sign-in off, demo only: ${google.join(" and ")} missing (docs/GOOGLE_SETUP.md, then node scripts/import-google-client.mjs <downloaded json>)`);
  else ok("Google sign-in configured (GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET present)");
  if (s.get("META_MODEL_API_KEY")) ok("Muse Spark on (META_MODEL_API_KEY present)");
  else warn("Muse Spark off, detector only: META_MODEL_API_KEY missing (make secrets-set META_MODEL_API_KEY=...)");
  const missing = REQUIRED_KEYS.filter((k) => !s.get(k));
  info(missing.length ? `required keys missing: ${missing.join(", ")} (make secrets-set KEY=value)` : `required keys all present: ${REQUIRED_KEYS.join(", ")}`);
  const optional = ["ABUSECH_AUTH_KEY", "RESEND_API_KEY", "HIBP_API_KEY", "GMAIL_PUBSUB_TOPIC", "GMAIL_PUBSUB_SUBSCRIPTION", "LLM_TRANSCRIBE_MODEL"];
  info(`optional: ${optional.map((k) => `${k} ${s.get(k) ? "present" : "missing"}`).join(", ")}`);
  info(`Prompt Guard 2 (optional injection shield, off without a key): ${["GROQ_API_KEY", "HF_TOKEN"].map((k) => `${k} ${s.get(k) ? "present" : "missing"}`).join(", ")}`);
  const observability = ["ROLLBAR_ACCESS_TOKEN", "HEARTBEAT_POLL_URL", "HEARTBEAT_WATCH_URL", "HEARTBEAT_THREATFEED_URL", "HEARTBEAT_RETENTION_URL"];
  info(`Observability (optional: Rollbar errors, heartbeats in production only): ${observability.map((k) => `${k} ${s.get(k) ? "present" : "missing"}`).join(", ")}`);
  if (s.strayEnv) warn(".env still exists: run make secrets-import (moves its keys into config/credentials.enc), then delete it (rm .env); it keeps winning over the credentials until then");
}

const execFileP = promisify(execFile);
// stdout of a command, or null when it is missing, fails or hangs. PG_USER reaches compose as the Makefile sets it.
async function output(cmd, args) {
  try {
    const env = { ...process.env, PG_USER: process.env.PG_USER || process.env.USER || "postgres" };
    return (await execFileP(cmd, args, { timeout: 10000, env })).stdout.trim();
  } catch {
    return null;
  }
}

const portInUse = (port, host = "127.0.0.1") => new Promise((resolve) => {
  const socket = netConnect({ port, host });
  socket.once("connect", () => { socket.end(); resolve(true); });
  socket.once("error", () => resolve(false));
  socket.setTimeout(1500, () => { socket.destroy(); resolve(false); });
});

// Docker CLI, daemon, compose plugin, then the compose Postgres: state, data folder, port.
async function checkDocker() {
  const port = Number(process.env.PG_PORT || 5432);
  const daemon = await output("docker", ["version", "--format", "{{.Server.Version}}"]);
  if (daemon === null) {
    return (await output("docker", ["--version"])) === null
      ? warn("Docker not found: install OrbStack or Docker Desktop for make server (or run PostgreSQL yourself: README, then make db-create)")
      : warn("Docker is installed but its daemon is not running: start OrbStack or Docker Desktop, then make server");
  }
  const compose = await output("docker", ["compose", "version", "--short"]);
  if (compose === null) return warn(`Docker ${daemon} without the compose plugin: install Docker Compose v2, then make server`);
  ok(`Docker ${daemon}, Compose ${compose}`);
  const initialized = existsSync(at(`${DATA_DIR}/PG_VERSION`));
  const data = initialized ? `data in ${DATA_DIR}` : existsSync(at(DATA_DIR)) ? `${DATA_DIR} is empty, the first start initializes it` : `${DATA_DIR} is created at the first start`;
  let row = null;
  const ps = await output("docker", ["compose", "-f", at(COMPOSE_FILE), "ps", "--all", "--format", "json", "postgres"]);
  if (ps) {
    try { row = (ps.startsWith("[") ? JSON.parse(ps) : ps.split("\n").filter(Boolean).map((l) => JSON.parse(l)))[0] || null; } catch { row = null; }
  }
  if (row?.State === "running") {
    const health = row.Health || "no healthcheck";
    return health === "healthy" ? ok(`compose postgres running (healthy) on 127.0.0.1:${port}, ${data}`)
      : warn(`compose postgres running but ${health}: make db-logs`);
  }
  const busy = await portInUse(port);
  if (row) info(`compose postgres ${row.State || "stopped"}: make server (or make db-up) starts it; ${data}`);
  else info(`compose postgres not created yet: make server (or make db-up) starts it; ${data}`);
  return busy
    ? info(`something else listens on 127.0.0.1:${port} (a local PostgreSQL?): make db-up would fail to bind; use it with make db-create, or stop it, or set PG_PORT`)
    : info(`port ${port} is free for the compose postgres`);
}

async function connect(url) {
  let pg;
  try { pg = (await import("pg")).default; } catch { return { state: "nodeps" }; }
  const client = new pg.Client({ connectionString: url, connectionTimeoutMillis: 2500, application_name: "scam-shield-doctor" });
  try {
    await client.connect();
    return { state: "ok", client };
  } catch (e) {
    try { await client.end(); } catch { /* never connected */ }
    if (e.code === "3D000") return { state: "nodb", message: e.message };
    if (e.code === "28000" || e.code === "28P01") return { state: "auth", message: e.message };
    return { state: "down", message: e.code || e.message };
  }
}

async function checkDb(s, { test = false } = {}) {
  const key = test ? "TEST_DATABASE_URL" : "DATABASE_URL";
  const found = s.get(key);
  const suffix = test ? sanitizeSuffix(process.env.TEST_DB_SUFFIX) : "";
  if (test && process.env.TEST_DB_SUFFIX && !suffix) warn(`TEST_DB_SUFFIX has no usable character ([a-z0-9_] after lower-casing): the default test database is used`);
  const url = test ? testDatabaseUrl({ TEST_DATABASE_URL: found?.value, TEST_DB_SUFFIX: suffix }) : found?.value || "postgres://localhost/scam_shield";
  const where = `${describeDbUrl(url)} (${key} ${found ? `from ${found.from}` : "default"}${suffix ? `, TEST_DB_SUFFIX ${suffix}` : ""})`;
  const label = test ? "test database" : "Postgres";
  const bad = test ? warn : fail;
  const consequence = test ? "; the integration tests skip without it" : "";
  const r = await connect(url);
  if (r.state === "nodeps") return info(`${label} ${where}: not checked until dependencies are installed`);
  if (r.state === "nodb" && suffix) return ok(`test database ${where}: not there yet, the tests create it on first use (make db-test-clean drops it)`);
  if (r.state === "nodb") return bad(`${label}: ${r.message} on ${describeDbUrl(url).split("/")[0]}: make db-create${consequence}`);
  if (r.state === "auth") return bad(`${label} ${where}: ${r.message}: make secrets-set DATABASE_URL=postgres://user:password@localhost/scam_shield${consequence}`);
  if (r.state === "down") return bad(`${label} not reachable at ${where}: ${r.message}. Fix: ${DB_FIX}${consequence}`);
  try {
    if (test) return ok(`test database ${where}`);
    const files = readdirSync(at("src/db/migrations")).filter((f) => f.endsWith(".sql")).sort();
    let applied = [];
    try { applied = (await r.client.query("SELECT name FROM schema_migrations")).rows.map((x) => x.name); } catch { /* fresh database */ }
    const pending = files.filter((f) => !applied.includes(f));
    ok(`Postgres ${where}`);
    return pending.length ? info(`schema: ${pending.length} of ${files.length} migrations pending (make dev applies them at start, or make db-migrate)`) : info(`schema up to date (${files.length} migrations)`);
  } finally {
    await r.client.end();
  }
}

function checkPort(s) {
  const port = Number(s.get("PORT")?.value || 3000);
  const host = s.get("HOST")?.value || "127.0.0.1";
  return new Promise((resolve) => {
    const server = createServer();
    server.once("error", (e) => resolve(e.code === "EADDRINUSE"
      ? warn(`port ${port} on ${host} is in use: is the server already running? (lsof -i :${port})`)
      : warn(`port ${port} on ${host} cannot be opened (${e.code})`)));
    server.listen(port, host, () => server.close(() => resolve(ok(`port ${port} on ${host} is free`))));
  });
}

export async function run(argv) {
  const quiet = argv.includes("--quiet");
  const strict = argv.includes("--strict");
  // "env" is the old name of the secrets check.
  const wanted = argv.filter((a) => !a.startsWith("--")).map((w) => (w === "env" ? "secrets" : w));
  const unknown = wanted.filter((w) => !CHECKS.includes(w));
  if (unknown.length) {
    console.error(`unknown check: ${unknown.join(", ")} (choose from ${CHECKS.join(", ")})`);
    return 2;
  }
  const selected = wanted.length ? wanted : CHECKS;
  const s = settings();
  const runners = {
    node: () => checkNode(), deps: () => checkDeps(), secrets: () => checkSecrets(s), docker: () => checkDocker(),
    db: () => checkDb(s), testdb: () => checkDb(s, { test: true }), port: () => checkPort(s),
  };
  for (const name of CHECKS) if (selected.includes(name)) await runners[name]();

  const tag = { ok: "OK  ", info: "info", warn: strict ? "FAIL" : "WARN", fail: "FAIL" };
  if (!quiet) console.log("Scam Shield doctor");
  for (const r of results) {
    if (quiet && !["warn", "fail"].includes(r.level)) continue;
    console.log(`  ${tag[r.level]}  ${r.text}`);
  }
  const fails = results.filter((r) => r.level === "fail" || (strict && r.level === "warn")).length;
  const warns = strict ? 0 : results.filter((r) => r.level === "warn").length;
  if (!quiet) {
    console.log(fails ? `${fails} to fix${warns ? `, ${warns} optional` : ""}: see the FAIL lines, then run make doctor again.`
      : warns ? `All set to run; ${warns} optional ${warns === 1 ? "feature is" : "features are"} off (WARN lines).` : "All good.");
  }
  return fails ? 1 : 0;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.exit(await run(process.argv.slice(2)));
}
