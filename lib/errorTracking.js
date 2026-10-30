// Error tracking with Rollbar (_product/specs/observability.md): server errors
// (status 500 and above), scheduled jobs when they start failing and when they
// recover, uncaught exceptions and unhandled rejections. Off without
// ROLLBAR_ACCESS_TOKEN: no client, no process listener, every call a no-op.
// Personal data never leaves the box: a request is only its method and route
// pattern, keys that can hold a person's words are scrubbed, every email
// address and phone number left anywhere in an item is masked, and the raw
// copy of the error that Rollbar adds after those steps is dropped.
import Rollbar from "rollbar";

// Email addresses (the Gmail poll's error lines use it too). With replace only: the g flag makes test() stateful.
export const ADDRESS = /[\w.+-]+@[\w-]+(?:\.[\w-]+)+/g;
// Phone numbers in US, French and international forms, the pattern redactForModel uses in lib/muse.js.
export const PHONE = /(?:\+?1[\s.-]?)?\(?\b\d{3}\)?[\s.-]\d{3}[\s.-]\d{4}\b|(?:\+33[\s.]?|\b0)[1-9](?:[\s.-]?\d{2}){4}\b|\+\d{2,3}[\s\d]{8,14}\d/g;

export const maskPersonalData = (text) => String(text).replace(ADDRESS, "[address]").replace(PHONE, "[phone]");

// Every string in the item, in place: titles, messages, traces, custom fields.
function maskDeep(node, seen) {
  if (typeof node === "string") return maskPersonalData(node);
  if (!node || typeof node !== "object" || seen.has(node)) return node;
  seen.add(node);
  for (const key of Object.keys(node)) node[key] = maskDeep(node[key], seen);
  return node;
}
export function maskPayload(payload) {
  maskDeep(payload, new WeakSet());
}

// Added to Rollbar's own list (passwords, tokens, cookies, authorization), for
// keys anywhere in the item and key=value pairs inside any text. Not "body":
// the item's own body is the error itself, and with it on the list every item
// arrives as "********" (rollbar 4.2.0); a request never carries one here.
export const SCRUB_FIELDS = ["text", "snippet", "subject", "from", "to", "email", "phone", "mobile", "code", "state", "refresh_token", "id_token"];

// The only request data an item carries: the method and the route pattern,
// never the URL with its query, the headers, cookies, body, IP or the person.
// With this hook set, Rollbar skips its own request, IP and person extraction.
export function addRequestData(data, request) {
  const route = request?.routeOptions?.url ?? null;
  data.request = { method: request?.method ?? null, url: route };
  if (route) data.context = `${request.method} ${route}`;
}

export function rollbarOptions(env = process.env) {
  return {
    environment: env.NODE_ENV || "development",
    codeVersion: env.APP_VERSION || "dev",
    captureUncaught: true,
    captureUnhandledRejections: true,
    // Report, then exit 1, so compose restarts the container instead of
    // Rollbar's listener keeping a broken process alive.
    exitOnUncaughtException: true,
    captureIp: false,
    captureEmail: false,
    captureUsername: false,
    autoInstrument: false,
    scrubFields: SCRUB_FIELDS,
    addRequestData,
    transform: maskPayload,
    onSendCallback: beforeSend,
  };
}

// The last pass, over exactly what is sent. After its scrubber and transform,
// Rollbar adds diagnostic.raw_error, the original message and stack: the
// item's trace already carries both, scrubbed and masked, so the raw copy
// loses them.
export function beforeSend(isUncaught, args, payload) {
  const raw = payload?.notifier?.diagnostic?.raw_error;
  if (raw) {
    delete raw.message;
    delete raw.stack;
  }
  maskPayload(payload);
}

let client = null;

// Once, first thing, when the server starts (src/server.js); again in tests.
// Returns the client, or null without a token. Rollbar and options: tests (a
// fake client, a local endpoint, capture off inside the test runner).
export function initErrorTracking({ env = process.env, Rollbar: RollbarClient = Rollbar, options = {} } = {}) {
  const accessToken = String(env.ROLLBAR_ACCESS_TOKEN || "").trim();
  client = accessToken ? new RollbarClient({ ...rollbarOptions(env), ...options, accessToken }) : null;
  return client;
}

export const errorTrackingOn = () => client !== null;

// Reporting never breaks the caller: an SDK error is logged and dropped.
function send(level, ...args) {
  if (!client) return;
  try { client[level](...args); } catch (e) { console.error(`[errors] could not report to Rollbar: ${e?.name || "error"}`); }
}

// A server error (status 500 and above, src/server.js). The SDK never sees the
// request itself: only its method and route pattern, handed to addRequestData.
export function reportError(err, request) {
  const req = request ? { method: request.method, routeOptions: { url: request.routeOptions?.url ?? null } } : undefined;
  send("error", err, req);
}

// A scheduled job that just started failing (src/jobs/scheduler.js decides
// when). One Rollbar item per job, whatever its error line says.
export function reportJobFailing(job, err, { trigger = null } = {}) {
  send("error", err, { job, trigger, title: `Job ${job} failing: ${err?.message || err}`, fingerprint: `job-${job}-failing` });
}

export function reportJobRecovered(job, failedRuns) {
  send("info", `Job ${job} recovered after ${failedRuns} failed run${failedRuns === 1 ? "" : "s"}`,
    { job, failedRuns, fingerprint: `job-${job}-recovered` });
}

// Waits for the items still being sent (shutdown, tests), timeoutMs at most.
export function flushErrorTracking({ timeoutMs = 3000 } = {}) {
  if (!client) return Promise.resolve();
  const pending = client;
  return new Promise((resolve) => {
    const timer = setTimeout(resolve, timeoutMs);
    timer.unref?.();
    pending.wait(() => { clearTimeout(timer); resolve(); });
  });
}
