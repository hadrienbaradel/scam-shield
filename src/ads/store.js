// The ad studio's rows (_product/specs/ad-studio.md, migration 012): every
// SQL on ads, ad_versions and ad_campaigns lives here. One row per idea; each
// change (the first draft, every edit by prompt) is a version, and the ad
// points at its current one, so Undo is a pointer move. A version records
// the one it was made from (`models.basedOn`), so Undo after an edit made on
// an undone version returns to that one, never to the version set aside.
// Every state change is one conditional UPDATE: two clicks on Publish make
// one `draft -> publishing` and the other finds nothing to move (409).
// A row left `drafting`, `editing` or `publishing` that no job of this
// process holds (the routes keep that registry) and that has not moved for
// fifteen minutes (longer than the slowest edit) was cut by a restart: it
// reads as failed ("interrupted"). The photo's bytes leave only through
// photo(); the list carries its URL.

import { randomBytes } from "node:crypto";
import { many, one, q, tx } from "../db/pool.js";

export const STALE_MINUTES = 15;
const STALE = `updated_at < now() - interval '${STALE_MINUTES} minutes'`;
const ALPHABET = "abcdefghijklmnopqrstuvwxyz0123456789";
const BUSY = ["drafting", "editing", "publishing"];
const INTERRUPTED = {
  drafting: "Interrupted: the server stopped while this idea was being made. Reject it and ask for new ideas.",
  editing: "Interrupted: the server stopped during the edit. Undo, or try the edit again.",
  publishing: "Interrupted while publishing: check Ads Manager before anything else, then reject this one.",
};

// 8 characters of [a-z0-9], the landing variant's address (/a/<code>).
// 252 = 7 * 36: bytes at or above it are dropped, so every character is equally likely.
export function newCode(random = randomBytes) {
  let out = "";
  while (out.length < 8) {
    for (const b of random(16)) {
      if (b < 252 && out.length < 8) out += ALPHABET[b % 36];
    }
  }
  return out;
}

// One `drafting` row per idea, each with its own code; a code already taken
// (a unique violation on ads.code) is drawn again, five times at most.
export async function createDrafting({ brief = null, count = 1, createdBy = null, code = newCode } = {}) {
  const rows = [];
  for (let i = 0; i < count; i++) {
    for (let attempt = 1; ; attempt++) {
      try {
        rows.push(await one(`INSERT INTO ads (code, status, brief, created_by) VALUES ($1, 'drafting', $2, $3) RETURNING id, code`,
          [code(), brief, createdBy]));
        break;
      } catch (e) {
        if (e.code !== "23505" || !/code/.test(e.constraint || "") || attempt >= 5) throw e;
      }
    }
  }
  return rows;
}

// The ad with its current version (words, photo, check, models), or null.
export async function getAd(id) {
  return one(`SELECT a.*, v.words, v.photo, v.photo_mime, v.photo_check, v.models
              FROM ads a LEFT JOIN ad_versions v ON v.ad_id = a.id AND v.version = a.version WHERE a.id = $1`, [id]);
}

export async function statusOf(id) {
  return (await one("SELECT status FROM ads WHERE id = $1", [id]))?.status ?? null;
}

// A new version made from the current one, the pointer moved to it and the
// ad back to `draft`, only while the ad is in one of `from`. Null when the
// ad left that state meanwhile (rejected, or already done): nothing is written.
export async function addVersion(id, { words, photo = null, check = null, models = null, instruction = null, photosMade = 0 }, { from }) {
  return tx(async (c) => {
    const ad = (await c.query("SELECT id, version, status FROM ads WHERE id = $1 FOR UPDATE", [id])).rows[0];
    if (!ad || !from.includes(ad.status)) return null;
    const next = (await c.query("SELECT coalesce(max(version), 0) + 1 AS n FROM ad_versions WHERE ad_id = $1", [id])).rows[0].n;
    const made = { ...(models || {}) };
    if (ad.version >= 1) made.basedOn = ad.version;
    else delete made.basedOn;
    await c.query(`INSERT INTO ad_versions (ad_id, version, words, photo, photo_mime, photo_check, models, instruction, photos_made)
                   VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
    [id, next, words, photo?.bytes ?? null, photo?.mime ?? null, check, made, instruction, Math.max(0, Math.trunc(Number(photosMade) || 0))]);
    await c.query("UPDATE ads SET version = $2, status = 'draft', error = NULL, updated_at = now() WHERE id = $1", [id, next]);
    return { id, version: next };
  });
}

// A first draft that could not be made: `failed`, with the plain reason.
export async function markFailed(id, error) {
  return Boolean(await one("UPDATE ads SET status = 'failed', error = $2, updated_at = now() WHERE id = $1 AND status = 'drafting' RETURNING id", [id, error]));
}

// Rows an admin can work on: a draft, or an edit cut by a restart.
const editable = (t = "") => `${t}version >= 1 AND (${t}status = 'draft' OR (${t}status = 'editing' AND ${t}${STALE}))`;

// draft -> editing, atomically; the ad with its current version, or null.
export async function startEdit(id) {
  const moved = await one(`UPDATE ads SET status = 'editing', error = NULL, updated_at = now() WHERE id = $1 AND ${editable()} RETURNING id`, [id]);
  return moved ? getAd(id) : null;
}

// An edit that failed: back to draft on the same version, with the reason.
export async function editFailed(id, error) {
  return Boolean(await one("UPDATE ads SET status = 'draft', error = $2, updated_at = now() WHERE id = $1 AND status = 'editing' RETURNING id", [id, error]));
}

// The pointer back to the version the current one was made from (the one
// before when nothing says). Null when there is none or the ad is busy.
export async function undo(id) {
  return one(`UPDATE ads a SET version = prev.v, status = 'draft', error = NULL, updated_at = now()
              FROM (SELECT coalesce((v.models->>'basedOn')::int, v.version - 1) AS v FROM ads x
                    JOIN ad_versions v ON v.ad_id = x.id AND v.version = x.version WHERE x.id = $1) prev
              WHERE a.id = $1 AND prev.v >= 1 AND ${editable("a.")}
                AND EXISTS (SELECT 1 FROM ad_versions w WHERE w.ad_id = a.id AND w.version = prev.v)
              RETURNING a.id, a.version`, [id]);
}

// draft -> publishing, atomically: the ad with its words and photo for the
// network, or null (a second click, or not a draft).
export async function startPublish(id) {
  const moved = await one(`UPDATE ads SET status = 'publishing', error = NULL, updated_at = now()
                           WHERE id = $1 AND status = 'draft' AND version >= 1 RETURNING id`, [id]);
  return moved ? getAd(id) : null;
}

// publishing -> published (or paused, when the ad was created paused).
// Idempotent: a retry after a write that did land finds its own ad number.
export async function publishDone(id, { network, external, budget, review }, { paused = false } = {}) {
  return Boolean(await one(`UPDATE ads SET status = $6, network = $2, external = $3, budget = $4, review = $5, error = NULL,
                                           published_at = coalesce(published_at, now()), updated_at = now()
                            WHERE id = $1 AND (status = 'publishing' OR (status IN ('published', 'paused') AND external->>'adId' = $7))
                            RETURNING id`, [id, network, external, budget, review, paused ? "paused" : "published", String(external?.adId ?? "")]));
}

// An ad the network created after its row had moved on (set aside
// elsewhere): kept with its ids, `paused` once the network paused it
// (`published` if it could not), and a plain line, so it is never untracked.
export async function keepAd(id, { network, external, budget, review }, { status = "paused", error = null } = {}) {
  return Boolean(await one(`UPDATE ads SET status = $7, network = $2, external = $3, budget = $4, review = $5, error = $6,
                                           published_at = coalesce(published_at, now()), updated_at = now()
                            WHERE id = $1 RETURNING id`, [id, network, external, budget, review, error, status === "published" ? "published" : "paused"]));
}

// A plain line on the card without changing its state (a late result that was not kept).
export async function noteError(id, error) {
  await q("UPDATE ads SET error = $2 WHERE id = $1", [id, error]);
}

// A publish that failed goes back to draft with the network's plain line.
export async function publishFailed(id, error) {
  return Boolean(await one("UPDATE ads SET status = 'draft', error = $2, updated_at = now() WHERE id = $1 AND status = 'publishing' RETURNING id", [id, error]));
}

export async function setReview(id, review) {
  return Boolean(await one(`UPDATE ads SET review = $2, error = NULL, updated_at = now() WHERE id = $1 AND status IN ('published', 'paused') RETURNING id`, [id, review]));
}

// published <-> paused, once the network has done it.
export async function setRunning(id, running) {
  const [from, to] = running ? ["paused", "published"] : ["published", "paused"];
  return Boolean(await one(`UPDATE ads SET status = $3, error = NULL, updated_at = now() WHERE id = $1 AND status = $2 RETURNING id`, [id, from, to]));
}

// Set aside with a reason: a draft, a failed or interrupted idea, a paused
// ad, or a live one once the caller has paused it on the network.
export async function reject(id, reason) {
  return Boolean(await one(`UPDATE ads SET status = 'rejected', rejected_reason = $2, updated_at = now()
                            WHERE id = $1 AND (status IN ('draft', 'failed', 'paused', 'published') OR (status = ANY($3) AND ${STALE}))
                            RETURNING id`, [id, reason, BUSY]));
}

// The one campaign per network, created on the first publish then reused.
export async function getCampaign(network) {
  return (await one("SELECT external_id FROM ad_campaigns WHERE network = $1", [network]))?.external_id ?? null;
}
export async function saveCampaign(network, externalId) {
  await q("INSERT INTO ad_campaigns (network, external_id) VALUES ($1, $2) ON CONFLICT (network) DO NOTHING", [network, externalId]);
  return getCampaign(network);
}

// One version's photo, the current one when no version is named.
export async function photo(id, version = null) {
  return one(`SELECT v.photo AS bytes, v.photo_mime AS mime FROM ads a JOIN ad_versions v ON v.ad_id = a.id
              AND v.version = coalesce($2::int, a.version) WHERE a.id = $1 AND v.photo IS NOT NULL`, [id, version]);
}

// The cards, newest first: the current version's words, check and models,
// the version count, the visits and the early-access requests that came
// through the variant; never the photo's bytes.
// `held`: the ids a job of this process is working on, never interrupted.
export async function listAds({ limit = 200, held = new Set() } = {}) {
  const rows = await many(`
    SELECT a.id, a.code, a.status, a.brief, a.version, a.network, a.external, a.review, a.budget, a.error, a.rejected_reason,
           a.visits, a.created_by, a.created_at, a.updated_at, a.published_at,
           v.words, v.photo_check, v.models, v.instruction, (v.photo IS NOT NULL) AS has_photo,
           coalesce((v.models->>'basedOn')::int, v.version - 1) AS undo_to,
           (SELECT count(*)::int FROM ad_versions x WHERE x.ad_id = a.id) AS versions,
           coalesce(r.n, 0) AS requests,
           (a.status = ANY($2) AND a.${STALE}) AS old
    FROM ads a LEFT JOIN ad_versions v ON v.ad_id = a.id AND v.version = a.version
    LEFT JOIN (SELECT variant, count(*)::int AS n FROM early_access_requests WHERE variant IS NOT NULL GROUP BY variant) r ON r.variant = a.code
    ORDER BY a.created_at DESC, a.id LIMIT $1`, [limit, BUSY]);
  return rows.map((r) => shape({ ...r, stale: r.old && !held.has(r.id) }));
}

function shape(r) {
  const { basedOn, ...models } = r.models || {};
  const status = r.stale ? "failed" : r.status;
  const workable = r.version >= 1 && (r.status === "draft" || (r.stale && r.status === "editing"));
  return {
    id: r.id,
    code: r.code,
    status,
    interrupted: r.stale ? r.status : null,
    brief: r.brief,
    version: r.version,
    versions: r.versions,
    canEdit: workable,
    canUndo: workable && r.undo_to >= 1,
    words: r.words ?? null,
    check: r.photo_check ?? null,
    models: r.models ? models : null,
    instruction: r.instruction ?? null,
    network: r.network,
    review: r.review,
    external: r.external,
    budget: r.budget,
    counts: { visits: r.visits, requests: r.requests },
    error: r.stale ? INTERRUPTED[r.status] : r.error,
    rejectedReason: r.rejected_reason,
    createdBy: r.created_by,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
    publishedAt: r.published_at,
    photoUrl: r.has_photo ? `/api/admin/ads/${r.id}/photo?v=${r.version}` : null,
    previewUrl: `/a/${r.code}?preview=1`,
  };
}

// Photos the image model returned since midnight UTC, all versions.
export async function photosToday() {
  return (await one(`SELECT coalesce(sum(photos_made), 0)::int AS n FROM ad_versions
                     WHERE created_at >= date_trunc('day', now() AT TIME ZONE 'UTC') AT TIME ZONE 'UTC'`)).n;
}
