// The public database's API (_product/specs/public-database.md, lines
// 1-5): the library read by anyone with no session (about, families, the
// list, one entry with the pattern cards that impersonate the same brand,
// the whole library as one CC BY 4.0 file, the active cards), a submission
// form (redacted, hashed against duplicates, classified by Muse Spark when
// a model is configured, read by a reviewer before it appears) with its
// status URL for the submitter, and the signed-in senior's share: once per
// message with her explicit tap, counted and withdrawn from Settings.
// Public endpoints give no name, no address and no hash back; the
// submitter's address is kept as a hash for rate abuse only.

import { createHash } from "node:crypto";
import { config } from "../config.js";
import { requireUser } from "../auth.js";
import { many } from "../db/pool.js";
import { museConfigured } from "../../lib/muse.js";
import { classifyExample } from "../../lib/libraryMuse.js";
import { CHANNELS, BODY_MIN, BODY_MAX, LICENCE, filterEntries, exportLibrary } from "../../lib/library.js";
import { getLibrary, submit, submissionStatus, sharedCounts, withdrawShared } from "../library/store.js";

export const REPO_URL = "https://github.com/hadrienbaradel/scam-shield";
const PAGE_SIZE = 50;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const sha256 = (s) => createHash("sha256").update(String(s)).digest("hex");
const activeCards = async () => (await many("SELECT card FROM pattern_cards WHERE status = 'active' ORDER BY id")).map((r) => r.card);
const classifier = () => (museConfigured() ? classifyExample : null);
// Newest first; the id breaks a tie so paging is stable.
const newest = (a, b) => (a.first_seen === b.first_seen ? (a.id < b.id ? -1 : 1) : a.first_seen < b.first_seen ? 1 : -1);

// What a submission must carry; the error names it (400).
function submissionProblem(body) {
  if (!body || typeof body !== "object") return "send a JSON body with channel and message";
  if (!CHANNELS.includes(body.channel)) return `channel must be one of ${CHANNELS.join(", ")}`;
  const text = body.message?.body;
  if (typeof text !== "string" || text.trim().length < BODY_MIN || text.length > BODY_MAX) return `the message body must be ${BODY_MIN} to ${BODY_MAX.toLocaleString("en-US")} characters`;
  return null;
}
// A pending submission's id is given back only to its own submitter (the store decides); an entry's id is public anyway.
const duplicateAnswer = (out) => ({
  error: out.entryId ? "This message is already in the library." : "This message was already submitted and waits for a reviewer.",
  entryId: out.entryId, ...(out.submissionId ? { submissionId: out.submissionId } : {}),
});

export default async function dbRoutes(app) {
  app.get("/api/public/about", async () => {
    const lib = await getLibrary();
    return { operator: config.publicDb.operator, contact: config.publicDb.contact, licence: LICENCE, repo: REPO_URL,
      counts: { entries: lib.entries.length, families: lib.families.length } };
  });

  app.get("/api/public/families", async () => {
    const lib = await getLibrary();
    const counts = new Map();
    for (const e of lib.entries) counts.set(e.family, (counts.get(e.family) || 0) + 1);
    return { families: lib.families.map((f) => ({ ...f, count: counts.get(f.id) || 0 })) };
  });

  app.get("/api/public/library", async (request) => {
    const { family, channel, country, language, q, page } = request.query;
    const lib = await getLibrary();
    const entries = filterEntries(lib.entries, { family, channel, country, language, q }).sort(newest);
    const p = Math.max(1, Number.parseInt(page, 10) || 1);
    return { total: entries.length, page: p, pageSize: PAGE_SIZE, entries: entries.slice((p - 1) * PAGE_SIZE, p * PAGE_SIZE) };
  });

  app.get("/api/public/library.json", async () => exportLibrary(await getLibrary()));

  app.get("/api/public/library/:id", async (request, reply) => {
    const lib = await getLibrary();
    const entry = lib.entries.find((e) => e.id === request.params.id);
    if (!entry) return reply.code(404).send({ error: "unknown entry" });
    const brand = String(entry.brand || "").toLowerCase();
    const cards = brand ? (await activeCards()).filter((c) => (c.impersonated_brands || []).some((b) => String(b).toLowerCase() === brand)) : [];
    return { entry, cards };
  });

  app.get("/api/public/cards", async () => ({ cards: await activeCards() }));

  app.post("/api/public/library/submit", { config: { rateLimit: { max: 10, timeWindow: "1 minute" } } }, async (request, reply) => {
    const problem = submissionProblem(request.body);
    if (problem) return reply.code(400).send({ error: problem });
    const { channel, message, country, language, note } = request.body;
    const out = await submit({ channel, message, country, language, note, submitterHash: sha256(request.ip), classify: classifier() });
    if (out.duplicate) return reply.code(409).send(duplicateAnswer(out));
    return reply.code(202).send({ id: out.id, status: "pending", statusUrl: `/api/public/library/submit/${out.id}` });
  });

  app.get("/api/public/library/submit/:id", async (request, reply) => {
    const status = UUID.test(request.params.id) ? await submissionStatus(request.params.id) : null;
    if (!status) return reply.code(404).send({ error: "unknown submission" });
    return status;
  });

  // The senior's side (spec line 5): signed in, her explicit tap per message.
  // Her locale fills the country and the language when the app sends none.
  app.register(async (mine) => {
    mine.addHook("preHandler", requireUser);

    mine.post("/api/library/share", { config: { rateLimit: { max: 20, timeWindow: "1 minute" } } }, async (request, reply) => {
      const problem = submissionProblem(request.body);
      if (problem) return reply.code(400).send({ error: problem });
      const { channel, message, country, language, note, verdict } = request.body;
      const [lang, region] = String(request.user.locale || "").split("-");
      const out = await submit({ channel, message, country: country || region || null, language: language || lang || null, note, verdict,
        userId: request.user.id, fromApp: true, classify: classifier() });
      if (out.duplicate) return reply.code(409).send(duplicateAnswer(out));
      return reply.code(202).send({ id: out.id });
    });

    mine.get("/api/library/shared", async (request) => sharedCounts(request.user.id));

    mine.post("/api/library/shared/withdraw", async (request) => withdrawShared(request.user.id));
  });
}
