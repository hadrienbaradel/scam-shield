// The suspect list over HTTP (_product/specs/public-database.md, lines 6
// and 7): the public lookup of a website, a sender address or a phone
// number (no session: the entries that used it, weighted by age, contested
// or removed when a contest says so), the notice that contests a listing
// (the four elements plus the good-faith statement, five a minute from one
// place, refused by name when one is missing, and only against a listing
// that exists), the status of a notice for whoever sent it (the decision
// and its reason, never the notice itself), and behind the admin console's
// two guards the queue of contests with Uphold and Dismiss. The public
// answers give no name, no address and no notice text back.

import { requireUser, requireAdmin } from "../auth.js";
import { many, one } from "../db/pool.js";
import { normalizeIndicator, lookupSuspect, phoneKey } from "../../lib/suspects.js";
import { getLibrary } from "../library/store.js";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const DECISIONS = ["upheld", "dismissed"];
const text = (v, max) => String(v ?? "").trim().slice(0, max);

const NOT_AN_INDICATOR = "That is not a website, a sender address or a phone number that can be listed (reserved and private addresses never are).";

// The contests on one indicator; a number's on its last 9 digits (the stored value is digits with an optional +).
function contestsFor(indicator) {
  const cols = "indicator_kind, indicator, status, decided_at";
  if (indicator.kind === "phone") return many(`SELECT ${cols} FROM suspect_contests WHERE indicator_kind = 'phone' AND right(ltrim(indicator, '+'), 9) = $1`, [phoneKey(indicator.value)]);
  return many(`SELECT ${cols} FROM suspect_contests WHERE indicator_kind = $1 AND indicator = $2`, [indicator.kind, indicator.value]);
}

async function lookup(q) {
  const indicator = normalizeIndicator(q);
  if (!indicator) return null;
  const lib = await getLibrary();
  return lookupSuspect(lib.entries, q, { contests: await contestsFor(indicator) });
}

// What a notice must carry (the four elements of a notice and the
// good-faith statement); the first missing one is named (400).
function noticeProblem(body) {
  if (!body || typeof body !== "object") return { error: "Send a JSON notice with the listing, your name, your email address, the URL of the listing, the reason and the good-faith statement.", missing: "body" };
  if (!normalizeIndicator(body.indicator)) return { error: `The notice needs the website, address or number it is about. ${NOT_AN_INDICATOR}`, missing: "indicator" };
  if (!text(body.name, 200)) return { error: "The notice needs your name.", missing: "name" };
  if (!text(body.email, 320)) return { error: "The notice needs your email address, to send you the decision.", missing: "email" };
  if (!EMAIL.test(text(body.email, 320))) return { error: "The notice needs your email address: this one does not look like an address.", missing: "email" };
  if (!text(body.url, 2000)) return { error: "The notice needs the URL of the listing it contests.", missing: "url" };
  if (!text(body.reason, 5000)) return { error: "The notice needs the reason the listing is wrong.", missing: "reason" };
  if (body.goodFaith !== true) return { error: "The notice needs the good-faith statement: that what it says is accurate and complete, to the best of your knowledge.", missing: "goodFaith" };
  return null;
}

const statusOf = (row) => ({ id: row.id, status: row.status, decision: row.decision, createdAt: row.created_at, decidedAt: row.decided_at });

export default async function dbSuspectsRoutes(app) {
  app.get("/api/public/suspects", async (request, reply) => {
    const q = String(request.query.q ?? "").trim();
    if (!q) return reply.code(400).send({ error: "Give a website, a sender address or a phone number to look up." });
    const out = await lookup(q);
    if (!out) return reply.code(400).send({ error: NOT_AN_INDICATOR });
    return out;
  });

  app.post("/api/public/suspects/contest", { config: { rateLimit: { max: 5, timeWindow: "1 minute" } } }, async (request, reply) => {
    const problem = noticeProblem(request.body);
    if (problem) return reply.code(400).send(problem);
    const body = request.body;
    const listing = await lookup(body.indicator);
    if (listing.removed) return reply.code(400).send({ error: "This listing was removed after a contest already; there is nothing left to contest.", missing: "listing" });
    if (!listing.reports) return reply.code(400).send({ error: "Nothing is listed for this, so there is nothing to contest. A listing never says scam without an entry behind it.", missing: "listing" });
    const row = await one(`INSERT INTO suspect_contests (indicator_kind, indicator, name, email, url, reason, good_faith) VALUES ($1, $2, $3, $4, $5, $6, true) RETURNING id`,
      [listing.indicator.kind, listing.indicator.value, text(body.name, 200), text(body.email, 320), text(body.url, 2000), text(body.reason, 5000)]);
    return reply.code(202).send({ id: row.id, status: "open", statusUrl: `/api/public/suspects/contest/${row.id}` });
  });

  app.get("/api/public/suspects/contest/:id", async (request, reply) => {
    const id = request.params.id;
    const row = UUID.test(id) ? await one("SELECT id, status, decision, created_at, decided_at FROM suspect_contests WHERE id = $1", [id]) : null;
    if (!row) return reply.code(404).send({ error: "unknown contest" });
    return statusOf(row);
  });

  app.register(async (adm) => {
    adm.addHook("preHandler", requireUser);
    adm.addHook("preHandler", requireAdmin);

    adm.get("/api/admin/db/contests", async () => {
      const contests = await many(`SELECT id, created_at, indicator_kind, indicator, name, email, url, reason, good_faith, status, decision, decided_at
                                   FROM suspect_contests ORDER BY (status = 'open') DESC, created_at DESC LIMIT 200`);
      const c = await one(`SELECT count(*) FILTER (WHERE status = 'open')::int AS open, count(*) FILTER (WHERE status = 'upheld')::int AS upheld,
                           count(*) FILTER (WHERE status = 'dismissed')::int AS dismissed FROM suspect_contests`);
      return { contests, counts: { open: c.open, upheld: c.upheld, dismissed: c.dismissed } };
    });

    adm.post("/api/admin/db/contests/:id/decide", async (request, reply) => {
      const id = request.params.id;
      const status = String(request.body?.status ?? "");
      const decision = text(request.body?.decision, 5000);
      if (!DECISIONS.includes(status)) return reply.code(400).send({ error: `status must be ${DECISIONS.join(" or ")}` });
      if (!decision) return reply.code(400).send({ error: "a decision text is needed: the person who contested reads it" });
      const done = UUID.test(id) ? await one("UPDATE suspect_contests SET status = $2, decision = $3, decided_at = now() WHERE id = $1 AND status = 'open' RETURNING id", [id, status, decision]) : null;
      if (!done) return reply.code(404).send({ error: "unknown contest, or decided already" });
      return { ok: true };
    });
  });
}
