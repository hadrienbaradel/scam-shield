#!/usr/bin/env node
// The laptop side of the OVH host (_product/docs/ops.md); the make targets call it.
//
//   node scripts/prod.mjs deploy              make deploy: preflight, git archive of HEAD, the playbook, PROD_DATABASE_URL
//   node scripts/prod.mjs ssh [command]       make prod-shell: SSH into the host
//   node scripts/prod.mjs logs                make logs: follow the app's logs (pino JSON)
//   node scripts/prod.mjs status              make prod-status: containers, health, disk, backups, tailnet, firewall
//   node scripts/prod.mjs backup-now          make backup-now: the daily dump, now
//   node scripts/prod.mjs backup-pull         make backup-pull: the latest dump into .runtime/backups/
//   node scripts/prod.mjs backup-restore F    make backup-restore FILE=F: a dump back into production (asks first)
//   node scripts/prod.mjs db-server           make server DB=prod: the laptop app on the shared database, no jobs
//   node scripts/prod.mjs db-shell            make db-prod-shell: psql on the shared database
//
// The host is the first one under [scam_shield] in .infra/prod/ansible/inventory.ini (gitignored; copy
// inventory.example.ini). Never prints a secret: the master key, the Postgres password, and the Tailscale
// auth key go from a file or the environment into the playbook (no_log) or through a pipe.

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
const shq = (s) => `'${String(s).replaceAll("'", "'\\''")}'`;
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

function target() {
  if (!existsSync(INVENTORY)) stop(`No ${rel(INVENTORY)}: cp .infra/prod/ansible/inventory.example.ini ${rel(INVENTORY)}, then set ansible_host and ansible_user (_product/docs/ops.md)`);
  const t = readInventory(readFileSync(INVENTORY, "utf8"));
  if (!t) stop(`${rel(INVENTORY)} names no host under [scam_shield]`);
  return t;
}
const sshArgs = (t, extra = []) => [...extra, ...(t.port ? ["-p", t.port] : []), t.user ? `${t.user}@${t.host}` : t.host];
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

async function deploy() {
  if (!has("ansible-playbook")) stop("ansible-playbook not found: brew install ansible (or pipx install ansible-core)");
  if (!process.env.MASTER_KEY && !existsSync(join(ROOT, "config/master.key"))) stop("No config/master.key: get it from a teammate, then make secrets-init (_product/docs/secrets.md)");
  const t = target();
  const sha = git("rev-parse", "HEAD");
  if (!/^[0-9a-f]{40}$/.test(sha)) stop("Not a git checkout with a commit: make deploy ships git archive HEAD");
  const short = sha.slice(0, 12);
  const dirty = git("status", "--porcelain", "--untracked-files=no");
  if (dirty) warn(`tracked files have uncommitted changes; they are NOT deployed (the archive is HEAD ${short}):\n${dirty}`);
  if (spawnSync("git", ["merge-base", "--is-ancestor", "HEAD", "origin/main"], { cwd: ROOT }).status !== 0) {
    warn(`HEAD ${short} is not on origin/main (git fetch, then push or deploy main): the team deploys green main`);
  }
  const creds = await credentials();
  const env = { ...process.env, ANSIBLE_CONFIG: join(ANSIBLE, "ansible.cfg") };
  const keyFile = join(ANSIBLE, ".tailscale-authkey");
  if (!env.TS_AUTHKEY && existsSync(keyFile)) env.TS_AUTHKEY = readFileSync(keyFile, "utf8").trim();
  if (!env.HEARTBEAT_BACKUP_URL && creds.get("HEARTBEAT_BACKUP_URL")) env.HEARTBEAT_BACKUP_URL = creds.get("HEARTBEAT_BACKUP_URL");

  const dir = mkdtempSync(join(tmpdir(), "prudence-deploy-"));
  chmodSync(dir, 0o700);
  try {
    const archive = join(dir, `scam-shield-${sha}.tar.gz`);
    const a = spawnSync("git", ["-c", "tar.umask=0022", "archive", "--format=tar.gz", "-o", archive, sha], { cwd: ROOT, stdio: "inherit" });
    if (a.status !== 0) stop("git archive failed");
    const vars = join(dir, "vars.json");
    writeFileSync(vars, JSON.stringify({ deploy_archive: archive, deploy_sha: sha }), { mode: 0o600 });
    say(`Deploying ${short} to ${t.name} (${t.user ? `${t.user}@` : ""}${t.host}): git archive of HEAD, then the playbook`);
    say(`Tailscale: ${env.TS_AUTHKEY ? "an auth key is given (joins the tailnet if not joined yet)" : "no TS_AUTHKEY (the join is skipped)"}`);
    const extra = (process.env.ANSIBLE_ARGS || "").split(/\s+/).filter(Boolean);
    const r = spawnSync("ansible-playbook", ["-i", INVENTORY, join(ANSIBLE, "playbook.yml"), "-e", `@${vars}`, ...extra], { cwd: ANSIBLE, env, stdio: "inherit" });
    if (r.status !== 0) stop(`deploy FAILED (ansible-playbook exit ${r.status ?? r.signal}): the task above names the step. Containers the run did not replace keep running; make prod-status shows what is up.`);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }

  if (!creds.get("PROD_DATABASE_URL")) {
    // One pipeline: the host's .env → the team's encrypted credentials. The password never reaches this process or the screen.
    const sed = `sudo sed -n 's|^POSTGRES_PASSWORD=\\([A-Za-z0-9][A-Za-z0-9]*\\)$|PROD_DATABASE_URL=postgres://scam_shield:\\1@prudence-prod:5432/scam_shield|p' ${APP_DIR}/.infra/prod/.env`;
    const pipe = `ssh ${sshArgs(t).map(shq).join(" ")} ${shq(sed)} | ${shq(process.execPath)} scripts/credentials.mjs set`;
    const s = spawnSync("/bin/sh", ["-c", pipe], { cwd: ROOT, stdio: ["ignore", "inherit", "inherit"] });
    if (s.status === 0) say("PROD_DATABASE_URL is in config/credentials.enc now: commit and push that file so the team has it (make server DB=prod, make db-prod-shell).");
    else warn("PROD_DATABASE_URL was not stored (see above); the next make deploy tries again");
  }
  say(`Deployed ${short}. Now: make logs for a minute, Rollbar for new items, make prod-status (_product/docs/ops.md, Deploy often).`);
  if (env.TS_AUTHKEY && existsSync(keyFile)) say(`${rel(keyFile)} is a single-use key: delete it once prod-status shows the tailnet.`);
}

// ------------------------------------------------------------------ the host

const prodShell = (args) => {
  const r = ssh(args.join(" "), { tty: !args.length || process.stdout.isTTY });
  return r.status ?? 1;
};
const logs = () => ssh(`${COMPOSE} logs --follow --tail=200 app`, { tty: true }).status ?? 1;
const status = () => ssh(`sudo bash ${APP_DIR}/.infra/prod/scripts/status.sh`).status ?? 1;

function backupNow() {
  const r = ssh(`sudo systemctl start prudence-backup.service; s=$?; sudo journalctl -u prudence-backup.service -n 1 -o cat --no-pager; exit $s`);
  return r.status ?? 1;
}

function latestDump() {
  const r = ssh(`sudo ls -1 ${BACKUPS}`, { capture: true });
  if (r.status !== 0) stop(`Cannot list ${BACKUPS} on the host (has make deploy run?)`);
  return r.stdout.split("\n").map((s) => s.trim()).filter((s) => DAILY_DUMP.test(s)).sort().pop();
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

async function backupRestore([file]) {
  if (!file || !/\.dump$/.test(file)) stop("Name a dump: make backup-restore FILE=2026-10-31.dump (in /var/backups/prudence on the host) or FILE=.runtime/backups/2026-10-31.dump (sent to the host first)");
  const t = target();
  let onHost;
  if (existsSync(file)) {
    onHost = `${BACKUPS}/restore-${basename(file)}`;
    const r = spawnSync("rsync", ["-t", ...rsyncSsh(t), file, remote(t, onHost)], { stdio: "inherit" });
    if (r.status !== 0) stop("rsync to the host failed");
  } else {
    if (file.includes("/")) stop(`${file} does not exist here; a dump on the host is named without a folder (make backup-pull lists none: ssh in and ls ${BACKUPS})`);
    onHost = `${BACKUPS}/${file}`;
  }
  if (process.env.FORCE !== "1") {
    const rl = createInterface({ input: process.stdin, output: process.stdout });
    const a = await rl.question(`Replace the production database with ${onHost}? The app stops for the restore; a dump of the current data is taken first. Type restore to go on: `);
    rl.close();
    if (a.trim() !== "restore") stop("kept: nothing changed");
  }
  const script = [
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
  return ssh(`bash -c ${shq(script)}`).status ?? 1;
}

// ------------------------------------------------------------------ the shared database (over Tailscale)

async function prodUrl() {
  const url = process.env.PROD_DATABASE_URL || (await credentials()).get("PROD_DATABASE_URL");
  if (!url) stop("PROD_DATABASE_URL is not in the credentials yet: git pull (a deploy stores it), or make deploy once (_product/docs/ops.md)");
  return url;
}

async function dbServer() {
  const url = await prodUrl();
  const where = `${new URL(url).hostname}:${new URL(url).port || 5432}`;
  const { default: pg } = await import("pg");
  const client = new pg.Client({ connectionString: url, connectionTimeoutMillis: 8000 });
  try {
    await client.connect();
  } catch (e) {
    stop(`The shared database does not answer at ${where} (${e.code || e.message}): is Tailscale up on this laptop (tailscale status shows prudence-prod)? _product/docs/ops.md`);
  }
  const applied = new Set((await client.query("SELECT name FROM schema_migrations")).rows.map((r) => r.name));
  await client.end();
  const ahead = readdirSync(join(ROOT, "src/db/migrations")).filter((f) => f.endsWith(".sql") && !applied.has(f));
  if (ahead.length) stop(`This checkout has migrations production has not applied (${ahead.join(", ")}). The app migrates at start, so it would change the shared database: deploy first (make deploy), or stay local (make server).`);
  say(`The laptop app on the shared production database (${where}) with WORKER=0: production alone runs the jobs. Each page pays round trips across the ocean.`);
  const child = spawn(process.execPath, ["--env-file-if-exists=.env", "--import", "./lib/credentials.js", "--watch-path=src", "--watch-path=lib", "--watch-path=public", "src/server.js"],
    { cwd: ROOT, stdio: "inherit", env: { ...process.env, DATABASE_URL: url, WORKER: "0" } });
  for (const sig of ["SIGINT", "SIGTERM"]) process.on(sig, () => child.kill(sig));
  return await new Promise((resolve) => child.on("exit", (code) => resolve(code ?? 0)));
}

async function dbShell() {
  const u = new URL(await prodUrl());
  const env = { ...process.env, PGPASSWORD: decodeURIComponent(u.password) };
  const args = (host) => ["-h", host, "-p", u.port || "5432", "-U", decodeURIComponent(u.username), "-d", u.pathname.slice(1)];
  if (has("psql")) return spawnSync("psql", args(u.hostname), { stdio: "inherit", env }).status ?? 1;
  if (!has("docker")) stop("psql not found: brew install libpq && brew link --force libpq (or install Docker)");
  let address;
  try { ({ address } = await lookup(u.hostname)); } catch { stop(`${u.hostname} does not resolve: is Tailscale up on this laptop, with MagicDNS on?`); }
  return spawnSync("docker", ["run", "--rm", "-it", "-e", "PGPASSWORD", "postgres:16-alpine", "psql", ...args(address)], { stdio: "inherit", env }).status ?? 1;
}

// ------------------------------------------------------------------

function help() {
  say(readFileSync(new URL(import.meta.url), "utf8").split("\n").filter((l) => /^\/\/ {3}/.test(l)).map((l) => l.slice(3)).join("\n"));
}

const commands = {
  deploy, ssh: prodShell, logs, status, "backup-now": backupNow, "backup-pull": backupPull,
  "backup-restore": backupRestore, "db-server": dbServer, "db-shell": dbShell, help,
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
