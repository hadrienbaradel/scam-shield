// The ad studio's admin API over Postgres (_product/specs/ad-studio.md, lines
// 1, 2, 4, 5, 6, 8 and 10; contract C4 of docs/plans/2026-11-04-ad-studio.md),
// with a fake studio and a fake network through app.adsDeps: admins only,
// New ideas fills drafting rows in the background, a failure is a plain
// line, an edit is a new version and Undo goes back, Publish happens once
// under two clicks and creates the campaign once, Pause, Resume, Refresh and
// Reject, the photo's bytes and headers, today's photos and cost, rows a
// restart cut, visits and requests per variant. Skipped without Postgres.
import "./helpers/env.js";
import { test, before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { pool, resetDb, makeUser, sessionFor, dbAvailable } from "./helpers/db.js";
import { one, many } from "../src/db/pool.js";
import { buildApp } from "../src/server.js";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import Fastify from "fastify";
import adsRoutes, { adsIdle, landingBase, plainError, importOptional, defaultModels, modelsFrom, mergeModels, jobOf, retried, LIMITS } from "../src/routes/ads.js";
import { newCode, createDrafting, STALE_MINUTES } from "../src/ads/store.js";

// ---------------------------------------------------------------- pure ---

test("a variant's code is 8 letters or digits, every character equally likely", () => {
  for (let i = 0; i < 50; i++) assert.match(newCode(), /^[a-z0-9]{8}$/);
  // Bytes from 252 up are drawn again (252 = 7 * 36), so "a" is not favoured.
  const bytes = [255, 254, 253, 252, 0, 1, 2, 3, 4, 5, 6, 7, 251, 35, 36, 71];
  assert.equal(newCode(() => Buffer.from(bytes)), "abcdefgh");
  assert.equal(newCode(() => Buffer.from([252, 253, ...bytes.slice(4)].slice(0, 16))), "abcdefgh");
});

test("an ad links to the public site unless this server is production on https", () => {
  assert.equal(landingBase({ production: false, baseUrl: "http://localhost:3000" }), "https://heyprudence.com");
  assert.equal(landingBase({ production: false, baseUrl: "https://x-3000.app.github.dev" }), "https://heyprudence.com", "a Codespace is no place for an ad's visitors");
  assert.equal(landingBase({ production: true, baseUrl: "https://heyprudence.com" }), "https://heyprudence.com");
  assert.equal(landingBase({ production: true, baseUrl: "https://staging.heyprudence.com" }), "https://staging.heyprudence.com");
  assert.equal(landingBase({ production: true, baseUrl: "http://localhost:3000" }), "https://heyprudence.com");
  assert.equal(landingBase(), "https://heyprudence.com", "the tests run outside production");
});

test("a failure reads as one plain line with no token in it", () => {
  assert.equal(plainError(new Error("Facebook: (#100) Invalid parameter")), "Facebook: (#100) Invalid parameter");
  const leaky = plainError(new Error("GET https://graph.facebook.com/v26.0/act_1?access_token=EAABsbCS1iHgBAKZC0secret&fields=name failed with Bearer abc.def"));
  assert.ok(!/EAAB|secret|abc\.def/.test(leaky), leaky);
  assert.match(leaky, /access_token=\[hidden\]/);
  assert.match(leaky, /Bearer \[hidden\]/);
  assert.match(plainError(new Error("token EAAGm0PX4ZCpsBAOabcdefghijklmnopqrstuv in the text")), /token \[hidden\] in the text/);
  assert.equal(plainError(new Error("x".repeat(1000))).length, 300);
  assert.equal(plainError(null, "Muse Spark could not write the ideas."), "Muse Spark could not write the ideas.");
});

test("the shutdown line comes from the server's own signal, not from the error's name (a layer may rewrap an abort)", () => {
  assert.equal(plainError(new Error("Muse Spark request was cancelled"), "x", true), "Stopped: the server was shutting down. Try again.");
  assert.equal(plainError(Object.assign(new Error("The operation was aborted"), { name: "AbortError" }), "x", false), "The operation was aborted",
    "an abort the server did not ask for (a model's own timeout) keeps its words");
});

test("a module that is not installed yet loads as nothing; a broken one is an error, never 'not installed'", async () => {
  assert.equal(await importOptional(new URL("../lib/ads/not-a-module.js", import.meta.url).href), null);
  const dir = await mkdtemp(join(tmpdir(), "ads-import-"));
  try {
    await writeFile(join(dir, "imports-missing.mjs"), 'import "./guardrails-not-there.mjs";\nexport const x = 1;\n');
    await writeFile(join(dir, "syntax.mjs"), "export const = ;\n");
    await writeFile(join(dir, "throws.mjs"), 'throw new Error("META_ADS_DAILY_BUDGET is not a number");\n');
    await assert.rejects(importOptional(pathToFileURL(join(dir, "imports-missing.mjs")).href), (e) => e.code === "ERR_MODULE_NOT_FOUND" && /guardrails-not-there/.test(e.message),
      "a module it imports is missing: that is a bug in the module, not 'not installed'");
    await assert.rejects(importOptional(pathToFileURL(join(dir, "syntax.mjs")).href), SyntaxError);
    await assert.rejects(importOptional(pathToFileURL(join(dir, "throws.mjs")).href), /is not a number/);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
  const m = await defaultModels();
  assert.equal(m.configured, false, "no META_MODEL_API_KEY in the tests");
  assert.deepEqual(m.missing, ["META_MODEL_API_KEY"]);
  assert.equal(typeof m.words, "string");
});

test("the key New ideas names comes from the llm layer's own image resolver (IMAGE_PROVIDER=muse is META_MODEL_API_KEY)", () => {
  const llm = (imageProvider, { wordsOk = true, imageOk = false } = {}) => ({
    llmConfigured: () => wordsOk, llmProviderName: () => "openai", llmLabel: () => "GPT",
    imageConfigured: () => imageOk, imageLabel: () => "Muse Image 1.0",
    imageProviderName: () => ({ muse: "meta", "openai-compatible": "openai" }[imageProvider] || imageProvider),
  });
  assert.deepEqual(modelsFrom(llm("muse"), { IMAGE_PROVIDER: "muse" }).missing, ["META_MODEL_API_KEY"], "the alias, resolved by the layer");
  assert.deepEqual(modelsFrom(llm("openai-compatible"), { IMAGE_PROVIDER: "openai-compatible" }).missing, ["OPENAI_API_KEY"]);
  assert.deepEqual(modelsFrom(llm("meta", { wordsOk: false })).missing, ["OPENAI_API_KEY", "META_MODEL_API_KEY"], "the words' key, then the photos'");
  assert.deepEqual(modelsFrom(llm("meta", { imageOk: true })), { words: "GPT", image: "Muse Image 1.0", configured: true, missing: [] });
  assert.deepEqual(modelsFrom(null), { words: null, image: null, configured: false, missing: [] });
});

test("an edit that called only Muse Spark keeps the photo's and the check's labels (a null label never wipes one)", () => {
  const before = { words: "Muse Spark", image: "Muse Image 1.0", check: "Muse Spark", basedOn: 1 };
  assert.deepEqual(mergeModels(before, { words: "Muse Spark 1.3", image: null, check: null }), { words: "Muse Spark 1.3", image: "Muse Image 1.0", check: "Muse Spark" });
  assert.deepEqual(mergeModels(before, { words: "Muse Spark", image: "Muse Image 1.1", check: "Muse Spark" }), { words: "Muse Spark", image: "Muse Image 1.1", check: "Muse Spark" });
  assert.deepEqual(mergeModels(null, undefined), {});
});

// ------------------------------------------------------------- the routes ---

const ORIGIN = "http://localhost:3999";
const hasDb = await dbAvailable();
const opts = { skip: hasDb ? false : "Postgres test database not available" };
let app;
let adminHeaders;
let seniorHeaders;

before(async () => {
  if (!hasDb) return;
  await resetDb();
  app = await buildApp({ logger: false });
  const senior = await makeUser({ email: "senior-ads@example.test" });
  seniorHeaders = { cookie: await sessionFor(senior) };
});
after(async () => { await app?.close(); await pool.end(); });
// A fresh admin per test (the same listed address, a new account): New ideas'
// limit of 10 a minute counts per person, so one test never spends another's.
beforeEach(async () => {
  if (!hasDb) return;
  await adsIdle();
  adminHeaders = { cookie: await sessionFor(await makeUser({ email: "admin@example.test", name: "Vlad" })) };
  await pool.query("TRUNCATE ads, ad_campaigns CASCADE");
  await pool.query("TRUNCATE early_access_requests");
});

const get = (url, headers = adminHeaders) => app.inject({ url, headers });
const post = (url, payload = {}, headers = adminHeaders) => app.inject({ method: "POST", url, headers: { origin: ORIGIN, ...headers }, payload });
const list = async () => (await get("/api/admin/ads")).json();
const adOf = async (id) => (await list()).ads.find((a) => a.id === id);

// A gate a fake call waits on, opened by the test.
function gate() {
  let open;
  const p = new Promise((r) => { open = r; });
  return { wait: () => p, open };
}

const jpeg = (n) => Buffer.from([0xff, 0xd8, 0xff, 0xe0, n, n, n, 0xff, 0xd9]);
const WORDS = (i) => ({
  headline: `Your mother's email, checked ${i}`,
  primary_text: "Prudence reads each message against her life and says, in plain words, whether it is safe.",
  description: "Free while in test",
  cta: "LEARN_MORE",
  photo_brief: "A woman in her seventies at a kitchen table with a laptop, her son beside her.",
  landing: { headline: `Is this email a scam? ${i}`, lead: "Prudence checks every message against your parent's own life." },
});
const CHECK = { pass: true, problems: [], fixed: ["a second pair of glasses on the table"], summary: "Checked by Muse Spark: fixed a second pair of glasses on the table", model: "Muse Spark" };
const MODELS = () => ({ words: "Muse Spark", image: "Muse Image 1.0", configured: true, missing: [] });

function fakeStudio(over = {}) {
  const calls = { propose: [], photo: [], edit: [] };
  return {
    calls,
    PHOTO_COST_USD: 0.01,
    async proposeIdeas(args) {
      calls.propose.push(args);
      return { ideas: Array.from({ length: args.count }, (_, i) => WORDS(i + 1)), model: "Muse Spark" };
    },
    async makePhoto(args) {
      calls.photo.push(args);
      return { photo: { bytes: jpeg(1), mime: "image/jpeg" }, check: CHECK, models: { image: "Muse Image 1.0", check: "Muse Spark" }, photosMade: 2 };
    },
    async editIdea(args) {
      calls.edit.push(args);
      return {
        words: { ...args.words, headline: `${args.words.headline} (edited)` },
        photo: { bytes: jpeg(calls.edit.length + 1), mime: "image/jpeg" },
        check: { ...CHECK, fixed: [], summary: "Checked by Muse Spark: nothing to fix" },
        changed: { words: true, photo: true },
        models: { words: "Muse Spark", image: "Muse Image 1.0", check: "Muse Spark" },
        photosMade: 1,
      };
    },
    ...over,
  };
}

function fakeNetwork(over = {}) {
  const calls = { publish: [], setStatus: [], review: [] };
  let ads = 0;
  return {
    calls,
    name: "facebook",
    label: "Facebook",
    configured: () => true,
    missingKeys: () => [],
    settings: () => ({ daily: 5, currency: "USD", days: 7, budgetLabel: "$5 a day · 7 days" }),
    async publish(args) {
      calls.publish.push(args);
      ads++;
      return {
        campaignId: args.campaignId || "cmp-1", campaignCreated: !args.campaignId, adsetId: `as-${ads}`, creativeId: `cr-${ads}`, adId: `120200000${ads}`,
        imageHash: "hash", status: "ACTIVE", adsManagerUrl: `https://adsmanager.facebook.com/adsmanager/manage/ads?selected_ad_ids=120200000${ads}`,
        budget: { daily: 5, currency: "USD", days: 7, endsAt: "2026-11-11T00:00:00.000Z" },
      };
    },
    async setStatus(args) { calls.setStatus.push(args); },
    async review(args) { calls.review.push(args); return { state: "rejected", effectiveStatus: "DISAPPROVED", reasons: ["Your ad uses a before-and-after image."] }; },
    ...over,
  };
}

function useDeps({ studio = fakeStudio(), network = fakeNetwork(), models = MODELS } = {}) {
  app.adsDeps = { studio, network, models };
  return { studio, network };
}

// New ideas, run to the end: the drafts' ids.
async function drafts(count = 1, brief = "adult children worried about a parent's email") {
  const res = await post("/api/admin/ads/ideas", { brief, count });
  assert.equal(res.statusCode, 202, res.body);
  await adsIdle();
  return res.json().ids;
}

// A published ad's id.
async function published() {
  const [id] = await drafts(1);
  assert.equal((await post(`/api/admin/ads/${id}/publish`)).statusCode, 202);
  await adsIdle();
  assert.equal((await adOf(id)).status, "published");
  return id;
}

test("the ad studio is for admins only: 401 signed out, 403 for anyone else, nothing created", opts, async () => {
  const { studio } = useDeps();
  const routes = [["GET", "/api/admin/ads"], ["POST", "/api/admin/ads/ideas"], ["POST", "/api/admin/ads/00000000-0000-0000-0000-000000000000/publish"],
    ["POST", "/api/admin/ads/00000000-0000-0000-0000-000000000000/edit"], ["GET", "/api/admin/ads/00000000-0000-0000-0000-000000000000/photo"]];
  for (const [method, url] of routes) {
    const headers = { origin: ORIGIN };
    assert.equal((await app.inject({ method, url, headers, payload: method === "POST" ? { count: 1 } : undefined })).statusCode, 401, `${url} signed out`);
    assert.equal((await app.inject({ method, url, headers: { ...headers, ...seniorHeaders }, payload: method === "POST" ? { count: 1 } : undefined })).statusCode, 403, `${url} not an admin`);
  }
  assert.equal(studio.calls.propose.length, 0);
  assert.equal((await one("SELECT count(*)::int AS n FROM ads")).n, 0);
});

test("New ideas answers at once with one drafting row per idea; each becomes a draft with its words, photo, check and models", opts, async () => {
  const hold = gate();
  const studio = fakeStudio();
  const propose = studio.proposeIdeas;
  studio.proposeIdeas = async (args) => { await hold.wait(); return propose(args); };
  useDeps({ studio });

  const res = await post("/api/admin/ads/ideas", { brief: "  adult children worried about a parent's email ", count: 3 });
  assert.equal(res.statusCode, 202, res.body);
  const { ids } = res.json();
  assert.equal(ids.length, 3);
  const drafting = await list();
  assert.deepEqual(drafting.ads.map((a) => a.status), ["drafting", "drafting", "drafting"], "the cards exist before any model answered");
  for (const a of drafting.ads) {
    assert.match(a.code, /^[a-z0-9]{8}$/);
    assert.equal(a.brief, "adult children worried about a parent's email");
    assert.equal(a.photoUrl, null);
    assert.equal(a.previewUrl, `/a/${a.code}?preview=1`);
  }
  assert.equal(new Set(drafting.ads.map((a) => a.code)).size, 3, "a code each");
  assert.equal((await one("SELECT created_by FROM ads LIMIT 1")).created_by, "admin@example.test");

  hold.open();
  await adsIdle();
  assert.deepEqual(studio.calls.propose.map((c) => [c.brief, c.count]), [["adult children worried about a parent's email", 3]], "one call for all the ideas");
  assert.equal(studio.calls.photo.length, 3, "one photo per idea");
  const data = await list();
  assert.deepEqual(data.ads.map((a) => a.status), ["draft", "draft", "draft"]);
  const ad = data.ads[0];
  assert.equal(ad.version, 1);
  assert.equal(ad.versions, 1);
  assert.equal(ad.canEdit, true);
  assert.equal(ad.canUndo, false, "nothing to undo on a first draft");
  assert.ok(ad.words.headline.startsWith("Your mother's email, checked"));
  assert.deepEqual(ad.check, CHECK);
  assert.deepEqual(ad.models, { words: "Muse Spark", image: "Muse Image 1.0", check: "Muse Spark" });
  assert.equal(ad.photoUrl, `/api/admin/ads/${ad.id}/photo?v=1`);
  assert.deepEqual(ad.counts, { visits: 0, requests: 0 });
  assert.equal(ad.error, null);
  assert.ok(!("photo" in ad), "the photo's bytes never leave through the list");
  assert.ok(!JSON.stringify(data).includes("basedOn"));
  assert.deepEqual(data.today, { photos: 6, costUsd: 0.06 }, "two photos per idea (one fix each), a cent each");
  assert.deepEqual(data.network, { name: "facebook", label: "Facebook", installed: true, configured: true, missing: [], budgetLabel: "$5 a day · 7 days" });
  assert.deepEqual(data.models, { words: "Muse Spark", image: "Muse Image 1.0", configured: true, missing: [], installed: true });
  assert.equal(data.landing, "https://heyprudence.com");

  const one2 = await post("/api/admin/ads/ideas", {});
  assert.equal(one2.json().ids.length, LIMITS.defaultCount, "three ideas when the count is not given");
  await adsIdle();
  assert.equal(studio.calls.propose.at(-1).brief, undefined, "no brief, none sent");
});

test("a batch reads in Muse Spark's order, its first idea on top, under the newest batch first", opts, async () => {
  useDeps();
  const first = (await post("/api/admin/ads/ideas", { count: 3 })).json().ids;
  assert.deepEqual((await list()).ads.map((a) => a.id), first, "in order while still drafting");
  await adsIdle();
  assert.deepEqual((await list()).ads.map((a) => a.words.headline), [1, 2, 3].map((i) => `Your mother's email, checked ${i}`));
  const second = (await post("/api/admin/ads/ideas", { count: 2 })).json().ids;
  await adsIdle();
  assert.deepEqual((await list()).ads.map((a) => a.id), [...second, ...first]);
});

test("the inputs have limits: a brief and an instruction of 500 characters, 1 to 4 ideas, a reason of 300", opts, async () => {
  useDeps();
  for (const [body, field] of [[{ brief: "x".repeat(501) }, "brief"], [{ brief: 42 }, "brief"], [{ count: 0 }, "count"], [{ count: 5 }, "count"], [{ count: 2.5 }, "count"], [{ count: "many" }, "count"]]) {
    const res = await post("/api/admin/ads/ideas", body);
    assert.equal(res.statusCode, 400, JSON.stringify(body));
    assert.equal(res.json().field, field);
  }
  assert.match((await post("/api/admin/ads/ideas", { count: 9 })).json().error, /Choose 1 to 4 ideas/);
  assert.equal((await post("/api/admin/ads/ideas", { brief: "x".repeat(500), count: "4" })).statusCode, 202, "500 characters and a count as text pass");
  await adsIdle();
  const [id] = (await list()).ads.map((a) => a.id);
  for (const instruction of ["", "   ", "x".repeat(501)]) {
    assert.equal((await post(`/api/admin/ads/${id}/edit`, { instruction })).statusCode, 400);
  }
  assert.match((await post(`/api/admin/ads/${id}/edit`, {})).json().error, /Write the instruction first/);
  assert.equal((await post(`/api/admin/ads/${id}/reject`, { reason: "x".repeat(301) })).statusCode, 400);
  assert.match((await post(`/api/admin/ads/${id}/reject`, { reason: " " })).json().error, /Write the reason first/);
  assert.equal((await adOf(id)).status, "draft", "nothing changed");
});

test("New ideas and Edit are limited to 10 a minute per admin", opts, async () => {
  useDeps();
  for (let i = 0; i < 10; i++) assert.equal((await post("/api/admin/ads/ideas", { count: 1 })).statusCode, 202, `request ${i + 1}`);
  assert.equal((await post("/api/admin/ads/ideas", { count: 1 })).statusCode, 429);
  await adsIdle();
  assert.equal((await one("SELECT count(*)::int AS n FROM ads")).n, 10);
});

test("a failure becomes failed with a plain line, never a token; an idea set aside by the word check says why", opts, async () => {
  useDeps({ studio: fakeStudio({ async proposeIdeas() { throw new Error("Muse Spark answered 401 (key=EAABsecretsecretsecretsecret)"); } }) });
  await drafts(2);
  let ads = (await list()).ads;
  assert.deepEqual(ads.map((a) => a.status), ["failed", "failed"]);
  assert.match(ads[0].error, /Muse Spark answered 401/);
  assert.ok(!ads[0].error.includes("EAAB"), ads[0].error);

  await pool.query("TRUNCATE ads CASCADE");
  const studio = fakeStudio({
    async proposeIdeas() { return { ideas: [WORDS(1)], model: "Muse Spark", dropped: [{ reason: "a number that is not in the fact sheet (87%)" }, "a brand from the brand list"] }; },
  });
  useDeps({ studio });
  const ids = await drafts(3);
  const byId = Object.fromEntries((await list()).ads.map((a) => [a.id, a]));
  assert.equal(byId[ids[0]].status, "draft");
  assert.equal(byId[ids[1]].status, "failed");
  assert.equal(byId[ids[1]].error, "Set aside by the word check after one rewrite: a number that is not in the fact sheet (87%)");
  assert.match(byId[ids[2]].error, /a brand from the brand list/);

  await pool.query("TRUNCATE ads CASCADE");
  useDeps({ studio: fakeStudio({ async proposeIdeas() { return { ideas: [], model: "Muse Spark" }; } }) });
  const [lone] = await drafts(1);
  assert.match((await adOf(lone)).error, /fewer ideas than asked/);

  await pool.query("TRUNCATE ads CASCADE");
  useDeps({ studio: fakeStudio({ async makePhoto() { throw new Error("Muse Image refused the photo: 400 content_policy_violation"); } }) });
  const [photoless] = await drafts(1);
  const failed = await adOf(photoless);
  assert.deepEqual([failed.status, failed.error, failed.photoUrl, failed.canEdit], ["failed", "Muse Image refused the photo: 400 content_policy_violation", null, false]);
  assert.equal((await post(`/api/admin/ads/${photoless}/publish`)).statusCode, 409, "a failed idea is never published");
});

test("an edit by prompt answers at once, then adds a version; Undo brings back the one before, and every version is kept", opts, async () => {
  const hold = gate();
  const studio = fakeStudio();
  const edit = studio.editIdea;
  studio.editIdea = async (args) => { await hold.wait(); return edit(args); };
  useDeps({ studio });
  const [id] = await drafts(1);

  const res = await post(`/api/admin/ads/${id}/edit`, { instruction: "  make the mother smile, warmer light " });
  assert.equal(res.statusCode, 202, res.body);
  assert.equal((await adOf(id)).status, "editing");
  assert.equal((await post(`/api/admin/ads/${id}/edit`, { instruction: "again" })).statusCode, 409, "one edit at a time");
  assert.equal((await post(`/api/admin/ads/${id}/publish`)).statusCode, 409, "no publish during an edit");
  assert.equal((await post(`/api/admin/ads/${id}/undo`)).statusCode, 409);
  hold.open();
  await adsIdle();

  const call = studio.calls.edit[0];
  assert.equal(call.instruction, "make the mother smile, warmer light");
  assert.ok(call.words.headline.startsWith("Your mother's email"));
  assert.deepEqual(call.photo.bytes, jpeg(1), "the current photo goes to the edit");
  let ad = await adOf(id);
  assert.deepEqual([ad.status, ad.version, ad.versions, ad.canUndo], ["draft", 2, 2, true]);
  assert.match(ad.words.headline, /\(edited\)$/);
  assert.equal(ad.instruction, "make the mother smile, warmer light");
  assert.equal(ad.check.summary, "Checked by Muse Spark: nothing to fix");
  assert.equal(ad.photoUrl, `/api/admin/ads/${id}/photo?v=2`);
  assert.deepEqual((await get(`/api/admin/ads/${id}/photo?v=1`)).rawPayload, jpeg(1), "the first version's photo is kept");
  assert.deepEqual((await get(`/api/admin/ads/${id}/photo`)).rawPayload, jpeg(2), "the current one by default");
  assert.equal((await list()).today.photos, 3, "two for the draft, one for the edit");

  const undone = await post(`/api/admin/ads/${id}/undo`);
  assert.equal(undone.statusCode, 200, undone.body);
  assert.deepEqual(undone.json(), { id, version: 1, status: "draft" });
  ad = await adOf(id);
  assert.deepEqual([ad.version, ad.versions, ad.canUndo, ad.instruction], [1, 2, false, null]);
  assert.ok(!ad.words.headline.includes("(edited)"));
  assert.equal((await post(`/api/admin/ads/${id}/undo`)).statusCode, 409, "nothing before the first version");

  // An edit made on the undone version: Undo returns to it, not to the version set aside.
  assert.equal((await post(`/api/admin/ads/${id}/edit`, { instruction: "shorter headline" })).statusCode, 202);
  await adsIdle();
  assert.deepEqual([(await adOf(id)).version, (await adOf(id)).versions], [3, 3]);
  assert.equal((await post(`/api/admin/ads/${id}/undo`)).json().version, 1);
  assert.equal((await many("SELECT version FROM ad_versions WHERE ad_id = $1 ORDER BY version", [id])).length, 3, "every version is kept");

  // A failed edit: back to the draft as it was, with the reason.
  useDeps({ studio: fakeStudio({ async editIdea() { throw new Error("Muse Image answered 503: try again"); } }) });
  assert.equal((await post(`/api/admin/ads/${id}/edit`, { instruction: "evening light" })).statusCode, 202);
  await adsIdle();
  ad = await adOf(id);
  assert.deepEqual([ad.status, ad.version, ad.error], ["draft", 1, "Muse Image answered 503: try again"]);

  // Words only: the photo and its check stay.
  useDeps({ studio: fakeStudio({ async editIdea({ words }) { return { words: { ...words, headline: "Shorter" }, changed: { words: true, photo: false }, models: { words: "Muse Spark" }, photosMade: 0 }; } }) });
  assert.equal((await post(`/api/admin/ads/${id}/edit`, { instruction: "shorter headline" })).statusCode, 202);
  await adsIdle();
  ad = await adOf(id);
  assert.deepEqual([ad.version, ad.words.headline, ad.error, ad.check.summary], [4, "Shorter", null, CHECK.summary]);
  assert.deepEqual(ad.models, { words: "Muse Spark", image: "Muse Image 1.0", check: "Muse Spark" });
  assert.deepEqual((await get(`/api/admin/ads/${id}/photo?v=4`)).rawPayload, jpeg(1));

  assert.equal((await post("/api/admin/ads/00000000-0000-0000-0000-000000000000/edit", { instruction: "x" })).statusCode, 404);
  assert.equal((await post("/api/admin/ads/not-an-id/undo")).statusCode, 404);
});

test("Publish happens once under two clicks: one network call, the other click gets 409; the ad goes live with its link, budget and review", opts, async () => {
  const hold = gate();
  const network = fakeNetwork();
  const publish = network.publish;
  network.publish = async (args) => { await hold.wait(); return publish(args); };
  useDeps({ network });
  const [id] = await drafts(1);
  const { code } = await adOf(id);

  const [a, b] = await Promise.all([post(`/api/admin/ads/${id}/publish`), post(`/api/admin/ads/${id}/publish`)]);
  assert.deepEqual([a.statusCode, b.statusCode].sort(), [202, 409]);
  const refused = [a, b].find((r) => r.statusCode === 409).json();
  assert.equal(refused.status, "publishing");
  assert.match(refused.error, /Only a draft can be published, once \(it is publishing\)/);
  assert.equal((await adOf(id)).status, "publishing");
  assert.equal((await post(`/api/admin/ads/${id}/publish`)).statusCode, 409, "a third click too");
  hold.open();
  await adsIdle();

  assert.equal(network.calls.publish.length, 1, "one ad on Facebook");
  const call = network.calls.publish[0];
  assert.equal(call.link, `https://heyprudence.com/a/${code}`);
  assert.equal(call.campaignId, null, "no campaign yet");
  assert.equal(call.name, `Prudence ${code} v1`);
  assert.deepEqual(call.photo, { bytes: jpeg(1), mime: "image/jpeg" });
  assert.ok(call.words.headline.startsWith("Your mother's email"));
  const ad = await adOf(id);
  assert.equal(ad.status, "published");
  assert.ok(ad.publishedAt);
  assert.equal(ad.network, "facebook");
  assert.deepEqual(ad.external, { campaignId: "cmp-1", adsetId: "as-1", creativeId: "cr-1", adId: "1202000001", imageHash: "hash", adsManagerUrl: "https://adsmanager.facebook.com/adsmanager/manage/ads?selected_ad_ids=1202000001" });
  assert.deepEqual(ad.budget, { daily: 5, currency: "USD", days: 7, endsAt: "2026-11-11T00:00:00.000Z" });
  assert.deepEqual([ad.review.state, ad.review.effectiveStatus, ad.review.reasons], ["in_review", "ACTIVE", []]);
  assert.equal(ad.canEdit, false, "a published ad is not edited");
  assert.equal((await post(`/api/admin/ads/${id}/publish`)).statusCode, 409, "published once");
  assert.equal((await post(`/api/admin/ads/${id}/edit`, { instruction: "x" })).statusCode, 409);
  assert.equal(network.calls.publish.length, 1);
});

test("an ad created paused (ADS_LAUNCH_STATUS=PAUSED) reads as paused, ready to resume", opts, async () => {
  const network = fakeNetwork();
  const publish = network.publish;
  network.publish = async (args) => ({ ...(await publish(args)), status: "PAUSED" });
  useDeps({ network });
  const [id] = await drafts(1);
  await post(`/api/admin/ads/${id}/publish`);
  await adsIdle();
  const ad = await adOf(id);
  assert.deepEqual([ad.status, ad.review.state], ["paused", "paused"]);
});

test("a publish failure goes back to draft with the network's plain line, and the next click tries again", opts, async () => {
  const network = fakeNetwork({ async publish() { throw new Error("Facebook refused the ad at the ad set step: (#100) budget too low; access_token=EAABsecret"); } });
  useDeps({ network });
  const [id] = await drafts(1);
  assert.equal((await post(`/api/admin/ads/${id}/publish`)).statusCode, 202);
  await adsIdle();
  const ad = await adOf(id);
  assert.equal(ad.status, "draft");
  assert.match(ad.error, /^Facebook refused the ad at the ad set step: \(#100\) budget too low/);
  assert.ok(!ad.error.includes("EAAB"));
  assert.equal((await one("SELECT count(*)::int AS n FROM ad_campaigns")).n, 0);

  useDeps();
  assert.equal((await post(`/api/admin/ads/${id}/publish`)).statusCode, 202);
  await adsIdle();
  const after = await adOf(id);
  assert.deepEqual([after.status, after.error], ["published", null]);
});

test("the one campaign is created on the first publish, stored, and reused, even for two ads published at once", opts, async () => {
  const { network } = useDeps();
  const [a, b, c] = await drafts(3);
  const [ra, rb] = await Promise.all([post(`/api/admin/ads/${a}/publish`), post(`/api/admin/ads/${b}/publish`)]);
  assert.deepEqual([ra.statusCode, rb.statusCode], [202, 202]);
  await adsIdle();
  assert.deepEqual(network.calls.publish.map((x) => x.campaignId), [null, "cmp-1"], "the second waits for the first, then reuses its campaign");
  assert.deepEqual(await many("SELECT network, external_id FROM ad_campaigns"), [{ network: "facebook", external_id: "cmp-1" }]);

  await post(`/api/admin/ads/${c}/publish`);
  await adsIdle();
  assert.equal(network.calls.publish[2].campaignId, "cmp-1");
  assert.equal((await one("SELECT count(*)::int AS n FROM ad_campaigns")).n, 1);
  assert.deepEqual((await list()).ads.map((x) => x.external.campaignId), ["cmp-1", "cmp-1", "cmp-1"]);
});

test("a publish that made the campaign and then failed keeps that campaign: the next publish reuses it, no second one", opts, async () => {
  const failing = fakeNetwork({
    async publish() {
      throw Object.assign(new Error("Facebook refused the ad at the creative step: (#100) the photo is too small"), { step: "creative", campaignId: "cmp-9", campaignCreated: true, leftovers: [] });
    },
  });
  useDeps({ network: failing });
  const [id] = await drafts(1);
  await post(`/api/admin/ads/${id}/publish`);
  await adsIdle();
  const ad = await adOf(id);
  assert.deepEqual([ad.status, ad.error], ["draft", "Facebook refused the ad at the creative step: (#100) the photo is too small"]);
  assert.deepEqual(await many("SELECT network, external_id FROM ad_campaigns"), [{ network: "facebook", external_id: "cmp-9" }]);

  const { network } = useDeps();
  await post(`/api/admin/ads/${id}/publish`);
  await adsIdle();
  assert.equal(network.calls.publish[0].campaignId, "cmp-9", "the kept campaign");
  assert.equal((await adOf(id)).external.campaignId, "cmp-9");
  assert.equal((await one("SELECT count(*)::int AS n FROM ad_campaigns")).n, 1);

  // A failure before the campaign existed stores nothing.
  await pool.query("TRUNCATE ad_campaigns");
  useDeps({ network: fakeNetwork({ async publish() { throw Object.assign(new Error("Facebook refused the photo"), { step: "image", campaignCreated: false }); } }) });
  const [other] = await drafts(1);
  await post(`/api/admin/ads/${other}/publish`);
  await adsIdle();
  assert.equal((await one("SELECT count(*)::int AS n FROM ad_campaigns")).n, 0);
});

test("the budget label is read from the network on every list (it changes once the ad account's currency is known)", opts, async () => {
  let label = "5 a day · 7 days";
  useDeps({ network: fakeNetwork({ settings: () => ({ budgetLabel: label }) }) });
  assert.equal((await list()).network.budgetLabel, "5 a day · 7 days");
  label = "€5 a day · 7 days";
  assert.equal((await list()).network.budgetLabel, "€5 a day · 7 days");
});

test("Pause stops a live ad and Resume restarts it; Refresh reads Meta's review and reasons; a network failure changes nothing", opts, async () => {
  const { network } = useDeps();
  const id = await published();
  const { external } = await adOf(id);

  assert.equal((await post(`/api/admin/ads/${id}/resume`)).statusCode, 409, "a live ad is not resumed");
  const paused = await post(`/api/admin/ads/${id}/pause`);
  assert.equal(paused.statusCode, 200, paused.body);
  assert.deepEqual(paused.json(), { id, status: "paused" });
  assert.deepEqual(network.calls.setStatus.at(-1), { adId: external.adId, adsetId: external.adsetId, status: "PAUSED" });
  assert.equal((await adOf(id)).status, "paused");
  assert.equal((await post(`/api/admin/ads/${id}/pause`)).statusCode, 409);
  const resumed = await post(`/api/admin/ads/${id}/resume`);
  assert.deepEqual(resumed.json(), { id, status: "published" });
  assert.equal(network.calls.setStatus.at(-1).status, "ACTIVE");

  const refreshed = await post(`/api/admin/ads/${id}/refresh`);
  assert.equal(refreshed.statusCode, 200, refreshed.body);
  assert.deepEqual(network.calls.review, [{ adId: external.adId }]);
  const ad = await adOf(id);
  assert.deepEqual([ad.review.state, ad.review.effectiveStatus, ad.review.reasons], ["rejected", "DISAPPROVED", ["Your ad uses a before-and-after image."]]);
  assert.ok(Date.parse(ad.review.checkedAt));

  useDeps({ network: fakeNetwork({ async setStatus() { throw new Error("Facebook did not answer (timeout)"); }, async review() { throw new Error("Facebook: (#190) token=EAABexpired"); } }) });
  const failed = await post(`/api/admin/ads/${id}/pause`);
  assert.equal(failed.statusCode, 502);
  assert.equal(failed.json().error, "Facebook did not answer (timeout)");
  assert.equal((await adOf(id)).status, "published", "still live: nothing changed");
  const badReview = await post(`/api/admin/ads/${id}/refresh`);
  assert.equal(badReview.statusCode, 502);
  assert.ok(!badReview.body.includes("EAAB"));

  const [draft] = await drafts(1);
  assert.equal((await post(`/api/admin/ads/${draft}/pause`)).statusCode, 409);
  assert.equal((await post(`/api/admin/ads/${draft}/refresh`)).statusCode, 409);
});

test("Reject sets an idea aside with its reason; a live ad is paused on Facebook first", opts, async () => {
  const { network } = useDeps();
  const [draft] = await drafts(1);
  const res = await post(`/api/admin/ads/${draft}/reject`, { reason: "  The photo looks staged. " });
  assert.equal(res.statusCode, 200, res.body);
  assert.deepEqual(res.json(), { id: draft, status: "rejected" });
  let ad = await adOf(draft);
  assert.deepEqual([ad.status, ad.rejectedReason, ad.canEdit], ["rejected", "The photo looks staged.", false]);
  assert.equal((await post(`/api/admin/ads/${draft}/reject`, { reason: "again" })).statusCode, 409);
  assert.equal((await post(`/api/admin/ads/${draft}/publish`)).statusCode, 409, "a rejected idea is never published");
  assert.equal(network.calls.setStatus.length, 0, "a draft never reached Facebook");

  const live = await published();
  const { external } = await adOf(live);
  assert.equal((await post(`/api/admin/ads/${live}/reject`, { reason: "Off message." })).statusCode, 200);
  assert.deepEqual(network.calls.setStatus, [{ adId: external.adId, adsetId: external.adsetId, status: "PAUSED" }]);
  ad = await adOf(live);
  assert.deepEqual([ad.status, ad.rejectedReason], ["rejected", "Off message."]);

  const other = await published();
  useDeps({ network: fakeNetwork({ async setStatus() { throw new Error("Facebook did not answer"); } }) });
  assert.equal((await post(`/api/admin/ads/${other}/reject`, { reason: "x" })).statusCode, 502);
  assert.equal((await adOf(other)).status, "published", "not set aside while it still runs");
  useDeps({ network: fakeNetwork({ configured: () => false, missingKeys: () => ["META_ADS_TOKEN"] }) });
  const blocked = await post(`/api/admin/ads/${other}/reject`, { reason: "x" });
  assert.equal(blocked.statusCode, 503);
  assert.match(blocked.json().error, /Pause it on Facebook first: Facebook needs META_ADS_TOKEN/);
});

test("the photo route sends the bytes as an image with a private five-minute cache", opts, async () => {
  useDeps();
  const [id] = await drafts(1);
  const res = await get(`/api/admin/ads/${id}/photo?v=1`);
  assert.equal(res.statusCode, 200);
  assert.equal(res.headers["content-type"], "image/jpeg");
  assert.equal(res.headers["cache-control"], "private, max-age=300");
  assert.equal(res.headers["x-content-type-options"], "nosniff");
  assert.deepEqual(res.rawPayload, jpeg(1));
  for (const url of [`/api/admin/ads/${id}/photo?v=2`, `/api/admin/ads/${id}/photo?v=0`, `/api/admin/ads/${id}/photo?v=abc`, "/api/admin/ads/not-an-id/photo",
    "/api/admin/ads/00000000-0000-0000-0000-000000000000/photo"]) {
    assert.equal((await get(url)).statusCode, 404, url);
  }
  await pool.query("UPDATE ad_versions SET photo_mime = 'text/html' WHERE ad_id = $1", [id]);
  assert.equal((await get(`/api/admin/ads/${id}/photo`)).headers["content-type"], "application/octet-stream", "never served as a page");
});

test("today's photos and their cost count the versions made since midnight UTC", opts, async () => {
  useDeps();
  const [id] = await drafts(1);
  await pool.query(`INSERT INTO ad_versions (ad_id, version, words, photos_made, created_at)
                    VALUES ($1, 7, '{}', 5, date_trunc('day', now() AT TIME ZONE 'UTC') AT TIME ZONE 'UTC' - interval '1 minute')`, [id]);
  await pool.query(`INSERT INTO ad_versions (ad_id, version, words, photos_made, created_at)
                    VALUES ($1, 8, '{}', 3, date_trunc('day', now() AT TIME ZONE 'UTC') AT TIME ZONE 'UTC')`, [id]);
  assert.deepEqual((await list()).today, { photos: 5, costUsd: 0.05 }, "2 from the draft and 3 at midnight; the 5 before midnight are yesterday's");

  useDeps({ studio: { ...fakeStudio(), PHOTO_COST_USD: 0.04 } });
  assert.deepEqual((await list()).today, { photos: 5, costUsd: 0.2 }, "the studio's price per photo");
});

test(`a row left drafting, editing or publishing for more than ${STALE_MINUTES} minutes reads as failed (interrupted); an interrupted edit can be retried`, opts, async () => {
  useDeps();
  const [drafting] = await createDrafting({ count: 1 });
  const [editing, publishing, fresh] = await drafts(3);
  await pool.query("UPDATE ads SET status = 'editing' WHERE id = ANY($1)", [[editing, fresh]]);
  await pool.query("UPDATE ads SET status = 'publishing' WHERE id = $1", [publishing]);
  await pool.query(`UPDATE ads SET updated_at = now() - interval '${STALE_MINUTES + 1} minutes' WHERE id = ANY($1)`, [[drafting.id, editing, publishing]]);

  const byId = Object.fromEntries((await list()).ads.map((a) => [a.id, a]));
  assert.deepEqual([byId[drafting.id].status, byId[drafting.id].interrupted], ["failed", "drafting"]);
  assert.match(byId[drafting.id].error, /^Interrupted/);
  assert.deepEqual([byId[editing].status, byId[editing].canEdit, byId[editing].canUndo], ["failed", true, false]);
  assert.match(byId[editing].error, /Interrupted: the server stopped during the edit/);
  assert.equal(byId[publishing].status, "failed");
  assert.match(byId[publishing].error, /check Ads Manager/);
  assert.deepEqual([byId[fresh].status, byId[fresh].interrupted, byId[fresh].canEdit], ["editing", null, false], "four minutes is still working");

  assert.equal((await post(`/api/admin/ads/${editing}/edit`, { instruction: "warmer light" })).statusCode, 202, "an interrupted edit can be tried again");
  await adsIdle();
  assert.deepEqual([(await adOf(editing)).status, (await adOf(editing)).version], ["draft", 2]);
  assert.equal((await post(`/api/admin/ads/${fresh}/edit`, { instruction: "x" })).statusCode, 409, "not while an edit runs");
  assert.equal((await post(`/api/admin/ads/${publishing}/publish`)).statusCode, 409, "an interrupted publish is never sent again");
  assert.equal((await post(`/api/admin/ads/${publishing}/reject`, { reason: "Cut by a restart." })).statusCode, 200);
  assert.equal((await post(`/api/admin/ads/${drafting.id}/reject`, { reason: "Cut by a restart." })).statusCode, 200);
  assert.equal((await post(`/api/admin/ads/${fresh}/reject`, { reason: "x" })).statusCode, 409, "a running edit is not set aside");
});

test("each card counts its variant's visits and the early-access requests that came through it", opts, async () => {
  useDeps();
  const [a, b] = await drafts(2);
  const codeA = (await adOf(a)).code;
  await pool.query("UPDATE ads SET visits = 312 WHERE id = $1", [a]);
  await pool.query(`INSERT INTO early_access_requests (email, whose, variant) VALUES
                    ('one@gmail.com', 'parent', $1), ('two@gmail.com', 'mine', $1), ('three@gmail.com', 'parent', 'zzzzzzzz'), ('four@gmail.com', 'parent', NULL)`, [codeA]);
  assert.deepEqual((await adOf(a)).counts, { visits: 312, requests: 2 });
  assert.deepEqual((await adOf(b)).counts, { visits: 0, requests: 0 });
});

test("a code already taken is drawn again", opts, async () => {
  const codes = ["aaaaaaaa", "aaaaaaaa", "aaaaaaaa", "bbbbbbbb"];
  const rows = await createDrafting({ count: 2, code: () => codes.shift() });
  assert.deepEqual(rows.map((r) => r.code), ["aaaaaaaa", "bbbbbbbb"]);
  await assert.rejects(createDrafting({ count: 1, code: () => "aaaaaaaa" }), /duplicate key/, "five collisions in a row is a bug, not bad luck");
});

test("without the studio, the models' keys or Facebook's keys, the routes say so in plain words and nothing is created", opts, async () => {
  useDeps({ studio: null, network: null });
  let data = await list();
  assert.deepEqual(data.network, { name: "facebook", label: "Facebook", installed: false, configured: false, missing: [], budgetLabel: null });
  assert.deepEqual([data.models.installed, data.models.configured], [false, false]);
  const noStudio = await post("/api/admin/ads/ideas", { count: 1 });
  assert.equal(noStudio.statusCode, 503);
  assert.match(noStudio.json().error, /not installed on this server yet/);
  assert.equal((await one("SELECT count(*)::int AS n FROM ads")).n, 0);

  useDeps({ models: async () => ({ words: "Muse Spark", image: "Muse Image 1.0", configured: false, missing: ["META_MODEL_API_KEY"] }) });
  data = await list();
  assert.deepEqual([data.models.installed, data.models.configured, data.models.missing], [true, false, ["META_MODEL_API_KEY"]]);
  const noKey = await post("/api/admin/ads/ideas", { count: 1 });
  assert.equal(noKey.statusCode, 503);
  assert.equal(noKey.json().error, "New ideas needs META_MODEL_API_KEY (make secrets-set).");
  assert.equal((await one("SELECT count(*)::int AS n FROM ads")).n, 0);

  useDeps();
  const [id] = await drafts(1);
  useDeps({ models: async () => ({ configured: false, missing: [] }) });
  assert.equal((await post(`/api/admin/ads/${id}/edit`, { instruction: "x" })).json().error, "An edit is not set up on this server.");
  useDeps({ studio: null });
  assert.equal((await post(`/api/admin/ads/${id}/edit`, { instruction: "x" })).statusCode, 503);

  const network = fakeNetwork({ configured: () => false, missingKeys: () => ["META_ADS_TOKEN", "META_AD_ACCOUNT_ID"], settings: () => { throw new Error("ADS_DAILY_BUDGET is not a number"); } });
  useDeps({ network });
  data = await list();
  assert.deepEqual(data.network, { name: "facebook", label: "Facebook", installed: true, configured: false, missing: ["META_ADS_TOKEN", "META_AD_ACCOUNT_ID"], budgetLabel: null });
  const noFb = await post(`/api/admin/ads/${id}/publish`);
  assert.equal(noFb.statusCode, 503);
  assert.equal(noFb.json().error, "Publishing on Facebook needs META_ADS_TOKEN, META_AD_ACCOUNT_ID (make secrets-set).");
  assert.equal((await adOf(id)).status, "draft", "nothing left");
  assert.equal(network.calls.publish.length, 0);

  useDeps({ network: null });
  assert.match((await post(`/api/admin/ads/${id}/publish`)).json().error, /Facebook publisher .* not installed/);
  assert.equal((await post(`/api/admin/ads/${id}/pause`)).statusCode, 409);

  const live = await (async () => { useDeps(); return published(); })();
  useDeps({ network: null });
  for (const path of ["pause", "refresh"]) assert.equal((await post(`/api/admin/ads/${live}/${path}`)).statusCode, 503, path);
  useDeps({ network: fakeNetwork({ configured: () => false, missingKeys: () => ["META_ADS_TOKEN"] }) });
  assert.match((await post(`/api/admin/ads/${live}/refresh`)).json().error, /Facebook needs META_ADS_TOKEN/);
});

test("a draft without a photo is never sent to the network", opts, async () => {
  const { network } = useDeps({ studio: fakeStudio({ async makePhoto() { return { photo: null, check: null, models: {}, photosMade: 0 }; } }) });
  const [id] = await drafts(1);
  const res = await post(`/api/admin/ads/${id}/publish`);
  assert.equal(res.statusCode, 409);
  assert.match(res.json().error, /no photo/);
  assert.deepEqual([(await adOf(id)).status, network.calls.publish.length], ["draft", 0]);
});

test("the defaults load the studio and the network when they are installed, and the list still answers when they are not", opts, async () => {
  app.adsDeps = undefined;
  const res = await get("/api/admin/ads");
  assert.equal(res.statusCode, 200, res.body);
  const data = res.json();
  assert.deepEqual(Object.keys(data).sort(), ["ads", "landing", "models", "network", "today"]);
  assert.equal(data.network.name, "facebook");
  assert.equal(data.models.configured, false, "no model key in the tests");
});

// ---------------------------------------------------- review round 1 ---

// Wraps one method of a fake so it waits on a gate first.
function gated(fake, method) {
  const g = gate();
  const real = fake[method];
  fake[method] = async (...args) => { await g.wait(); return real.apply(fake, args); };
  return g;
}
const age = (id, minutes) => pool.query(`UPDATE ads SET updated_at = now() - make_interval(mins => $2) WHERE id = $1`, [id, minutes]);

test("a queued publish older than the floor still reads as publishing while this process holds it; Reject, Edit and Undo wait (409)", opts, async () => {
  const network = fakeNetwork();
  const hold = gated(network, "publish");
  useDeps({ network });
  const ids = await drafts(3);
  for (const id of ids) assert.equal((await post(`/api/admin/ads/${id}/publish`)).statusCode, 202);
  for (const id of ids) await age(id, STALE_MINUTES + 5);
  const before = (await list()).ads;
  assert.deepEqual(before.map((a) => [a.status, a.interrupted]), [["publishing", null], ["publishing", null], ["publishing", null]], "queued, never interrupted");
  assert.deepEqual(ids.map(jobOf), ["publishing", "publishing", "publishing"]);
  const third = ids[2];
  const refused = await post(`/api/admin/ads/${third}/reject`, { reason: "Changed my mind." });
  assert.equal(refused.statusCode, 409);
  assert.equal(refused.json().error, "This idea is being published right now: wait for it to finish.");
  assert.equal((await post(`/api/admin/ads/${third}/edit`, { instruction: "x" })).statusCode, 409);
  assert.equal((await post(`/api/admin/ads/${third}/undo`)).statusCode, 409);
  assert.equal((await post(`/api/admin/ads/${third}/publish`)).statusCode, 409);
  hold.open();
  await adsIdle();
  assert.deepEqual((await list()).ads.map((a) => a.status), ["published", "published", "published"]);
  assert.equal(network.calls.publish.length, 3);
  assert.equal(jobOf(third), null, "let go once stored");
});

test("a queued publish set aside elsewhere before its turn never reaches the network", opts, async () => {
  const network = fakeNetwork();
  const hold = gated(network, "publish");
  useDeps({ network });
  const [a, b] = await drafts(2);
  await post(`/api/admin/ads/${a}/publish`);
  await post(`/api/admin/ads/${b}/publish`);
  await pool.query("UPDATE ads SET status = 'rejected', rejected_reason = 'by another server' WHERE id = $1", [b]);
  hold.open();
  await adsIdle();
  assert.equal(network.calls.publish.length, 1, "only the first");
  assert.deepEqual([(await adOf(a)).status, (await adOf(b)).status], ["published", "rejected"]);
});

test("an ad the network made after its row moved on is paused there and kept with its ids, never untracked", opts, async () => {
  const network = fakeNetwork();
  const publish = network.publish;
  network.publish = async (args) => {
    await pool.query("UPDATE ads SET status = 'rejected', rejected_reason = 'by another server' WHERE status = 'publishing'");
    return publish(args);
  };
  useDeps({ network });
  const [id] = await drafts(1);
  await post(`/api/admin/ads/${id}/publish`);
  await adsIdle();
  const ad = await adOf(id);
  assert.deepEqual(network.calls.setStatus, [{ adId: "1202000001", adsetId: "as-1", status: "PAUSED" }]);
  assert.equal(ad.status, "paused");
  assert.equal(ad.external.adId, "1202000001");
  assert.equal(ad.review.state, "paused");
  assert.match(ad.error, /created, then paused at once/);

  // The pause fails too: the row says it is live, and what to do.
  const failing = fakeNetwork({ async setStatus() { throw new Error("Facebook did not answer"); } });
  const publish2 = failing.publish;
  failing.publish = async (args) => {
    await pool.query("UPDATE ads SET status = 'rejected' WHERE status = 'publishing'");
    return publish2(args);
  };
  useDeps({ network: failing });
  const [other] = await drafts(1);
  await post(`/api/admin/ads/${other}/publish`);
  await adsIdle();
  const live = await adOf(other);
  assert.deepEqual([live.status, live.external.adId], ["published", "1202000001"]);
  assert.match(live.error, /could not be paused: pause it in Ads Manager now/);
});

test("once the network made the ad, a store failure never puts the card back to Draft: the write is tried again, else the row stays publishing and the ids are logged", opts, async () => {
  // A blip: the first write fails, the second lands.
  let blips = 0;
  const network = fakeNetwork();
  const publish = network.publish;
  network.publish = async (args) => ({ ...(await publish(args)), budget: { toJSON: () => { if (blips++ === 0) throw new Error("connection reset"); return { daily: 5, currency: "USD", days: 7 }; } } });
  useDeps({ network });
  const [id] = await drafts(1);
  await post(`/api/admin/ads/${id}/publish`);
  await adsIdle();
  assert.equal((await adOf(id)).status, "published");
  assert.deepEqual((await adOf(id)).budget, { daily: 5, currency: "USD", days: 7 });
  assert.equal(network.calls.publish.length, 1);

  // Down for good: the row stays publishing, never draft; the ids are logged without a token.
  const broken = fakeNetwork();
  const publishB = broken.publish;
  broken.publish = async (args) => ({ ...(await publishB(args)), budget: { daily: 5n } });
  useDeps({ network: broken });
  const [stuck] = await drafts(1);
  const logged = [];
  const consoleError = console.error;
  console.error = (...a) => logged.push(a.join(" "));
  try {
    await post(`/api/admin/ads/${stuck}/publish`);
    await adsIdle();
  } finally {
    console.error = consoleError;
  }
  const ad = await adOf(stuck);
  assert.equal(ad.status, "publishing", "never back to draft: a second click would pay twice");
  assert.equal((await post(`/api/admin/ads/${stuck}/publish`)).statusCode, 409);
  assert.equal(broken.calls.publish.length, 1);
  assert.equal(logged.length, 1);
  assert.match(logged[0], new RegExp(`ad 1202000001 \\(ad set as-1, campaign cmp-1\\) is on Facebook but row ${stuck} could not be written`));
  assert.ok(!/EAA|token=/.test(logged[0]));

  let tries = 0;
  await assert.rejects(retried(async () => { tries++; throw new Error("down"); }, [1, 1]), /down/);
  assert.equal(tries, 3, "three tries in all");
});

test("a words-only edit keeps the photo's and the check's model labels", opts, async () => {
  useDeps();
  const [id] = await drafts(1);
  useDeps({ studio: fakeStudio({ async editIdea({ words, photo }) { return { words: { ...words, headline: "Shorter" }, photo, check: null, changed: { words: true, photo: false }, models: { words: "Muse Spark 1.3", image: null, check: null }, photosMade: 0 }; } }) });
  await post(`/api/admin/ads/${id}/edit`, { instruction: "shorter headline" });
  await adsIdle();
  const ad = await adOf(id);
  assert.deepEqual([ad.version, ad.words.headline], [2, "Shorter"]);
  assert.deepEqual(ad.models, { words: "Muse Spark 1.3", image: "Muse Image 1.0", check: "Muse Spark" });
  assert.deepEqual(ad.check, CHECK, "the check of the photo it kept");
});

test(`an edit or a draft still running after ${STALE_MINUTES} minutes is not interrupted; a result that lands after the idea moved on says so instead of vanishing`, opts, async () => {
  assert.equal(STALE_MINUTES, 15, "longer than the slowest edit (about 7 minutes)");
  const studio = fakeStudio();
  const editing = gated(studio, "editIdea");
  useDeps({ studio });
  const [id] = await drafts(1);
  await post(`/api/admin/ads/${id}/edit`, { instruction: "evening light" });
  await age(id, STALE_MINUTES + 5);
  const ad = await adOf(id);
  assert.deepEqual([ad.status, ad.interrupted, ad.canEdit], ["editing", null, false]);
  const again = await post(`/api/admin/ads/${id}/edit`, { instruction: "x" });
  assert.equal(again.statusCode, 409);
  assert.equal(again.json().error, "Muse Spark and Muse Image are still editing this idea: wait for it to finish.");
  assert.equal((await post(`/api/admin/ads/${id}/undo`)).statusCode, 409);
  assert.equal((await post(`/api/admin/ads/${id}/reject`, { reason: "x" })).statusCode, 409);
  await pool.query("UPDATE ads SET status = 'rejected' WHERE id = $1", [id]); // another server set it aside
  editing.open();
  await adsIdle();
  const after = await adOf(id);
  assert.deepEqual([after.status, after.version], ["rejected", 1]);
  assert.equal(after.error, 'The edit "evening light" finished after the idea had moved on (it is rejected): it was not kept.');

  const drafting = fakeStudio();
  const photo = gated(drafting, "makePhoto");
  useDeps({ studio: drafting });
  const res = await post("/api/admin/ads/ideas", { count: 1 });
  const [late] = res.json().ids;
  await age(late, STALE_MINUTES + 5);
  assert.deepEqual([(await adOf(late)).status, jobOf(late)], ["drafting", "drafting"]);
  assert.equal((await post(`/api/admin/ads/${late}/reject`, { reason: "x" })).statusCode, 409);
  await pool.query("UPDATE ads SET status = 'rejected' WHERE id = $1", [late]);
  photo.open();
  await adsIdle();
  assert.equal((await adOf(late)).error, "This idea was finished after it had moved on (it is rejected): its words and photo were not kept.");
});

test("a server that shuts down during an edit says so, even when the model layer renamed the abort", opts, async () => {
  useDeps();
  const [id] = await drafts(1);
  const other = await buildApp({ logger: false });
  other.adsDeps = {
    studio: fakeStudio({ editIdea: ({ signal }) => new Promise((_, reject) => signal.addEventListener("abort", () => reject(new Error("Muse Spark request was cancelled")))) }),
    network: fakeNetwork(),
    models: MODELS,
  };
  const res = await other.inject({ method: "POST", url: `/api/admin/ads/${id}/edit`, headers: { origin: ORIGIN, ...adminHeaders }, payload: { instruction: "warmer light" } });
  assert.equal(res.statusCode, 202, res.body);
  await other.close();
  const ad = await adOf(id);
  assert.deepEqual([ad.status, ad.error], ["draft", "Stopped: the server was shutting down. Try again."]);
});

test("a studio module that is installed but broken answers 500, never 'not installed'; a missing one is 'not installed'", opts, async () => {
  const dir = await mkdtemp(join(tmpdir(), "ads-broken-"));
  const make = async (modules) => {
    const f = Fastify({ logger: false });
    f.addHook("onRequest", async (request) => { request.user = { isAdmin: true, email: "admin@example.test" }; });
    await f.register(adsRoutes, { modules });
    return f;
  };
  try {
    await writeFile(join(dir, "studio.mjs"), 'import "./guardrails-not-there.mjs";\n');
    const broken = await make({ studio: pathToFileURL(join(dir, "studio.mjs")).href });
    const res = await broken.inject({ url: "/api/admin/ads" });
    assert.equal(res.statusCode, 500);
    await broken.close();
    const missing = await make({ studio: pathToFileURL(join(dir, "nothing.mjs")).href, networks: pathToFileURL(join(dir, "nothing.mjs")).href });
    const ok = await missing.inject({ url: "/api/admin/ads" });
    assert.equal(ok.statusCode, 200, ok.body);
    assert.deepEqual([ok.json().models.installed, ok.json().network.installed], [false, false]);
    await missing.close();
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
