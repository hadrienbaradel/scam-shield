// Encrypted credentials, Rails style. config/credentials.enc is committed and
// holds KEY=value lines encrypted with AES-256-GCM; config/master.key (32
// random bytes as 64 hex characters, mode 600) is never committed and travels
// between teammates out of band. MASTER_KEY in the environment replaces the
// file (CI, hosts). Nothing here prints a value; the CLI's `show` is the only
// place that does, for a human at a terminal.
//
// This module has no side effects. lib/credentials.js is the one entry points
// import first: it calls loadCredentials() and stops the process with one line
// when the file cannot be read. scripts/credentials.mjs is the CLI.

import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import { chmodSync, existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../", import.meta.url));
export const DEFAULT_FILE = join(root, "config", "credentials.enc");
export const DEFAULT_KEY_FILE = join(root, "config", "master.key");

// Without these the product runs in demo mode (no Gmail sign-in, detector
// only). Everything else is optional and listed in config/credentials.example.
export const REQUIRED_KEYS = ["TOKEN_ENC_KEY", "GOOGLE_CLIENT_ID", "GOOGLE_CLIENT_SECRET", "META_MODEL_API_KEY"];
export const OPTIONAL_KEYS = ["ADMIN_EMAILS", "DATABASE_URL", "TEST_DATABASE_URL", "GMAIL_PUBSUB_TOPIC", "GMAIL_PUBSUB_SUBSCRIPTION",
  "ABUSECH_AUTH_KEY", "RESEND_API_KEY", "MAIL_FROM", "HIBP_API_KEY", "META_MODEL_NAME", "META_MODEL_BASE_URL", "META_MODEL_REASONING_EFFORT",
  "LLM_PROVIDER", "LLM_MODEL", "LLM_BASE_URL", "LLM_THINKING", "OPENAI_API_KEY", "ANTHROPIC_API_KEY", "ANTHROPIC_BASE_URL"];

// Every failure a user can see is one of these: one line, no stack trace.
export class CredentialsError extends Error {
  constructor(message) { super(message); this.name = "CredentialsError"; }
}

export const KEY_NAME = /^[A-Za-z_][A-Za-z0-9_]*$/;

// Paths come from the environment so tests and unusual hosts can point
// elsewhere: CREDENTIALS_FILE (the encrypted file), MASTER_KEY_FILE (the key).
export function paths(opts = {}) {
  const env = opts.env || process.env;
  return { file: opts.file || env.CREDENTIALS_FILE || DEFAULT_FILE, keyFile: opts.keyFile || env.MASTER_KEY_FILE || DEFAULT_KEY_FILE };
}

// "config/credentials.enc" for a path inside the repo, the full path otherwise.
export const rel = (p) => (String(p).startsWith(root) ? String(p).slice(root.length) : String(p));

export const generateKey = () => randomBytes(32).toString("hex");

export function parseKey(text, from) {
  const k = String(text || "").trim();
  if (!/^[0-9a-fA-F]{64}$/.test(k)) throw new CredentialsError(`${from} is not a master key (64 hex characters): ask a teammate for it again`);
  return Buffer.from(k, "hex");
}

// The master key in use: { key, from } with from "MASTER_KEY" or the key file, or null.
export function findKey(opts = {}) {
  const env = opts.env || process.env;
  const { keyFile } = paths(opts);
  if (env.MASTER_KEY) return { key: parseKey(env.MASTER_KEY, "MASTER_KEY"), from: "MASTER_KEY" };
  if (existsSync(keyFile)) return { key: parseKey(readFileSync(keyFile, "utf8"), rel(keyFile)), from: rel(keyFile) };
  return null;
}

export function writeKeyFile(keyFile, hex) {
  mkdirSync(dirname(keyFile), { recursive: true });
  writeFileSync(keyFile, `${hex}\n`, { mode: 0o600 });
  chmodSync(keyFile, 0o600);
}

// Envelope on one line (small git diffs): v1.<iv b64>.<tag b64>.<ciphertext b64>.
// Same shape as src/crypto.js uses for OAuth tokens; "v1" is authenticated too.
export function encrypt(plain, key) {
  const iv = randomBytes(12);
  const c = createCipheriv("aes-256-gcm", key, iv);
  c.setAAD(Buffer.from("v1"));
  const body = Buffer.concat([c.update(String(plain), "utf8"), c.final()]);
  return ["v1", iv.toString("base64"), c.getAuthTag().toString("base64"), body.toString("base64")].join(".");
}

export function decrypt(envelope, key) {
  const parts = String(envelope).trim().split(".");
  if (parts.length !== 4 || parts[0] !== "v1") throw new CredentialsError("not a credentials file (expected one line v1.<iv>.<tag>.<data>)");
  const [iv, tag, body] = parts.slice(1).map((p) => Buffer.from(p, "base64"));
  try {
    const d = createDecipheriv("aes-256-gcm", key, iv);
    d.setAAD(Buffer.from("v1"));
    d.setAuthTag(tag);
    return Buffer.concat([d.update(body), d.final()]).toString("utf8");
  } catch {
    throw new CredentialsError("wrong key or altered file");
  }
}

// --- the dotenv payload -----------------------------------------------------

// KEY=value lines → Map(key → value). `export KEY=` and # comments are accepted;
// "double quotes" take \n \" \\ escapes, 'single quotes' are literal.
export function parseDotenv(text) {
  const out = new Map();
  for (const raw of String(text).split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    const m = line.match(/^(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/);
    if (!m) continue;
    let v = m[2].trim();
    if (v.length >= 2 && v.startsWith('"') && v.endsWith('"')) v = v.slice(1, -1).replace(/\\(.)/g, (_, c) => (c === "n" ? "\n" : c));
    else if (v.length >= 2 && v.startsWith("'") && v.endsWith("'")) v = v.slice(1, -1);
    out.set(m[1], v);
  }
  return out;
}

// A value as it goes on its line: quoted only when the plain form would not read back.
export function formatValue(v) {
  const s = String(v ?? "");
  if (s !== "" && !/[\s"'#\\]/.test(s)) return s;
  return `"${s.replace(/\\/g, "\\\\").replace(/"/g, '\\"').replace(/\n/g, "\\n")}"`;
}

// Line numbers (1-based) that are neither KEY=value, a comment nor blank.
export function badLines(text) {
  return String(text).split(/\r?\n/)
    .map((raw, i) => (raw.trim() && !raw.trim().startsWith("#") && !/^(?:export\s+)?[A-Za-z_][A-Za-z0-9_]*\s*=/.test(raw.trim()) ? i + 1 : 0))
    .filter(Boolean);
}

// Replaces the KEY= line (a commented "# KEY=" one counts) or appends; comments and order are kept.
export function setLines(text, pairs) {
  let out = String(text);
  for (const [key, value] of pairs) {
    if (!KEY_NAME.test(key)) throw new CredentialsError(`not a valid key name: ${key}`);
    const line = `${key}=${formatValue(value)}`;
    const re = new RegExp(`^#?\\s*(?:export\\s+)?${key}\\s*=.*$`, "m");
    out = re.test(out) ? out.replace(re, () => line) : `${out.replace(/\n?$/, out ? "\n" : "")}${line}\n`;
  }
  return out;
}

export function unsetLines(text, keys) {
  let out = String(text);
  const removed = [];
  for (const key of keys) {
    const re = new RegExp(`^(?:export\\s+)?${key}\\s*=.*\\n?`, "m");
    if (re.test(out)) { out = out.replace(re, ""); removed.push(key); }
  }
  return { text: out, removed };
}

// --- the encrypted file -----------------------------------------------------

export const noKeyLine = ({ file, keyFile }) =>
  `No master key for ${rel(file)}: get ${rel(keyFile)} from a teammate (make secrets-init pastes it) or set MASTER_KEY; for a brand-new project delete ${rel(file)} and run make secrets-init`;

// Decrypts the file. { status, text, map }; status.error is the one line to show.
export function open(opts = {}) {
  const { file, keyFile } = paths(opts);
  const status = { file, keyFile, exists: existsSync(file), keyFrom: null, ok: false, error: null, keys: [], empty: [] };
  const result = { status, text: "", map: new Map() };
  let found = null;
  try { found = findKey(opts); } catch (e) { status.error = e.message; return result; }
  status.keyFrom = found?.from || null;
  if (!status.exists) return result;
  if (!found) { status.error = noKeyLine(status); return result; }
  try {
    result.text = decrypt(readFileSync(file, "utf8"), found.key);
  } catch (e) {
    status.error = e.message.startsWith("not a credentials file")
      ? `${rel(file)} is ${e.message}: git checkout ${rel(file)}, or delete it and run make secrets-init`
      : `Cannot decrypt ${rel(file)} with ${found.from}: wrong key (rotated? ask a teammate for the current one) or the file was altered`;
    return result;
  }
  result.map = parseDotenv(result.text);
  status.ok = true;
  status.keys = [...result.map.keys()].sort();
  status.empty = status.keys.filter((k) => !result.map.get(k));
  return result;
}

// Names, presence and the one-line problem if any. Never throws, never a value.
export const credentialsStatus = (opts = {}) => open(opts).status;

// Atomic write of the encrypted file, with the key in use (or a given one, for rotate).
export function writeStore(text, opts = {}, key = findKey(opts)?.key) {
  const { file } = paths(opts);
  if (!key) throw new CredentialsError(noKeyLine(paths(opts)));
  mkdirSync(dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.tmp`;
  writeFileSync(tmp, `${encrypt(text, key)}\n`, { mode: 0o644 });
  renameSync(tmp, file);
}

// Opens or throws the one line.
export function openOrThrow(opts = {}) {
  const r = open(opts);
  if (r.status.error) throw new CredentialsError(r.status.error);
  if (!r.status.exists) throw new CredentialsError(`${rel(r.status.file)} missing: make secrets-init creates it (git checkout ${rel(r.status.file)} restores the team's)`);
  return r;
}

// pairs: [[key, value], ...]. Returns the names written.
export function setKeys(pairs, opts = {}) {
  const { text } = openOrThrow(opts);
  writeStore(setLines(text, pairs), opts);
  return pairs.map(([k]) => k);
}

// Copies the credentials into env (process.env by default). A variable that
// is already set and not empty wins: real environment and .env over the file.
// No file: nothing happens. File without a usable key: throws the one line.
export function loadCredentials(opts = {}) {
  const env = opts.env || process.env;
  const { status, map } = open(opts);
  if (status.error) throw new CredentialsError(status.error);
  const loaded = [];
  const shadowed = [];
  for (const [k, v] of map) {
    if (!v) continue;
    if (env[k]) shadowed.push(k);
    else { env[k] = v; loaded.push(k); }
  }
  return { ...status, loaded, shadowed };
}
