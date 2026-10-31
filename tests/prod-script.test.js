// scripts/prod.mjs, the laptop side of the OVH host (_product/docs/ops.md): the decisions and the commands
// it builds, which are pure functions. No network and no SSH: the one pipeline test runs the exact command
// string with `ssh` and `sudo` replaced by local stubs and `credentials.mjs set` by a file that records its
// stdin, against a throwaway .env.
// Not testable without the host, so not faked here: the playbook run itself (make deploy after the
// preflight; checked on the host, _product/specs/public-deployment.md Acceptance), the SSH sessions (make
// logs, prod-status, prod-shell, backup-now), the rsync copies (backup-pull, the restore upload), the
// restore run, and the database calls of make server DB=prod and make db-prod-shell.
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  archiveArgs, deployEnv, deployVars, inventoryCheck, migrationsAhead, pickLatestDump, playbookArgs, preflight,
  prodUrlPipeline, psqlCall, readInventory, restoreScript, restoreSource, secretsLine, shq, sshArgs, unreachableMessage,
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

test("PROD_DATABASE_URL moves from the host's .env into the credentials through the pipe only (ssh and sudo stubbed)", () => {
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
    const run = (envText) => {
      writeFileSync(join(app, ".infra/prod/.env"), envText);
      const cmd = prodUrlPipeline({ host: "203.0.113.10", user: "ubuntu", port: "" }, { appDir: app, node: join(bin, "record-set") });
      assert.ok(!cmd.includes("Abc123secret"), "the command line never holds the password");
      const r = spawnSync("/bin/sh", ["-c", cmd], { env: { PATH: `${bin}:/usr/bin:/bin` }, encoding: "utf8" });
      assert.equal(r.status, 0, r.stderr);
      assert.equal(r.stdout, "", "nothing reaches the screen but what credentials.mjs set prints (names only)");
      return readFileSync(join(dir, "stdin.txt"), "utf8");
    };
    assert.equal(run("MASTER_KEY=00ff\nPOSTGRES_PASSWORD=Abc123secret\nBASE_URL=https://heyprudence.com\n"),
      "PROD_DATABASE_URL=postgres://scam_shield:Abc123secret@prudence-prod:5432/scam_shield\n");
    assert.equal(run("POSTGRES_PASSWORD=has space\n"), "", "a password that is not letters and digits is never turned into a URL");
    assert.equal(run("MASTER_KEY=00ff\n"), "");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("messages and psql's arguments name the database's host, never its password", () => {
  const url = "postgres://scam_shield:Abc123secret@prudence-prod:5432/scam_shield";
  const msg = unreachableMessage(url, Object.assign(new Error("getaddrinfo ENOTFOUND prudence-prod"), { code: "ENOTFOUND" }));
  assert.match(msg, /^The shared database does not answer at prudence-prod:5432 \(ENOTFOUND\)/);
  assert.ok(!msg.includes("Abc123secret"));
  const call = psqlCall(url);
  assert.deepEqual(call.args, ["-h", "prudence-prod", "-p", "5432", "-U", "scam_shield", "-d", "scam_shield"]);
  assert.deepEqual(call.env, { PGPASSWORD: "Abc123secret" });
  assert.equal(psqlCall(url, "100.64.0.7").args[1], "100.64.0.7");
  assert.equal(shq("it's"), `'it'\\''s'`);
});

test("make server DB=prod refuses a checkout whose migrations production has not applied", () => {
  const files = ["001_init.sql", "002_actions.sql", "003_new.sql", "README.md"];
  assert.deepEqual(migrationsAhead(files, ["001_init.sql", "002_actions.sql"]), ["003_new.sql"]);
  assert.deepEqual(migrationsAhead(files, ["001_init.sql", "002_actions.sql", "003_new.sql", "004_newer.sql"]), [], "a database ahead of the checkout is fine");
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
