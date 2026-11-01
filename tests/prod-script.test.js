// scripts/prod.mjs, the laptop side of the OVH host (_product/docs/ops.md): the decisions and the commands
// it builds, which are pure functions. No network and no SSH: the one pipeline test runs the exact command
// string with `ssh` and `sudo` replaced by local stubs and `credentials.mjs set` by a file that records its
// stdin, against a throwaway .env.
// Not testable without the host, so not faked here: the playbook run itself (make deploy after the
// preflight; checked on the host, _product/specs/public-deployment.md Acceptance), the SSH sessions (make
// logs, prod-status, prod-shell, backup-now), the rsync copies (backup-pull, the restore upload), the
// restore run, and the database calls of make server and make db-prod-shell (tests/shared-database.test.js
// covers which database the app and the tests end up on).
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  SHARED_DB_HOST, archiveArgs, dbUrlPipeline, dbUrlSed, dbWhere, deployEnv, deployVars, dockerPsqlArgs, inventoryCheck, migrationPlan,
  migrationsAhead, pickLatestDump, playbookArgs, preflight, psqlCall, readInventory, restoreScript, restoreSource, secretsLine,
  serverDatabase, shq, sshArgs, unreachableMessage,
} from "../scripts/prod.mjs";

const SHA = "e1348e4b25f75dc9ac89485b35c20340c8c7d1b9";
const good = { hasAnsible: true, hasMasterKey: true, inventory: { target: { name: "prudence-prod" } }, sha: SHA, dirty: "", onOriginMain: true };

test("the inventory's first host under [scam_shield] is the target; comments, other groups and :vars are skipped", () => {
  const text = "# a comment\n[other]\nx ansible_host=192.0.2.1\n[scam_shield]\n; another\nprudence-prod ansible_host=203.0.113.10 ansible_user=ubuntu ansible_port=2222\nsecond ansible_host=203.0.113.11\n[scam_shield:vars]\nssh_public=true\n";
  assert.deepEqual(readInventory(text), { name: "prudence-prod", host: "203.0.113.10", user: "ubuntu", port: "2222" });
  assert.deepEqual(readInventory("[scam_shield]\nprudence-prod\n"), { name: "prudence-prod", host: "prudence-prod", user: "", port: "" });
  assert.equal(readInventory("[scam_shield:vars]\nssh_public=true\n"), null);
  assert.match(inventoryCheck("inventory.ini", null).error, /^No inventory\.ini: cp .*inventory\.example\.ini/);
  assert.equal(inventoryCheck("inventory.ini", "[other]\nx\n").error, "inventory.ini names no host under [scam_shield]");
  assert.equal(inventoryCheck("inventory.ini", "[scam_shield]\nh ansible_host=203.0.113.10\n").target.host, "203.0.113.10");
  assert.deepEqual(sshArgs({ host: "203.0.113.10", user: "ubuntu", port: "2222" }, ["-t"]), ["-t", "-p", "2222", "ubuntu@203.0.113.10"]);
  assert.deepEqual(sshArgs({ host: "prudence-prod", user: "", port: "" }), ["prudence-prod"]);
});

test("preflight stops without ansible, the master key file, an inventory host or a commit, and only warns about uncommitted changes and a HEAD off origin/main", () => {
  assert.deepEqual(preflight(good), { errors: [], warnings: [] });
  const none = preflight({ hasAnsible: false, hasMasterKey: false, inventory: { error: "No inventory.ini: ..." }, sha: "", dirty: "", onOriginMain: true });
  assert.equal(none.errors.length, 4);
  assert.match(none.errors[0], /ansible-playbook not found: brew install ansible/);
  assert.match(none.errors[1], /No config\/master\.key: .*make secrets-init/);
  assert.equal(none.errors[2], "No inventory.ini: ...");
  assert.match(none.errors[3], /Not a git checkout with a commit/);
  assert.match(preflight({ ...good, sha: "HEAD" }).errors[0], /Not a git checkout/);
  const warned = preflight({ ...good, dirty: " M Makefile\n M README.md", onOriginMain: false });
  assert.deepEqual(warned.errors, []);
  assert.equal(warned.warnings.length, 2);
  assert.match(warned.warnings[0], /uncommitted changes; they are NOT deployed \(the archive is HEAD e1348e4b25f7\):\n M Makefile\n M README\.md$/);
  assert.match(warned.warnings[1], /HEAD e1348e4b25f7 is not on origin\/main/);
});

test("the archive is that exact commit, and its sha is the only version the playbook gets (deploy_sha, then GIT_SHA and APP_VERSION)", () => {
  assert.deepEqual(archiveArgs(SHA, "/tmp/x/scam-shield.tar.gz"), ["-c", "tar.umask=0022", "archive", "--format=tar.gz", "-o", "/tmp/x/scam-shield.tar.gz", SHA]);
  assert.ok(!archiveArgs(SHA, "a.tgz").includes("HEAD"), "never HEAD: a commit landing during the deploy must not change what ships");
  assert.deepEqual(deployVars("/tmp/x/a.tar.gz", SHA), { deploy_archive: "/tmp/x/a.tar.gz", deploy_sha: SHA });
  assert.deepEqual(playbookArgs({ inventory: "inv.ini", playbook: "playbook.yml", varsFile: "/tmp/x/vars.json" }), ["-i", "inv.ini", "playbook.yml", "-e", "@/tmp/x/vars.json"]);
  assert.deepEqual(playbookArgs({ inventory: "i", playbook: "p", varsFile: "v", extra: "  --check   --diff " }), ["-i", "i", "p", "-e", "@v", "--check", "--diff"]);
});

test("secrets reach the playbook's environment, never its command line or what make deploy prints", () => {
  const base = { PATH: "/usr/bin", TUNNEL_TOKEN: "eyJ-tunnel-secret" };
  const env = deployEnv(base, { ansibleConfig: "/repo/ansible.cfg", authKey: "tskey-auth-secret", heartbeat: "https://uptime.example/beat-secret" });
  assert.equal(env.ANSIBLE_CONFIG, "/repo/ansible.cfg");
  assert.equal(env.TS_AUTHKEY, "tskey-auth-secret");
  assert.equal(env.HEARTBEAT_BACKUP_URL, "https://uptime.example/beat-secret");
  assert.equal(env.TUNNEL_TOKEN, "eyJ-tunnel-secret");
  assert.deepEqual(base, { PATH: "/usr/bin", TUNNEL_TOKEN: "eyJ-tunnel-secret" }, "the caller's environment is left as it was");
  assert.equal(deployEnv({ TS_AUTHKEY: "from-env" }, { authKey: "from-file" }).TS_AUTHKEY, "from-env", "the environment wins over the file");
  assert.equal(deployEnv({}, {}).TS_AUTHKEY, undefined);
  const line = secretsLine(env);
  assert.equal(line, "Tailscale: an auth key is given (joins the tailnet if not joined yet); tunnel: a TUNNEL_TOKEN is given");
  for (const value of ["tskey-auth-secret", "eyJ-tunnel-secret", "beat-secret"]) assert.ok(!line.includes(value));
  assert.equal(secretsLine({}), "Tailscale: no TS_AUTHKEY (the join is skipped); tunnel: the host keeps what it has");
  const args = playbookArgs({ inventory: "i", playbook: "p", varsFile: "v", extra: "" }).join(" ");
  for (const value of ["tskey-auth-secret", "eyJ-tunnel-secret", "beat-secret"]) assert.ok(!args.includes(value));
});

test("DATABASE_URL moves from the host's .env into the credentials through the pipe only, on the tailnet host (ssh and sudo stubbed)", () => {
  const dir = mkdtempSync(join(tmpdir(), "prod-script-test-"));
  try {
    const bin = join(dir, "bin");
    mkdirSync(bin);
    // ssh <user@host> <remote command>: runs the remote command here. sudo: runs its arguments.
    writeFileSync(join(bin, "ssh"), '#!/bin/sh\nfor last; do :; done\nexec /bin/sh -c "$last"\n');
    writeFileSync(join(bin, "sudo"), '#!/bin/sh\nexec "$@"\n');
    // In place of `node scripts/credentials.mjs set`: record stdin, print nothing.
    writeFileSync(join(bin, "record-set"), `#!/bin/sh\ncat > "${join(dir, "stdin.txt")}"\n`);
    for (const f of ["ssh", "sudo", "record-set"]) chmodSync(join(bin, f), 0o755);
    const app = join(dir, "app");
    mkdirSync(join(app, ".infra/prod"), { recursive: true });
    const run = (envText, host) => {
      writeFileSync(join(app, ".infra/prod/.env"), envText);
      const cmd = dbUrlPipeline({ host: "203.0.113.10", user: "ubuntu", port: "" }, { appDir: app, node: join(bin, "record-set"), ...(host ? { host } : {}) });
      assert.ok(!cmd.includes("Abc123secret"), "the command line never holds the password");
      const r = spawnSync("/bin/sh", ["-c", cmd], { env: { PATH: `${bin}:/usr/bin:/bin` }, encoding: "utf8" });
      assert.equal(r.status, 0, r.stderr);
      assert.equal(r.stdout, "", "nothing reaches the screen but what credentials.mjs set prints (names only)");
      return readFileSync(join(dir, "stdin.txt"), "utf8");
    };
    assert.equal(SHARED_DB_HOST, process.env.PROD_DB_HOST || "100.127.78.127", "the box's Tailscale address unless PROD_DB_HOST says otherwise");
    assert.equal(run("MASTER_KEY=00ff\nPOSTGRES_PASSWORD=Abc123secret\nBASE_URL=https://heyprudence.com\n"),
      `DATABASE_URL=postgres://scam_shield:Abc123secret@${SHARED_DB_HOST}:5432/scam_shield\n`, "the SSH target (the public address here) is not the database's host");
    assert.equal(run("POSTGRES_PASSWORD=Abc123secret\n", "meikit.tail2c017.ts.net"),
      "DATABASE_URL=postgres://scam_shield:Abc123secret@meikit.tail2c017.ts.net:5432/scam_shield\n", "the MagicDNS name, for a tailnet that has it on");
    assert.equal(run("POSTGRES_PASSWORD=has space\n"), "", "a password that is not letters and digits is never turned into a URL");
    assert.equal(run("MASTER_KEY=00ff\n"), "");
    for (const bad of ["a|b", "x;rm", "h ost", "-oProxyCommand=x", ""]) assert.throws(() => dbUrlSed(bad), /PROD_DB_HOST must be a host name or an IPv4 address/, bad);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("messages and psql's arguments name the database's host, never its password", () => {
  const url = "postgres://scam_shield:Abc123secret@100.127.78.127:5432/scam_shield";
  assert.equal(dbWhere(url), "100.127.78.127:5432");
  const timeout = unreachableMessage(url, new Error("Connection terminated due to connection timeout"));
  assert.match(timeout, /^The shared database does not answer at 100\.127\.78\.127:5432 \(timeout\): is Tailscale running on this laptop, and is meikit shared with you \(tailscale status lists it\)\? make server DB=dev runs on this laptop's Postgres meanwhile/);
  const named = unreachableMessage("postgres://scam_shield:Abc123secret@meikit.tail2c017.ts.net:5432/scam_shield", Object.assign(new Error("getaddrinfo ENOTFOUND meikit.tail2c017.ts.net"), { code: "ENOTFOUND" }));
  assert.match(named, /^The shared database does not answer at meikit\.tail2c017\.ts\.net:5432 \(ENOTFOUND\)/);
  const refused = unreachableMessage(url, Object.assign(new Error("password authentication failed"), { code: "28P01" }));
  assert.match(refused, /refused the password in DATABASE_URL: git pull .*make db-prod-url/);
  for (const m of [timeout, named, refused]) assert.ok(!m.includes("Abc123secret"));
  const call = psqlCall(url);
  assert.deepEqual(call.args, ["-h", "100.127.78.127", "-p", "5432", "-U", "scam_shield", "-d", "scam_shield"]);
  assert.deepEqual(call.env, { PGPASSWORD: "Abc123secret" });
  assert.equal(psqlCall(url, "100.64.0.7").args[1], "100.64.0.7");
  assert.deepEqual(dockerPsqlArgs(call.args, true).slice(0, 3), ["run", "--rm", "-it"], "a terminal gets a TTY");
  assert.deepEqual(dockerPsqlArgs(call.args, false).slice(0, 3), ["run", "--rm", "-i"], "a pipe does not (docker refuses -t without one)");
  assert.ok(!dockerPsqlArgs(call.args, false).join(" ").includes("Abc123secret"), "the password reaches docker as PGPASSWORD from the environment, never as an argument");
  assert.equal(shq("it's"), `'it'\\''s'`);
});

test("make server: the shared database when the credentials name one, this laptop's Postgres with DB=dev or without one; DB=prod insists", () => {
  const url = "postgres://scam_shield:pw@100.127.78.127:5432/scam_shield";
  assert.deepEqual(serverDatabase({ db: "", sharedUrl: url }), { mode: "shared", url });
  assert.deepEqual(serverDatabase({ db: "scam_shield", sharedUrl: url }), { mode: "shared", url }, "the Makefile's DB default (a database name for db-shell) is no mode");
  assert.deepEqual(serverDatabase({ db: "prod", sharedUrl: url }), { mode: "shared", url });
  assert.deepEqual(serverDatabase({ db: "dev", sharedUrl: url }), { mode: "dev" });
  assert.deepEqual(serverDatabase({ db: "local", sharedUrl: url }), { mode: "dev" }, "DB=local, the old name of the local mode, still means it");
  const judge = serverDatabase({ db: "", sharedUrl: "", why: "no master key on this machine" });
  assert.equal(judge.mode, "dev", "a clone without the master key (a judge) still gets a working make server");
  assert.match(judge.note, /^No shared database here \(no master key on this machine\): make server runs on this laptop's Postgres/);
  assert.match(serverDatabase({ db: "", sharedUrl: "" }).note, /config\/credentials\.enc has no DATABASE_URL/);
  assert.match(serverDatabase({ db: "prod", sharedUrl: "" }).error, /^No shared database: .*git pull, or make db-prod-url/);
});

test("make server migrates the shared database once before the app starts, and refuses a migration file git does not hold as committed", () => {
  const files = ["001_init.sql", "002_actions.sql", "003_new.sql", "README.md"];
  assert.deepEqual(migrationsAhead(files, ["001_init.sql", "002_actions.sql"]), ["003_new.sql"]);
  assert.deepEqual(migrationsAhead(files, ["001_init.sql", "002_actions.sql", "003_new.sql", "004_newer.sql"]), [], "a database ahead of the checkout is fine");
  assert.deepEqual(migrationPlan(files, ["001_init.sql"], ""), { pending: ["002_actions.sql", "003_new.sql"], uncommitted: [] }, "committed and pushed, not deployed yet: applied (additive only)");
  assert.deepEqual(migrationPlan(files, ["001_init.sql", "002_actions.sql"], "?? src/db/migrations/003_new.sql\n"), { pending: ["003_new.sql"], uncommitted: ["003_new.sql"] });
  assert.deepEqual(migrationPlan(files, ["001_init.sql", "002_actions.sql"], " M src/db/migrations/003_new.sql\n").uncommitted, ["003_new.sql"]);
  assert.deepEqual(migrationPlan(files, ["001_init.sql", "002_actions.sql"], "R  src/db/migrations/003_old.sql -> src/db/migrations/003_new.sql\n").uncommitted, ["003_new.sql"]);
  assert.deepEqual(migrationPlan(files, files, " M src/db/migrations/001_init.sql\n").uncommitted, [], "an applied file being edited is not make server's business");
});

test("backups: the latest daily dump is picked by its date, and a restore names a .dump, takes a safety dump first and restores in one transaction", () => {
  assert.equal(pickLatestDump("2026-10-30.dump\n2026-11-01.dump\npre-restore-2026-11-02-101500.dump\n2026-11-02.dump.partial\n2026-10-31.dump\n"), "2026-11-01.dump");
  assert.equal(pickLatestDump(""), undefined);
  assert.match(restoreSource(".env", false).error, /^Name a dump/, "the Makefile's FILE defaults to .env");
  assert.match(restoreSource(undefined, false).error, /^Name a dump/);
  assert.deepEqual(restoreSource(".runtime/backups/2026-10-31.dump", true), { upload: true, onHost: "/var/backups/prudence/restore-2026-10-31.dump" });
  assert.deepEqual(restoreSource("2026-10-31.dump", false), { upload: false, onHost: "/var/backups/prudence/2026-10-31.dump" });
  assert.match(restoreSource("elsewhere/2026-10-31.dump", false).error, /does not exist here/);
  const lines = restoreScript("/var/backups/prudence/2026-10-31.dump").split("\n");
  const at = (re) => lines.findIndex((l) => re.test(l));
  assert.equal(lines[0], "set -euo pipefail");
  assert.ok(at(/pg_dump .* \| sudo tee "\$safety"/) < at(/ stop app$/), "the current data is saved before the app stops");
  assert.ok(at(/ stop app$/) < at(/pg_restore .*--clean --if-exists --no-owner --single-transaction/));
  assert.ok(at(/pg_restore/) < at(/ start app$/) && at(/ start app$/) < at(/api\/health/));
});
