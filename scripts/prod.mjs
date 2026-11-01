#!/usr/bin/env node
// The laptop side of the OVH host (_product/docs/ops.md); the make targets call it.
//
//   node scripts/prod.mjs deploy              make deploy: preflight, git archive of HEAD, the playbook, DATABASE_URL once
//   node scripts/prod.mjs ssh [command]       make prod-shell: SSH into the host
//   node scripts/prod.mjs logs                make logs: follow the app's logs (pino JSON)
//   node scripts/prod.mjs status              make prod-status: containers, health, disk, backups, tailnet, firewall
//   node scripts/prod.mjs backup-now          make backup-now: the daily dump, now
//   node scripts/prod.mjs backup-pull         make backup-pull: the latest dump into .runtime/backups/
//   node scripts/prod.mjs backup-restore F    make backup-restore FILE=F: a dump back into production (asks first)
//   node scripts/prod.mjs db-mode [DB]        make server asks: "shared" (DATABASE_URL in the credentials) or "dev"
//   node scripts/prod.mjs db-server           make server: the laptop app on the shared database, migrated first, no jobs
//   node scripts/prod.mjs db-url              make db-prod-url: DATABASE_URL into the credentials, piped from the host
//   node scripts/prod.mjs db-shell            make db-prod-shell: psql on the shared database
//
// The host is the first one under [scam_shield] in .infra/prod/ansible/inventory.ini (gitignored; copy
// inventory.example.ini). Never prints a secret: the master key, the Postgres password, the Tailscale auth
// key and the tunnel token go from a file or the environment into the playbook (no_log) or through a pipe.
// The decisions and the commands it builds are exported pure functions (tests/prod-script.test.js); the
// functions that run them talk to the host.

import { spawn, spawnSync } from "node:child_process";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { lookup } from "node:dns/promises";
import { tmpdir } from "node:os";
import { basename, join, relative } from "node:path";
import { createInterface } from "node:readline/promises";
import { fileURLToPath, pathToFileURL } from "node:url";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const ANSIBLE = join(ROOT, ".infra/prod/ansible");
const INVENTORY = process.env.PROD_INVENTORY || join(ANSIBLE, "inventory.ini");
const APP_DIR = "/opt/scam-shield";
const BACKUPS = "/var/backups/prudence";
const COMPOSE = `sudo docker compose -f ${APP_DIR}/.infra/prod/docker-compose.yml`;
const DAILY_DUMP = /^\d{4}-\d{2}-\d{2}\.dump$/;

const say = (s) => console.log(s);
const warn = (s) => console.error(`warning: ${s}`);
class Stop extends Error {}
const stop = (s) => { throw new Stop(s); };
const rel = (p) => relative(ROOT, p) || ".";
// One shell word, whatever it holds (a path, a remote command).
export const shq = (s) => `'${String(s).replaceAll("'", "'\\''")}'`;
const has = (cmd) => spawnSync("/bin/sh", ["-c", `command -v ${cmd}`], { stdio: "ignore" }).status === 0;
const git = (...args) => spawnSync("git", args, { cwd: ROOT, encoding: "utf8" }).stdout?.trimEnd() ?? "";

// The first host under [scam_shield]: "name ansible_host=... ansible_user=... [ansible_port=...]".
export function readInventory(text) {
  let group = "";
  for (const raw of String(text).split(/\r?\n/)) {
    const line = raw.replace(/^\s*[#;].*$/, "").trim();
    if (!line) continue;
    const g = line.match(/^\[([^\]]+)\]$/);
    if (g) { group = g[1].trim(); continue; }
    if (group !== "scam_shield") continue;
    const [name, ...pairs] = line.split(/\s+/);
    const vars = Object.fromEntries(pairs.filter((p) => p.includes("=")).map((p) => [p.slice(0, p.indexOf("=")), p.slice(p.indexOf("=") + 1)]));
    return { name, host: vars.ansible_host || name, user: vars.ansible_user || "", port: vars.ansible_port || "" };
  }
  return null;
}

// The inventory's text (null when the file is missing) → { target } or { error }, the line to show.
export function inventoryCheck(label, text) {
  if (text == null) return { error: `No ${label}: cp .infra/prod/ansible/inventory.example.ini ${label}, then set ansible_host and ansible_user (_product/docs/ops.md)` };
  const t = readInventory(text);
  return t ? { target: t } : { error: `${label} names no host under [scam_shield]` };
}
const readTarget = () => inventoryCheck(rel(INVENTORY), existsSync(INVENTORY) ? readFileSync(INVENTORY, "utf8") : null);
function target() {
  const r = readTarget();
  if (r.error) stop(r.error);
  return r.target;
}
export const sshArgs = (t, extra = []) => [...extra, ...(t.port ? ["-p", t.port] : []), t.user ? `${t.user}@${t.host}` : t.host];
const ssh = (command, { tty = false, capture = false } = {}) =>
  spawnSync("ssh", [...sshArgs(target(), tty ? ["-t"] : []), ...(command ? [command] : [])],
    { stdio: capture ? ["ignore", "pipe", "inherit"] : "inherit", encoding: "utf8" });
const rsyncSsh = (t) => ["-e", `ssh${t.port ? ` -p ${t.port}` : ""}`, "--rsync-path=sudo rsync"];
const remote = (t, path) => `${t.user ? `${t.user}@` : ""}${t.host}:${path}`;

// The team's credentials, read in place (names and the two values used here, never printed).
async function credentials() {
  const { openOrThrow } = await import("../lib/credentialStore.js");
  return openOrThrow().map;
}

// ------------------------------------------------------------------ deploy

// What stops a deploy and what only warns, from facts the caller gathered: ansible-playbook on PATH,
// config/master.key present (the playbook reads that file), the inventory check, HEAD's sha, the
// porcelain status of tracked files, and whether HEAD is on origin/main.
export function preflight({ hasAnsible, hasMasterKey, inventory, sha, dirty, onOriginMain }) {
  const errors = [];
  const warnings = [];
  if (!hasAnsible) errors.push("ansible-playbook not found: brew install ansible (or pipx install ansible-core)");
  if (!hasMasterKey) errors.push("No config/master.key: get it from a teammate, then make secrets-init (_product/docs/secrets.md)");
  if (inventory?.error) errors.push(inventory.error);
  if (!/^[0-9a-f]{40}$/.test(sha || "")) errors.push("Not a git checkout with a commit: make deploy ships git archive HEAD");
  const short = String(sha || "").slice(0, 12);
  if (dirty) warnings.push(`tracked files have uncommitted changes; they are NOT deployed (the archive is HEAD ${short}):\n${dirty}`);
  if (!onOriginMain) warnings.push(`HEAD ${short} is not on origin/main (git fetch, then push or deploy main): the team deploys green main`);
  return { errors, warnings };
}

// git archive of exactly that commit (a commit landing meanwhile changes nothing), files 0644 and folders 0755.
export const archiveArgs = (sha, file) => ["-c", "tar.umask=0022", "archive", "--format=tar.gz", "-o", file, sha];
// The only extra vars on disk: where the archive is and its sha, which becomes GIT_SHA, the image's
// APP_VERSION and what /api/health must name before the deploy counts as done. No secret.
export const deployVars = (archive, sha) => ({ deploy_archive: archive, deploy_sha: sha });
export const playbookArgs = ({ inventory, playbook, varsFile, extra = "" }) =>
  ["-i", inventory, playbook, "-e", `@${varsFile}`, ...String(extra || "").split(/\s+/).filter(Boolean)];

// The playbook's environment: the caller's, plus the Tailscale auth key from its gitignored file and the
// backup heartbeat from the team's credentials, each only when the environment has none. Values travel
// to ansible-playbook (no_log tasks), never to the screen; the base environment is left as it was.
export function deployEnv(base, { ansibleConfig, authKey = "", heartbeat = "" } = {}) {
  const env = { ...base, ANSIBLE_CONFIG: ansibleConfig };
  if (!env.TS_AUTHKEY && authKey) env.TS_AUTHKEY = authKey;
  if (!env.HEARTBEAT_BACKUP_URL && heartbeat) env.HEARTBEAT_BACKUP_URL = heartbeat;
  return env;
}
// What make deploy says about the secrets it passes: whether each one is there, never what it is.
export const secretsLine = (env) =>
  `Tailscale: ${env.TS_AUTHKEY ? "an auth key is given (joins the tailnet if not joined yet)" : "no TS_AUTHKEY (the join is skipped)"}; tunnel: ${env.TUNNEL_TOKEN ? "a TUNNEL_TOKEN is given" : "the host keeps what it has"}`;

// The shared database's host as a laptop reaches it: the box's Tailscale address, since MagicDNS is off on
// the tailnet (meikit.tail2c017.ts.net works where it is on). PROD_DB_HOST changes it. The only place the
// code names it: config/credentials.enc carries it inside DATABASE_URL (_product/docs/ops.md).
export const SHARED_DB_HOST = process.env.PROD_DB_HOST || "100.127.78.127";

// DATABASE_URL from the host's .env in one pipeline: sed on the host prints the KEY=value line,
// credentials.mjs set reads it on stdin and prints the name only; this process never holds the password.
export function dbUrlSed(host = SHARED_DB_HOST) {
  if (!/^[A-Za-z0-9][A-Za-z0-9.-]*$/.test(host)) stop(`PROD_DB_HOST must be a host name or an IPv4 address: ${host}`);
  return `s|^POSTGRES_PASSWORD=\\([A-Za-z0-9][A-Za-z0-9]*\\)$|DATABASE_URL=postgres://scam_shield:\\1@${host}:5432/scam_shield|p`;
}
export const dbUrlPipeline = (t, { appDir = APP_DIR, node = process.execPath, host = SHARED_DB_HOST } = {}) =>
  `ssh ${sshArgs(t).map(shq).join(" ")} ${shq(`sudo sed -n ${shq(dbUrlSed(host))} ${appDir}/.infra/prod/.env`)} | ${shq(node)} scripts/credentials.mjs set`;
const storeDbUrl = (t) => spawnSync("/bin/sh", ["-c", dbUrlPipeline(t)], { cwd: ROOT, stdio: ["ignore", "inherit", "inherit"] }).status === 0;

async function deploy() {
  const inventory = readTarget();
  const sha = git("rev-parse", "HEAD");
  const { errors, warnings } = preflight({
    hasAnsible: has("ansible-playbook"),
    hasMasterKey: existsSync(join(ROOT, "config/master.key")),
    inventory,
    sha,
    dirty: git("status", "--porcelain", "--untracked-files=no"),
    onOriginMain: spawnSync("git", ["merge-base", "--is-ancestor", "HEAD", "origin/main"], { cwd: ROOT }).status === 0,
  });
  if (errors.length) stop(errors.join("\n"));
  for (const w of warnings) warn(w);
  const t = inventory.target;
  const short = sha.slice(0, 12);
  const creds = await credentials();
  const keyFile = join(ANSIBLE, ".tailscale-authkey");
  const env = deployEnv(process.env, {
    ansibleConfig: join(ANSIBLE, "ansible.cfg"),
    authKey: existsSync(keyFile) ? readFileSync(keyFile, "utf8").trim() : "",
    heartbeat: creds.get("HEARTBEAT_BACKUP_URL") || "",
  });

  const dir = mkdtempSync(join(tmpdir(), "prudence-deploy-"));
  chmodSync(dir, 0o700);
  try {
    const archive = join(dir, `scam-shield-${sha}.tar.gz`);
    const a = spawnSync("git", archiveArgs(sha, archive), { cwd: ROOT, stdio: "inherit" });
    if (a.status !== 0) stop("git archive failed");
    const vars = join(dir, "vars.json");
    writeFileSync(vars, JSON.stringify(deployVars(archive, sha)), { mode: 0o600 });
    say(`Deploying ${short} to ${t.name} (${t.user ? `${t.user}@` : ""}${t.host}): git archive of HEAD, then the playbook`);
    say(secretsLine(env));
    const args = playbookArgs({ inventory: INVENTORY, playbook: join(ANSIBLE, "playbook.yml"), varsFile: vars, extra: process.env.ANSIBLE_ARGS });
    const r = spawnSync("ansible-playbook", args, { cwd: ANSIBLE, env, stdio: "inherit" });
    if (r.status !== 0) stop(`deploy FAILED (ansible-playbook exit ${r.status ?? r.signal}): the task above names the step. Containers the run did not replace keep running; make prod-status shows what is up.`);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }

  if (!creds.get("DATABASE_URL")) {
    if (storeDbUrl(t)) say(`DATABASE_URL (the shared database at ${SHARED_DB_HOST}:5432) is in config/credentials.enc now: commit and push that file so the team has it (make server, make db-prod-shell).`);
    else warn("DATABASE_URL was not stored (see above); the next make deploy tries again, or make db-prod-url");
  }
  say(`Deployed ${short}. Now: make logs for a minute, Rollbar for new items, make prod-status (_product/docs/ops.md, Deploy often).`);
  if (env.TS_AUTHKEY && existsSync(keyFile)) say(`${rel(keyFile)} is a single-use key: delete it once prod-status shows the tailnet.`);
}

// ------------------------------------------------------------------ the host

const prodShell = (args) => {
  const r = ssh(args.join(" "), { tty: Boolean(process.stdin.isTTY) });
  return r.status ?? 1;
};
const logs = () => ssh(`${COMPOSE} logs --follow --tail=200 app`, { tty: Boolean(process.stdin.isTTY) }).status ?? 1;
const status = () => ssh(`sudo bash ${APP_DIR}/.infra/prod/scripts/status.sh`).status ?? 1;

function backupNow() {
  const r = ssh(`sudo systemctl start prudence-backup.service; s=$?; sudo journalctl -u prudence-backup.service -t prudence-backup -n 1 -o cat --no-pager; exit $s`);
  return r.status ?? 1;
}

// The newest daily dump in an `ls -1` of the backup folder; pre-restore and partial files never count.
export const pickLatestDump = (listing) => String(listing || "").split("\n").map((s) => s.trim()).filter((s) => DAILY_DUMP.test(s)).sort().pop();

function latestDump() {
  const r = ssh(`sudo ls -1 ${BACKUPS}`, { capture: true });
  if (r.status !== 0) stop(`Cannot list ${BACKUPS} on the host (has make deploy run?)`);
  return pickLatestDump(r.stdout);
}

function backupPull() {
  const name = latestDump();
  if (!name) stop("No dump on the host yet: make backup-now");
  const t = target();
  const dest = join(ROOT, ".runtime/backups");
  mkdirSync(dest, { recursive: true, mode: 0o700 });
  const r = spawnSync("rsync", ["-t", ...rsyncSsh(t), remote(t, `${BACKUPS}/${name}`), `${dest}/`], { stdio: "inherit" });
  if (r.status !== 0) stop("rsync failed");
  chmodSync(join(dest, name), 0o600);
  say(`${name} copied to ${rel(dest)}/ (gitignored, mode 600): the off-host copy. Older copies stay there until you delete them.`);
}

// Which dump a restore uses: FILE must name a .dump (the Makefile's FILE defaults to .env); a file here is
// sent up as restore-<name>, a bare name is one already in the backup folder.
export function restoreSource(file, existsHere) {
  if (!file || !/\.dump$/.test(file)) return { error: "Name a dump: make backup-restore FILE=2026-10-31.dump (in /var/backups/prudence on the host) or FILE=.runtime/backups/2026-10-31.dump (sent to the host first)" };
  if (existsHere) return { upload: true, onHost: `${BACKUPS}/restore-${basename(file)}` };
  if (file.includes("/")) return { error: `${file} does not exist here; a dump on the host is named without a folder (ssh in and ls ${BACKUPS})` };
  return { upload: false, onHost: `${BACKUPS}/${file}` };
}

// The restore, as one script for the host: a dump of the current data first, the app stopped, the dump
// restored in one transaction, the app started (it migrates), then its health.
export const restoreScript = (onHost) => [
  "set -euo pipefail",
  `sudo test -s ${shq(onHost)} || { echo "no dump at ${onHost}"; exit 1; }`,
  `safety=${BACKUPS}/pre-restore-$(date +%F-%H%M%S).dump`,
  `${COMPOSE} exec -T postgres pg_dump -U scam_shield -d scam_shield -Fc | sudo tee "$safety" > /dev/null`,
  `sudo chmod 600 "$safety"; echo "current data saved in $safety"`,
  `${COMPOSE} stop app`,
  `sudo cat ${shq(onHost)} | ${COMPOSE} exec -T postgres pg_restore -U scam_shield -d scam_shield --clean --if-exists --no-owner --single-transaction`,
  `${COMPOSE} start app`,
  `for i in $(seq 30); do if out=$(curl -fsS -m 5 http://127.0.0.1:3000/api/health); then echo "restored; /api/health: $out"; exit 0; fi; sleep 2; done`,
  `echo "restored, but /api/health does not answer: make logs"; exit 1`,
].join("\n");

async function backupRestore([file]) {
  const source = restoreSource(file, Boolean(file) && existsSync(file));
  if (source.error) stop(source.error);
  const t = target();
  const { onHost } = source;
  if (source.upload) {
    const r = spawnSync("rsync", ["-t", ...rsyncSsh(t), file, remote(t, onHost)], { stdio: "inherit" });
    if (r.status !== 0) stop("rsync to the host failed");
  }
  if (process.env.FORCE !== "1") {
    const rl = createInterface({ input: process.stdin, output: process.stdout });
    const a = await rl.question(`Replace the production database with ${onHost}? The app stops for the restore; a dump of the current data is taken first. Type restore to go on: `);
    rl.close();
    if (a.trim() !== "restore") stop("kept: nothing changed");
  }
  return ssh(`bash -c ${shq(restoreScript(onHost))}`).status ?? 1;
}

// ------------------------------------------------------------------ the shared database (over Tailscale)

// host:port of a database URL, the only part of it a message names.
export const dbWhere = (url) => { const u = new URL(url); return `${u.hostname}:${u.port || 5432}`; };

// What make server runs on, from DB (dev, prod or anything else) and the team's DATABASE_URL in the
// credentials ("" when the file has none or cannot be opened, as on a clone without the master key; why
// says which): the shared database, or this laptop's own Postgres. DB=local, the old name, means dev; only
// DB=prod insists on the shared one.
export function serverDatabase({ db = "", sharedUrl = "", why = "" } = {}) {
  if (db === "dev" || db === "local") return { mode: "dev" };
  if (sharedUrl) return { mode: "shared", url: sharedUrl };
  const reason = why || "config/credentials.enc has no DATABASE_URL";
  if (db === "prod") return { error: `No shared database: ${reason}. git pull, or make db-prod-url (_product/docs/ops.md)` };
  return { mode: "dev", note: `No shared database here (${reason}): make server runs on this laptop's Postgres, as make server DB=dev does.` };
}

// One line for a shared database that does not open, naming its host, never its password.
export function unreachableMessage(url, err) {
  const where = dbWhere(url);
  const code = err?.code || (/timeout/i.test(String(err?.message || "")) ? "timeout" : String(err?.message || err));
  if (code === "28P01" || code === "28000") return `The shared database at ${where} refused the password in DATABASE_URL: git pull (the team's credentials may hold a newer one), or make db-prod-url (_product/docs/ops.md)`;
  return `The shared database does not answer at ${where} (${code}): is Tailscale running on this laptop, and is meikit shared with you (tailscale status lists it)? make server DB=dev runs on this laptop's Postgres meanwhile (_product/docs/ops.md)`;
}

// The migration files this checkout has that the database has not applied (the app would apply them at start).
export const migrationsAhead = (files, applied) => files.filter((f) => f.endsWith(".sql") && !new Set(applied).has(f)).sort();
// What make server does about them on the shared database: it applies the pending ones once, before the app
// starts, and refuses when one of them is not committed (untracked or changed in git's porcelain status):
// production would keep a version nobody else has, and a deploy never applies it again.
export function migrationPlan(files, applied, gitStatus = "") {
  const pending = migrationsAhead(files, applied);
  const changed = new Set(String(gitStatus).split("\n").map((l) => l.slice(3).split(" -> ").pop().trim()).filter(Boolean).map((p) => basename(p)));
  return { pending, uncommitted: pending.filter((f) => changed.has(f)) };
}

// psql's arguments and environment for a URL: the password goes in PGPASSWORD, never on the command line.
export function psqlCall(url, host) {
  const u = new URL(url);
  return {
    args: ["-h", host || u.hostname, "-p", u.port || "5432", "-U", decodeURIComponent(u.username), "-d", u.pathname.slice(1)],
    env: { PGPASSWORD: decodeURIComponent(u.password) },
  };
}
// psql from the postgres image when the laptop has none; a terminal gets -it, a pipe -i (echo 'select 1' | make db-prod-shell).
export const dockerPsqlArgs = (args, tty) => ["run", "--rm", tty ? "-it" : "-i", "-e", "PGPASSWORD", "postgres:16-alpine", "psql", ...args];

// The team's DATABASE_URL and, when there is none, why. Never throws, never prints the value.
async function sharedDbUrl() {
  const { open } = await import("../lib/credentialStore.js");
  const { status, map } = open();
  if (status.error) return { url: "", why: status.error.startsWith("No master key") ? "no master key on this machine" : status.error };
  if (!status.exists) return { url: "", why: "no config/credentials.enc" };
  return { url: map.get("DATABASE_URL") || "", why: "" };
}

async function dbMode([db = ""]) {
  const { url, why } = await sharedDbUrl();
  const choice = serverDatabase({ db, sharedUrl: url, why });
  if (choice.error) stop(choice.error);
  if (choice.note) console.error(choice.note);
  say(choice.mode);
}

async function dbServer() {
  const { url, why } = await sharedDbUrl();
  if (!url) stop(serverDatabase({ db: "prod", why }).error);
  const { default: pg } = await import("pg");
  const client = new pg.Client({ connectionString: url, connectionTimeoutMillis: 5000, application_name: "scam-shield-make-server" });
  try {
    await client.connect();
  } catch (e) {
    stop(unreachableMessage(url, e));
  }
  let applied = [];
  try { applied = (await client.query("SELECT name FROM schema_migrations")).rows.map((r) => r.name); } catch { /* a fresh database: all pending */ }
  await client.end();
  const plan = migrationPlan(readdirSync(join(ROOT, "src/db/migrations")), applied, git("status", "--porcelain", "--untracked-files=all", "--", "src/db/migrations"));
  if (plan.uncommitted.length) stop(`Not committed: ${plan.uncommitted.join(", ")}. make server would apply it to the shared production database, which would keep a version nobody else has: commit and push it first, or make server DB=dev.`);
  say(`make server on the shared production database (${dbWhere(url)}, DATABASE_URL from config/credentials.enc); background jobs off (WORKER=0): the host runs them. Every query crosses the tailnet: make server DB=dev for query-heavy work.`);
  say(plan.pending.length ? `Migrations: ${plan.pending.join(", ")} not applied there yet; applying them now (additive only until Nov 4, _product/docs/ops.md).` : "Migrations: none missing there; the pattern cards are checked.");
  const m = spawnSync(process.execPath, ["--import", "./lib/credentials.js", "src/db/migrate.js"], { cwd: ROOT, stdio: "inherit", env: { ...process.env, DATABASE_URL: url } });
  if (m.status !== 0) stop("The migration failed on the shared database (above): the app was not started.");
  // MIGRATE=0: restarts on a file change do not migrate again (src/server.js).
  const child = spawn(process.execPath, ["--env-file-if-exists=.env", "--import", "./lib/credentials.js", "--watch-path=src", "--watch-path=lib", "--watch-path=public", "src/server.js"],
    { cwd: ROOT, stdio: "inherit", env: { ...process.env, DATABASE_URL: url, WORKER: "0", MIGRATE: "0" } });
  for (const sig of ["SIGINT", "SIGTERM"]) process.on(sig, () => child.kill(sig));
  return await new Promise((resolve) => child.on("exit", (code) => resolve(code ?? 0)));
}

function dbUrl() {
  if (!storeDbUrl(target())) stop("DATABASE_URL was not stored (see above): the host's .env holds the Postgres password once make deploy has run there.");
  say(`DATABASE_URL points at the shared database (${SHARED_DB_HOST}:5432; the password came from the host's .env and was never shown): commit and push config/credentials.enc.`);
}

async function dbShell() {
  const { url, why } = await sharedDbUrl();
  if (!url) stop(serverDatabase({ db: "prod", why }).error);
  const { hostname } = new URL(url);
  const call = psqlCall(url);
  const env = { ...process.env, ...call.env };
  if (has("psql")) return spawnSync("psql", call.args, { stdio: "inherit", env }).status ?? 1;
  if (!has("docker")) stop("psql not found: brew install libpq && brew link --force libpq (or install Docker)");
  let address;
  try { ({ address } = await lookup(hostname)); } catch { stop(`${hostname} does not resolve here: MagicDNS is off, so use the Tailscale address in DATABASE_URL (as the team's does)`); }
  return spawnSync("docker", dockerPsqlArgs(psqlCall(url, address).args, Boolean(process.stdin.isTTY)), { stdio: "inherit", env }).status ?? 1;
}

// ------------------------------------------------------------------

function help() {
  say(readFileSync(new URL(import.meta.url), "utf8").split("\n").filter((l) => /^\/\/ {3}/.test(l)).map((l) => l.slice(3)).join("\n"));
}

const commands = {
  deploy, ssh: prodShell, logs, status, "backup-now": backupNow, "backup-pull": backupPull,
  "backup-restore": backupRestore, "db-mode": dbMode, "db-server": dbServer, "db-url": dbUrl, "db-shell": dbShell, help,
};
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const [cmd = "help", ...rest] = process.argv.slice(2);
  try {
    if (!commands[cmd]) { console.error(`unknown command: ${cmd}`); help(); process.exitCode = 2; }
    else process.exitCode = (await commands[cmd](rest)) || 0;
  } catch (e) {
    if (!(e instanceof Stop)) throw e;
    console.error(e.message);
    process.exitCode = 1;
  }
}
