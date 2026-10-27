// Scam Shield doctor: what is missing on this machine to run the app and its
// tests. It prints names and present/missing only, never a value from .env or
// the environment (API keys, the token key, database credentials).
//
//   node scripts/doctor.mjs                  every check
//   node scripts/doctor.mjs db testdb        only these: node, deps, env, db, testdb, port
//   --quiet   print problems only            --strict   warnings fail too
//
// Exit 1 when something required is missing, 0 otherwise. `make doctor` runs
// it whole; `make setup`, `make test` and `npm run check` run single checks to
// stop early with a one-line fix instead of a stack trace.

import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { createServer } from "node:net";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = new URL("../", import.meta.url);
const at = (p) => fileURLToPath(new URL(p, root));

// The npm scripts use --env-file-if-exists (Node 22.9+) and `npm run check`
// uses the built-in coverage thresholds (22.8+). package.json's engines field
// is looser than that; this is the version that actually works.
export const WORKING_NODE = "22.9.0";
export const CHECKS = ["node", "deps", "env", "db", "testdb", "port"];
export const DB_FIX = "make db-up (Docker) or brew services start postgresql@14 && make db-create";

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

// KEY=value lines of a .env file → Map(key → value). Values are only ever
// tested for presence; nothing in this file prints one.
export function parseEnvFile(text) {
  const out = new Map();
  for (const raw of String(text).split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    const m = line.match(/^(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/);
    if (!m) continue;
    let v = m[2].trim();
    if (v.length >= 2 && ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'")))) v = v.slice(1, -1);
    out.set(m[1], v);
  }
  return out;
}

// Same precedence as `node --env-file-if-exists=.env`: the shell wins over the file.
function settings() {
  const file = at(".env");
  const hasFile = existsSync(file);
  const fromFile = hasFile ? parseEnvFile(readFileSync(file, "utf8")) : new Map();
  const get = (key) => {
    if (process.env[key]) return { value: process.env[key], from: "environment" };
    if (fromFile.get(key)) return { value: fromFile.get(key), from: ".env" };
    return null;
  };
  return { hasFile, get };
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

function checkEnv(s) {
  if (s.hasFile) ok(".env present");
  else fail(".env missing: make setup creates it from .env.example with a fresh TOKEN_ENC_KEY");
  const key = s.get("TOKEN_ENC_KEY");
  if (key && key.value.length >= 40) ok(`TOKEN_ENC_KEY present (${key.from})`);
  else if (s.hasFile || key) fail("TOKEN_ENC_KEY missing or too short: node scripts/set-env.mjs TOKEN_ENC_KEY=$(node -e \"console.log(require('crypto').randomBytes(32).toString('base64'))\")");
  const google = ["GOOGLE_CLIENT_ID", "GOOGLE_CLIENT_SECRET"].filter((k) => !s.get(k));
  if (google.length) warn(`Google sign-in off, demo only: ${google.join(" and ")} missing (docs/GOOGLE_SETUP.md, then node scripts/import-google-client.mjs <downloaded json>)`);
  else ok("Google sign-in configured (GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET present)");
  if (s.get("META_MODEL_API_KEY")) ok("Muse Spark on (META_MODEL_API_KEY present)");
  else warn("Muse Spark off, detector only: META_MODEL_API_KEY missing (node scripts/set-env.mjs META_MODEL_API_KEY=...)");
  const optional = ["ABUSECH_AUTH_KEY", "RESEND_API_KEY", "HIBP_API_KEY", "GMAIL_PUBSUB_TOPIC", "GMAIL_PUBSUB_SUBSCRIPTION"];
  info(`optional: ${optional.map((k) => `${k} ${s.get(k) ? "present" : "missing"}`).join(", ")}`);
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
  const url = found?.value || (test ? "postgres://localhost/scam_shield_test" : "postgres://localhost/scam_shield");
  const where = `${describeDbUrl(url)} (${key} ${found ? `from ${found.from}` : "default"})`;
  const label = test ? "test database" : "Postgres";
  const bad = test ? warn : fail;
  const consequence = test ? "; the integration tests skip without it" : "";
  const r = await connect(url);
  if (r.state === "nodeps") return info(`${label} ${where}: not checked until dependencies are installed`);
  if (r.state === "nodb") return bad(`${label}: ${r.message} on ${describeDbUrl(url).split("/")[0]}: make db-create${consequence}`);
  if (r.state === "auth") return bad(`${label} ${where}: ${r.message}: node scripts/set-env.mjs DATABASE_URL=postgres://user:password@localhost/scam_shield${consequence}`);
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
  const wanted = argv.filter((a) => !a.startsWith("--"));
  const unknown = wanted.filter((w) => !CHECKS.includes(w));
  if (unknown.length) {
    console.error(`unknown check: ${unknown.join(", ")} (choose from ${CHECKS.join(", ")})`);
    return 2;
  }
  const selected = wanted.length ? wanted : CHECKS;
  const s = settings();
  const runners = {
    node: () => checkNode(), deps: () => checkDeps(), env: () => checkEnv(s),
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
