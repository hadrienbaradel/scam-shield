#!/usr/bin/env node
// The Graph API side of the WhatsApp setup (docs/WHATSAPP_SETUP.md, Part 2): what the dashboard shows only
// screen by screen, in one look, and the two calls that finish the wiring once Vlad stored the token and the
// app secret. Run with the credentials loaded (this file reads no config of its own):
//
//   node --import ./lib/credentials.js scripts/whatsapp-check.mjs <command>   (the commands: USAGE below)
//
// Never prints a token, the app secret or the verify token: the bearer token travels in a header, the app
// token (<app id>|<app secret>) in the query string, and a line names the path, Graph's message and its code,
// never the URL. Every printed line also goes through scrub(), in case Graph or fetch ever echoed one.
// Exit 1 when a check failed or a key is missing, 2 on a usage error. The decisions are exported pure
// functions (tests/whatsapp-check.test.js); run() only sends what plan() built.

import { pathToFileURL } from "node:url";
import { GRAPH_URL, whatsappConfig } from "../src/channels/whatsapp.js";

export const USAGE = `usage: node --import ./lib/credentials.js scripts/whatsapp-check.mjs <command>
  status             the keys by name (set or missing), the number as Meta sees it, the apps the business
                     account delivers to, and the app's webhook (callback URL, active, fields)
  subscribe [url]    subscribe the business account to the app (deliveries flow); with an https URL, also
                     point the app's webhook there (Meta calls the URL during the request: the server must be up)
  hello <digits>     the hello_world template to an allowlisted phone: proves the token, the number and the allowlist`;

export const TIMEOUT_MS = 20_000;
// What status reports by name only; WHATSAPP_GRAPH_VERSION is shown with its value (not a secret).
export const KEYS = ["WHATSAPP_ACCESS_TOKEN", "WHATSAPP_PHONE_NUMBER_ID", "WHATSAPP_BUSINESS_ACCOUNT_ID", "WHATSAPP_APP_SECRET",
  "WHATSAPP_VERIFY_TOKEN", "WHATSAPP_PHONE_NUMBER", "META_APP_ID"];
const COMMANDS = ["status", "subscribe", "hello"];
const NUMBER_FIELDS = "display_phone_number,verified_name,quality_rating,platform_type";

// One label per request: the start of its printed line, and the key describe() reads its answer by.
export const LABEL = {
  number: "phone number",
  apps: "apps on the business account",
  webhook: "app webhook",
  subscribe: "subscribe the business account",
  callback: "set the app webhook",
  hello: "hello_world",
};
// The keys each request cannot go without.
const NEEDS = {
  number: ["WHATSAPP_ACCESS_TOKEN", "WHATSAPP_PHONE_NUMBER_ID"],
  apps: ["WHATSAPP_ACCESS_TOKEN", "WHATSAPP_BUSINESS_ACCOUNT_ID"],
  webhook: ["META_APP_ID", "WHATSAPP_APP_SECRET"],
  subscribe: ["WHATSAPP_ACCESS_TOKEN", "WHATSAPP_BUSINESS_ACCOUNT_ID"],
  callback: ["META_APP_ID", "WHATSAPP_APP_SECRET", "WHATSAPP_VERIFY_TOKEN"],
  hello: ["WHATSAPP_ACCESS_TOKEN", "WHATSAPP_PHONE_NUMBER_ID"],
};
// Hints for the failures that have one obvious cause.
const HINT = {
  [LABEL.callback]: "; Meta calls the callback URL with the verify token during this request, so the server must be up and reachable there, answering GET /api/whatsapp/webhook with WHATSAPP_VERIFY_TOKEN",
  [LABEL.hello]: "; the phone must be on the test number's allowlist (docs/WHATSAPP_SETUP.md, Part 1 step 3)",
};

const has = (env, k) => Boolean(String(env[k] ?? "").trim());
const digits = (s) => String(s ?? "").replace(/[\s().+-]/g, "");
const isHttps = (u) => { try { return new URL(u).protocol === "https:"; } catch { return false; } };
const steps = (command, args = []) =>
  command === "status" ? ["number", "apps", "webhook"]
    : command === "subscribe" ? (args[0] ? ["subscribe", "callback"] : ["subscribe"])
      : command === "hello" ? ["hello"] : [];

// The key names a command needs and the environment lacks (blank counts as missing).
export const missingKeys = (command, env = {}, args = []) =>
  [...new Set(steps(command, args).flatMap((s) => NEEDS[s]))].filter((k) => !has(env, k));

// An argument the command cannot use, as the line to print; "" when the arguments are fine.
export function usageError(command, args = []) {
  if (command === "hello" && !/^\d{6,15}$/.test(digits(args[0]))) return "hello needs the recipient's number, digits with the country code (e.g. 15551234567), on the test number's allowlist";
  if (command === "subscribe" && args[0] && !isHttps(args[0])) return "the callback URL must start with https:// (Meta calls nothing else), e.g. https://<tunnel>/api/whatsapp/webhook";
  return "";
}

// The requests a command sends, without the host and without any token: send() adds the auth. status
// keeps the checks it has the keys for (the others are reported as skipped); the other commands run only
// when missingKeys() is empty. The verify token rides in the webhook form because Meta needs it there.
export function plan(command, args = [], env = {}) {
  const c = whatsappConfig(env);
  const v = c.graphVersion;
  const seg = (s) => encodeURIComponent(String(s ?? "").trim());
  const build = {
    number: () => ({ method: "GET", path: `/${v}/${seg(c.phoneNumberId)}`, auth: "bearer", query: { fields: NUMBER_FIELDS } }),
    apps: () => ({ method: "GET", path: `/${v}/${seg(c.businessAccountId)}/subscribed_apps`, auth: "bearer" }),
    webhook: () => ({ method: "GET", path: `/${v}/${seg(env.META_APP_ID)}/subscriptions`, auth: "app" }),
    subscribe: () => ({ method: "POST", path: `/${v}/${seg(c.businessAccountId)}/subscribed_apps`, auth: "bearer" }),
    callback: () => ({
      method: "POST", path: `/${v}/${seg(env.META_APP_ID)}/subscriptions`, auth: "app",
      form: { object: "whatsapp_business_account", callback_url: args[0], verify_token: c.verifyToken, fields: "messages" },
    }),
    hello: () => ({
      method: "POST", path: `/${v}/${seg(c.phoneNumberId)}/messages`, auth: "bearer",
      body: { messaging_product: "whatsapp", to: digits(args[0]), type: "template", template: { name: "hello_world", language: { code: "en_US" } } },
    }),
  };
  return steps(command, args)
    .filter((s) => command !== "status" || NEEDS[s].every((k) => has(env, k)))
    .map((s) => ({ label: LABEL[s], ...build[s]() }));
}

// Graph's error as "message (code N)", a transport failure as send() named it, "" when the call went through.
function failure(r) {
  const e = r?.json?.error;
  if (e) return `${e.message || "no message"} (code ${e.code ?? "?"}${e.error_subcode ? `, subcode ${e.error_subcode}` : ""})`;
  if (!r?.ok) return r?.error || `HTTP ${r?.status ?? "?"}`;
  return "";
}

const fieldName = (f) => (typeof f === "string" ? f : f?.name || "");

// A parsed answer ({ ok, status, json } or send()'s { ok: false, error }) → whether the check passed and what to say.
function assess(label, r) {
  const err = failure(r);
  if (err) return { ok: false, text: `FAILED: ${err}${HINT[label] || ""}` };
  const j = r.json || {};
  switch (label) {
    case LABEL.number:
      return { ok: true, text: `${j.display_phone_number || "?"}, verified name "${j.verified_name || "?"}", quality ${j.quality_rating || "?"}, platform ${j.platform_type || "?"}` };
    case LABEL.apps: {
      // Newer versions wrap each app in whatsapp_business_api_data; older ones list it flat.
      const apps = (j.data || []).map((d) => d.whatsapp_business_api_data || d).map((a) => `${a.name || "?"} (${a.id || "?"})`);
      return apps.length ? { ok: true, text: apps.join(", ") } : { ok: false, text: "none: no delivery reaches the app until `subscribe` adds it" };
    }
    case LABEL.webhook: {
      const s = (j.data || []).find((d) => d.object === "whatsapp_business_account");
      if (!s) return { ok: false, text: "no whatsapp_business_account subscription: `subscribe <https callback URL>` sets it" };
      const fields = (s.fields || []).map(fieldName).filter(Boolean);
      const ok = s.active === true && fields.includes("messages");
      return { ok, text: `callback ${s.callback_url || "?"}, active ${s.active === true}, fields ${fields.join(", ") || "none"}${ok ? "" : ": deliveries need it active with the messages field (`subscribe <url>`)"}` };
    }
    case LABEL.subscribe:
    case LABEL.callback:
      return j.success === true ? { ok: true, text: "done" } : { ok: false, text: "no success: true in the answer" };
    case LABEL.hello: {
      const m = (j.messages || [])[0];
      return m?.id ? { ok: true, text: `sent, message id ${m.id}${m.message_status ? ` (${m.message_status})` : ""}` } : { ok: false, text: "no message id in the answer" };
    }
    default:
      return { ok: true, text: "ok" };
  }
}
export const describe = (label, response) => `${label}: ${assess(label, response).text}`;
export const passed = (label, response) => assess(label, response).ok;

// The keys by name, then the Graph version with its value.
export const keyLines = (env = {}) => [
  ...KEYS.map((k) => `${k}: ${has(env, k) ? "set" : "missing"}`),
  `WHATSAPP_GRAPH_VERSION: ${has(env, "WHATSAPP_GRAPH_VERSION") ? env.WHATSAPP_GRAPH_VERSION : `${whatsappConfig({}).graphVersion} (default)`}`,
];

// Defence in depth: whatever a line holds, no secret value leaves this script (the app token contains the secret).
export function scrub(text, env = {}) {
  const c = whatsappConfig(env);
  return [c.token, c.appSecret, c.verifyToken].filter((s) => s.length >= 6).reduce((t, s) => t.split(s).join("[redacted]"), String(text));
}

// One request, with its auth: the bearer token in a header, the app token in the query. No redirect is
// followed, so the token reaches only graph.facebook.com.
async function send(req, env, fetchImpl) {
  const c = whatsappConfig(env);
  const url = new URL(`${GRAPH_URL}${req.path}`);
  for (const [k, v] of Object.entries(req.query || {})) url.searchParams.set(k, v);
  const headers = {};
  if (req.auth === "bearer") headers.authorization = `Bearer ${c.token}`;
  if (req.auth === "app") url.searchParams.set("access_token", `${String(env.META_APP_ID).trim()}|${c.appSecret}`);
  let body;
  if (req.body) { headers["content-type"] = "application/json"; body = JSON.stringify(req.body); }
  else if (req.form) body = new URLSearchParams(req.form);
  try {
    const res = await fetchImpl(url.href, { method: req.method, headers, body, redirect: "error", signal: AbortSignal.timeout(TIMEOUT_MS) });
    return { ok: res.ok, status: res.status, json: await res.json().catch(() => ({})) };
  } catch (e) {
    // Only the error's name or code: a transport error message is not trusted to leave the URL out.
    return { ok: false, status: 0, json: {}, error: e?.name === "TimeoutError" ? `no answer in ${TIMEOUT_MS / 1000} s` : `network error (${e?.cause?.code || e?.name || "unknown"})` };
  }
}

// The command line → the exit code. env, fetchImpl and out are injectable so the test runs it offline.
export async function run(argv = process.argv.slice(2), { env = process.env, fetchImpl = fetch, out = console.log } = {}) {
  const [command, ...args] = argv;
  if (!command || ["--help", "-h", "help"].includes(command)) { out(USAGE); return 0; }
  if (!COMMANDS.includes(command)) { out(`unknown command: ${command}\n${USAGE}`); return 2; }
  const say = (line) => out(scrub(line, env));
  const bad = usageError(command, args);
  if (bad) { say(bad); return 2; }
  const missing = missingKeys(command, env, args);
  if (command === "status") {
    keyLines(env).forEach(say);
    if (missing.length) say(`skipped: the checks that need ${missing.join(", ")} (make secrets-set NAME=value; docs/WHATSAPP_SETUP.md)`);
  } else if (missing.length) {
    say(`missing: ${missing.join(", ")} (make secrets-set NAME=value; docs/WHATSAPP_SETUP.md)`);
    return 1;
  }
  let failures = missing.length;
  for (const req of plan(command, args, env)) {
    const response = await send(req, env, fetchImpl);
    const ok = passed(req.label, response);
    say(`${describe(req.label, response)}${ok ? "" : `  [${req.method} ${req.path}]`}`);
    if (!ok) failures++;
  }
  if (command === "subscribe" && !failures) say(args[0] ? `deliveries flow to ${args[0]}: status shows the webhook` : "the app's callback URL is unchanged: status shows it, subscribe <https URL> moves it");
  return failures ? 1 : 0;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) process.exitCode = await run();
