// Encrypted credentials CLI (Rails style): config/credentials.enc is committed,
// config/master.key is not. Nothing here prints a value except `show`, which
// a human asks for. `make secrets-*` wraps the common commands.
//
//   node scripts/credentials.mjs init                 master.key if missing, credentials.enc if missing (or paste the team's key)
//   node scripts/credentials.mjs set KEY=value ...    or `set` alone and paste KEY=value lines, Ctrl-D
//   node scripts/credentials.mjs unset KEY ...
//   node scripts/credentials.mjs keys                 names only, set/empty
//   node scripts/credentials.mjs edit                 $VISUAL or $EDITOR or vi on a private temp file
//   node scripts/credentials.mjs show [KEY]           values, for your eyes only
//   node scripts/credentials.mjs import <file>        merge a dotenv file (.env), then delete it
//   node scripts/credentials.mjs check                required keys present? exit 1 if not
//   node scripts/credentials.mjs rotate               new master key, file re-encrypted
//
// CREDENTIALS_FILE and MASTER_KEY_FILE change the paths; MASTER_KEY replaces the key file.

import { chmodSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  CredentialsError, KEY_NAME, REQUIRED_KEYS, badLines, credentialsStatus, decrypt, findKey, formatValue, generateKey,
  noKeyLine, open, openOrThrow, parseDotenv, parseKey, paths, rel, setLines, unsetLines, writeKeyFile, writeStore,
} from "../lib/credentialStore.js";

const out = (s) => console.log(s);
const err = (s) => console.error(s);
const { file, keyFile } = paths();
const REQUIRED_HINT = `make secrets-set KEY=value (Google: node scripts/import-google-client.mjs <downloaded json>)`;

// A line typed at the terminal without echo (a pasted key must not stay on screen).
function readHidden(prompt) {
  return new Promise((resolve) => {
    process.stderr.write(prompt);
    const stdin = process.stdin;
    let typed = "";
    const done = (value) => {
      stdin.setRawMode(false); stdin.pause(); stdin.off("data", onData);
      process.stderr.write("\n");
      resolve(value);
    };
    const onData = (chunk) => {
      for (const c of String(chunk)) {
        if (c === "\u0003") { done(null); process.exit(130); }
        if (c === "\r" || c === "\n") return done(typed);
        if (c === "\u007f" || c === "\b") typed = typed.slice(0, -1);
        else typed += c;
      }
    };
    stdin.setRawMode(true); stdin.resume(); stdin.setEncoding("utf8");
    stdin.on("data", onData);
  });
}

const readStdin = () => new Promise((resolve) => {
  let text = "";
  process.stdin.setEncoding("utf8");
  process.stdin.on("data", (c) => { text += c; });
  process.stdin.on("end", () => resolve(text));
});

// "KEY=value" → [key, value]; the argument is never echoed (it may be a pasted secret).
function pair(arg, n) {
  const i = String(arg).indexOf("=");
  const key = i > 0 ? arg.slice(0, i) : "";
  if (!KEY_NAME.test(key)) throw new CredentialsError(`argument ${n} is not KEY=value (a key name is letters, digits and _)`);
  return [key, arg.slice(i + 1)];
}

async function init() {
  const exists = existsSync(file);
  let found = findKey();
  if (!found && exists) {
    if (!process.stdin.isTTY) throw new CredentialsError(noKeyLine({ file, keyFile }));
    err(`${rel(file)} exists but there is no master key on this machine.`);
    const typed = await readHidden("Paste the master key a teammate sent you (not shown), then Enter: ");
    if (!typed) throw new CredentialsError(noKeyLine({ file, keyFile }));
    const key = parseKey(typed, "The pasted text");
    try { decrypt(readFileSync(file, "utf8"), key); } catch { throw new CredentialsError(`That key does not open ${rel(file)}: ask the teammate for the current one (was it rotated?)`); }
    writeKeyFile(keyFile, typed.trim());
    out(`saved ${rel(keyFile)} (mode 600, ignored by git)`);
    found = findKey();
  } else if (!found) {
    writeKeyFile(keyFile, generateKey());
    out(`created ${rel(keyFile)}: 32 random bytes, mode 600, never committed. Teammates get it from you out of band (not git, not email).`);
    found = findKey();
  } else {
    out(`master key: ${found.from}`);
  }
  if (!exists) {
    writeStore("", {}, found.key);
    out(`created ${rel(file)} (empty, encrypted; commit it)`);
  } else {
    const st = credentialsStatus();
    if (st.error) throw new CredentialsError(st.error);
    out(`${rel(file)} decrypts: ${st.keys.length} key${st.keys.length === 1 ? "" : "s"}`);
  }
  out(`Required keys: ${REQUIRED_KEYS.join(", ")}. Set them with ${REQUIRED_HINT}; make secrets-keys lists what is set.`);
}

async function set(args) {
  let pairs;
  if (args.length) pairs = args.map((a, i) => pair(a, i + 1));
  else {
    if (process.stdin.isTTY) err("Paste KEY=value lines (one per line), then Ctrl-D. Ctrl-C cancels.");
    pairs = [...parseDotenv(await readStdin())];
  }
  if (!pairs.length) throw new CredentialsError("nothing to set: usage set KEY=value [KEY=value...], or paste KEY=value lines on stdin");
  const { text } = openOrThrow();
  writeStore(setLines(text, pairs));
  for (const [k, v] of pairs) out(`set ${k}${v ? "" : " (empty)"}`);
}

function unset(args) {
  if (!args.length) throw new CredentialsError("usage: unset KEY [KEY...]");
  for (const k of args) if (!KEY_NAME.test(k)) throw new CredentialsError(`not a key name: ${k}`);
  const { text } = openOrThrow();
  const r = unsetLines(text, args);
  if (r.removed.length) writeStore(r.text);
  for (const k of args) out(r.removed.includes(k) ? `unset ${k}` : `${k} was not set`);
}

function keys() {
  const { status } = openOrThrow();
  if (!status.keys.length) return out(`no keys yet in ${rel(status.file)}: ${REQUIRED_HINT}`);
  const w = Math.max(...status.keys.map((k) => k.length));
  for (const k of status.keys) out(`${k.padEnd(w)}  ${status.empty.includes(k) ? "empty" : "set"}${REQUIRED_KEYS.includes(k) ? "  (required)" : ""}`);
}

function edit() {
  const { text, status } = openOrThrow();
  const dir = mkdtempSync(join(tmpdir(), "scam-shield-credentials-"));
  chmodSync(dir, 0o700);
  const tmp = join(dir, "credentials.env");
  try {
    writeFileSync(tmp, text || `# KEY=value per line; # comments are kept. Required: ${REQUIRED_KEYS.join(", ")}\n`, { mode: 0o600 });
    const editor = process.env.VISUAL || process.env.EDITOR || "vi";
    const r = spawnSync("/bin/sh", ["-c", `${editor} "$1"`, "sh", tmp], { stdio: "inherit" });
    if (r.status !== 0) { err(`${editor} exited with ${r.status ?? r.signal}: nothing saved`); return 1; }
    const edited = readFileSync(tmp, "utf8");
    if (edited === text) return out("no change");
    const bad = badLines(edited);
    if (bad.length) { err(`line ${bad[0]} is not KEY=value or a # comment: nothing saved, run edit again`); return 1; }
    writeStore(edited);
    out(`saved ${rel(status.file)}: ${parseDotenv(edited).size} keys`);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

function show(args) {
  err("WARNING: secret values follow. For your eyes at a terminal only; never into chat, logs, tickets, a commit or an agent.");
  const { map } = openOrThrow();
  if (args[0]) {
    if (!map.has(args[0])) { err(`${args[0]} is not set`); return 1; }
    return out(map.get(args[0]));
  }
  for (const [k, v] of map) out(`${k}=${formatValue(v)}`);
}

function importFile(args) {
  const src = args[0];
  if (!src) throw new CredentialsError("usage: import <dotenv file>   (make secrets-import FILE=.env)");
  if (!existsSync(src)) throw new CredentialsError(`${src} not found`);
  const entries = [...parseDotenv(readFileSync(src, "utf8"))];
  const pairs = entries.filter(([, v]) => v);
  const skipped = entries.filter(([, v]) => !v).map(([k]) => k);
  const { text } = openOrThrow();
  if (pairs.length) writeStore(setLines(text, pairs));
  out(`imported ${pairs.length} key${pairs.length === 1 ? "" : "s"} from ${src}${pairs.length ? `: ${pairs.map(([k]) => k).join(", ")}` : ""}`);
  if (skipped.length) out(`skipped (empty): ${skipped.join(", ")}`);
  out(`Delete ${src} now, it still holds the same secrets in plain text: rm ${src}`);
}

function check() {
  const { map, status } = openOrThrow();
  const missing = REQUIRED_KEYS.filter((k) => !map.get(k));
  if (missing.length) { err(`required keys missing in ${rel(status.file)}: ${missing.join(", ")}. Set them with ${REQUIRED_HINT}`); return 1; }
  out(`all ${REQUIRED_KEYS.length} required keys set (${REQUIRED_KEYS.join(", ")})`);
}

function rotate() {
  const { text, status } = openOrThrow();
  const fresh = generateKey();
  writeStore(text, {}, Buffer.from(fresh, "hex"));
  writeKeyFile(keyFile, fresh);
  out(`rotated: ${rel(status.file)} re-encrypted, new key in ${rel(keyFile)}. Give it to every teammate out of band and update MASTER_KEY wherever it is set (CI, hosts).`);
  if (status.keyFrom === "MASTER_KEY") err("MASTER_KEY in this shell is now stale.");
  out("Leaked? Rotating this key is not enough: also rotate every provider key it protected (Meta, Google client secret, Resend, HIBP, abuse.ch).");
}

function help() {
  out(readFileSync(new URL(import.meta.url), "utf8").split("\n").filter((l) => /^\/\/ {3}/.test(l)).map((l) => l.slice(3)).join("\n"));
}

const commands = { init, set, unset, keys, edit, show, import: importFile, check, rotate, help };
const [cmd, ...rest] = process.argv.slice(2);
try {
  if (!cmd || cmd === "help" || cmd === "--help" || cmd === "-h") help();
  else if (!commands[cmd]) { err(`unknown command: ${cmd}`); help(); process.exitCode = 2; }
  else process.exitCode = (await commands[cmd](rest)) || 0;
} catch (e) {
  if (!(e instanceof CredentialsError)) throw e;
  err(e.message);
  process.exitCode = 1;
}
