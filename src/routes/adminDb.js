// The library's review queue on the admin console (spec line 2): the
// submissions with the redacted message (the one place the console shows
// a message: publishing it is the point), approve with the reviewer's
// corrections (the entry is built and validated; a bad one is refused with
// the reasons), reject with a reason the submitter can read. Admins only,
// like src/routes/admin.js. Never who submitted.

import { requireUser, requireAdmin } from "../auth.js";
import { listSubmissions, approveSubmission, rejectSubmission } from "../library/store.js";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const OVERRIDES = ["family", "brand", "lure", "ask", "country", "language"];

// Only the six fields a reviewer may set, as strings or null.
function overridesOf(body) {
  const out = {};
  if (!body || typeof body !== "object") return out;
  for (const k of OVERRIDES) {
    if (!(k in body)) continue;
    out[k] = body[k] == null || body[k] === "" ? null : String(body[k]).trim();
  }
  return out;
}

export default async function adminDbRoutes(app) {
  app.register(async (adm) => {
    adm.addHook("preHandler", requireUser);
    adm.addHook("preHandler", requireAdmin);

    adm.get("/api/admin/db/submissions", async () => listSubmissions());

    adm.post("/api/admin/db/submissions/:id/approve", async (request, reply) => {
      const id = request.params.id;
      const out = UUID.test(id) ? await approveSubmission(id, overridesOf(request.body)) : null;
      if (!out) return reply.code(404).send({ error: "unknown submission" });
      if (out.errors) return reply.code(out.decided ? 409 : 400).send({ error: out.errors.join("; "), errors: out.errors });
      return { entry: out.entry };
    });

    adm.post("/api/admin/db/submissions/:id/reject", async (request, reply) => {
      const id = request.params.id;
      const reason = String(request.body?.reason ?? "").trim();
      if (!reason) return reply.code(400).send({ error: "a reason is needed: the submitter reads it" });
      const ok = UUID.test(id) ? await rejectSubmission(id, reason) : false;
      if (!ok) return reply.code(404).send({ error: "unknown submission, or decided already" });
      return { ok: true };
    });
  });
}
