// Observability (_product/specs/observability.md): one or more tests per
// Behavior line. Rollbar is a fake client, or the real SDK posting to a local
// endpoint (and, for the crash path, in a child process); heartbeats get a
// fake fetch; Postgres is stubbed, plus one health check on the real test
// database when it is reachable. Nothing here reaches the network.
import "./helpers/env.js";
import { test, before, after, afterEach } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { spawn } from "node:child_process";
import {
  initErrorTracking, errorTrackingOn, rollbarOptions, reportError, reportJobFailing, reportJobRecovered,
  flushErrorTracking, maskPersonalData, SCRUB_FIELDS,
} from "../lib/errorTracking.js";
import { JOBS, canRun, runJob, pingHeartbeat, heartbeats } from "../src/jobs/scheduler.js";
import { buildApp } from "../src/server.js";
import { healthCheck } from "../src/routes/account.js";
import { config, parseTrustProxy, PRIVATE_PROXIES } from "../src/config.js";
import { dbAvailable, pool } from "./helpers/db.js";

const hasDb = await dbAvailable();
// Timers that keep the process (and so the test runner) alive.
const liveTimers = () => process.getActiveResourcesInfo().filter((r) => r === "Timeout").length;
const OOPS = { error: "Something went wrong on our side. To be safe, do not click anything in the message." };

// A stand-in for the Rollbar class: keeps its options and every call.
class FakeRollbar {
  constructor(options) { this.options = options; this.calls = []; }
  error(...args) { this.calls.push({ level: "error", args }); }
  info(...args) { this.calls.push({ level: "info", args }); }
  wait(callback) { callback(); }
}
const fakeTracking = (env = {}) => initErrorTracking({ env: { ROLLBAR_ACCESS_TOKEN: "test-token", ...env }, Rollbar: FakeRollbar });

// A local Rollbar API: every item the real SDK posts lands in `items`.
async function rollbarEndpoint() {
  const items = [];
  const server = http.createServer((req, res) => {
    let body = "";
    req.on("data", (chunk) => { body += chunk; });
    req.on("end", () => {
      items.push({ token: req.headers["x-rollbar-access-token"], payload: JSON.parse(body) });
      res.setHeader("content-type", "application/json");
      res.end(JSON.stringify({ err: 0, result: { id: null, uuid: "local" } }));
    });
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  // Rollbar keeps its connection alive: close it too, or close() waits for the idle timeout.
  const close = () => { server.closeAllConnections(); return new Promise((resolve) => server.close(resolve)); };
  return { items, url: `http://127.0.0.1:${server.address().port}/api/1/item/`, close };
}
// The real SDK with the production options, aimed at the local endpoint. Capture stays
// off inside the test runner (no process listener); the child-process test covers it.
const realTracking = (endpoint) => initErrorTracking({
  env: { ROLLBAR_ACCESS_TOKEN: "test-token", NODE_ENV: "production", APP_VERSION: "3f2c1ab" },
  options: { endpoint, captureUncaught: false, captureUnhandledRejections: false },
});

let app;
before(async () => {
  app = await buildApp({ logger: false });
  app.get("/api/test/boom/:id", async () => { throw new Error("database exploded"); });
  app.get("/api/test/upstream", async () => { throw Object.assign(new Error("Gmail answered 502"), { statusCode: 502 }); });
  app.get("/api/test/missing", async () => { throw Object.assign(new Error("No such message."), { statusCode: 404 }); });
  app.get("/api/test/invalid", async () => { throw Object.assign(new Error("Paste a message first."), { statusCode: 400 }); });
  app.get("/api/test/limited", { config: { rateLimit: { max: 1, timeWindow: 60000 } } }, async () => ({ ok: true }));
  app.post("/api/test/check/:id", async (request) => {
    const cause = new Error(`lookup failed for ${request.body.email}`);
    throw new Error(`could not check the message from ${request.body.email} (call +1 617 555 0123)`, { cause });
  });
  await app.ready();
});
afterEach(() => { initErrorTracking({ env: {} }); });
after(async () => {
  await app?.close();
  await pool.end();
});

// ---------------------------------------------------------------- line 1 ---

test("without ROLLBAR_ACCESS_TOKEN nothing is sent, no process listener is added and every report is a no-op", async () => {
  const listeners = () => [process.listenerCount("uncaughtException"), process.listenerCount("unhandledRejection")];
  const before = listeners();
  let built = 0;
  class Counting { constructor() { built++; } }
  assert.equal(initErrorTracking({ env: { NODE_ENV: "production", APP_VERSION: "3f2c1ab" }, Rollbar: Counting }), null);
  assert.equal(initErrorTracking({ env: { ROLLBAR_ACCESS_TOKEN: "  " }, Rollbar: Counting }), null);
  assert.equal(built, 0);
  assert.equal(errorTrackingOn(), false);
  reportError(new Error("x"), { method: "GET", routeOptions: { url: "/x" } });
  reportJobFailing("poll", new Error("x"));
  reportJobRecovered("poll", 2);
  await flushErrorTracking();
  assert.deepEqual(listeners(), before);
  // The server answers exactly as before.
  const res = await app.inject({ method: "GET", url: "/api/test/boom/1" });
  assert.equal(res.statusCode, 500);
  assert.deepEqual(res.json(), OOPS);
});

test("a token turns it on: the environment, the code version, crash capture with exit, no IP, email, username or person", () => {
  const client = fakeTracking({ NODE_ENV: "production", APP_VERSION: "3f2c1ab" });
  assert.ok(client instanceof FakeRollbar);
  assert.equal(errorTrackingOn(), true);
  const o = client.options;
  assert.equal(o.accessToken, "test-token");
  assert.equal(o.environment, "production");
  assert.equal(o.codeVersion, "3f2c1ab");
  assert.equal(o.captureUncaught, true);
  assert.equal(o.captureUnhandledRejections, true);
  assert.equal(o.exitOnUncaughtException, true);
  assert.equal(o.captureIp, false);
  assert.equal(o.captureEmail, false);
  assert.equal(o.captureUsername, false);
  assert.equal(o.autoInstrument, false);
  assert.equal("person" in o, false);
  assert.equal(typeof o.addRequestData, "function", "Rollbar's own request, IP and person extraction is replaced");
  // Unset: development and dev.
  const unset = rollbarOptions({});
  assert.equal(unset.environment, "development");
  assert.equal(unset.codeVersion, "dev");
});

// The real module in a child process, with the production options untouched.
async function child(script, endpoint) {
  const moduleUrl = new URL("../lib/errorTracking.js", import.meta.url).href;
  const code = `const m = await import(${JSON.stringify(moduleUrl)}); m.initErrorTracking({ options: { endpoint: ${JSON.stringify(endpoint)} } });\n${script}`;
  const proc = spawn(process.execPath, ["--input-type=module", "-e", code], {
    env: { PATH: process.env.PATH, ROLLBAR_ACCESS_TOKEN: "test-token", NODE_ENV: "production", APP_VERSION: "3f2c1ab" },
    stdio: ["ignore", "pipe", "pipe"],
  });
  let stdout = "";
  proc.stdout.on("data", (d) => { stdout += d; });
  proc.stderr.resume();
  const exitCode = await new Promise((resolve) => proc.on("close", resolve));
  return { exitCode, stdout };
}

test("an uncaught exception is reported, then the process exits 1; an unhandled rejection is reported and the server keeps running", async () => {
  const endpoint = await rollbarEndpoint();
  try {
    const crash = await child(`setTimeout(() => { throw new Error("crash while syncing linda@example.com"); }, 10);
setTimeout(() => { console.log("still alive"); process.exit(0); }, 4000).unref();`, endpoint.url);
    assert.equal(crash.exitCode, 1);
    assert.doesNotMatch(crash.stdout, /still alive/);
    assert.equal(endpoint.items.length, 1);
    const crashed = endpoint.items[0].payload.data;
    assert.equal(crashed.notifier.diagnostic.is_uncaught, true);
    assert.equal(crashed.body.trace_chain[0].exception.message, "crash while syncing [address]");
    assert.equal(crashed.environment, "production");
    assert.equal(crashed.code_version, "3f2c1ab");

    const rejection = await child(`Promise.reject(new Error("forgotten promise for +1 617 555 0123"));
setTimeout(async () => { await m.flushErrorTracking(); console.log("still running"); process.exit(0); }, 200);`, endpoint.url);
    assert.equal(rejection.exitCode, 0);
    assert.match(rejection.stdout, /still running/);
    assert.equal(endpoint.items.length, 2);
    assert.equal(endpoint.items[1].payload.data.body.trace_chain[0].exception.message, "forgotten promise for [phone]");
  } finally {
    await endpoint.close();
  }
});

// ---------------------------------------------------------------- line 2 ---

test("a request that ends in a 500 is reported with its route, and the answer does not change", async () => {
  const client = fakeTracking();
  const res = await app.inject({ method: "GET", url: "/api/test/boom/42?code=abc" });
  assert.equal(res.statusCode, 500);
  assert.deepEqual(res.json(), OOPS);
  assert.equal(client.calls.length, 1);
  const [{ level, args }] = client.calls;
  assert.equal(level, "error");
  assert.equal(args[0].message, "database exploded");
  // The SDK is handed the method and the route pattern, never the request.
  assert.deepEqual(args[1], { method: "GET", routeOptions: { url: "/api/test/boom/:id" } });
  // A 5xx thrown by a route is a 500 for the user and a report for us.
  const upstream = await app.inject({ method: "GET", url: "/api/test/upstream" });
  assert.equal(upstream.statusCode, 500);
  assert.equal(client.calls.length, 2);
});

test("a 4xx is never reported: not found, invalid, rate limited; their answers do not change", async () => {
  const client = fakeTracking();
  const missing = await app.inject({ method: "GET", url: "/api/test/missing" });
  assert.equal(missing.statusCode, 404);
  assert.deepEqual(missing.json(), { error: "No such message." });
  const invalid = await app.inject({ method: "GET", url: "/api/test/invalid" });
  assert.equal(invalid.statusCode, 400);
  assert.deepEqual(invalid.json(), { error: "Paste a message first." });
  assert.equal((await app.inject({ method: "GET", url: "/api/test/no-such-route" })).statusCode, 404);
  assert.equal((await app.inject({ method: "GET", url: "/api/test/limited" })).statusCode, 200);
  assert.equal((await app.inject({ method: "GET", url: "/api/test/limited" })).statusCode, 429);
  assert.equal(client.calls.length, 0);
});

test("reporting never breaks the answer: an SDK that throws is logged and dropped, and a flush never hangs", async (t) => {
  class Broken extends FakeRollbar {
    error() { throw new Error("SDK bug"); }
    wait() { /* never calls back */ }
  }
  initErrorTracking({ env: { ROLLBAR_ACCESS_TOKEN: "test-token" }, Rollbar: Broken });
  const logged = t.mock.method(console, "error", () => {});
  const res = await app.inject({ method: "GET", url: "/api/test/boom/7" });
  assert.equal(res.statusCode, 500);
  assert.deepEqual(res.json(), OOPS);
  assert.match(logged.mock.calls[0].arguments[0], /could not report to Rollbar/);
  await flushErrorTracking({ timeoutMs: 20 });
});

// ---------------------------------------------------------------- line 3 ---

test("a reported request carries only its method and route; headers, cookies, body, query, IP and person never leave the box", async () => {
  const endpoint = await rollbarEndpoint();
  try {
    realTracking(endpoint.url);
    const res = await app.inject({
      method: "POST",
      url: "/api/test/check/42?code=4/0AXsecret&state=st4te",
      remoteAddress: "198.51.100.23",
      headers: {
        origin: "http://localhost:3999", cookie: "pref=cookie-secret", authorization: "Basic dXNlcjpzZWNyZXQ=",
        "x-forwarded-for": "203.0.113.9", "user-agent": "Linda iPad", "content-type": "application/json",
      },
      payload: { email: "linda@example.com", text: "Your parcel is waiting, call 06 12 34 56 78", subject: "USPS notice" },
    });
    assert.equal(res.statusCode, 500);
    assert.deepEqual(res.json(), OOPS);
    await flushErrorTracking();
    assert.equal(endpoint.items.length, 1);
    const { token, payload } = endpoint.items[0];
    assert.equal(token, "test-token");
    const data = payload.data;
    assert.deepEqual(data.request, { method: "POST", url: "/api/test/check/:id" });
    assert.equal(data.context, "POST /api/test/check/:id");
    assert.equal(data.person, undefined);
    assert.equal(data.environment, "production");
    assert.equal(data.code_version, "3f2c1ab");
    // The item keeps its error (Rollbar's scrubber would wipe a key named body), masked.
    assert.equal(data.body.trace_chain[0].exception.message, "could not check the message from [address] (call [phone])");
    assert.equal(data.body.trace_chain[1].exception.message, "lookup failed for [address]");
    // Rollbar's raw copy of the error, added after its scrubber, loses the message and the stack.
    assert.equal(data.notifier.diagnostic.raw_error.name, "Error");
    assert.equal(data.notifier.diagnostic.raw_error.message, undefined);
    assert.equal(data.notifier.diagnostic.raw_error.stack, undefined);
    const sent = JSON.stringify(payload);
    for (const kept of ["linda@example.com", "617 555 0123", "06 12 34 56 78", "cookie-secret", "dXNlcjpzZWNyZXQ=", "4/0AXsecret", "st4te",
      "198.51.100.23", "203.0.113.9", "Linda iPad", "parcel is waiting", "USPS notice"]) {
      assert.ok(!sent.includes(kept), `"${kept}" must not leave the box`);
    }
  } finally {
    await endpoint.close();
  }
});

test("keys that can hold a person's words are scrubbed wherever they appear, and code= or state= inside any text", async () => {
  assert.deepEqual(SCRUB_FIELDS, ["text", "snippet", "subject", "from", "to", "email", "phone", "mobile", "code", "state", "refresh_token", "id_token"]);
  const endpoint = await rollbarEndpoint();
  try {
    const client = realTracking(endpoint.url);
    client.error(new Error("token exchange failed: /auth/google/callback?code=4/0AXsecret&state=st4te"), {
      job: "poll", subject: "Your parcel", nested: { text: "Hello Linda", from: "USPS", snippet: "Track it", refresh_token: "1//rt-secret", mobile: "0612" },
    });
    await flushErrorTracking();
    const data = endpoint.items[0].payload.data;
    assert.equal(data.custom.job, "poll", "other keys stay");
    assert.equal(data.custom.subject, "********");
    for (const key of ["text", "from", "snippet", "refresh_token", "mobile"]) assert.equal(data.custom.nested[key], "********", key);
    assert.equal(data.body.trace_chain[0].exception.message, "token exchange failed: /auth/google/callback?code=********&state=********");
    const sent = JSON.stringify(endpoint.items[0].payload);
    for (const kept of ["4/0AXsecret", "st4te", "Your parcel", "Hello Linda", "1//rt-secret", "Track it"]) assert.ok(!sent.includes(kept), kept);
  } finally {
    await endpoint.close();
  }
});

test("every email address and phone number in a message, title or trace becomes [address] or [phone]; other numbers stay", async () => {
  assert.equal(maskPersonalData("from linda.smith+news@mail.example.co.uk"), "from [address]");
  for (const phone of ["(617) 555-0123", "617-555-0123", "+1 617 555 0123", "+16175550123", "06 12 34 56 78", "0612345678", "+33 6 12 34 56 78", "+44 20 7946 0958"]) {
    assert.equal(maskPersonalData(`call ${phone} now`), "call [phone] now", phone);
  }
  const kept = "2026-10-30T08:50:00.000Z at runJob (src/jobs/scheduler.js:183:19) uuid 0a1b2c3d-1234-4f00-9abc-0123456789ab v4-2026-10-29 3f2c1ab 120 s";
  assert.equal(maskPersonalData(kept), kept);
  // Through the real SDK: the title and the message of a job's item.
  const endpoint = await rollbarEndpoint();
  try {
    realTracking(endpoint.url);
    reportJobFailing("poll", new Error("sync failed for linda@example.com (+33 6 12 34 56 78)"), { trigger: "schedule" });
    reportJobRecovered("poll", 3);
    await flushErrorTracking();
    const [failing, recovered] = endpoint.items.map((i) => i.payload.data);
    assert.equal(failing.title, "Job poll failing: sync failed for [address] ([phone])");
    assert.equal(failing.body.trace_chain[0].exception.message, "sync failed for [address] ([phone])");
    assert.equal(failing.level, "error");
    assert.equal(failing.fingerprint, "job-poll-failing");
    assert.equal(recovered.level, "info");
    assert.equal(recovered.body.message.body, "Job poll recovered after 3 failed runs");
    assert.equal(recovered.fingerprint, "job-poll-recovered");
  } finally {
    await endpoint.close();
  }
});

// ------------------------------------------------------------ lines 4, 5 ---

const memoryStore = () => {
  const rows = [];
  return { rows, async start(run) { rows.push({ ...run }); return rows.length; }, async end(run) { rows[run.id - 1] = { ...run }; } };
};
const fakeJob = (over = {}) => ({ id: "poll", name: "Gmail poll", what: "polls", kind: "interval", everyMs: 120000,
  run: async () => ({ users: 1 }), running: false, lastRun: null, nextDueAt: null, ...over });
const NO_PING = { enabled: false };

test("a job is reported when it starts failing, not on every failing run, and once when it recovers", async () => {
  const client = fakeTracking();
  const store = memoryStore();
  let failing = true;
  const jobs = [fakeJob({ run: async () => {
    if (failing) throw Object.assign(new Error("every mailbox failed to sync (1 of 1)"), { noted: true });
    return { users: 1 };
  } })];
  for (let i = 0; i < 3; i++) assert.equal((await runJob("poll", { trigger: "schedule", jobs, store, heartbeat: NO_PING })).ok, false);
  assert.equal(client.calls.length, 1, "the first failure ever is reported, the next two are not");
  assert.equal(client.calls[0].level, "error");
  assert.equal(client.calls[0].args[0].message, "every mailbox failed to sync (1 of 1)");
  assert.deepEqual(client.calls[0].args[1], { job: "poll", trigger: "schedule", title: "Job poll failing: every mailbox failed to sync (1 of 1)", fingerprint: "job-poll-failing" });
  assert.equal(store.rows.length, 3, "every failed run is still recorded");
  assert.ok(store.rows.every((r) => r.ok === false));

  failing = false;
  assert.equal((await runJob("poll", { jobs, store, heartbeat: NO_PING })).ok, true);
  assert.equal(client.calls.length, 2);
  assert.equal(client.calls[1].level, "info");
  assert.equal(client.calls[1].args[0], "Job poll recovered after 3 failed runs");
  assert.deepEqual(client.calls[1].args[1], { job: "poll", failedRuns: 3, fingerprint: "job-poll-recovered" });
  await runJob("poll", { jobs, store, heartbeat: NO_PING });
  assert.equal(client.calls.length, 2, "a success after a success says nothing");

  failing = true;
  await runJob("poll", { jobs, store, heartbeat: NO_PING });
  assert.equal(client.calls.length, 3, "the first failure after a success is reported");
  assert.equal(jobs[0].failures, 1);
});

const HEARTBEAT_URL = "https://uptime.example.test/api/v1/heartbeat/s3cr3t-token";
const recordingFetch = () => {
  const calls = [];
  const fetchImpl = async (url, init) => { calls.push({ url, init }); return { ok: true, status: 200 }; };
  return { calls, fetchImpl };
};

test("in production a job pings its heartbeat URL after a run that succeeded, <url>/fail after one that failed", async () => {
  const { calls, fetchImpl } = recordingFetch();
  let fail = false;
  const jobs = [fakeJob({ run: async () => { if (fail) throw new Error("boom"); return { users: 1 }; } })];
  const heartbeat = { urls: { poll: HEARTBEAT_URL }, enabled: true, fetchImpl };
  await runJob("poll", { jobs, store: memoryStore(), heartbeat });
  fail = true;
  await runJob("poll", { jobs, store: memoryStore(), heartbeat });
  assert.deepEqual(calls.map((c) => c.url), [HEARTBEAT_URL, `${HEARTBEAT_URL}/fail`]);
  assert.ok(calls.every((c) => c.init.method === "GET" && c.init.signal instanceof AbortSignal));
  // A URL saved with a trailing slash gets no double slash.
  await runJob("poll", { jobs, store: memoryStore(), heartbeat: { ...heartbeat, urls: { poll: `${HEARTBEAT_URL}/` } } });
  assert.equal(calls[2].url, `${HEARTBEAT_URL}/fail`);
});

test("outside production, or without a URL, nothing is pinged; one key per scheduled job, 5 s at most", async () => {
  const { calls, fetchImpl } = recordingFetch();
  const jobs = [fakeJob()];
  await runJob("poll", { jobs, store: memoryStore(), heartbeat: { urls: { poll: HEARTBEAT_URL }, enabled: false, fetchImpl } });
  await runJob("poll", { jobs, store: memoryStore(), heartbeat: { urls: { poll: "" }, enabled: true, fetchImpl } });
  await runJob("poll", { jobs, store: memoryStore(), heartbeat: { urls: {}, enabled: true, fetchImpl } });
  assert.equal(calls.length, 0);
  // The defaults: config's URLs, on only when NODE_ENV is production (test here), 5 s.
  assert.equal(heartbeats.enabled, config.production);
  assert.equal(heartbeats.enabled, false);
  assert.equal(heartbeats.urls, config.heartbeats);
  assert.equal(heartbeats.timeoutMs, 5000);
  assert.deepEqual(Object.keys(config.heartbeats), JOBS.filter(canRun).map((j) => j.id));
});

test("a hanging heartbeat does not block the run; a failing one never throws and never logs its URL", async (t) => {
  const jobs = [fakeJob()];
  const hanging = { urls: { poll: HEARTBEAT_URL }, enabled: true, fetchImpl: () => new Promise(() => {}) };
  let timer;
  const run = await Promise.race([
    runJob("poll", { jobs, store: memoryStore(), heartbeat: hanging }),
    new Promise((resolve) => { timer = setTimeout(() => resolve("blocked"), 1000); }),
  ]);
  clearTimeout(timer);
  assert.notEqual(run, "blocked");
  assert.equal(run.ok, true);

  const logged = t.mock.method(console, "error", () => {});
  const beat = { urls: { poll: HEARTBEAT_URL }, enabled: true };
  await pingHeartbeat("poll", true, { ...beat, fetchImpl: () => { throw new TypeError(`Failed to parse URL from ${HEARTBEAT_URL}`); } });
  await pingHeartbeat("poll", false, { ...beat, fetchImpl: async () => { throw new Error(`connect ECONNREFUSED ${HEARTBEAT_URL}`); } });
  await pingHeartbeat("poll", true, { ...beat, fetchImpl: async () => ({ ok: false, status: 404 }) });
  await pingHeartbeat("poll", true, { ...beat, timeoutMs: 20,
    fetchImpl: (url, { signal }) => new Promise((resolve, reject) => signal.addEventListener("abort", () => reject(signal.reason))) });
  assert.equal(pingHeartbeat("poll", true, { ...beat, enabled: false }), null);
  const lines = logged.mock.calls.map((c) => c.arguments.join(" "));
  assert.deepEqual(lines, [
    "[jobs] heartbeat of poll failed (TypeError)",
    "[jobs] heartbeat of poll failed (Error)",
    "[jobs] heartbeat of poll answered 404",
    "[jobs] heartbeat of poll failed (TimeoutError)",
  ]);
  assert.ok(lines.every((l) => !l.includes("s3cr3t")), "the URL is a secret");
});

// ---------------------------------------------------------------- line 6 ---

test("GET /api/health, without sign-in, asks Postgres SELECT 1 and answers 200 with db ok and the version", async (t) => {
  const queries = [];
  t.mock.method(pool, "query", async (text) => { queries.push(text); return { rows: [{ "?column?": 1 }], rowCount: 1 }; });
  const saved = config.appVersion;
  config.appVersion = "3f2c1ab";
  t.after(() => { config.appVersion = saved; });
  const timers = liveTimers();
  const res = await app.inject({ method: "GET", url: "/api/health" });
  assert.equal(res.statusCode, 200);
  assert.deepEqual(res.json(), { ok: true, db: "ok", version: "3f2c1ab" });
  assert.deepEqual(queries, ["SELECT 1"]);
  assert.equal(liveTimers(), timers, "the 2 s timer keeps nothing alive once Postgres answered");
});

test("GET /api/health answers 503 with db down and the version when the query fails, and that is no Rollbar item", async (t) => {
  const client = fakeTracking();
  t.mock.method(pool, "query", async () => { throw Object.assign(new Error("connect ECONNREFUSED 127.0.0.1:5432"), { code: "ECONNREFUSED" }); });
  const res = await app.inject({ method: "GET", url: "/api/health" });
  assert.equal(res.statusCode, 503);
  assert.deepEqual(res.json(), { ok: false, db: "down", version: config.appVersion });
  assert.equal(client.calls.length, 0, "the monitor reports a dead database, not Rollbar");
  assert.equal(config.appVersion, process.env.APP_VERSION || "dev");
});

test("GET /api/health answers 503 when Postgres does not answer within 2 s, and its timer keeps nothing alive", async (t) => {
  assert.equal(healthCheck.timeoutMs, 2000);
  const saved = healthCheck.timeoutMs;
  healthCheck.timeoutMs = 25;
  t.after(() => { healthCheck.timeoutMs = saved; });
  t.mock.method(pool, "query", () => new Promise(() => {}));
  const timers = liveTimers();
  const started = Date.now();
  const res = await app.inject({ method: "GET", url: "/api/health" });
  assert.equal(res.statusCode, 503);
  assert.deepEqual(res.json(), { ok: false, db: "down", version: config.appVersion });
  assert.ok(Date.now() - started < 1000, "answered at the timeout, not whenever the query gives up");
  assert.equal(liveTimers(), timers, "nothing left keeping the process alive");
});

test("GET /api/health on the real test database", { skip: !hasDb && "Postgres unreachable" }, async () => {
  const res = await app.inject({ method: "GET", url: "/api/health" });
  assert.equal(res.statusCode, 200);
  assert.equal(res.json().db, "ok");
});

// ---------------------------------------------------------------- line 7 ---

test("TRUST_PROXY: unset or false trusts no proxy, true the proxies on this machine or its private networks, anything else the proxies' addresses", () => {
  for (const off of [undefined, "", "  ", "false", "FALSE", "0"]) assert.equal(parseTrustProxy(off), false, String(off));
  for (const on of ["true", "TRUE", "1"]) assert.deepEqual(parseTrustProxy(on), ["loopback", "linklocal", "uniquelocal"], on);
  assert.deepEqual(PRIVATE_PROXIES, ["loopback", "linklocal", "uniquelocal"]);
  assert.deepEqual(parseTrustProxy(" 10.0.0.0/8, 172.16.0.0/12 "), ["10.0.0.0/8", "172.16.0.0/12"]);
  assert.deepEqual(parseTrustProxy("127.0.0.1"), ["127.0.0.1"]);
});

test("behind the tunnel the visitor's address keys the rate limits only when TRUST_PROXY says so", async () => {
  // cloudflared connects from 172.18.0.5; Cloudflare appended the visitor's address; the visitor wrote 198.51.100.99 first.
  const visits = async (trustProxy) => {
    const proxied = await buildApp({ logger: false, trustProxy });
    proxied.get("/api/test/limited", { config: { rateLimit: { max: 1, timeWindow: 60000 } } }, async (request) => ({ ip: request.ip }));
    const from = (visitor) => proxied.inject({ method: "GET", url: "/api/test/limited", remoteAddress: "172.18.0.5",
      headers: { "x-forwarded-for": `198.51.100.99, ${visitor}` } });
    const out = [];
    for (const visitor of ["203.0.113.1", "203.0.113.2", "203.0.113.1"]) {
      const res = await from(visitor);
      out.push(res.statusCode === 200 ? res.json().ip : res.statusCode);
    }
    await proxied.close();
    return out;
  };
  // Off (the default): every visitor is the tunnel, one bucket for all.
  assert.deepEqual(await visits(parseTrustProxy(undefined)), ["172.18.0.5", 429, 429]);
  // TRUST_PROXY=true, or the tunnel's network: the address Cloudflare appended, one bucket per visitor.
  assert.deepEqual(await visits(parseTrustProxy("true")), ["203.0.113.1", "203.0.113.2", 429]);
  assert.deepEqual(await visits(parseTrustProxy("172.16.0.0/12")), ["203.0.113.1", "203.0.113.2", 429]);
  // Why TRUST_PROXY=true is not Fastify's own true: that takes the leftmost entry, the one a visitor writes,
  assert.deepEqual(await visits(true), ["198.51.100.99", 429, 429]);
  // and why a hop count is no option: Fastify 5.12 then trusts nothing.
  assert.deepEqual(await visits(1), ["172.18.0.5", 429, 429]);
});
