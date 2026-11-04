// The served library and its submissions queue (spec lines 2, 4 and 5).
// What is served is the files of data/library/ (read once per process)
// plus the entries a reviewer approved, which live in Postgres until a
// script exports them to files; the merge is cached a minute and dropped
// when an approval lands. A submission is redacted before it is stored,
// hashed on its words to refuse a duplicate, classified by Muse Spark when
// a classifier is given (a model outage never blocks a submission), and
// waits for a human: approve builds the entry and validates it, reject
// keeps the reason. The senior's shares are rows with user_id and
// from_app, counted and withdrawn per person.

import { randomBytes } from "node:crypto";
import { loadLibraryFiles, redactExample, bodyHash, validateEntry, nameWarnings, LIBRARY_VERDICTS } from "../../lib/library.js";
import { many, one, q } from "../db/pool.js";

const CACHE_MS = 60000;
const SUBMISSIONS_SOURCE = "prudence-submissions";
let files = null;
let cache = null;

export async function getLibrary({ reload = false } = {}) {
  if (!files || reload) files = await loadLibraryFiles();
  if (!cache || reload || Date.now() - cache.at > CACHE_MS) {
    const rows = await many("SELECT entry FROM library_submissions WHERE status = 'approved' AND entry IS NOT NULL ORDER BY decided_at");
    const seen = new Set(files.entries.map((e) => e.id));
    const approved = rows.map((r) => r.entry).filter((e) => !seen.has(e.id) && seen.add(e.id));
    const entries = [...files.entries, ...approved].filter((e) => e.status === "published");
    cache = { at: Date.now(), library: { families: files.families, sources: files.sources, entries }, hashes: new Map(entries.map((e) => [bodyHash(e.message), e.id])) };
  }
  return cache.library;
}
export const forgetLibrary = () => { cache = null; };

const code = (v, re, fix) => { const s = fix(String(v ?? "").trim()); return re.test(s) ? s : null; };
const countryCode = (v) => code(v, /^[A-Z]{2}$/, (s) => s.toUpperCase());
const languageCode = (v) => code(v, /^[a-z]{2}$/, (s) => s.toLowerCase());
const text = (v, max) => (v == null || v === "" ? null : String(v).slice(0, max));

// The message as the library keeps it: four fields, the links as text and
// href, redacted. For a senior's share her name becomes [name] and her own
// address as the sender (a spoofed "from yourself") becomes [someone]@domain.
function cleanMessage(message = {}, { recipientName = "", ownEmail = "" } = {}) {
  const links = Array.isArray(message.links) ? message.links.filter((l) => l && typeof l.href === "string").slice(0, 50)
    .map((l) => ({ text: text(l.text, 500), href: l.href.slice(0, 2000) })) : [];
  const clean = redactExample({ from: text(message.from, 320), subject: text(message.subject, 500), body: String(message.body ?? ""), links }, { recipientName });
  const own = String(ownEmail || "").trim().toLowerCase();
  if (own && clean.from && clean.from.trim().toLowerCase() === own) clean.from = `[someone]@${own.split("@")[1]}`;
  return clean;
}

// The app's verdict, reduced to what the entry shows: the verdict word, the headline, the reasons as lines.
function cleanVerdict(verdict) {
  if (!verdict || !LIBRARY_VERDICTS.includes(verdict.verdict)) return null;
  return { verdict: verdict.verdict, headline: String(verdict.headline ?? "").slice(0, 200),
    reasons: (Array.isArray(verdict.reasons) ? verdict.reasons : []).map((r) => String(r?.text ?? r ?? "").slice(0, 300)).filter(Boolean).slice(0, 5) };
}

export async function submit({ channel, message, country = null, language = null, note = null, verdict = null, userId = null, fromApp = false, submitterHash = null, classify = null }) {
  const owner = fromApp && userId ? await one("SELECT name, email FROM users WHERE id = $1", [userId]) : null;
  const clean = cleanMessage(message, { recipientName: owner?.name, ownEmail: owner?.email });
  const hash = bodyHash(clean);
  const lib = await getLibrary();
  const entryId = cache.hashes.get(hash);
  if (entryId) return { duplicate: true, entryId, submissionId: null };
  const pending = await one("SELECT id FROM library_submissions WHERE body_hash = $1 AND status = 'pending' LIMIT 1", [hash]);
  if (pending) return { duplicate: true, entryId: null, submissionId: pending.id };
  let proposed = null;
  if (classify) {
    // The reviewer classifies by hand when the model is down.
    try { proposed = await classify({ channel, message: clean, families: lib.families }); } catch { proposed = null; }
  }
  if (nameWarnings(clean).length) proposed = { ...(proposed || {}), may_carry_name: true };
  return one(`INSERT INTO library_submissions (channel, message, proposed, body_hash, country, language, note, verdict, user_id, from_app, submitter_hash)
              VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11) RETURNING *`,
  [channel, clean, proposed, hash, countryCode(country), languageCode(language), text(note, 2000), cleanVerdict(verdict), userId, Boolean(fromApp), submitterHash]);
}

export async function submissionStatus(id) {
  const row = await one("SELECT id, status, reason, entry_id FROM library_submissions WHERE id = $1", [id]);
  return row ? { id: row.id, status: row.status, reason: row.reason, entryId: row.entry_id } : null;
}

// The queue for the console: never who submitted (user_id, submitter_hash).
export async function listSubmissions() {
  const submissions = await many(`SELECT id, created_at, channel, message, proposed, country, language, note, status, reason, entry_id, from_app, verdict, decided_at
                                  FROM library_submissions ORDER BY (status = 'pending') DESC, created_at DESC LIMIT 200`);
  const c = await one(`SELECT count(*) FILTER (WHERE status = 'pending')::int AS pending, count(*) FILTER (WHERE status = 'approved')::int AS approved,
                       count(*) FILTER (WHERE status = 'rejected')::int AS rejected FROM library_submissions`);
  return { submissions, counts: { pending: c.pending, approved: c.approved, rejected: c.rejected } };
}

// overrides: family, brand, lure, ask, country, language from the reviewer, over the model's proposal and the submitter's values.
export async function approveSubmission(id, overrides = {}) {
  const row = await one("SELECT * FROM library_submissions WHERE id = $1", [id]);
  if (!row) return null;
  if (row.status !== "pending") return { errors: [`submission is ${row.status}`], decided: true };
  const lib = await getLibrary();
  const today = new Date().toISOString().slice(0, 10);
  const source = lib.sources.find((s) => s.id === SUBMISSIONS_SOURCE);
  const pick = (k, fallback = null) => (overrides[k] !== undefined ? overrides[k] : fallback ?? row.proposed?.[k] ?? null);
  const entry = {
    id: `lib-${today.replace(/-/g, "")}-${randomBytes(3).toString("hex")}`,
    family: pick("family"), channel: row.channel,
    country: countryCode(pick("country", row.country)), language: languageCode(pick("language", row.language)),
    brand: text(pick("brand"), 120), lure: String(pick("lure") ?? "").slice(0, 200), ask: String(pick("ask") ?? "").slice(0, 200),
    message: row.message, first_seen: today, last_seen: today,
    source: { id: source.id, url: source.url, licence: source.licence, attribution: source.attribution },
    verdict: row.verdict, status: "published",
  };
  const errors = validateEntry(entry, lib);
  if (errors.length) return { errors: [...errors] };
  // Conditional: two reviewers approving at once publish one entry, not two.
  const done = await one("UPDATE library_submissions SET status = 'approved', entry = $2, entry_id = $3, decided_at = now() WHERE id = $1 AND status = 'pending' RETURNING id", [id, entry, entry.id]);
  if (!done) return { errors: ["submission is not pending"], decided: true };
  forgetLibrary();
  return { entry };
}

export async function rejectSubmission(id, reason) {
  const rows = await many("UPDATE library_submissions SET status = 'rejected', reason = $2, decided_at = now() WHERE id = $1 AND status = 'pending' RETURNING id", [id, text(reason, 2000)]);
  return rows.length === 1;
}

export async function sharedCounts(userId) {
  const c = await one(`SELECT count(*)::int AS count, count(*) FILTER (WHERE status = 'pending')::int AS pending, count(*) FILTER (WHERE status = 'approved')::int AS approved
                       FROM library_submissions WHERE user_id = $1 AND from_app`, [userId]);
  return { count: c.count, pending: c.pending, approved: c.approved };
}

export async function withdrawShared(userId) {
  const rows = await many("UPDATE library_submissions SET status = 'withdrawn', decided_at = now() WHERE user_id = $1 AND from_app AND status = 'pending' RETURNING id", [userId]);
  return { withdrawn: rows.length };
}
