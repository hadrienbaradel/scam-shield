// Early access (_product/specs/landing-page.md, line 6): the request behind
// the landing page's "Protect my parent's email" while Google sign-in is in
// its test phase. No session: the address to protect (lower-cased and
// trimmed), whose it is, an optional first name and note, the page's
// language; 10 a minute from one place. A malformed address gets one plain
// line in the page's language; a second request for the same address gets
// the same answer as the first and stores nothing more. The server mails
// nobody: we add the address as a tester by hand. A request sent from an
// ad's landing variant (/a/<code>, src/routes/adLanding.js) also keeps that
// ad's code, when such an ad exists (_product/specs/ad-studio.md, line 8);
// the first request's code stays, like the rest of it. Behind the admin
// console's two guards, the list of requests newest first and "Mark added".

import { requireUser, requireAdmin } from "../auth.js";
import { q, many, one } from "../db/pool.js";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
// An allowlist, checked on the lower-cased address: a local part of letters,
// digits and . _ + ' - only (never ? & = % / or anything a mailto link or a
// header could read), one @, a host of labels of letters, digits and
// hyphens with a dot, ending in letters. Only what passes is stored.
const EMAIL = /^[a-z0-9._+'-]{1,64}@(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/;
const WHOSE = ["parent", "mine"];
const VARIANT = /^[a-z0-9]{8}$/;
const text = (v, max) => String(v ?? "").trim().slice(0, max);

const LINES = {
  en: {
    body: "Send the Gmail address to protect, and whose it is: your parent's or yours.",
    email: "That does not look like an email address. Check it and try again, for example linda@gmail.com.",
    whose: "Say whose address it is: your parent's or yours.",
  },
  fr: {
    body: "Indiquez l'adresse Gmail à protéger, et à qui elle est : à votre parent ou à vous.",
    email: "Cette adresse e-mail ne semble pas correcte. Vérifiez-la et réessayez, par exemple linda@gmail.com.",
    whose: "Dites à qui est cette adresse : à votre parent ou à vous.",
  },
};

// "fr-FR" → "fr"; anything that is not a language tag → null.
export function languageOf(v) {
  const m = /^([a-z]{2,3})(?:[-_][a-z0-9]{1,8})*$/i.exec(text(v, 35));
  return m ? m[1].toLowerCase() : null;
}

export function normalizeEmail(v) {
  const email = typeof v === "string" ? v.trim().toLowerCase() : "";
  return email.length <= 254 && EMAIL.test(email) ? email : null;
}

// The landing variant a request came from (an ads.code), or nothing: anything
// else in the field is ignored, never refused.
export const variantOf = (v) => (typeof v === "string" && VARIANT.test(v) ? v : null);

// The request as stored, or the field that stops it.
export function parseRequest(body) {
  const lang = languageOf(body?.language);
  const lines = LINES[lang] || LINES.en;
  if (!body || typeof body !== "object") return { field: "body", error: lines.body };
  const email = normalizeEmail(body.email);
  if (!email) return { field: "email", error: lines.email };
  const whose = String(body.whose ?? "").trim().toLowerCase();
  if (!WHOSE.includes(whose)) return { field: "whose", error: lines.whose };
  return { request: { email, whose, name: text(body.name, 100) || null, note: text(body.note, 1000) || null, language: lang } };
}

export default async function earlyAccessRoutes(app) {
  app.post("/api/early-access", { config: { rateLimit: { max: 10, timeWindow: "1 minute" } } }, async (request, reply) => {
    const { request: r, field, error } = parseRequest(request.body);
    if (!r) return reply.code(400).send({ error, field });
    // The variant is kept only when an ad has that code (the subquery is null otherwise).
    await q(`INSERT INTO early_access_requests (email, whose, name, note, language, variant)
             VALUES ($1, $2, $3, $4, $5, (SELECT code FROM ads WHERE code = $6))
             ON CONFLICT (email) DO NOTHING`, [r.email, r.whose, r.name, r.note, r.language, variantOf(request.body.variant)]);
    return { ok: true, email: r.email };
  });

  app.register(async (adm) => {
    adm.addHook("preHandler", requireUser);
    adm.addHook("preHandler", requireAdmin);

    adm.get("/api/admin/early-access", async () => {
      const requests = await many(`SELECT id, created_at, email, whose, name, note, language, status, added_at
                                   FROM early_access_requests ORDER BY created_at DESC, id LIMIT 500`);
      const c = await one(`SELECT count(*) FILTER (WHERE status = 'open')::int AS open, count(*) FILTER (WHERE status = 'added')::int AS added
                           FROM early_access_requests`);
      return { requests, counts: { open: c.open, added: c.added } };
    });

    // Idempotent: a second click keeps the first date (retention counts 90 days from it).
    adm.post("/api/admin/early-access/:id/added", async (request, reply) => {
      const id = request.params.id;
      const row = UUID.test(id)
        ? await one(`UPDATE early_access_requests SET status = 'added', added_at = coalesce(added_at, now()) WHERE id = $1 RETURNING id, status, added_at`, [id])
        : null;
      if (!row) return reply.code(404).send({ error: "unknown early-access request" });
      return { ok: true, id: row.id, status: row.status, addedAt: row.added_at };
    });
  });
}
