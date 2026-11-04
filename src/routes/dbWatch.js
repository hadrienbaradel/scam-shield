// The scam watch over HTTP (_product/specs/public-database.md, lines 9 and
// 10): the public week at /api/public/watch (no session, approved items
// only, never the queue), and the review behind the admin console's two
// guards: the queue with the sources and the last run, approve with an
// edited one action (answers the candidate card's id, if any), reject with
// a reason, and run now as a manual run of the Scam watch job, so it shows
// in Jobs and is refused (409) while one runs; it answers 202 at once,
// fifteen feeds take longer than a request should.

import { requireUser, requireAdmin } from "../auth.js";
import { hydrateJobs, jobsReport, runJob } from "../jobs/scheduler.js";
import { WATCH_SOURCES, watchQueue, approveWatchItem, rejectWatchItem, publicWatch } from "../jobs/scamwatch.js";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MAX_DAYS = 90;

export default async function dbWatchRoutes(app) {
  // The week by default, up to 90 days; anything else reads as the week.
  app.get("/api/public/watch", async (request) => {
    const asked = Number(request.query.days);
    const days = Number.isInteger(asked) && asked >= 1 && asked <= MAX_DAYS ? asked : 7;
    return { items: await publicWatch({ days }) };
  });

  app.register(async (adm) => {
    adm.addHook("preHandler", requireUser);
    adm.addHook("preHandler", requireAdmin);

    adm.get("/api/admin/db/watch", async () => {
      await hydrateJobs();
      const lastRun = jobsReport().jobs.find((j) => j.id === "scamwatch")?.lastRun ?? null;
      return { items: await watchQueue(), sources: WATCH_SOURCES, lastRun };
    });

    adm.post("/api/admin/db/watch/run", async (request, reply) => {
      try {
        runJob("scamwatch", { trigger: "manual" }).catch((e) => request.log.error(e, "job scamwatch"));
      } catch (e) {
        if (e.statusCode) return reply.code(e.statusCode).send({ error: e.message });
        throw e;
      }
      return reply.code(202).send({ started: true, job: "scamwatch" });
    });

    adm.post("/api/admin/db/watch/:id/approve", async (request, reply) => {
      const id = request.params.id;
      const out = UUID.test(id) ? await approveWatchItem(id, { one_action: request.body?.one_action }) : null;
      if (!out) return reply.code(404).send({ error: "unknown watch item" });
      return { ok: true, cardId: out.cardId };
    });

    adm.post("/api/admin/db/watch/:id/reject", async (request, reply) => {
      const id = request.params.id;
      const done = UUID.test(id) ? await rejectWatchItem(id, request.body?.reason) : false;
      if (!done) return reply.code(404).send({ error: "unknown watch item" });
      return { ok: true };
    });
  });
}
