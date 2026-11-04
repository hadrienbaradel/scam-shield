// lib/ads/networks/: the Facebook ad network of the ad studio (_product/specs/ad-studio.md lines 6, 9 and 10;
// contract C3 in docs/plans/2026-11-04-ad-studio.md). Every Marketing API call goes through a fake Graph that
// records it, so the order, the forms, the budget and the cleanup are checked with no network.
// Not testable here: whether the live Marketing API takes these exact forms (checked at the first real publish,
// scripts/ads-check.mjs status first).
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { getNetwork, networkNames } from "../lib/ads/networks/index.js";
import {
  AdNetworkError, DEFAULT_GRAPH_VERSION, adSettings, budgetLabel, createFacebookNetwork, currencyOffset, facebook, facebookConfig,
  graphMessage, imageHashFrom, missingKeys, reviewReasons, reviewState, scrubText,
} from "../lib/ads/networks/facebook.js";

const TOKEN = "EAAGads-system-user-token-0123456789abcdef";
const ENV = { META_ADS_TOKEN: TOKEN, META_AD_ACCOUNT_ID: "act_1234567890", META_ADS_PAGE_ID: "555000111" };
const NOW = Date.UTC(2026, 10, 4, 18, 0, 0);
const PHOTO = { bytes: Buffer.from([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3, 0xff, 0xd9]), mime: "image/jpeg" };
const WORDS = {
  headline: "Is that email really from her bank?", primary_text: "Prudence reads your mother's mail with her and says, in plain words, what is a scam.",
  description: "Free early access", cta: "SIGN_UP", photo_brief: "a mother and her son at a kitchen table",
  landing: { headline: "h", lead: "l" },
};
const LINK = "https://heyprudence.com/a/abcd1234";
const net = (env = ENV) => createFacebookNetwork({ env, now: () => NOW });

// A Graph API that answers "<METHOD> <path>" from a table (a function gets the call), records every call with its
// form fields decoded, and answers 404 to anything else.
function fakeGraph(answers = {}) {
  const calls = [];
  const fetchImpl = async (url, init = {}) => {
    const u = new URL(url);
    const form = init.body ? Object.fromEntries(init.body) : null;
    const call = { method: init.method, url: u, path: u.pathname, headers: init.headers, form, redirect: init.redirect, signal: init.signal };
    calls.push(call);
    const a = answers[`${init.method} ${u.pathname}`];
    const [status, json] = typeof a === "function" ? a(call) : a || [404, { error: { message: "Unknown path components", code: 2500 } }];
    return Response.json(json, { status });
  };
  return { calls, fetchImpl };
}
const json = (s) => JSON.parse(s);
const V = `/${DEFAULT_GRAPH_VERSION}`;
const ACT = `${V}/act_1234567890`;
const GOOD = {
  [`GET ${ACT}`]: [200, { name: "Hey Prudence ads", currency: "USD", account_status: 1, id: "act_1234567890" }],
  [`POST ${ACT}/adimages`]: [200, { images: { bytes: { hash: "imghash123", url: "https://scontent.example/x.jpg" } } }],
  [`POST ${ACT}/campaigns`]: [200, { id: "120200000000000001" }],
  [`POST ${ACT}/adsets`]: [200, { id: "120200000000000002" }],
  [`POST ${ACT}/adcreatives`]: [200, { id: "120200000000000003" }],
  [`POST ${ACT}/ads`]: [200, { id: "120200000000000004" }],
  [`DELETE ${V}/120200000000000002`]: [200, { success: true }],
  [`DELETE ${V}/120200000000000003`]: [200, { success: true }],
};
const publishArgs = (extra = {}) => ({ name: "Prudence ad abcd1234 v1", words: WORDS, photo: PHOTO, link: LINK, ...extra });
const route = (calls) => calls.map((c) => `${c.method} ${c.path}`);

test("Approve and publish creates the photo, the one Prudence campaign, the ad set, the creative and the ad, in that order", async () => {
  const g = fakeGraph(GOOD);
  const out = await net().publish({ ...publishArgs(), fetchImpl: g.fetchImpl });
  assert.deepEqual(route(g.calls), [
    `GET ${ACT}`, `POST ${ACT}/adimages`, `POST ${ACT}/campaigns`, `POST ${ACT}/adsets`, `POST ${ACT}/adcreatives`, `POST ${ACT}/ads`,
  ]);
  assert.equal(g.calls[0].url.searchParams.get("fields"), "name,currency,account_status");
  assert.equal(g.calls[1].form.bytes, PHOTO.bytes.toString("base64"));
  assert.deepEqual(g.calls[2].form, {
    name: "Prudence", objective: "OUTCOME_TRAFFIC", status: "ACTIVE", buying_type: "AUCTION", special_ad_categories: "[]",
    is_adset_budget_sharing_enabled: "false",
  });
  const adset = g.calls[3].form;
  assert.deepEqual({ ...adset, targeting: json(adset.targeting) }, {
    name: "Prudence ad abcd1234 v1", campaign_id: "120200000000000001", daily_budget: "500", billing_event: "IMPRESSIONS",
    optimization_goal: "LINK_CLICKS", bid_strategy: "LOWEST_COST_WITHOUT_CAP", start_time: String(NOW / 1000),
    end_time: String(NOW / 1000 + 7 * 86400), status: "ACTIVE",
    targeting: {
      geo_locations: { countries: ["US"] }, age_min: 35, age_max: 64, publisher_platforms: ["facebook"], facebook_positions: ["feed"],
      targeting_automation: { advantage_audience: 0 },
    },
  });
  assert.equal(g.calls[4].form.name, "Prudence ad abcd1234 v1");
  assert.deepEqual(json(g.calls[4].form.object_story_spec), {
    page_id: "555000111",
    link_data: {
      link: LINK, message: WORDS.primary_text, name: WORDS.headline, description: "Free early access", image_hash: "imghash123",
      call_to_action: { type: "SIGN_UP", value: { link: LINK } },
    },
  });
  assert.deepEqual({ ...g.calls[5].form, creative: json(g.calls[5].form.creative) }, {
    name: "Prudence ad abcd1234 v1", adset_id: "120200000000000002", creative: { creative_id: "120200000000000003" }, status: "ACTIVE",
  });
  assert.deepEqual(out, {
    campaignId: "120200000000000001", campaignCreated: true, adsetId: "120200000000000002", creativeId: "120200000000000003",
    adId: "120200000000000004", imageHash: "imghash123", status: "ACTIVE",
    adsManagerUrl: "https://adsmanager.facebook.com/adsmanager/manage/ads?act=1234567890&selected_ad_ids=120200000000000004",
    budget: { daily: 5, currency: "USD", days: 7, endsAt: "2026-11-11T18:00:00.000Z" },
  });
});

test("the Prudence campaign is created once: a stored campaign is reused and no campaign call goes out", async () => {
  const g = fakeGraph(GOOD);
  const out = await net().publish({ ...publishArgs({ campaignId: "120200000000000001" }), fetchImpl: g.fetchImpl });
  assert.ok(!route(g.calls).includes(`POST ${ACT}/campaigns`));
  assert.equal(g.calls.find((c) => c.path === `${ACT}/adsets`).form.campaign_id, "120200000000000001");
  assert.equal(out.campaignCreated, false);
  assert.equal(out.campaignId, "120200000000000001");
});

test("every call carries the token in the Authorization header only, follows no redirect, and goes to graph.facebook.com", async () => {
  const g = fakeGraph(GOOD);
  await net().publish({ ...publishArgs(), fetchImpl: g.fetchImpl });
  for (const c of g.calls) {
    assert.equal(c.headers.authorization, `Bearer ${TOKEN}`);
    assert.equal(c.url.origin, "https://graph.facebook.com");
    assert.ok(!c.url.href.includes(TOKEN));
    assert.equal(c.url.searchParams.get("access_token"), null);
    assert.ok(!JSON.stringify(c.form || {}).includes(TOKEN));
    assert.equal(c.redirect, "error");
    assert.ok(c.signal instanceof AbortSignal);
  }
});

test("the budget goes in the account currency's minor units, and a currency the button did not name stops the publish before anything is created", async () => {
  const yen = { ...GOOD, [`GET ${ACT}`]: [200, { name: "Yen", currency: "JPY", account_status: 1 }] };
  const n = net({ ...ENV, ADS_DAILY_BUDGET: "700" });
  assert.equal(n.settings().budgetLabel, "$700 a day · 7 days");
  const g = fakeGraph(yen);
  await assert.rejects(n.publish({ ...publishArgs(), fetchImpl: g.fetchImpl }), (e) => {
    assert.ok(e instanceof AdNetworkError);
    assert.equal(e.step, "budget");
    assert.equal(e.message, 'The ad account pays in JPY, not USD: the button now reads "¥700 a day · 7 days"; check it and publish again');
    return true;
  });
  assert.deepEqual(route(g.calls), [`GET ${ACT}`]);
  assert.equal(n.settings().currency, "JPY");
  assert.equal(n.settings().budgetLabel, "¥700 a day · 7 days");
  const again = fakeGraph(yen);
  const out = await n.publish({ ...publishArgs(), fetchImpl: again.fetchImpl });
  assert.equal(again.calls.find((c) => c.path === `${ACT}/adsets`).form.daily_budget, "700");
  assert.deepEqual(out.budget, { daily: 700, currency: "JPY", days: 7, endsAt: "2026-11-11T18:00:00.000Z" });

  // Hundredths for the rest: 7.5 USD is 750 cents.
  const cents = fakeGraph(GOOD);
  await net({ ...ENV, ADS_DAILY_BUDGET: "7.5", ADS_DAYS: "3" }).publish({ ...publishArgs(), fetchImpl: cents.fetchImpl });
  const adset = cents.calls.find((c) => c.path === `${ACT}/adsets`).form;
  assert.equal(adset.daily_budget, "750");
  assert.equal(Number(adset.end_time) - Number(adset.start_time), 3 * 86400);
  assert.equal(currencyOffset("krw"), 1);
  assert.equal(currencyOffset("EUR"), 100);
  assert.equal(currencyOffset(undefined), 100);
});

test("the button carries the spend: settings and their label, the audience and the launch status from the keys, defaults for what is unusable", () => {
  assert.deepEqual(net({}).settings(), {
    daily: 5, currency: "USD", days: 7, countries: ["US"], ageMin: 35, ageMax: 64, launchStatus: "ACTIVE", budgetLabel: "$5 a day · 7 days",
  });
  assert.deepEqual(adSettings({ ADS_DAILY_BUDGET: "12", ADS_DAYS: "14", ADS_COUNTRIES: "us, ca us", ADS_AGE_MIN: "40", ADS_AGE_MAX: "65", ADS_LAUNCH_STATUS: "paused" }, "EUR"), {
    daily: 12, currency: "EUR", days: 14, countries: ["US", "CA"], ageMin: 40, ageMax: 65, launchStatus: "PAUSED", budgetLabel: "€12 a day · 14 days",
  });
  // Unusable values fall back: a zero or negative budget, one day (a daily budget needs more than 24 hours), a
  // country that is not two letters, ages out of range or upside down, an unknown status.
  assert.deepEqual(adSettings({ ADS_DAILY_BUDGET: "0", ADS_DAYS: "1", ADS_COUNTRIES: "USA", ADS_AGE_MIN: "70", ADS_AGE_MAX: "x", ADS_LAUNCH_STATUS: "LIVE" }), adSettings({}));
  assert.deepEqual(adSettings({ ADS_DAILY_BUDGET: "-3", ADS_DAYS: "2.5", ADS_AGE_MIN: "60", ADS_AGE_MAX: "40" }), adSettings({}));
  assert.equal(adSettings({ ADS_DAYS: "91" }).days, 7);
  assert.equal(budgetLabel({ daily: 7.5, currency: "USD", days: 3 }), "$7.50 a day · 3 days");
  assert.equal(budgetLabel({ daily: 20, currency: "pln", days: 7 }), "20 PLN a day · 7 days");
  assert.equal(budgetLabel({ daily: 5, currency: "GBP", days: 1 }), "£5 a day · 1 day");
  const fb = getNetwork("facebook");
  assert.equal(fb.label, "Facebook");
  assert.equal(typeof fb.settings().budgetLabel, "string");
});

test("missing keys are named and nothing leaves: the token, the ad account, the Page (MESSENGER_PAGE_ID as fallback)", async () => {
  assert.deepEqual(missingKeys({}), ["META_ADS_TOKEN", "META_AD_ACCOUNT_ID", "META_ADS_PAGE_ID"]);
  assert.deepEqual(missingKeys({ ...ENV, META_ADS_TOKEN: "   " }), ["META_ADS_TOKEN"]);
  assert.deepEqual(missingKeys({ META_ADS_TOKEN: TOKEN, META_AD_ACCOUNT_ID: "1234567890", MESSENGER_PAGE_ID: "999" }), []);
  assert.deepEqual(missingKeys({ ...ENV, META_AD_ACCOUNT_ID: "acct-12" }), ["META_AD_ACCOUNT_ID"]);
  assert.deepEqual(missingKeys({ ...ENV, META_ADS_PAGE_ID: "hey-prudence" }), ["META_ADS_PAGE_ID"]);
  const c = facebookConfig({ META_ADS_TOKEN: TOKEN, META_AD_ACCOUNT_ID: " 1234567890 ", MESSENGER_PAGE_ID: "999", META_ADS_GRAPH_VERSION: "v27.0" });
  assert.equal(c.accountId, "act_1234567890");
  assert.equal(c.accountDigits, "1234567890");
  assert.equal(c.pageId, "999");
  assert.equal(c.pageFrom, "MESSENGER_PAGE_ID");
  assert.equal(c.graphVersion, "v27.0");
  assert.equal(facebookConfig({ META_ADS_GRAPH_VERSION: "latest" }).graphVersion, DEFAULT_GRAPH_VERSION);

  const n = net({ META_AD_ACCOUNT_ID: "acct-12", META_ADS_PAGE_ID: "hey" });
  assert.equal(n.configured(), false);
  assert.deepEqual(n.missingKeys(), ["META_ADS_TOKEN", "META_AD_ACCOUNT_ID", "META_ADS_PAGE_ID"]);
  const g = fakeGraph(GOOD);
  for (const run of [
    () => n.publish({ ...publishArgs(), fetchImpl: g.fetchImpl }),
    () => n.setStatus({ adId: "1", status: "PAUSED", fetchImpl: g.fetchImpl }),
    () => n.review({ adId: "1", fetchImpl: g.fetchImpl }),
  ]) {
    await assert.rejects(run(), (e) => {
      assert.equal(e.step, "keys");
      assert.deepEqual(e.missing, ["META_ADS_TOKEN", "META_AD_ACCOUNT_ID", "META_ADS_PAGE_ID"]);
      assert.equal(e.message, "Facebook is not set up: missing META_ADS_TOKEN, META_AD_ACCOUNT_ID (act_ followed by digits, or the digits alone), META_ADS_PAGE_ID (the Page's number)");
      return true;
    });
  }
  assert.equal(g.calls.length, 0);
  assert.equal(net().configured(), true);
});

test("the registry has Facebook only, and an unknown network is a plain error", () => {
  assert.deepEqual(networkNames(), ["facebook"]);
  assert.equal(getNetwork("facebook"), facebook);
  assert.throws(() => getNetwork("snapchat"), { message: 'Unknown ad network "snapchat": the known ones are facebook' });
  assert.throws(() => getNetwork("toString"), /Unknown ad network "toString"/);
  assert.throws(() => getNetwork(), /Unknown ad network ""/);
});

test("the app's network reads the keys at every call, so a key stored while the server runs counts at once", async () => {
  const saved = Object.fromEntries(["META_ADS_TOKEN", "META_AD_ACCOUNT_ID", "META_ADS_PAGE_ID", "MESSENGER_PAGE_ID", "ADS_DAILY_BUDGET"].map((k) => [k, process.env[k]]));
  try {
    for (const k of Object.keys(saved)) delete process.env[k];
    assert.equal(facebook.configured(), false);
    Object.assign(process.env, ENV, { ADS_DAILY_BUDGET: "9" });
    assert.equal(facebook.configured(), true);
    assert.equal(facebook.settings().budgetLabel, "$9 a day · 7 days");
    const g = fakeGraph({ [`GET ${V}/42`]: [200, { effective_status: "PENDING_REVIEW" }] });
    assert.equal((await facebook.review({ adId: "42", fetchImpl: g.fetchImpl })).state, "in_review");
  } finally {
    for (const [k, v] of Object.entries(saved)) if (v === undefined) delete process.env[k]; else process.env[k] = v;
  }
});

test("Meta's review state in words: In review, Active, Rejected with Meta's reason, Paused, and other", async () => {
  const expected = {
    PENDING_REVIEW: "in_review", IN_PROCESS: "in_review", ACTIVE: "active", DISAPPROVED: "rejected", WITH_ISSUES: "rejected",
    PAUSED: "paused", ADSET_PAUSED: "paused", CAMPAIGN_PAUSED: "paused", PREAPPROVED: "other", ARCHIVED: "other", DELETED: "other", "": "other",
  };
  for (const [status, state] of Object.entries(expected)) assert.equal(reviewState(status), state, status);
  assert.equal(reviewState("paused"), "paused");

  const feedback = {
    global: { ADULT_CONTENT: "Ads can't promote adult content.", "Personal attributes": "", PERSONAL_ATTRIBUTES: "  Ads can't assert or imply\npersonal attributes. " },
    placement_specific: { facebook: { ADULT_CONTENT: "Ads can't promote adult content.", LOW_QUALITY: 42 }, instagram: null },
  };
  assert.deepEqual(reviewReasons(feedback), [
    "Ads can't promote adult content.", "Personal attributes", "Ads can't assert or imply personal attributes.", "Low quality",
  ]);
  assert.deepEqual(reviewReasons(undefined), []);
  assert.deepEqual(reviewReasons({ global: "nope" }), []);

  const g = fakeGraph({
    [`GET ${V}/120200000000000004`]: [200, { id: "120200000000000004", effective_status: "DISAPPROVED", ad_review_feedback: feedback }],
    [`GET ${V}/7`]: [200, { effective_status: "PENDING_BILLING_INFO" }],
    [`GET ${V}/8`]: [200, { effective_status: "ACTIVE" }],
  });
  const n = net();
  const r = await n.review({ adId: "120200000000000004", fetchImpl: g.fetchImpl });
  assert.equal(g.calls[0].url.searchParams.get("fields"), "effective_status,ad_review_feedback");
  assert.deepEqual(r, { state: "rejected", effectiveStatus: "DISAPPROVED", reasons: reviewReasons(feedback) });
  assert.deepEqual(await n.review({ adId: "7", fetchImpl: g.fetchImpl }), { state: "other", effectiveStatus: "PENDING_BILLING_INFO", reasons: ["The ad account has no payment method yet"] });
  assert.deepEqual(await n.review({ adId: "8", fetchImpl: g.fetchImpl }), { state: "active", effectiveStatus: "ACTIVE", reasons: [] });
  await assert.rejects(n.review({ fetchImpl: g.fetchImpl }), { step: "input" });
  await assert.rejects(n.review({ adId: "9", fetchImpl: g.fetchImpl }), (e) => e.step === "review" && e.status === 404 && e.code === 2500);
});

test("Pause stops the ad then its ad set; Resume starts the ad set then the ad; a failure half way says what already changed", async () => {
  const ok = { [`POST ${V}/AD1`]: [200, { success: true }], [`POST ${V}/SET1`]: [200, { success: true }] };
  const n = net();
  const pause = fakeGraph(ok);
  assert.deepEqual(await n.setStatus({ adId: "AD1", adsetId: "SET1", status: "PAUSED", fetchImpl: pause.fetchImpl }), { adId: "AD1", adsetId: "SET1", status: "PAUSED" });
  assert.deepEqual(route(pause.calls), [`POST ${V}/AD1`, `POST ${V}/SET1`]);
  assert.deepEqual(pause.calls.map((c) => c.form), [{ status: "PAUSED" }, { status: "PAUSED" }]);
  const resume = fakeGraph(ok);
  assert.deepEqual(await n.setStatus({ adId: "AD1", adsetId: "SET1", status: "active", fetchImpl: resume.fetchImpl }), { adId: "AD1", adsetId: "SET1", status: "ACTIVE" });
  assert.deepEqual(route(resume.calls), [`POST ${V}/SET1`, `POST ${V}/AD1`]);
  assert.deepEqual(resume.calls.map((c) => c.form), [{ status: "ACTIVE" }, { status: "ACTIVE" }]);
  const alone = fakeGraph(ok);
  assert.deepEqual(await n.setStatus({ adId: "AD1", status: "PAUSED", fetchImpl: alone.fetchImpl }), { adId: "AD1", adsetId: null, status: "PAUSED" });
  assert.equal(alone.calls.length, 1);

  const half = fakeGraph({ [`POST ${V}/AD1`]: [200, { success: true }], [`POST ${V}/SET1`]: [400, { error: { message: "Invalid parameter", code: 100 } }] });
  await assert.rejects(n.setStatus({ adId: "AD1", adsetId: "SET1", status: "PAUSED", fetchImpl: half.fetchImpl }), (e) => {
    assert.equal(e.step, "status");
    assert.equal(e.message, "Facebook refused changing the ad's status: Invalid parameter (code 100) (the ad is already paused)");
    assert.deepEqual(e.done, ["ad"]);
    return true;
  });
  const first = fakeGraph({});
  await assert.rejects(n.setStatus({ adId: "AD1", adsetId: "SET1", status: "ACTIVE", fetchImpl: first.fetchImpl }), (e) => e.done.length === 0 && !/already/.test(e.message));
  await assert.rejects(n.setStatus({ adId: "AD1", status: "DELETED", fetchImpl: first.fetchImpl }), { step: "input", message: "The status is PAUSED or ACTIVE" });
  await assert.rejects(n.setStatus({ status: "PAUSED", fetchImpl: first.fetchImpl }), { step: "input" });
});

test("a failure after the ad set exists deletes what this publish made (ad set, creative; never the campaign), then names the step", async () => {
  const creativeFails = fakeGraph({ ...GOOD, [`POST ${ACT}/adcreatives`]: [400, { error: { message: "Invalid parameter", error_user_msg: "The link must be reachable.", code: 100, error_subcode: 1487 } }] });
  await assert.rejects(net().publish({ ...publishArgs(), fetchImpl: creativeFails.fetchImpl }), (e) => {
    assert.ok(e instanceof AdNetworkError);
    assert.equal(e.step, "creative");
    assert.equal(e.status, 400);
    assert.equal(e.code, 100);
    assert.equal(e.message, "Facebook refused creating the ad's creative: The link must be reachable. (code 100, subcode 1487)");
    assert.deepEqual(e.leftovers, []);
    assert.equal(e.campaignId, "120200000000000001");
    assert.equal(e.campaignCreated, true);
    return true;
  });
  assert.deepEqual(route(creativeFails.calls).slice(-2), [`POST ${ACT}/adcreatives`, `DELETE ${V}/120200000000000002`]);
  assert.ok(!route(creativeFails.calls).some((r) => r.includes("DELETE") && r.includes("120200000000000001")));

  const adFails = fakeGraph({ ...GOOD, [`POST ${ACT}/ads`]: [500, { error: { message: "An unexpected error has occurred.", code: 2 } }] });
  await assert.rejects(net().publish({ ...publishArgs({ campaignId: "C9" }), fetchImpl: adFails.fetchImpl }), (e) => {
    assert.equal(e.step, "ad");
    assert.equal(e.campaignId, undefined);
    return true;
  });
  assert.deepEqual(route(adFails.calls).slice(-3), [`POST ${ACT}/ads`, `DELETE ${V}/120200000000000003`, `DELETE ${V}/120200000000000002`]);
  // No create is ever sent twice.
  for (const p of ["adimages", "campaigns", "adsets", "adcreatives", "ads"]) assert.ok(route(adFails.calls).filter((r) => r === `POST ${ACT}/${p}`).length <= 1);

  // A cleanup that fails is named in the message, not hidden.
  const stuck = fakeGraph({ ...GOOD, [`POST ${ACT}/ads`]: [400, { error: { message: "Bad", code: 100 } }], [`DELETE ${V}/120200000000000002`]: [500, { error: { message: "busy", code: 2 } }] });
  await assert.rejects(net().publish({ ...publishArgs(), fetchImpl: stuck.fetchImpl }), (e) => {
    assert.equal(e.message, "Facebook refused creating the ad: Bad (code 100); left on Facebook: ad set 120200000000000002 (delete it in Ads Manager)");
    assert.deepEqual(e.leftovers, [{ kind: "ad set", id: "120200000000000002" }]);
    return true;
  });

  // An answer without an id is a failure of that step, and is cleaned up the same way.
  const noId = fakeGraph({ ...GOOD, [`POST ${ACT}/ads`]: [200, { success: true }] });
  await assert.rejects(net().publish({ ...publishArgs(), fetchImpl: noId.fetchImpl }), { step: "ad", message: "Facebook created no ad id" });
  assert.equal(route(noId.calls).filter((r) => r.startsWith("DELETE")).length, 2);
});

test("a failure before the ad set deletes nothing; a blocked ad account and a bad ad stop before any upload", async () => {
  const imageFails = fakeGraph({ ...GOOD, [`POST ${ACT}/adimages`]: [400, { error: { message: "Image too small", code: 100 } }] });
  await assert.rejects(net().publish({ ...publishArgs(), fetchImpl: imageFails.fetchImpl }), { step: "image", message: "Facebook refused uploading the photo: Image too small (code 100)" });
  assert.deepEqual(route(imageFails.calls), [`GET ${ACT}`, `POST ${ACT}/adimages`]);
  const noHash = fakeGraph({ ...GOOD, [`POST ${ACT}/adimages`]: [200, { images: {} }] });
  await assert.rejects(net().publish({ ...publishArgs(), fetchImpl: noHash.fetchImpl }), { step: "image" });
  const campaignFails = fakeGraph({ ...GOOD, [`POST ${ACT}/campaigns`]: [400, { error: { message: "No", code: 100 } }] });
  await assert.rejects(net().publish({ ...publishArgs(), fetchImpl: campaignFails.fetchImpl }), (e) => e.step === "campaign" && e.campaignId === undefined);
  assert.ok(!route(campaignFails.calls).some((r) => r.startsWith("DELETE")));
  const noCampaignId = fakeGraph({ ...GOOD, [`POST ${ACT}/campaigns`]: [200, {}] });
  await assert.rejects(net().publish({ ...publishArgs(), fetchImpl: noCampaignId.fetchImpl }), { step: "campaign" });
  const adsetFails = fakeGraph({ ...GOOD, [`POST ${ACT}/adsets`]: [400, { error: { message: "Budget too low", code: 100 } }] });
  await assert.rejects(net().publish({ ...publishArgs(), fetchImpl: adsetFails.fetchImpl }), (e) => e.step === "adset" && e.campaignCreated === true);
  assert.ok(!route(adsetFails.calls).some((r) => r.startsWith("DELETE")));

  const disabled = fakeGraph({ ...GOOD, [`GET ${ACT}`]: [200, { name: "x", currency: "USD", account_status: 2 }] });
  await assert.rejects(net().publish({ ...publishArgs(), fetchImpl: disabled.fetchImpl }), { step: "account", message: "The ad account is disabled: Facebook takes no new ads from it (Business settings → Ad accounts)" });
  assert.equal(disabled.calls.length, 1);
  const noCurrency = fakeGraph({ ...GOOD, [`GET ${ACT}`]: [200, { account_status: 1 }] });
  await assert.rejects(net().publish({ ...publishArgs(), fetchImpl: noCurrency.fetchImpl }), { step: "account" });

  const g = fakeGraph(GOOD);
  const bad = [
    [{ photo: { bytes: Buffer.alloc(0) } }, "the photo"],
    [{ photo: undefined }, "the photo"],
    [{ link: "http://heyprudence.com/a/abcd1234" }, "an https link"],
    [{ link: "https://user:pw@heyprudence.com/" }, "an https link"],
    [{ link: "not a url" }, "an https link"],
    [{ words: { ...WORDS, cta: "BUY_NOW" } }, "a button Facebook takes (LEARN_MORE or SIGN_UP)"],
    [{ words: { ...WORDS, headline: " " } }, "a headline"],
    [{ words: undefined }, "a headline, the main text"],
    [{ name: "" }, "a name"],
  ];
  for (const [extra, what] of bad) {
    await assert.rejects(net().publish({ ...publishArgs(extra), fetchImpl: g.fetchImpl }), { step: "input", message: `The ad is missing ${what}` });
  }
  assert.equal(g.calls.length, 0);
  // Without a description and a button, the creative goes without a description and with Learn more.
  const plain = fakeGraph(GOOD);
  await net().publish({ ...publishArgs({ words: { headline: "h", primary_text: "p" } }), fetchImpl: plain.fetchImpl });
  const spec = json(plain.calls.find((c) => c.path === `${ACT}/adcreatives`).form.object_story_spec);
  assert.equal(spec.link_data.description, undefined);
  assert.deepEqual(spec.link_data.call_to_action, { type: "LEARN_MORE", value: { link: LINK } });
});

test("a token never appears in an error: Graph echoing it, a URL with its query, a transport error carrying the URL", async () => {
  const leaky = fakeGraph({
    ...GOOD,
    [`POST ${ACT}/adimages`]: [400, { error: { message: `Bad token ${TOKEN} at https://graph.facebook.com/v26.0/act_1/adimages?access_token=${TOKEN}&x=1`, code: 190 } }],
  });
  const errors = [];
  await net().publish({ ...publishArgs(), fetchImpl: leaky.fetchImpl }).catch((e) => errors.push(e));
  const transport = async (url) => { throw Object.assign(new Error(`connect ECONNREFUSED ${url}?access_token=${TOKEN}`), { cause: { code: "ECONNREFUSED" } }); };
  await net().publish({ ...publishArgs(), fetchImpl: transport }).catch((e) => errors.push(e));
  const timeout = async () => { throw Object.assign(new Error(`timed out ${TOKEN}`), { name: "TimeoutError" }); };
  await net().review({ adId: "1", fetchImpl: timeout }).catch((e) => errors.push(e));
  const aborted = new AbortController();
  aborted.abort();
  const honour = async (url, init) => { init.signal.throwIfAborted(); return Response.json({}); };
  await net().setStatus({ adId: "1", status: "PAUSED", signal: aborted.signal, fetchImpl: honour }).catch((e) => errors.push(e));
  const notJson = async () => new Response("<html>bad gateway</html>", { status: 502 });
  await net().review({ adId: "1", fetchImpl: notJson }).catch((e) => errors.push(e));

  assert.equal(errors.length, 5);
  assert.deepEqual(errors.map((e) => e.message), [
    "Facebook refused uploading the photo: Bad token [redacted] at https://graph.facebook.com/v26.0/act_1/adimages (code 190)",
    "Facebook could not be reached while reading the ad account: network error (ECONNREFUSED)",
    "Facebook could not be reached while reading the ad's review: no answer in 30 s",
    "Facebook could not be reached while changing the ad's status: stopped before Facebook answered",
    "Facebook refused reading the ad's review: HTTP 502",
  ]);
  for (const e of errors) {
    assert.ok(e instanceof AdNetworkError);
    assert.ok(!`${e.message} ${e.stack} ${JSON.stringify(e)}`.includes(TOKEN));
    assert.ok(!/access_token|\?/.test(e.message));
  }
  assert.equal(scrubText(`a ${TOKEN} b https://x.example/p?access_token=abc#f c access_token=zzz`, TOKEN), "a [redacted] b https://x.example/p c access_token=[redacted]");
  assert.equal(scrubText("short abc", "abc"), "short abc");
  assert.equal(graphMessage("weird", 418, {}), "Facebook refused weird: HTTP 418");
  assert.equal(imageHashFrom({ images: { "a.jpg": { url: "u" }, bytes: { hash: "h2" } } }), "h2");
  assert.equal(imageHashFrom(null), "");
});

test("a non-network bug while publishing still cleans up and says which step stopped, without the original text", async () => {
  let n = 0;
  const g = fakeGraph({
    ...GOOD,
    [`POST ${ACT}/adcreatives`]: () => { n++; return [200, { id: "120200000000000003" }]; },
  });
  const broken = async (url, init) => {
    if (init.method === "POST" && new URL(url).pathname === `${ACT}/ads`) throw new TypeError(`boom ${TOKEN}`);
    return g.fetchImpl(url, init);
  };
  await assert.rejects(net().publish({ ...publishArgs(), fetchImpl: broken }), (e) => {
    assert.equal(e.step, "ad");
    assert.equal(e.message, "Facebook could not be reached while creating the ad: network error (TypeError)");
    return true;
  });
  assert.equal(n, 1);
  assert.deepEqual(route(g.calls).slice(-2), [`DELETE ${V}/120200000000000003`, `DELETE ${V}/120200000000000002`]);
});

test("the Graph version defaults to the Messenger adapter's, and META_ADS_GRAPH_VERSION moves it", async () => {
  const messenger = readFileSync(new URL("../src/channels/messenger.js", import.meta.url), "utf8");
  assert.equal(messenger.match(/export const DEFAULT_GRAPH_VERSION = "([^"]+)"/)[1], DEFAULT_GRAPH_VERSION);
  const g = fakeGraph({ "GET /v27.0/5": [200, { effective_status: "ACTIVE" }] });
  await net({ ...ENV, META_ADS_GRAPH_VERSION: "v27.0" }).review({ adId: "5", fetchImpl: g.fetchImpl });
  assert.equal(g.calls[0].path, "/v27.0/5");
});
