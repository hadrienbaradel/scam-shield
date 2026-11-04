// The ad studio's admin API (_product/specs/ad-studio.md, lines 2 to 10;
// contract C4 of docs/plans/2026-11-04-ad-studio.md). Admins only, like
// src/routes/adminDb.js. No request waits for a model: New ideas and an
// edit answer 202 at once and the work runs in this process, the console
// polling the list until each card is a draft again (or failed, with a
// plain line). Publish moves the ad `draft -> publishing` in one UPDATE, so
// a second click gets 409 and nothing reaches the network twice; the
// network calls run one at a time per network, so the one Prudence
// campaign is created once. A failure goes back to draft with the
// network's plain line, never a token.
//
// The models and the network sit behind a seam: `deps` (an option of the
// plugin) or `app.adsDeps`, each of { studio, network, models } optional;
// otherwise lib/ads/studio.js, lib/ads/networks/index.js (Facebook) and
// lib/llm/index.js are imported on first use. A piece that is not
// installed answers 503 with a plain line, and the list says so.

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

// A failure as one plain line: no token, no secret in a query string, 300 characters at most.
export function plainError(e, fallback = "Something went wrong.") {
  if (e?.name === "AbortError") return "Stopped: the server was shutting down. Try again.";
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
function background(log, fn) {
  const p = Promise.resolve().then(fn).catch((e) => log.error({ err: e }, "ad studio background task failed")).finally(() => pending.delete(p));
  pending.add(p);
}

// One network call chain at a time per network.
const chains = new Map();
function serial(key, fn) {
  const run = (chains.get(key) || Promise.resolve()).then(fn);
  chains.set(key, run.catch(() => {}));
  return run;
}

// ---- The seam --------------------------------------------------------------

// A module that may not exist yet: its namespace, or null.
export async function importOptional(url) {
  try { return await import(url); } catch { return null; }
}

async function defaultStudio() {
  return importOptional(new URL("../../lib/ads/studio.js", import.meta.url).href);
}

async function defaultNetwork() {
  const mod = await importOptional(new URL("../../lib/ads/networks/index.js", import.meta.url).href);
  try { return mod?.getNetwork?.("facebook") ?? null; } catch { return null; }
}

// The models that write, draw and check, by their labels, and whether New ideas can run.
export async function defaultModels() {
  const llm = await importOptional(new URL("../../lib/llm/index.js", import.meta.url).href);
  if (!llm) return { words: null, image: null, configured: false, missing: [] };
  const hasImages = typeof llm.imageConfigured === "function";
  const wordsOk = llm.llmConfigured();
  const imageOk = hasImages && llm.imageConfigured();
  const missing = [];
  if (!wordsOk) missing.push(PROVIDER_KEYS[llm.llmProviderName()]);
  if (hasImages && !imageOk) missing.push(PROVIDER_KEYS[String(process.env.IMAGE_PROVIDER || "meta").trim().toLowerCase()]);
  return {
    words: llm.llmLabel(),
    image: typeof llm.imageLabel === "function" ? llm.imageLabel() : null,
    configured: wordsOk && imageOk,
    missing: [...new Set(missing.filter(Boolean))],
  };
}

async function resolveDeps(app, given) {
  const d = given || app.adsDeps || {};
  return {
    studio: "studio" in d ? d.studio : await defaultStudio(),
    network: "network" in d ? d.network : await defaultNetwork(),
    models: "models" in d ? d.models : defaultModels,
  };
}

function networkInfo(n) {
  if (!n) return { name: "facebook", label: "Facebook", installed: false, configured: false, missing: [], budgetLabel: null };
  let budgetLabel = null;
  try { budgetLabel = n.settings?.()?.budgetLabel ?? null; } catch { /* a bad ADS_* value: the label stays empty */ }
  return { name: n.name || "facebook", label: n.label || "Facebook", installed: true, configured: Boolean(n.configured()), missing: n.missingKeys?.() || [], budgetLabel };
}

async function modelsInfo(d) {
  const m = { words: null, image: null, configured: false, missing: [], ...(await (typeof d.models === "function" ? d.models() : d.models)) };
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
const photoOf = (ad) => (ad?.photo ? { bytes: ad.photo, mime: ad.photo_mime || "image/jpeg" } : null);

// ---- Routes --------------------------------------------------------------------

export default async function adsRoutes(app, opts = {}) {
  const controller = new AbortController();
  app.addHook("onClose", async () => { controller.abort(); await adsIdle(); });

  app.register(async (adm) => {
    adm.addHook("preHandler", requireUser);
    adm.addHook("preHandler", requireAdmin);
    const deps = () => resolveDeps(app, opts.deps);

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

    adm.get("/api/admin/ads", async () => {
      const d = await deps();
      const [ads, photos, models] = await Promise.all([store.listAds(), store.photosToday(), modelsInfo(d)]);
      const each = Number(d.studio?.PHOTO_COST_USD ?? PHOTO_COST_USD);
      return {
        ads,
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
      background(request.log, async () => {
        let proposal;
        try {
          proposal = await d.studio.proposeIdeas({ brief: brief.value || undefined, count: count.value, signal });
        } catch (e) {
          await Promise.all(rows.map((r) => store.markFailed(r.id, plainError(e, "Muse Spark could not write the ideas."))));
          return;
        }
        const ideas = Array.isArray(proposal?.ideas) ? proposal.ideas : [];
        await Promise.all(rows.map(async (row, i) => {
          const words = ideas[i];
          if (!words) return store.markFailed(row.id, droppedLine(proposal, i - ideas.length));
          try {
            const made = await d.studio.makePhoto({ words, signal });
            await store.addVersion(row.id, {
              words, photo: made.photo, check: made.check ?? null, photosMade: made.photosMade ?? 0,
              models: { words: proposal.model ?? null, image: made.models?.image ?? null, check: made.models?.check ?? null },
            }, { from: ["drafting"] });
          } catch (e) {
            await store.markFailed(row.id, plainError(e, "The photo could not be made."));
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
      const d = await deps();
      if (!d.studio) return reply.code(503).send({ error: notInstalled("idea writer (lib/ads/studio.js)") });
      const models = await modelsInfo(d);
      if (!models.configured) return reply.code(503).send({ error: needsKeys("An edit", models.missing), missing: models.missing });
      const ad = await store.startEdit(found.id);
      if (!ad) return conflict(reply, found, "Only a draft can be edited");

      const { signal } = controller;
      background(request.log, async () => {
        try {
          const out = await d.studio.editIdea({ words: ad.words, photo: photoOf(ad), instruction: instruction.value, signal });
          await store.addVersion(ad.id, {
            words: out.words ?? ad.words,
            photo: out.photo ?? photoOf(ad),
            check: out.check ?? ad.photo_check,
            models: { ...stripBasedOn(ad.models), ...(out.models || {}) },
            instruction: instruction.value,
            photosMade: out.photosMade ?? 0,
          }, { from: ["editing"] });
        } catch (e) {
          await store.editFailed(ad.id, plainError(e, "The edit could not be made."));
        }
      });
      return reply.code(202).send({ id: ad.id, status: "editing" });
    });

    adm.post("/api/admin/ads/:id/undo", async (request, reply) => {
      const found = await adOr404(request, reply);
      if (!found) return reply;
      const out = await store.undo(found.id);
      if (!out) return conflict(reply, found, "Nothing to undo: there is no earlier version, or the idea is busy");
      return { id: out.id, version: out.version, status: "draft" };
    });

    adm.post("/api/admin/ads/:id/publish", async (request, reply) => {
      const found = await adOr404(request, reply);
      if (!found) return reply;
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

      const network = d.network;
      background(request.log, () => serial(net.name, async () => {
        try {
          const campaignId = await store.getCampaign(net.name);
          const out = await network.publish({
            name: `Prudence ${ad.code} v${ad.version}`,
            words: ad.words,
            photo: photoOf(ad),
            link: `${landingBase()}/a/${ad.code}`,
            campaignId,
          });
          if (out.campaignCreated && out.campaignId) await store.saveCampaign(net.name, out.campaignId);
          const { campaignId: cid, adsetId, creativeId, adId, imageHash, adsManagerUrl } = out;
          const paused = String(out.status || "").toUpperCase() === "PAUSED";
          await store.publishDone(ad.id, {
            network: net.name,
            external: { campaignId: cid ?? campaignId, adsetId, creativeId, adId, imageHash, adsManagerUrl },
            budget: out.budget ?? null,
            review: { state: paused ? "paused" : "in_review", effectiveStatus: out.status ?? null, reasons: [], checkedAt: new Date().toISOString() },
          });
          if (paused) await store.setRunning(ad.id, false);
        } catch (e) {
          await store.publishFailed(ad.id, plainError(e, `${net.label} refused the ad.`));
        }
      }));
      return reply.code(202).send({ id: ad.id, status: "publishing" });
    });

    // Pause and Resume: the network first, then the row.
    for (const [path, running] of [["pause", false], ["resume", true]]) {
      adm.post(`/api/admin/ads/:id/${path}`, async (request, reply) => {
        const ad = await adOr404(request, reply);
        if (!ad) return reply;
        if (ad.status !== (running ? "paused" : "published") || !ad.external?.adId) {
          return conflict(reply, ad, running ? "Only a paused ad can be resumed" : "Only a live ad can be paused");
        }
        const d = await deps();
        const net = networkInfo(d.network);
        if (!net.installed || !net.configured) return reply.code(503).send({ error: net.installed ? needsKeys(net.label, net.missing) : notInstalled("Facebook publisher (lib/ads/networks/)") });
        try {
          await d.network.setStatus({ adId: ad.external.adId, adsetId: ad.external.adsetId, status: running ? "ACTIVE" : "PAUSED" });
        } catch (e) {
          return reply.code(502).send({ error: plainError(e, `${net.label} did not answer.`) });
        }
        await store.setRunning(ad.id, running);
        return { id: ad.id, status: running ? "published" : "paused" };
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
      // A live ad stops on the network before it is set aside.
      if (ad.status === "published" && ad.external?.adId) {
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
