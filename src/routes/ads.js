// The ad studio's admin API (_product/specs/ad-studio.md, lines 2 to 10;
// contract C4 of docs/plans/2026-11-04-ad-studio.md). Admins only, like
// src/routes/adminDb.js. No request waits for a model: New ideas and an
// edit answer 202 at once and the work runs in this process, the console
// polling the list until each card is a draft again (or failed, with a
// plain line). Publish moves the ad `draft -> publishing` in one UPDATE, so
// a second click gets 409 and nothing reaches the network twice; the
// network calls run one at a time per network, so the one Prudence
// campaign is created once. A failure before the network made the ad goes
// back to draft with the network's plain line, never a token; once the
// network has made it, the row never goes back to draft (a second click
// would pay twice). Each job holds its ads in an in-process registry while
// it runs (queued publishes included): a held ad is never read as
// interrupted, and Edit, Undo and Reject wait for it (409).
//
// The models and the network sit behind a seam: `deps` (an option of the
// plugin) or `app.adsDeps`, each of { studio, network, models } optional;
// otherwise lib/ads/studio.js, lib/ads/networks/index.js (Facebook) and
// lib/llm/index.js are imported on first use (dynamically: the routes were
// built before them). Only that very module being absent reads as "not
// installed" (503 with a plain line, and the list says so); any other
// import error is a 500, logged with its message.

import { requireUser, requireAdmin } from "../auth.js";
import { config } from "../config.js";
import * as store from "../ads/store.js";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const LIMITS = { brief: 500, instruction: 500, reason: 300, minCount: 1, maxCount: 4, defaultCount: 3 };
export const PHOTO_COST_USD = 0.01;
const LANDING = "https://heyprudence.com";
const LIMIT = { rateLimit: { max: 10, timeWindow: "1 minute" } };
const PHOTO_TYPES = ["image/jpeg", "image/png", "image/webp"];
// The key each provider reads (lib/llm/), named when New ideas is off.
const PROVIDER_KEYS = { meta: "META_MODEL_API_KEY", openai: "OPENAI_API_KEY", anthropic: "ANTHROPIC_API_KEY", baseten: "BASETEN_API_KEY" };

// The address an ad links to: this server's in production, else the public
// site (a laptop or a Codespace is never a place to send an ad's visitors).
export const landingBase = (c = config) => (c.production && c.baseUrl.startsWith("https://") ? c.baseUrl : LANDING);

// A failure as one plain line: no token, no secret in a query string, 300
// characters at most. `stopped`: this server's shutdown cut the work (read
// from the controller's signal, whatever a layer renamed the error to).
export function plainError(e, fallback = "Something went wrong.", stopped = false) {
  if (stopped) return "Stopped: the server was shutting down. Try again.";
  const text = String(e?.message || e || "").trim() || fallback;
  return text
    .replace(/\bEA[A-Za-z0-9]{20,}/g, "[hidden]")
    .replace(/\b(access_token|token|key|secret|password)=([^&\s"']+)/gi, "$1=[hidden]")
    .replace(/\bBearer\s+\S+/gi, "Bearer [hidden]")
    .slice(0, 300);
}

// ---- Background work -------------------------------------------------------

const pending = new Set();
// Resolves once every background task (ideas, edits, publishes) has ended.
export async function adsIdle() {
  while (pending.size) await Promise.allSettled([...pending]);
}

// The ads a job of this process works on: id -> "drafting" | "editing" | "publishing".
const jobs = new Map();
export const jobOf = (id) => jobs.get(id) ?? null;
// The instruction an edit of this process is applying, by ad id: the card shows it.
const applying = new Map();
const BUSY_LINE = {
  drafting: "Muse Spark and Muse Image are still making this idea",
  editing: "Muse Spark and Muse Image are still editing this idea",
  publishing: "This idea is being published right now",
  pausing: "This ad is being paused right now",
  resuming: "This ad is being restarted right now",
  rejecting: "This idea is being set aside right now",
};

// The ad held in the registry while a request's network call on it runs
// (Pause, Resume, Reject); called right after held() said it was free.
async function holding(id, kind, fn) {
  jobs.set(id, kind);
  try { return await fn(); } finally { if (jobs.get(id) === kind) jobs.delete(id); }
}

// A background job holding `ids` until it ends; `release(id)` lets one go earlier.
function background(log, ids, kind, fn) {
  for (const id of ids) jobs.set(id, kind);
  const release = (id) => { if (jobs.get(id) === kind) jobs.delete(id); };
  const p = Promise.resolve().then(() => fn(release))
    .catch((e) => log.error({ err: e }, "ad studio background task failed"))
    .finally(() => { for (const id of ids) release(id); pending.delete(p); });
  pending.add(p);
}

// One network call chain at a time per network.
const chains = new Map();
function serial(key, fn) {
  const run = (chains.get(key) || Promise.resolve()).then(fn);
  chains.set(key, run.catch(() => {}));
  return run;
}

// A store write after the network made the ad: three tries in all.
export async function retried(fn, waits = [100, 400]) {
  for (let i = 0; ; i++) {
    try { return await fn(); } catch (e) {
      if (i >= waits.length) throw e;
      await new Promise((r) => setTimeout(r, waits[i]));
    }
  }
}

// ---- The seam --------------------------------------------------------------

export const MODULES = {
  studio: new URL("../../lib/ads/studio.js", import.meta.url).href,
  networks: new URL("../../lib/ads/networks/index.js", import.meta.url).href,
  llm: new URL("../../lib/llm/index.js", import.meta.url).href,
};

// A module that may not be installed yet: its namespace, or null when that
// very module is missing. Anything else (a module it imports is missing, a
// syntax error, a throw while loading) is thrown, so the route answers 500.
export async function importOptional(url) {
  try { return await import(url); } catch (e) {
    if (e?.code === "ERR_MODULE_NOT_FOUND" && e.url === url) return null;
    throw e;
  }
}

// The words model's full label with its version ("Muse Spark 1.3", as the
// cards name it) through the studio's modelLabel; the provider's label otherwise.
function wordsLabel(llm, studio) {
  try {
    if (typeof studio?.modelLabel === "function" && typeof llm.llmModel === "function") return studio.modelLabel(llm.llmModel());
  } catch { /* an unknown provider: its plain label below */ }
  return llm.llmLabel();
}

// The models that write, draw and check, by their labels, and whether New
// ideas can run, through the llm layer's own resolvers (IMAGE_PROVIDER=muse is meta).
export function modelsFrom(llm, env = process.env, studio = null) {
  if (!llm) return { words: null, image: null, configured: false, missing: [] };
  const hasImages = typeof llm.imageConfigured === "function";
  const wordsOk = llm.llmConfigured();
  const imageOk = hasImages && llm.imageConfigured();
  const imageProvider = typeof llm.imageProviderName === "function" ? llm.imageProviderName() : String(env.IMAGE_PROVIDER || "meta").trim().toLowerCase();
  const missing = [];
  if (!wordsOk) missing.push(PROVIDER_KEYS[llm.llmProviderName()]);
  if (hasImages && !imageOk) missing.push(PROVIDER_KEYS[imageProvider]);
  return {
    words: wordsLabel(llm, studio),
    image: typeof llm.imageLabel === "function" ? llm.imageLabel() : null,
    configured: wordsOk && imageOk,
    missing: [...new Set(missing.filter(Boolean))],
  };
}
export const defaultModels = async (url = MODULES.llm, studio = null) => modelsFrom(await importOptional(url), process.env, studio);

async function resolveDeps(app, given, modules) {
  const d = given || app.adsDeps || {};
  return {
    studio: "studio" in d ? d.studio : await importOptional(modules.studio),
    network: "network" in d ? d.network : (await importOptional(modules.networks))?.getNetwork("facebook") ?? null,
    models: "models" in d ? d.models : (studio) => defaultModels(modules.llm, studio),
  };
}

function networkInfo(n) {
  if (!n) return { name: "facebook", label: "Facebook", installed: false, configured: false, missing: [], budgetLabel: null };
  let budgetLabel = null;
  // Read on every call: the label changes once the network knows the ad account's currency.
  try { budgetLabel = n.settings?.()?.budgetLabel ?? null; } catch { /* a bad ADS_* value: the label stays empty */ }
  return { name: n.name || "facebook", label: n.label || "Facebook", installed: true, configured: Boolean(n.configured()), missing: n.missingKeys?.() || [], budgetLabel };
}

async function modelsInfo(d) {
  const m = { words: null, image: null, configured: false, missing: [], ...(await (typeof d.models === "function" ? d.models(d.studio) : d.models)) };
  return { ...m, installed: Boolean(d.studio), configured: Boolean(d.studio) && Boolean(m.configured) };
}

const notInstalled = (what) => `The ad studio's ${what} is not installed on this server yet.`;
const needsKeys = (what, missing) => (missing?.length ? `${what} needs ${missing.join(", ")} (make secrets-set).` : `${what} is not set up on this server.`);

// ---- Input -------------------------------------------------------------------

function textField(v, { max, required, name }) {
  if (v != null && typeof v !== "string") return { error: `The ${name} must be text.` };
  const s = String(v ?? "").trim();
  if (required && !s) return { error: `Write the ${name} first.` };
  if (s.length > max) return { error: `The ${name} is at most ${max} characters.` };
  return { value: s || null };
}

function countField(v) {
  if (v == null || v === "") return { value: LIMITS.defaultCount };
  const n = Number(v);
  if (!Number.isInteger(n) || n < LIMITS.minCount || n > LIMITS.maxCount) return { error: `Choose ${LIMITS.minCount} to ${LIMITS.maxCount} ideas.` };
  return { value: n };
}

// Why an idea Muse Spark set aside has no draft (the studio's own reason when it gives one).
function droppedLine(proposal, j) {
  const d = Array.isArray(proposal?.dropped) ? proposal.dropped[j] : null;
  const why = typeof d === "string" ? d : d?.reason || (Array.isArray(d?.problems) ? d.problems.join("; ") : "");
  return why
    ? `Set aside by the word check after one rewrite: ${plainError({ message: why })}`
    : "Muse Spark wrote fewer ideas than asked: this one was set aside by the word check.";
}

const stripBasedOn = (models) => { const { basedOn, ...rest } = models || {}; return rest; };
// The labels of the models that made a version: one the edit did not call (null) keeps its earlier label.
export const mergeModels = (before, after) => ({
  ...stripBasedOn(before),
  ...Object.fromEntries(Object.entries(after || {}).filter(([, v]) => v != null)),
});
const photoOf = (ad) => (ad?.photo ? { bytes: ad.photo, mime: ad.photo_mime || "image/jpeg" } : null);

// ---- Publishing ------------------------------------------------------------------

const STOPPED = "Stopped: the server was shutting down. Try again.";

async function publishJob({ ad, net, network, log, signal }) {
  let out;
  let campaignId;
  try {
    // Set aside while it waited for the network (elsewhere): nothing is sent.
    if ((await store.statusOf(ad.id)) !== "publishing") return;
    campaignId = await store.getCampaign(net.name);
    // The server began shutting down while this one waited: no network call starts after that.
    if (signal?.aborted) {
      await store.publishFailed(ad.id, STOPPED);
      return;
    }
    out = await network.publish({
      name: `Prudence ${ad.code} v${ad.version}`,
      words: ad.words,
      photo: photoOf(ad),
      link: `${landingBase()}/a/${ad.code}`,
      campaignId,
    });
  } catch (e) {
    // The campaign was made before a later step failed: keep it, so the next publish reuses it.
    if (e?.campaignCreated && e?.campaignId) {
      await store.saveCampaign(net.name, String(e.campaignId)).catch((err) => log.error({ err }, "ad campaign not stored"));
    }
    await store.publishFailed(ad.id, plainError(e, `${net.label} refused the ad.`));
    return;
  }

  // The ad exists on the network from here: the row never goes back to draft.
  const { campaignId: cid, adsetId, creativeId, adId, imageHash, adsManagerUrl } = out;
  const paused = String(out.status || "").toUpperCase() === "PAUSED";
  const record = {
    network: net.name,
    external: { campaignId: cid ?? campaignId, adsetId, creativeId, adId, imageHash, adsManagerUrl },
    budget: out.budget ?? null,
    review: { state: paused ? "paused" : "in_review", effectiveStatus: out.status ?? null, reasons: [], checkedAt: new Date().toISOString() },
  };
  // The ad's own row first, tried three times. Once publishDone has said the
  // row moved on, it is never called again in this publish: a retry only
  // finishes keeping the ad (and pauses it on the network at most once).
  let movedOn = false;
  let stopped = null;
  try {
    await retried(async () => {
      if (!movedOn) {
        if (await store.publishDone(ad.id, record, { paused })) return;
        movedOn = true;
      }
      if (stopped === null) {
        try {
          await network.setStatus({ adId, adsetId, status: "PAUSED" });
          stopped = true;
        } catch (e) {
          stopped = false;
          log.error({ adId, err: plainError(e) }, "ad studio: a set-aside ad could not be paused");
        }
      }
      await store.keepAd(ad.id, { ...record, review: { ...record.review, state: stopped ? "paused" : record.review.state } }, stopped
        ? { status: "paused", error: `Set aside while ${net.label} was making it: the ad was created, then paused at once. Check it in Ads Manager.` }
        : { status: "published", error: `Set aside while ${net.label} was making it, and it could not be paused: pause it in Ads Manager now.` });
    });
  } catch (e) {
    // Loud, with the ids an admin needs in Ads Manager, never a token. The row stays `publishing`.
    const line = `ad studio: ad ${adId} (ad set ${adsetId}, campaign ${record.external.campaignId}) is on ${net.label} but row ${ad.id} could not be written: ${plainError(e)}`;
    log.error(line);
    console.error(line);
  }

  // Then the one campaign, apart: its failure is only logged (the ad's row already names it).
  if (out.campaignCreated && out.campaignId) {
    try {
      await retried(() => store.saveCampaign(net.name, String(out.campaignId)));
    } catch (e) {
      const line = `ad studio: campaign ${out.campaignId} on ${net.label} was not stored, the next publish may make another: ${plainError(e)}`;
      log.error(line);
      console.error(line);
    }
  }
}

// ---- Routes --------------------------------------------------------------------

export default async function adsRoutes(app, opts = {}) {
  const controller = new AbortController();
  app.addHook("onClose", async () => { controller.abort(); await adsIdle(); });
  const modules = { ...MODULES, ...opts.modules };

  app.register(async (adm) => {
    adm.addHook("preHandler", requireUser);
    adm.addHook("preHandler", requireAdmin);
    const deps = () => resolveDeps(app, opts.deps, modules);

    // The ad, or the reply already sent (404).
    async function adOr404(request, reply) {
      const id = request.params.id;
      const ad = UUID.test(id) ? await store.getAd(id) : null;
      if (!ad) reply.code(404).send({ error: "Unknown ad." });
      return ad;
    }
    // 409 with the state the ad is in now (a second click reads the first one's move).
    async function conflict(reply, ad, line) {
      const status = (await store.statusOf(ad.id)) ?? ad.status;
      return reply.code(409).send({ error: `${line} (it is ${status}).`, status });
    }
    // 409 while a job of this process works on the ad; null otherwise.
    function held(reply, id) {
      const kind = jobs.get(id);
      return kind ? reply.code(409).send({ error: `${BUSY_LINE[kind]}: wait for it to finish.`, status: kind }) : null;
    }

    adm.get("/api/admin/ads", async () => {
      const d = await deps();
      const [ads, photos, models] = await Promise.all([store.listAds({ held: new Set(jobs.keys()) }), store.photosToday(), modelsInfo(d)]);
      const each = Number(d.studio?.PHOTO_COST_USD ?? PHOTO_COST_USD);
      return {
        ads: ads.map((a) => ({ ...a, applying: applying.get(a.id) ?? null })),
        today: { photos, costUsd: Math.round(photos * each * 100) / 100 },
        network: networkInfo(d.network),
        models,
        landing: landingBase(),
      };
    });

    adm.post("/api/admin/ads/ideas", { config: LIMIT }, async (request, reply) => {
      const brief = textField(request.body?.brief, { max: LIMITS.brief, name: "brief" });
      if (brief.error) return reply.code(400).send({ error: brief.error, field: "brief" });
      const count = countField(request.body?.count);
      if (count.error) return reply.code(400).send({ error: count.error, field: "count" });
      const d = await deps();
      if (!d.studio) return reply.code(503).send({ error: notInstalled("idea writer (lib/ads/studio.js)") });
      const models = await modelsInfo(d);
      if (!models.configured) return reply.code(503).send({ error: needsKeys("New ideas", models.missing), missing: models.missing });

      const rows = await store.createDrafting({ brief: brief.value, count: count.value, createdBy: request.user.email });
      const { signal } = controller;
      background(request.log, rows.map((r) => r.id), "drafting", async (release) => {
        let proposal;
        try {
          proposal = await d.studio.proposeIdeas({ brief: brief.value || undefined, count: count.value, signal });
        } catch (e) {
          await Promise.all(rows.map((r) => store.markFailed(r.id, plainError(e, "Muse Spark could not write the ideas.", signal.aborted))));
          return;
        }
        const ideas = Array.isArray(proposal?.ideas) ? proposal.ideas : [];
        await Promise.all(rows.map(async (row, i) => {
          try {
            const words = ideas[i];
            if (!words) return await store.markFailed(row.id, droppedLine(proposal, i - ideas.length));
            let made;
            try {
              made = await d.studio.makePhoto({ words, signal });
            } catch (e) {
              return await store.markFailed(row.id, plainError(e, "The photo could not be made.", signal.aborted));
            }
            const kept = await store.addVersion(row.id, {
              words, photo: made.photo, check: made.check ?? null, photosMade: made.photosMade ?? 0,
              models: { words: proposal.model ?? null, image: made.models?.image ?? null, check: made.models?.check ?? null },
            }, { from: ["drafting"] });
            if (!kept) await store.noteError(row.id, `This idea was finished after it had moved on (it is ${await store.statusOf(row.id)}): its words and photo were not kept.`);
          } finally {
            release(row.id);
          }
        }));
      });
      return reply.code(202).send({ ids: rows.map((r) => r.id) });
    });

    adm.post("/api/admin/ads/:id/edit", { config: LIMIT }, async (request, reply) => {
      const instruction = textField(request.body?.instruction, { max: LIMITS.instruction, required: true, name: "instruction" });
      if (instruction.error) return reply.code(400).send({ error: instruction.error, field: "instruction" });
      const found = await adOr404(request, reply);
      if (!found) return reply;
      if (held(reply, found.id)) return reply;
      const d = await deps();
      if (!d.studio) return reply.code(503).send({ error: notInstalled("idea writer (lib/ads/studio.js)") });
      const models = await modelsInfo(d);
      if (!models.configured) return reply.code(503).send({ error: needsKeys("An edit", models.missing), missing: models.missing });
      const ad = await store.startEdit(found.id);
      if (!ad) return conflict(reply, found, "Only a draft can be edited");

      const { signal } = controller;
      applying.set(ad.id, instruction.value);
      background(request.log, [ad.id], "editing", async () => {
        try {
          let out;
          try {
            out = await d.studio.editIdea({ words: ad.words, photo: photoOf(ad), instruction: instruction.value, signal });
          } catch (e) {
            await store.editFailed(ad.id, plainError(e, "The edit could not be made.", signal.aborted));
            return;
          }
          const kept = await store.addVersion(ad.id, {
            words: out.words ?? ad.words,
            photo: out.photo ?? photoOf(ad),
            check: out.check ?? ad.photo_check,
            models: mergeModels(ad.models, out.models),
            instruction: instruction.value,
            photosMade: out.photosMade ?? 0,
          }, { from: ["editing"] });
          if (!kept) await store.noteError(ad.id, `The edit "${instruction.value.slice(0, 80)}" finished after the idea had moved on (it is ${await store.statusOf(ad.id)}): it was not kept.`);
        } finally {
          applying.delete(ad.id);
        }
      });
      return reply.code(202).send({ id: ad.id, status: "editing" });
    });

    adm.post("/api/admin/ads/:id/undo", async (request, reply) => {
      const found = await adOr404(request, reply);
      if (!found) return reply;
      if (held(reply, found.id)) return reply;
      const out = await store.undo(found.id);
      if (!out) return conflict(reply, found, "Nothing to undo: there is no earlier version, or the idea is busy");
      return { id: out.id, version: out.version, status: "draft" };
    });

    adm.post("/api/admin/ads/:id/publish", async (request, reply) => {
      const found = await adOr404(request, reply);
      if (!found) return reply;
      if (held(reply, found.id)) return reply;
      const d = await deps();
      const net = networkInfo(d.network);
      if (!net.installed) return reply.code(503).send({ error: notInstalled("Facebook publisher (lib/ads/networks/)") });
      if (!net.configured) return reply.code(503).send({ error: needsKeys(`Publishing on ${net.label}`, net.missing), missing: net.missing });
      const ad = await store.startPublish(found.id);
      if (!ad) return conflict(reply, found, "Only a draft can be published, once");
      if (!ad.photo) {
        await store.publishFailed(ad.id, "This idea has no photo: edit it to make one, then publish.");
        return reply.code(409).send({ error: "This idea has no photo: edit it to make one, then publish." });
      }
      // Held from the click, through the wait for the network, to the stored result.
      const network = d.network;
      const log = request.log;
      background(log, [ad.id], "publishing", () => serial(net.name, () => publishJob({ ad, net, network, log, signal: controller.signal })));
      return reply.code(202).send({ id: ad.id, status: "publishing" });
    });

    // Pause and Resume: the network first, then the row, the ad held all along
    // (Reject answers 409 meanwhile). A restart the row does not take is paused again.
    for (const [path, running] of [["pause", false], ["resume", true]]) {
      adm.post(`/api/admin/ads/:id/${path}`, async (request, reply) => {
        const ad = await adOr404(request, reply);
        if (!ad) return reply;
        if (held(reply, ad.id)) return reply;
        return holding(ad.id, running ? "resuming" : "pausing", async () => {
          const status = await store.statusOf(ad.id);
          if (status !== (running ? "paused" : "published") || !ad.external?.adId) {
            return conflict(reply, ad, running ? "Only a paused ad can be resumed" : "Only a live ad can be paused");
          }
          const d = await deps();
          const net = networkInfo(d.network);
          if (!net.installed || !net.configured) return reply.code(503).send({ error: net.installed ? needsKeys(net.label, net.missing) : notInstalled("Facebook publisher (lib/ads/networks/)") });
          const ids = { adId: ad.external.adId, adsetId: ad.external.adsetId };
          try {
            await d.network.setStatus({ ...ids, status: running ? "ACTIVE" : "PAUSED" });
          } catch (e) {
            return reply.code(502).send({ error: plainError(e, `${net.label} did not answer.`) });
          }
          let moved = false;
          try {
            moved = await store.setRunning(ad.id, running);
          } catch (e) {
            request.log.error({ err: e }, "ad studio: the row of a paused or restarted ad was not written");
          }
          if (moved) return { id: ad.id, status: running ? "published" : "paused" };
          if (!running) return reply.code(409).send({ error: `The ad is paused on ${net.label}, but its card could not be updated: refresh the page.` });
          try {
            await d.network.setStatus({ ...ids, status: "PAUSED" });
          } catch (e) {
            return reply.code(502).send({ error: `The ad restarted on ${net.label} but its card could not be updated, and pausing it again failed: pause it in Ads Manager now. (${plainError(e)})` });
          }
          return reply.code(409).send({ error: `The ad's card could not be updated, so it was paused again on ${net.label}. Refresh the page and try again.` });
        });
      });
    }

    adm.post("/api/admin/ads/:id/refresh", async (request, reply) => {
      const ad = await adOr404(request, reply);
      if (!ad) return reply;
      if (!["published", "paused"].includes(ad.status) || !ad.external?.adId) return conflict(reply, ad, "Only a published ad has a review to read");
      const d = await deps();
      const net = networkInfo(d.network);
      if (!net.installed || !net.configured) return reply.code(503).send({ error: net.installed ? needsKeys(net.label, net.missing) : notInstalled("Facebook publisher (lib/ads/networks/)") });
      let review;
      try {
        const r = await d.network.review({ adId: ad.external.adId });
        review = { state: r.state, effectiveStatus: r.effectiveStatus ?? null, reasons: Array.isArray(r.reasons) ? r.reasons.map(String) : [], checkedAt: new Date().toISOString() };
      } catch (e) {
        return reply.code(502).send({ error: plainError(e, `${net.label} did not answer.`) });
      }
      await store.setReview(ad.id, review);
      return { id: ad.id, review };
    });

    adm.post("/api/admin/ads/:id/reject", async (request, reply) => {
      const reason = textField(request.body?.reason, { max: LIMITS.reason, required: true, name: "reason" });
      if (reason.error) return reply.code(400).send({ error: reason.error, field: "reason" });
      const ad = await adOr404(request, reply);
      if (!ad) return reply;
      if (held(reply, ad.id)) return reply;
      return holding(ad.id, "rejecting", async () => {
        // Any ad with a number stops on the network before it is set aside, whatever the row says.
        if (ad.external?.adId && (await store.statusOf(ad.id)) !== "rejected") {
          const d = await deps();
          const net = networkInfo(d.network);
          if (!net.installed || !net.configured) return reply.code(503).send({ error: `Pause it on ${net.label} first: ${net.installed ? needsKeys(net.label, net.missing) : notInstalled("Facebook publisher")}` });
          try {
            await d.network.setStatus({ adId: ad.external.adId, adsetId: ad.external.adsetId, status: "PAUSED" });
          } catch (e) {
            return reply.code(502).send({ error: plainError(e, `${net.label} did not answer.`) });
          }
        }
        if (!(await store.reject(ad.id, reason.value))) return conflict(reply, ad, "This idea cannot be set aside now");
        return { id: ad.id, status: "rejected" };
      });
    });

    adm.get("/api/admin/ads/:id/photo", async (request, reply) => {
      const id = request.params.id;
      const v = request.query?.v;
      const version = v == null || v === "" ? null : Number(v);
      if (!UUID.test(id) || (version !== null && (!Number.isInteger(version) || version < 1 || version > 100000))) {
        return reply.code(404).send({ error: "Unknown photo." });
      }
      const p = await store.photo(id, version);
      if (!p) return reply.code(404).send({ error: "Unknown photo." });
      return reply
        .header("content-type", PHOTO_TYPES.includes(p.mime) ? p.mime : "application/octet-stream")
        .header("cache-control", "private, max-age=300")
        .send(p.bytes);
    });
  });
}
