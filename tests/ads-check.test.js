// scripts/ads-check.mjs status, the Facebook side of the ad studio in one look (_product/specs/ad-studio.md lines
// 6 and 10): the requests it plans, the keys it names and the lines it prints, all pure functions. No network:
// run() goes through a fake Graph that records every call.
// Not testable here: whether the live Graph API answers in the shapes assumed (checked the first time status runs
// with Vlad's keys stored).
import { test } from "node:test";
import assert from "node:assert/strict";
import { describe as line, keyLines, missingKeys, passed, plan, run, scrub, USAGE } from "../scripts/ads-check.mjs";

const TOKEN = "EAAGads-system-user-token-0123456789abcdef";
const PAGE_TOKEN = "EAAPageTokenFromMeAccounts0123456789abcdef";
const ENV = { META_ADS_TOKEN: TOKEN, META_AD_ACCOUNT_ID: "act_1234567890", META_ADS_PAGE_ID: "555000111" };
const V = "/v26.0";

const ok = (json) => ({ ok: true, status: 200, json });
const graphError = { ok: false, status: 400, json: { error: { message: "Invalid OAuth access token - Cannot parse access token", type: "OAuthException", code: 190 } } };
const ANSWERS = {
  token: ok({ id: "61550000000001", name: "Prudence ads" }),
  permissions: ok({ data: [
    { permission: "ads_management", status: "granted" }, { permission: "pages_manage_ads", status: "granted" },
    { permission: "pages_read_engagement", status: "granted" }, { permission: "pages_show_list", status: "granted" },
    { permission: "public_profile", status: "granted" },
  ] }),
  account: ok({
    id: "act_1234567890", name: "Hey Prudence ads", currency: "USD", account_status: 1, disable_reason: 0, funding_source: "7000000000001",
    business: { id: "4686439461680708", name: "Hey Prudence" },
  }),
  page: ok({ id: "555000111", name: "Hey Prudence" }),
  pageAccess: ok({ data: [{ id: "999", name: "Other", tasks: ["ANALYZE"] }, { id: "555000111", name: "Hey Prudence", tasks: ["ADVERTISE", "ANALYZE"], access_token: PAGE_TOKEN }] }),
  campaign: ok({ id: "120200000000000001", name: "Prudence", objective: "OUTCOME_TRAFFIC", status: "ACTIVE", effective_status: "ACTIVE" }),
};

test("status plans the token, its permissions, the ad account, the Page and the token's Pages, plus the stored campaign when one is named; no token in any request", () => {
  const reqs = plan("status", { ...ENV, META_ADS_CAMPAIGN_ID: "120200000000000001" });
  assert.deepEqual(reqs, [
    { label: "token", step: "token", method: "GET", path: `${V}/me`, query: { fields: "id,name" } },
    { label: "token permissions", step: "permissions", method: "GET", path: `${V}/me/permissions` },
    { label: "ad account", step: "account", method: "GET", path: `${V}/act_1234567890`, query: { fields: "name,currency,account_status,disable_reason,funding_source,business" } },
    { label: "Page", step: "page", method: "GET", path: `${V}/555000111`, query: { fields: "id,name" } },
    { label: "Page access", step: "pageAccess", method: "GET", path: `${V}/me/accounts`, query: { fields: "id,name,tasks", limit: "100" } },
    { label: "stored campaign", step: "campaign", method: "GET", path: `${V}/120200000000000001`, query: { fields: "name,objective,status,effective_status" } },
  ]);
  assert.ok(!JSON.stringify(reqs).includes(TOKEN));
  assert.deepEqual(plan("status", ENV).map((r) => r.step), ["token", "permissions", "account", "page", "pageAccess"]);
  // Only the checks whose keys are there; the account id as digits alone; MESSENGER_PAGE_ID as the Page's fallback.
  assert.deepEqual(plan("status", { META_ADS_TOKEN: TOKEN }).map((r) => r.step), ["token", "permissions"]);
  assert.deepEqual(plan("status", { META_ADS_TOKEN: TOKEN, META_AD_ACCOUNT_ID: "1234567890", MESSENGER_PAGE_ID: "777", META_ADS_GRAPH_VERSION: "v27.0" }).map((r) => r.path),
    ["/v27.0/me", "/v27.0/me/permissions", "/v27.0/act_1234567890", "/v27.0/777", "/v27.0/me/accounts"]);
  assert.deepEqual(plan("status", { ...ENV, META_ADS_CAMPAIGN_ID: "abc" }).map((r) => r.step), ["token", "permissions", "account", "page", "pageAccess"]);
  assert.deepEqual(plan("status", {}), []);
  assert.deepEqual(plan("publish", ENV), []);
});

test("missingKeys names what publishing needs and the environment lacks or cannot use", () => {
  assert.deepEqual(missingKeys({}), ["META_ADS_TOKEN", "META_AD_ACCOUNT_ID", "META_ADS_PAGE_ID"]);
  assert.deepEqual(missingKeys({ ...ENV, META_AD_ACCOUNT_ID: "my-account" }), ["META_AD_ACCOUNT_ID"]);
  assert.deepEqual(missingKeys(ENV), []);
});

test("the key lines name each key set or missing, the Graph version and the spend the button will carry, never a value", () => {
  assert.deepEqual(keyLines(ENV), [
    "META_ADS_TOKEN: set", "META_AD_ACCOUNT_ID: set", "META_ADS_PAGE_ID: set",
    "META_ADS_CAMPAIGN_ID: not set (optional: the console keeps the campaign it makes)", "META_ADS_GRAPH_VERSION: v26.0 (default)",
    "settings: $5 a day · 7 days until the account's currency is read, countries US, ages 35 to 64, Facebook feed, ads start ACTIVE",
  ]);
  assert.deepEqual(keyLines({ META_AD_ACCOUNT_ID: "x", MESSENGER_PAGE_ID: "777", META_ADS_CAMPAIGN_ID: "12", META_ADS_GRAPH_VERSION: "v27.0", ADS_LAUNCH_STATUS: "PAUSED" }).slice(0, 5), [
    "META_ADS_TOKEN: missing", "META_AD_ACCOUNT_ID: set, but not act_<digits>", "META_ADS_PAGE_ID: set through MESSENGER_PAGE_ID",
    "META_ADS_CAMPAIGN_ID: set", "META_ADS_GRAPH_VERSION: v27.0",
  ]);
  assert.deepEqual(keyLines({ META_ADS_PAGE_ID: "hey", META_ADS_CAMPAIGN_ID: "x", META_ADS_GRAPH_VERSION: "latest" }).slice(1, 5), [
    "META_AD_ACCOUNT_ID: missing", "META_ADS_PAGE_ID: set, but not the Page's number", "META_ADS_CAMPAIGN_ID: set, but not a number",
    "META_ADS_GRAPH_VERSION: v26.0 (default)",
  ]);
  assert.equal(keyLines({}).at(2), "META_ADS_PAGE_ID: missing");
  assert.ok(!keyLines(ENV).join("\n").includes(TOKEN));
  assert.ok(!keyLines(ENV).join("\n").includes("1234567890"));
});

test("a ready setup reads as one line per check: who the token is, its permissions, the account with its currency and card, the Page and the right to advertise for it", () => {
  const env = { ...ENV, META_ADS_CAMPAIGN_ID: "120200000000000001" };
  const lines = Object.entries(ANSWERS).map(([step, r]) => line(step, r, env));
  assert.deepEqual(lines, [
    'token: works, it acts as "Prudence ads" (61550000000001)',
    "token permissions: ads_management, pages_manage_ads, pages_read_engagement, pages_show_list granted",
    'ad account: "Hey Prudence ads" (act_1234567890), currency USD, the button reads "$5 a day · 7 days" (daily_budget 500), status active, payment method set, in the business portfolio "Hey Prudence" (4686439461680708)',
    'Page: "Hey Prudence" (555000111)',
    'Page access: the token can create ads for "Hey Prudence" (tasks ADVERTISE, ANALYZE)',
    'stored campaign: "Prudence" (120200000000000001), objective OUTCOME_TRAFFIC, status ACTIVE, delivery ACTIVE',
  ]);
  for (const [step, r] of Object.entries(ANSWERS)) assert.equal(passed(step, r, env), true, step);
  assert.ok(!lines.join("\n").includes(PAGE_TOKEN));
});

test("what stops a publish is a failed line: a missing permission, a disabled account, no card, a Page the token cannot advertise for, a deleted campaign", () => {
  const perms = ok({ data: [{ permission: "ads_management", status: "granted" }, { permission: "pages_manage_ads", status: "declined" }] });
  assert.equal(passed("permissions", perms), false);
  assert.equal(line("permissions", perms), "token permissions: missing pages_manage_ads, pages_read_engagement, pages_show_list (granted: ads_management): generate a new system-user token with them ticked");
  assert.match(line("permissions", ok({ data: [] })), /^token permissions: missing ads_management, pages_manage_ads, pages_read_engagement, pages_show_list: generate/);

  const disabled = ok({ id: "act_1", name: "", currency: "EUR", account_status: 2, disable_reason: 3 });
  assert.equal(passed("account", disabled, ENV), false);
  assert.equal(line("account", disabled, ENV),
    'ad account: (no name) (act_1), currency EUR, the button reads "€5 a day · 7 days" (daily_budget 500), status disabled, disabled for payment risk, no payment method reported: ads are created but never shown until a card is added (Billing and payments), not in a business portfolio');
  const yen = ok({ name: "Yen", currency: "JPY", account_status: 1, funding_source: "1", disable_reason: 99 });
  assert.match(line("account", yen, { ...ENV, ADS_DAILY_BUDGET: "700" }), /\(act_1234567890\), currency JPY, the button reads "¥700 a day · 7 days" \(daily_budget 700\), status active, disabled for reason 99/);
  assert.equal(passed("account", ok({ name: "x", account_status: 1, funding_source: "1" }), ENV), false);
  assert.match(line("account", ok({ name: "x", account_status: 1, funding_source: "1" }), ENV), /no currency named/);
  assert.match(line("account", ok({ name: "x", currency: "USD" }), ENV), /status unknown \(none\)/);

  const notListed = ok({ data: [{ id: "999", name: "Other", tasks: ["ADVERTISE"] }] });
  assert.equal(passed("pageAccess", notListed, ENV), false);
  assert.equal(line("pageAccess", notListed, ENV), "Page access: the Page 555000111 is not among the token's Pages: assign it to the system user with the right to create ads");
  const analyst = ok({ data: [{ id: "555000111", name: "Hey Prudence", tasks: ["ANALYZE"] }] });
  assert.equal(passed("pageAccess", analyst, ENV), false);
  assert.match(line("pageAccess", analyst, ENV), /tasks on "Hey Prudence" \(ANALYZE\) do not include ADVERTISE/);
  assert.match(line("pageAccess", ok({ data: [{ id: "555000111" }] }), ENV), /\(none\) do not include ADVERTISE/);
  assert.equal(passed("pageAccess", ok({ data: [{ id: "555000111", tasks: ["MANAGE"] }] }), ENV), true);

  const deleted = ok({ id: "1", name: "Prudence", objective: "OUTCOME_TRAFFIC", status: "DELETED", effective_status: "DELETED" });
  assert.equal(passed("campaign", deleted), false);
  assert.match(line("campaign", deleted), /it is gone, the next publish needs a new one$/);
  const sales = ok({ id: "1", name: "Old", objective: "OUTCOME_SALES", status: "ACTIVE" });
  assert.equal(passed("campaign", sales), false);
  assert.match(line("campaign", sales), /delivery \?: not a traffic campaign \(OUTCOME_TRAFFIC\)$/);
  assert.match(line("campaign", ok({}), { META_ADS_CAMPAIGN_ID: "42" }), /^stored campaign: \(no name\) \(42\), objective \?/);

  for (const step of ["token", "permissions", "account", "page", "pageAccess", "campaign"]) {
    assert.equal(passed(step, graphError, ENV), false);
    assert.match(line(step, graphError, ENV), /: FAILED: Invalid OAuth access token - Cannot parse access token \(code 190\)$/);
  }
  assert.equal(line("token", { ok: false, status: 400, json: { error: { error_user_msg: "Ask an admin", message: "x", code: 10, error_subcode: 2 } } }), "token: FAILED: Ask an admin (code 10, subcode 2)");
  assert.equal(line("token", { ok: false, status: 400, json: { error: {} } }), "token: FAILED: no message (code ?)");
  assert.equal(line("page", { ok: false, status: 502, json: {} }), "Page: FAILED: HTTP 502");
  assert.equal(line("page", { ok: false, status: 0, json: {}, error: "no answer in 20 s" }), "Page: FAILED: no answer in 20 s");
  assert.equal(line("other", ok({})), "other: ok");
});

test("scrub removes our token, any Page token Graph might echo, and URL queries", () => {
  assert.equal(scrub(`a ${TOKEN} b ${PAGE_TOKEN} c https://graph.facebook.com/v26.0/me?access_token=zz`, ENV), "a [redacted] b [redacted] c https://graph.facebook.com/v26.0/me");
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
  [`GET ${V}/me`]: [200, ANSWERS.token.json],
  [`GET ${V}/me/permissions`]: [200, ANSWERS.permissions.json],
  [`GET ${V}/act_1234567890`]: [200, ANSWERS.account.json],
  [`GET ${V}/555000111`]: [200, ANSWERS.page.json],
  [`GET ${V}/me/accounts`]: [200, ANSWERS.pageAccess.json],
  [`GET ${V}/120200000000000001`]: [200, ANSWERS.campaign.json],
};

test("run sends only GETs with the token in the Authorization header, follows no redirect, prints no token and exits 0 when ready", async () => {
  const g = fakeGraph(GOOD);
  const lines = [];
  assert.equal(await run(["status"], { env: { ...ENV, META_ADS_CAMPAIGN_ID: "120200000000000001" }, fetchImpl: g.fetchImpl, out: (l) => lines.push(l) }), 0);
  assert.equal(g.calls.length, 6);
  for (const c of g.calls) {
    assert.equal(c.method, "GET");
    assert.equal(c.body, undefined);
    assert.equal(c.headers.authorization, `Bearer ${TOKEN}`);
    assert.equal(c.url.searchParams.get("access_token"), null);
    assert.equal(c.url.origin, "https://graph.facebook.com");
    assert.equal(c.redirect, "error");
  }
  assert.equal(lines.at(-1), "ready: the console can publish on Facebook");
  assert.ok(lines.includes('Page access: the token can create ads for "Hey Prudence" (tasks ADVERTISE, ANALYZE)'));
  for (const s of [TOKEN, PAGE_TOKEN]) assert.ok(!lines.join("\n").includes(s));
});

test("run exits 1 on a failed check (path printed, an echoed token scrubbed) and on missing keys without calling Meta; usage exits 0, an unknown command 2", async () => {
  const leaky = fakeGraph({ ...GOOD, [`GET ${V}/me/permissions`]: [400, { error: { message: `bad token ${TOKEN}`, code: 190 } }] });
  const lines = [];
  assert.equal(await run(["status"], { env: ENV, fetchImpl: leaky.fetchImpl, out: (l) => lines.push(l) }), 1);
  assert.ok(lines.includes(`token permissions: FAILED: bad token [redacted] (code 190)  [GET ${V}/me/permissions]`));
  assert.equal(lines.at(-1), "1 problem to fix before publishing");

  const none = fakeGraph(GOOD);
  const out = [];
  assert.equal(await run(["status"], { env: { META_ADS_TOKEN: TOKEN }, fetchImpl: none.fetchImpl, out: (l) => out.push(l) }), 1);
  assert.deepEqual(none.calls.map((c) => c.url.pathname), [`${V}/me`, `${V}/me/permissions`]);
  assert.ok(out.includes("missing: META_AD_ACCOUNT_ID, META_ADS_PAGE_ID; the checks that need them are skipped (make secrets-set NAME=value; _product/docs/secrets.md, the ad studio keys)"));
  assert.equal(out.at(-1), "2 problems to fix before publishing");
  const empty = fakeGraph(GOOD);
  assert.equal(await run(["status"], { env: {}, fetchImpl: empty.fetchImpl, out: () => {} }), 1);
  assert.equal(empty.calls.length, 0);

  const timeout = async (url) => { throw Object.assign(new Error(`timed out at ${url}`), { name: "TimeoutError" }); };
  const t = [];
  assert.equal(await run(["status"], { env: { META_ADS_TOKEN: TOKEN }, fetchImpl: timeout, out: (l) => t.push(l) }), 1);
  assert.ok(t.includes(`token: FAILED: no answer in 20 s  [GET ${V}/me]`));
  const refused = async () => { throw Object.assign(new TypeError("fetch failed"), { cause: { code: "ECONNREFUSED" } }); };
  const r = [];
  await run(["status"], { env: { META_ADS_TOKEN: TOKEN }, fetchImpl: refused, out: (l) => r.push(l) });
  assert.ok(r.includes(`token: FAILED: network error (ECONNREFUSED)  [GET ${V}/me]`));

  const usage = [];
  assert.equal(await run([], { env: ENV, out: (l) => usage.push(l) }), 0);
  assert.equal(usage[0], USAGE);
  assert.match(USAGE, /^usage: node --import \.\/lib\/credentials\.js scripts\/ads-check\.mjs status/);
  assert.equal(await run(["--help"], { env: ENV, out: () => {} }), 0);
  const unknown = [];
  assert.equal(await run(["publish"], { env: ENV, out: (l) => unknown.push(l) }), 2);
  assert.match(unknown[0], /^unknown command: publish/);
});
