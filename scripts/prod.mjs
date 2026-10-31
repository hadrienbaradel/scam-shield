#!/usr/bin/env node
// The laptop side of the OVH host (_product/docs/ops.md); the make targets call it.
//
//   node scripts/prod.mjs deploy              make deploy: preflight, git archive of HEAD, the playbook
//
// The host is the first one under [scam_shield] in .infra/prod/ansible/inventory.ini (gitignored; copy
// inventory.example.ini). Never prints a secret: the master key goes from config/master.key into the
// playbook (no_log), and the Postgres password never leaves the host.

import { spawnSync } from "node:child_process";
import { chmodSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, relative } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const ANSIBLE = join(ROOT, ".infra/prod/ansible");
const INVENTORY = process.env.PROD_INVENTORY || join(ANSIBLE, "inventory.ini");

const say = (s) => console.log(s);
const warn = (s) => console.error(`warning: ${s}`);
class Stop extends Error {}
const stop = (s) => { throw new Stop(s); };
const rel = (p) => relative(ROOT, p) || ".";
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
  const env = { ...process.env, ANSIBLE_CONFIG: join(ANSIBLE, "ansible.cfg") };

  const dir = mkdtempSync(join(tmpdir(), "prudence-deploy-"));
  chmodSync(dir, 0o700);
  try {
    const archive = join(dir, `scam-shield-${sha}.tar.gz`);
    const a = spawnSync("git", ["-c", "tar.umask=0022", "archive", "--format=tar.gz", "-o", archive, sha], { cwd: ROOT, stdio: "inherit" });
    if (a.status !== 0) stop("git archive failed");
    const vars = join(dir, "vars.json");
    writeFileSync(vars, JSON.stringify({ deploy_archive: archive, deploy_sha: sha }), { mode: 0o600 });
    say(`Deploying ${short} to ${t.name} (${t.user ? `${t.user}@` : ""}${t.host}): git archive of HEAD, then the playbook`);
    const extra = (process.env.ANSIBLE_ARGS || "").split(/\s+/).filter(Boolean);
    const r = spawnSync("ansible-playbook", ["-i", INVENTORY, join(ANSIBLE, "playbook.yml"), "-e", `@${vars}`, ...extra], { cwd: ANSIBLE, env, stdio: "inherit" });
    if (r.status !== 0) stop(`deploy FAILED (ansible-playbook exit ${r.status ?? r.signal}): the task above names the step. Containers the run did not replace keep running; make prod-status shows what is up.`);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }

  say(`Deployed ${short}. Now: make logs for a minute, Rollbar for new items, make prod-status (_product/docs/ops.md, Deploy often).`);
}

// ------------------------------------------------------------------

function help() {
  say(readFileSync(new URL(import.meta.url), "utf8").split("\n").filter((l) => /^\/\/ {3}/.test(l)).map((l) => l.slice(3)).join("\n"));
}

const commands = {
  deploy, help,
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
