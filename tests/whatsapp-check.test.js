// scripts/whatsapp-check.mjs, the Graph API side of the WhatsApp setup (docs/WHATSAPP_SETUP.md, Part 2): the
// requests it plans, the keys it asks for and the lines it prints, all pure functions. No network and no
// database: run() goes through a fake fetch that records every call.
// Not testable here: whether the live Graph API answers in the shapes assumed (checked the first time status
// runs with the token stored).
import { test } from "node:test";
import assert from "node:assert/strict";
import { describe as line, keyLines, missingKeys, passed, plan, run, scrub, usageError } from "../scripts/whatsapp-check.mjs";

const TOKEN = "EAAtest-bearer-token-0123456789";
const SECRET = "app-secret-abcdef0123456789";
const VERIFY = "verify-token-xyz987654";
const ENV = {
  WHATSAPP_ACCESS_TOKEN: TOKEN, WHATSAPP_PHONE_NUMBER_ID: "PHONE_ID", WHATSAPP_BUSINESS_ACCOUNT_ID: "WABA_ID", WHATSAPP_APP_SECRET: SECRET,
  WHATSAPP_VERIFY_TOKEN: VERIFY, WHATSAPP_PHONE_NUMBER: "15550001111", WHATSAPP_GRAPH_VERSION: "v25.0", META_APP_ID: "APP_ID",
};
const SECRETS = [TOKEN, SECRET, VERIFY, `APP_ID|${SECRET}`];
const CALLBACK = "https://tunnel.example/api/whatsapp/webhook";

// Graph answers as the script parses them, success and failure, one per label.
const ok = (json) => ({ ok: true, status: 200, json });
const graphError = { ok: false, status: 400, json: { error: { message: "Invalid OAuth access token - Cannot parse access token", type: "OAuthException", code: 190 } } };
const SAMPLES = [
  ["phone number", ok({ display_phone_number: "+1 555-000-1111", verified_name: "Test Number", quality_rating: "GREEN", platform_type: "CLOUD_API", id: "PHONE_ID" })],
  ["apps on the business account", ok({ data: [{ whatsapp_business_api_data: { name: "Hey Prudence", id: "APP_ID", link: "https://www.facebook.com/games/?app_id=APP_ID" } }] })],
  ["apps on the business account", ok({ data: [] })],
  ["app webhook", ok({ data: [{ object: "whatsapp_business_account", callback_url: CALLBACK, active: true, fields: [{ name: "messages", version: "v25.0" }] }] })],
  ["app webhook", ok({ data: [{ object: "page", callback_url: CALLBACK, active: true, fields: ["messages"] }] })],
  ["subscribe the business account", ok({ success: true })],
  ["set the app webhook", ok({ success: true })],
  ["hello_world", ok({ messaging_product: "whatsapp", contacts: [{ input: "15550002222", wa_id: "15550002222" }], messages: [{ id: "wamid.HBgL", message_status: "accepted" }] })],
  ...["phone number", "apps on the business account", "app webhook", "subscribe the business account", "set the app webhook", "hello_world"].map((l) => [l, graphError]),
  ["hello_world", { ok: false, status: 0, json: {}, error: "no answer in 20 s" }],
];

test("status plans the number, the business account's apps (bearer) and the app's webhook (app token), with no token in any request", () => {
  const reqs = plan("status", [], ENV);
  assert.deepEqual(reqs, [
    { label: "phone number", method: "GET", path: "/v25.0/PHONE_ID", auth: "bearer", query: { fields: "display_phone_number,verified_name,quality_rating,platform_type" } },
    { label: "apps on the business account", method: "GET", path: "/v25.0/WABA_ID/subscribed_apps", auth: "bearer" },
    { label: "app webhook", method: "GET", path: "/v25.0/APP_ID/subscriptions", auth: "app" },
  ]);
  for (const s of SECRETS) assert.ok(!JSON.stringify(reqs).includes(s));
  // Only the checks whose keys are there: the app's webhook alone, then nothing.
  assert.deepEqual(plan("status", [], { META_APP_ID: "APP_ID", WHATSAPP_APP_SECRET: SECRET }).map((r) => r.label), ["app webhook"]);
  assert.deepEqual(plan("status", [], {}), []);
  // The channel's default version when none is stored.
  assert.equal(plan("status", [], { ...ENV, WHATSAPP_GRAPH_VERSION: "" })[0].path, "/v22.0/PHONE_ID");
});

test("subscribe subscribes the business account, and with a URL also sets the app's webhook with the verify token and the messages field", () => {
  const one = plan("subscribe", [], ENV);
  assert.deepEqual(one, [{ label: "subscribe the business account", method: "POST", path: "/v25.0/WABA_ID/subscribed_apps", auth: "bearer" }]);
  const two = plan("subscribe", [CALLBACK], ENV);
  assert.equal(two.length, 2);
  assert.deepEqual(two[0], one[0]);
  assert.deepEqual(two[1], {
    label: "set the app webhook", method: "POST", path: "/v25.0/APP_ID/subscriptions", auth: "app",
    form: { object: "whatsapp_business_account", callback_url: CALLBACK, verify_token: VERIFY, fields: "messages" },
  });
  assert.equal(two[1].query, undefined);
});

test("hello sends the hello_world template to the digits given, punctuation stripped", () => {
  assert.deepEqual(plan("hello", ["+1 (555) 000-2222"], ENV), [{
    label: "hello_world", method: "POST", path: "/v25.0/PHONE_ID/messages", auth: "bearer",
    body: { messaging_product: "whatsapp", to: "15550002222", type: "template", template: { name: "hello_world", language: { code: "en_US" } } },
  }]);
  assert.deepEqual(plan("nope", [], ENV), []);
});

test("missingKeys names what each command needs and lacks; blank counts as missing", () => {
  assert.deepEqual(missingKeys("status", {}), ["WHATSAPP_ACCESS_TOKEN", "WHATSAPP_PHONE_NUMBER_ID", "WHATSAPP_BUSINESS_ACCOUNT_ID", "META_APP_ID", "WHATSAPP_APP_SECRET"]);
  assert.deepEqual(missingKeys("subscribe", {}), ["WHATSAPP_ACCESS_TOKEN", "WHATSAPP_BUSINESS_ACCOUNT_ID"]);
  assert.deepEqual(missingKeys("subscribe", {}, [CALLBACK]), ["WHATSAPP_ACCESS_TOKEN", "WHATSAPP_BUSINESS_ACCOUNT_ID", "META_APP_ID", "WHATSAPP_APP_SECRET", "WHATSAPP_VERIFY_TOKEN"]);
  assert.deepEqual(missingKeys("hello", { ...ENV, WHATSAPP_ACCESS_TOKEN: "  " }), ["WHATSAPP_ACCESS_TOKEN"]);
  for (const c of ["status", "subscribe", "hello"]) assert.deepEqual(missingKeys(c, ENV, [CALLBACK]), []);
});

test("usageError refuses a hello without a number and a callback URL that is not https", () => {
  assert.match(usageError("hello", []), /^hello needs the recipient's number/);
  assert.match(usageError("hello", ["12ab"]), /^hello needs/);
  assert.equal(usageError("hello", ["+33 6 12 34 56 78"]), "");
  assert.match(usageError("subscribe", ["http://tunnel.example/api/whatsapp/webhook"]), /must start with https:\/\//);
  assert.equal(usageError("subscribe", []), "");
  assert.equal(usageError("subscribe", [CALLBACK]), "");
});

test("describe prints the fields of a success and Graph's message and code for an error; passed says which failed", () => {
  const [number, apps, noApps, webhook, otherObject, subscribed, set, hello] = SAMPLES.map(([l, r]) => [line(l, r), passed(l, r)]);
  assert.deepEqual(number, ['phone number: +1 555-000-1111, verified name "Test Number", quality GREEN, platform CLOUD_API', true]);
  assert.deepEqual(apps, ["apps on the business account: Hey Prudence (APP_ID)", true]);
  assert.equal(line("apps on the business account", ok({ data: [{ name: "Old Shape", id: "9" }] })), "apps on the business account: Old Shape (9)");
  assert.equal(noApps[1], false);
  assert.match(noApps[0], /none: .*subscribe/);
  assert.deepEqual(webhook, [`app webhook: callback ${CALLBACK}, active true, fields messages`, true]);
  assert.equal(otherObject[1], false);
  assert.match(otherObject[0], /no whatsapp_business_account subscription/);
  const inactive = ok({ data: [{ object: "whatsapp_business_account", callback_url: CALLBACK, active: false, fields: [] }] });
  assert.equal(passed("app webhook", inactive), false);
  assert.match(line("app webhook", inactive), /active false, fields none: deliveries need it active/);
  assert.deepEqual(subscribed, ["subscribe the business account: done", true]);
  assert.deepEqual(set, ["set the app webhook: done", true]);
  assert.equal(passed("set the app webhook", ok({})), false);
  assert.deepEqual(hello, ["hello_world: sent, message id wamid.HBgL (accepted)", true]);

  assert.equal(line("phone number", graphError), "phone number: FAILED: Invalid OAuth access token - Cannot parse access token (code 190)");
  assert.equal(passed("phone number", graphError), false);
  assert.match(line("set the app webhook", graphError), /\(code 190\); Meta calls the callback URL .* the server must be up and reachable/);
  assert.match(line("hello_world", graphError), /allowlist/);
  assert.equal(line("hello_world", { ok: false, status: 0, json: {}, error: "no answer in 20 s" }), "hello_world: FAILED: no answer in 20 s; the phone must be on the test number's allowlist (docs/WHATSAPP_SETUP.md, Part 1 step 3)");
  assert.equal(line("phone number", { ok: false, status: 502, json: {} }), "phone number: FAILED: HTTP 502");
});

test("no printed line carries a secret: describe on every sample, the key lines, and scrub", () => {
  const printed = [...SAMPLES.map(([l, r]) => line(l, r)), ...keyLines(ENV)].join("\n");
  for (const s of SECRETS) assert.ok(!printed.includes(s), `a line carries ${s.slice(0, 6)}...`);
  assert.deepEqual(keyLines(ENV).slice(0, 2), ["WHATSAPP_ACCESS_TOKEN: set", "WHATSAPP_PHONE_NUMBER_ID: set"]);
  assert.equal(keyLines(ENV).at(-1), "WHATSAPP_GRAPH_VERSION: v25.0");
  assert.equal(keyLines({}).at(-1), "WHATSAPP_GRAPH_VERSION: v22.0 (default)");
  assert.ok(keyLines({}).includes("META_APP_ID: missing"));
  assert.equal(scrub(`a ${TOKEN} b APP_ID|${SECRET} c ${VERIFY}`, ENV), "a [redacted] b APP_ID|[redacted] c [redacted]");
});

// A Graph API that answers each path as configured and records what it was sent.
function fakeGraph(answers = {}) {
  const calls = [];
  const fetchImpl = async (url, init) => {
    const u = new URL(url);
    calls.push({ url: u, method: init.method, headers: init.headers, body: init.body, redirect: init.redirect });
    const [status, json] = answers[`${init.method} ${u.pathname}`] || [404, { error: { message: "unknown path", code: 803 } }];
    return Response.json(json, { status });
  };
  return { calls, fetchImpl };
}
const GOOD = {
  "GET /v25.0/PHONE_ID": [200, SAMPLES[0][1].json],
  "GET /v25.0/WABA_ID/subscribed_apps": [200, SAMPLES[1][1].json],
  "GET /v25.0/APP_ID/subscriptions": [200, SAMPLES[3][1].json],
  "POST /v25.0/WABA_ID/subscribed_apps": [200, { success: true }],
  "POST /v25.0/APP_ID/subscriptions": [200, { success: true }],
  "POST /v25.0/PHONE_ID/messages": [200, SAMPLES[7][1].json],
};

test("run sends the bearer token only in the header and the app token only in the query, follows no redirect, and prints no secret", async () => {
  const { calls, fetchImpl } = fakeGraph(GOOD);
  const lines = [];
  assert.equal(await run(["status"], { env: ENV, fetchImpl, out: (l) => lines.push(l) }), 0);
  assert.equal(calls.length, 3);
  assert.equal(calls[0].headers.authorization, `Bearer ${TOKEN}`);
  assert.equal(calls[0].url.searchParams.get("access_token"), null);
  assert.equal(calls[2].headers.authorization, undefined);
  assert.equal(calls[2].url.searchParams.get("access_token"), `APP_ID|${SECRET}`);
  assert.ok(calls.every((c) => c.url.origin === "https://graph.facebook.com" && c.redirect === "error"));
  assert.ok(lines.includes("app webhook: callback https://tunnel.example/api/whatsapp/webhook, active true, fields messages"));

  const sub = fakeGraph(GOOD);
  assert.equal(await run(["subscribe", CALLBACK], { env: ENV, fetchImpl: sub.fetchImpl, out: (l) => lines.push(l) }), 0);
  assert.deepEqual(Object.fromEntries(sub.calls[1].body), { object: "whatsapp_business_account", callback_url: CALLBACK, verify_token: VERIFY, fields: "messages" });
  const hi = fakeGraph(GOOD);
  assert.equal(await run(["hello", "15550002222"], { env: ENV, fetchImpl: hi.fetchImpl, out: (l) => lines.push(l) }), 0);
  assert.equal(JSON.parse(hi.calls[0].body).to, "15550002222");
  assert.ok(lines.includes("hello_world: sent, message id wamid.HBgL (accepted)"));
  for (const s of SECRETS) assert.ok(!lines.join("\n").includes(s));
});

test("run exits 1 on a failed check (path printed, an echoed secret scrubbed), on missing keys without calling Meta; usage exits 0, bad input 2", async () => {
  const leaky = fakeGraph({ ...GOOD, "GET /v25.0/APP_ID/subscriptions": [400, { error: { message: `bad token APP_ID|${SECRET}`, code: 190 } }] });
  const lines = [];
  assert.equal(await run(["status"], { env: ENV, fetchImpl: leaky.fetchImpl, out: (l) => lines.push(l) }), 1);
  assert.ok(lines.includes("app webhook: FAILED: bad token APP_ID|[redacted] (code 190)  [GET /v25.0/APP_ID/subscriptions]"));

  const none = fakeGraph(GOOD);
  const out = [];
  assert.equal(await run(["hello", "15550002222"], { env: {}, fetchImpl: none.fetchImpl, out: (l) => out.push(l) }), 1);
  assert.equal(none.calls.length, 0);
  assert.match(out[0], /^missing: WHATSAPP_ACCESS_TOKEN, WHATSAPP_PHONE_NUMBER_ID/);
  assert.equal(await run(["status"], { env: {}, fetchImpl: none.fetchImpl, out: (l) => out.push(l) }), 1);
  assert.equal(none.calls.length, 0);
  assert.ok(out.some((l) => l.startsWith("skipped: the checks that need WHATSAPP_ACCESS_TOKEN")));

  const timeout = async () => { throw Object.assign(new Error(`timed out at ${CALLBACK}?access_token=APP_ID|${SECRET}`), { name: "TimeoutError" }); };
  const t = [];
  assert.equal(await run(["subscribe"], { env: ENV, fetchImpl: timeout, out: (l) => t.push(l) }), 1);
  assert.deepEqual(t, ["subscribe the business account: FAILED: no answer in 20 s  [POST /v25.0/WABA_ID/subscribed_apps]"]);

  const usage = [];
  assert.equal(await run([], { env: ENV, out: (l) => usage.push(l) }), 0);
  assert.match(usage[0], /^usage: node --import \.\/lib\/credentials\.js scripts\/whatsapp-check\.mjs <command>/);
  assert.equal(await run(["--help"], { env: ENV, out: () => {} }), 0);
  assert.equal(await run(["nope"], { env: ENV, out: () => {} }), 2);
  assert.equal(await run(["hello"], { env: ENV, out: () => {} }), 2);
  assert.equal(await run(["subscribe", "http://x.example"], { env: ENV, out: () => {} }), 2);
});
