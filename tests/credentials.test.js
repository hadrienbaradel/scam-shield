// Encrypted credentials (lib/credentialStore.js, lib/credentials.js,
// scripts/credentials.mjs): round trip, one-line errors, loader precedence,
// and a CLI that never prints a value except `show`.
import { test } from "node:test";
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { chmodSync, existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  CredentialsError, REQUIRED_KEYS, credentialsStatus, decrypt, encrypt, formatValue, generateKey, loadCredentials,
  parseDotenv, setLines, unsetLines, writeKeyFile, writeStore,
} from "../lib/credentialStore.js";

const cli = new URL("../scripts/credentials.mjs", import.meta.url).pathname;
const loader = new URL("../lib/credentials.js", import.meta.url).pathname;

// A private config/ in a temp dir; the real one and a MASTER_KEY in the shell never play.
function sandbox() {
  const dir = mkdtempSync(join(tmpdir(), "scam-shield-cred-test-"));
  const env = { ...process.env, CREDENTIALS_FILE: join(dir, "credentials.enc"), MASTER_KEY_FILE: join(dir, "master.key") };
  delete env.MASTER_KEY;
  delete env.VISUAL;
  delete env.EDITOR;
  return { dir, env, file: env.CREDENTIALS_FILE, keyFile: env.MASTER_KEY_FILE, opts: { file: env.CREDENTIALS_FILE, keyFile: env.MASTER_KEY_FILE } };
}
const run = (args, env, stdin = "") => new Promise((resolve) => {
  const child = execFile(process.execPath, [cli, ...args], { env, timeout: 20000 },
    (err, stdout, stderr) => resolve({ code: err ? err.code : 0, stdout, stderr, output: `${stdout}${stderr}` }));
  child.stdin.end(stdin);
});
const hexKey = () => Buffer.from(generateKey(), "hex");

test("encrypt/decrypt round trip: one line, fresh IV per write, authenticated", () => {
  const key = hexKey();
  const a = encrypt("A=1\nB=two words\n", key);
  const b = encrypt("A=1\nB=two words\n", key);
  assert.notEqual(a, b, "a fresh IV every time");
  assert.match(a, /^v1\.[A-Za-z0-9+/=]+\.[A-Za-z0-9+/=]+\.[A-Za-z0-9+/=]+$/);
  assert.equal(decrypt(a, key), "A=1\nB=two words\n");
  assert.equal(decrypt(encrypt("", key), key), "", "an empty store round-trips");
});

test("wrong key, tampering and garbage each give one clear line", () => {
  const key = hexKey();
  const sealed = encrypt("SECRET=round-trip-value\n", key);
  assert.throws(() => decrypt(sealed, hexKey()), (e) => e instanceof CredentialsError && e.message === "wrong key or altered file");
  const parts = sealed.split(".");
  parts[3] = `${parts[3].slice(0, -4)}${parts[3].slice(-4) === "AAAA" ? "BBBB" : "AAAA"}`;
  assert.throws(() => decrypt(parts.join("."), key), /wrong key or altered file/);
  assert.throws(() => decrypt("hello", key), /not a credentials file/);
  for (const e of [() => decrypt(sealed, hexKey()), () => decrypt("hello", key)]) {
    try { e(); } catch (err) { assert.ok(!err.message.includes("\n")); assert.ok(!err.message.includes("round-trip-value")); }
  }
});

test("dotenv lines: quotes, escapes, comments; set replaces in place and keeps comments", () => {
  const m = parseDotenv(`# c\nA=1\nexport B="x y\\n\\"z\\""\nC='lit"eral'\nD=\nnot a line\n`);
  assert.deepEqual([...m.keys()], ["A", "B", "C", "D"]);
  assert.equal(m.get("B"), 'x y\n"z"');
  assert.equal(m.get("C"), 'lit"eral');
  assert.equal(m.get("D"), "");
  assert.equal(formatValue("plain-token_1"), "plain-token_1");
  assert.equal(parseDotenv(`K=${formatValue('a b "q" # not a comment\\ \n')}`).get("K"), 'a b "q" # not a comment\\ \n');
  let text = "# keep me\n# META_MODEL_NAME=old\nA=1\n";
  text = setLines(text, [["A", "2"], ["META_MODEL_NAME", "muse"], ["NEW", "v"]]);
  assert.equal(text, "# keep me\nMETA_MODEL_NAME=muse\nA=2\nNEW=v\n");
  const r = unsetLines(text, ["A", "NOPE"]);
  assert.equal(r.text, "# keep me\nMETA_MODEL_NAME=muse\nNEW=v\n");
  assert.deepEqual(r.removed, ["A"]);
  assert.throws(() => setLines("", [["bad name", "x"]]), /not a valid key name/);
});

test("loader: the environment wins, empty values are filled, no file is a no-op", (t) => {
  const sb = sandbox();
  t.after(() => rmSync(sb.dir, { recursive: true, force: true }));
  const fakeEnv = { API: "from-shell", EMPTY_IN_ENV: "" };
  const opts = { ...sb.opts, env: fakeEnv };
  const before = credentialsStatus(opts);
  assert.deepEqual([before.exists, before.ok, before.error], [false, false, null]);
  assert.deepEqual(loadCredentials(opts).loaded, [], "no file: nothing happens");
  assert.deepEqual(fakeEnv, { API: "from-shell", EMPTY_IN_ENV: "" });

  const hex = generateKey();
  writeKeyFile(sb.keyFile, hex);
  assert.equal(statSync(sb.keyFile).mode & 0o777, 0o600);
  writeStore("API=from-file\nEMPTY_IN_ENV=filled\nEMPTY_IN_FILE=\nOTHER=x\n", opts);
  const r = loadCredentials(opts);
  assert.deepEqual(r.loaded, ["EMPTY_IN_ENV", "OTHER"]);
  assert.deepEqual(r.shadowed, ["API"]);
  assert.deepEqual(fakeEnv, { API: "from-shell", EMPTY_IN_ENV: "filled", OTHER: "x" });
  const st = credentialsStatus(opts);
  assert.deepEqual([st.ok, st.keys, st.empty], [true, ["API", "EMPTY_IN_ENV", "EMPTY_IN_FILE", "OTHER"], ["EMPTY_IN_FILE"]]);
  assert.ok(!JSON.stringify(st).includes("from-file"), "status carries names, never values");

  // No key: one line with the fix. MASTER_KEY in the environment replaces the file.
  rmSync(sb.keyFile);
  const noKey = credentialsStatus(opts);
  assert.match(noKey.error, /^No master key for .*credentials\.enc: get .*master\.key from a teammate \(make secrets-init pastes it\) or set MASTER_KEY; for a brand-new project delete .*credentials\.enc and run make secrets-init$/);
  assert.throws(() => loadCredentials(opts), (e) => e instanceof CredentialsError && e.message === noKey.error);
  const withEnvKey = { MASTER_KEY: hex };
  assert.deepEqual(loadCredentials({ ...sb.opts, env: withEnvKey }).loaded, ["API", "EMPTY_IN_ENV", "OTHER"]);
  assert.equal(withEnvKey.API, "from-file");
  // Wrong key: one line naming both files.
  writeKeyFile(sb.keyFile, generateKey());
  assert.match(credentialsStatus(opts).error, /^Cannot decrypt .*credentials\.enc with .*master\.key: wrong key \(rotated\? ask a teammate for the current one\) or the file was altered$/);
  writeFileSync(sb.keyFile, "not-hex\n");
  assert.match(credentialsStatus(opts).error, /master\.key is not a master key \(64 hex characters\)/);
});

test("the autoload fills process.env in an entry point, stops it with one line on a bad key, warns on a missing one, and stays out of tests", async (t) => {
  const sb = sandbox();
  t.after(() => rmSync(sb.dir, { recursive: true, force: true }));
  writeKeyFile(sb.keyFile, generateKey());
  writeStore("PROBE_KEY=probe-value\n", sb.opts);
  const probe = `import ${JSON.stringify(loader)}; console.log(process.env.PROBE_KEY === "probe-value" ? "loaded" : "not loaded")`;
  const spawn = (env) => new Promise((resolve) => execFile(process.execPath, ["--input-type=module", "-e", probe], { env, timeout: 20000 },
    (err, stdout, stderr) => resolve({ code: err ? err.code : 0, stdout, stderr })));
  const entry = { ...sb.env };
  delete entry.NODE_TEST_CONTEXT;
  delete entry.PROBE_KEY;
  assert.deepEqual(await spawn(entry), { code: 0, stdout: "loaded\n", stderr: "" });
  assert.deepEqual(await spawn(sb.env), { code: 0, stdout: "not loaded\n", stderr: "" }, "inside node --test nothing is loaded");
  writeKeyFile(sb.keyFile, generateKey());
  const bad = await spawn(entry);
  assert.equal(bad.code, 1);
  assert.equal(bad.stdout, "");
  assert.equal(bad.stderr.trim().split("\n").length, 1, `one line, no stack trace: ${bad.stderr}`);
  assert.match(bad.stderr, /^Cannot decrypt .*credentials\.enc with .*master\.key: wrong key/);
  rmSync(sb.keyFile);
  // No key yet (a new teammate): one warning line, the process carries on with its own environment.
  const none = await spawn(entry);
  assert.equal(none.code, 0);
  assert.equal(none.stdout, "not loaded\n");
  assert.match(none.stderr, /^warning: No master key for .*credentials\.enc: .*make secrets-init\. Running on your environment and \.env only\.\n$/);
  // In production the key is required.
  const prod = await spawn({ ...entry, NODE_ENV: "production" });
  assert.equal(prod.code, 1);
  assert.match(prod.stderr, /^No master key for .*credentials\.enc: .*make secrets-init\n$/);
});

test("CLI: init, set, keys, import, check, unset, rotate; only show prints a value", async (t) => {
  const sb = sandbox();
  t.after(() => rmSync(sb.dir, { recursive: true, force: true }));
  const secrets = ["sk-SET-VALUE-1", "GOCSPX-SET-VALUE-2", "stdin-value-3", "imported-value-4", "edited-value-5"];
  const quiet = []; // every output except show's
  const cmd = async (args, stdin) => { const r = await run(args, sb.env, stdin); if (args[0] !== "show") quiet.push(r.output); return r; };

  let r = await cmd(["init"]);
  assert.equal(r.code, 0, r.output);
  assert.match(r.stdout, /created .*master\.key: 32 random bytes, mode 600, never committed/);
  assert.match(r.stdout, /created .*credentials\.enc \(empty, encrypted; commit it\)/);
  assert.match(r.stdout, new RegExp(`Required keys: ${REQUIRED_KEYS.join(", ")}`));
  const hex = readFileSync(sb.keyFile, "utf8").trim();
  assert.match(hex, /^[0-9a-f]{64}$/);
  assert.equal(statSync(sb.keyFile).mode & 0o777, 0o600);
  assert.ok(!r.output.includes(hex), "init never prints the key");
  assert.equal(readFileSync(sb.file, "utf8").split("\n").filter(Boolean).length, 1, "the encrypted file is one line");
  r = await cmd(["init"]);
  assert.match(r.stdout, /master key: .*master\.key\n.*credentials\.enc decrypts: 0 keys/);

  r = await cmd(["keys"]);
  assert.match(r.stdout, /^no keys yet in .*credentials\.enc: make secrets-set KEY=value/);
  r = await cmd(["set", `META_MODEL_API_KEY=${secrets[0]}`, `GOOGLE_CLIENT_SECRET=${secrets[1]}`, "EMPTY_ONE="]);
  assert.equal(r.code, 0, r.output);
  assert.equal(r.stdout, "set META_MODEL_API_KEY\nset GOOGLE_CLIENT_SECRET\nset EMPTY_ONE (empty)\n");
  r = await cmd(["set"], `# pasted\nexport FROM_STDIN=${secrets[2]}\n\n`);
  assert.equal(r.stdout, "set FROM_STDIN\n");
  r = await cmd(["set", "sk-looks-like-a-pasted-secret"]);
  assert.equal(r.code, 1);
  assert.equal(r.output, "argument 1 is not KEY=value (a key name is letters, digits and _)\n", "a bad argument is never echoed");
  r = await cmd(["keys"]);
  assert.equal(r.code, 0);
  assert.equal(r.stdout, "EMPTY_ONE             empty\nFROM_STDIN            set\nGOOGLE_CLIENT_SECRET  set  (required)\nMETA_MODEL_API_KEY    set  (required)\n");

  r = await cmd(["check"]);
  assert.equal(r.code, 1);
  assert.equal(r.stderr, `required keys missing in ${sb.file}: TOKEN_ENC_KEY, GOOGLE_CLIENT_ID. Set them with make secrets-set KEY=value (Google: node scripts/import-google-client.mjs <downloaded json>)\n`);

  const dotenv = join(sb.dir, "old.env");
  writeFileSync(dotenv, `# old .env\nTOKEN_ENC_KEY=${Buffer.alloc(32, 9).toString("base64")}\nGOOGLE_CLIENT_ID=${secrets[3]}\nADMIN_EMAILS=\n`);
  r = await cmd(["import", dotenv]);
  assert.equal(r.code, 0, r.output);
  assert.equal(r.stdout, `imported 2 keys from ${dotenv}: TOKEN_ENC_KEY, GOOGLE_CLIENT_ID\nskipped (empty): ADMIN_EMAILS\nDelete ${dotenv} now, it still holds the same secrets in plain text: rm ${dotenv}\n`);
  r = await cmd(["check"]);
  assert.equal(r.code, 0, r.output);
  assert.equal(r.stdout, `all 4 required keys set (${REQUIRED_KEYS.join(", ")})\n`);
  r = await cmd(["import", join(sb.dir, "missing.env")]);
  assert.equal(r.code, 1);
  assert.match(r.stderr, /missing\.env not found/);

  // edit: a fake editor appends a line; the temp file is gone afterwards.
  const editor = join(sb.dir, "fake-editor.sh");
  writeFileSync(editor, `#!/bin/sh\nprintf 'EDITED=${secrets[4]}\\n' >> "$1"\n`);
  chmodSync(editor, 0o755);
  const tmpDirs = () => readdirSync(sb.dir).filter((d) => d.startsWith("scam-shield-credentials-")).length;
  const dirsBefore = tmpDirs();
  r = await run(["edit"], { ...sb.env, EDITOR: editor, TMPDIR: sb.dir });
  quiet.push(r.output);
  assert.equal(r.code, 0, r.output);
  assert.match(r.stdout, /^saved .*credentials\.enc: 7 keys\n$/);
  assert.equal(tmpDirs(), dirsBefore, "the temp copy is deleted");
  r = await run(["edit"], { ...sb.env, EDITOR: "false", TMPDIR: sb.dir });
  quiet.push(r.output);
  assert.equal(r.code, 1);
  assert.match(r.stderr, /false exited with 1: nothing saved/);
  assert.equal(tmpDirs(), dirsBefore, "deleted even when the editor fails");

  // show is the only command that prints values: a warning first, on stderr.
  r = await cmd(["show", "EDITED"]);
  assert.equal(r.stdout, `${secrets[4]}\n`);
  assert.match(r.stderr, /^WARNING: secret values follow/);
  r = await cmd(["show"]);
  assert.ok(r.stdout.includes(`META_MODEL_API_KEY=${secrets[0]}`) && r.stdout.includes(`FROM_STDIN=${secrets[2]}`));
  r = await cmd(["show", "NOPE"]);
  assert.equal(r.code, 1);
  assert.match(r.stderr, /NOPE is not set/);

  r = await cmd(["unset", "EDITED", "NOPE"]);
  assert.equal(r.stdout, "unset EDITED\nNOPE was not set\n");
  assert.ok(!(await cmd(["keys"])).stdout.includes("EDITED"));

  const sealedBefore = readFileSync(sb.file, "utf8");
  r = await cmd(["rotate"]);
  assert.equal(r.code, 0, r.output);
  assert.match(r.stdout, /^rotated: .*credentials\.enc re-encrypted, new key in .*master\.key\. Give it to every teammate out of band/);
  const hexAfter = readFileSync(sb.keyFile, "utf8").trim();
  assert.notEqual(hexAfter, hex);
  assert.ok(!r.output.includes(hexAfter) && !r.output.includes(hex));
  assert.throws(() => decrypt(sealedBefore, Buffer.from(hexAfter, "hex")), /wrong key/);
  assert.equal(parseDotenv(decrypt(readFileSync(sb.file, "utf8"), Buffer.from(hexAfter, "hex"))).get("FROM_STDIN"), secrets[2]);

  // A fresh clone (file, no key), not at a terminal: the one line with the fix, exit 1.
  rmSync(sb.keyFile);
  for (const args of [["init"], ["keys"], ["set", "A=b"], ["check"]]) {
    r = await cmd(args);
    assert.equal(r.code, 1, args.join(" "));
    assert.equal(r.stdout, "");
    assert.match(r.stderr, /^No master key for .*credentials\.enc: get .*master\.key from a teammate \(make secrets-init pastes it\) or set MASTER_KEY; .*make secrets-init\n$/);
  }
  r = await cmd(["keys"]);
  assert.equal(r.stderr.split("\n").filter(Boolean).length, 1, "no stack trace");
  assert.equal((await run(["keys"], { ...sb.env, MASTER_KEY: hexAfter })).code, 0, "MASTER_KEY replaces the file");

  r = await cmd(["bogus"]);
  assert.equal(r.code, 2);
  assert.match(r.output, /unknown command: bogus/);
  assert.match((await cmd(["help"])).stdout, /credentials\.mjs set KEY=value/);

  for (const value of [...secrets, hex, hexAfter]) for (const text of quiet) assert.ok(!text.includes(value), `a value leaked: ${value.slice(0, 8)}…`);
  assert.ok(!existsSync(join(sb.dir, "credentials.enc.tmp")));
});
