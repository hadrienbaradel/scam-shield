// The admin console (ADMIN_EMAILS only): the shell at /admin/, and its API
// (health, background jobs with Run now, people, outbox). Threat-feed
// review stays here too: a candidate card can only reach "active" through
// a human (PRD). Plus the local outbox page for testing guardian emails
// without an email provider.

import { readFile } from "node:fs/promises";
import { requireUser, requireAdmin } from "../auth.js";
import { config, googleConfigured } from "../config.js";
import { isLocalDevRequest } from "../localDev.js";
import { many, one, q } from "../db/pool.js";
import { validatePatternCard, promoteCard } from "../../lib/threatfeed.js";
import { reviewQueue, SOURCES } from "../jobs/threatfeed.js";
import { jobStatus, jobsReport, hydrateJobs, recentRuns, runJob } from "../jobs/scheduler.js";
import { healthReport } from "../admin/health.js";
import { listUsers, userDetail, outboxList } from "../admin/users.js";
import { syncUser } from "../sync/worker.js";
import { page, esc } from "../pages.js";

// The console shell (src/admin/console.html) is read on the first request
// and kept; until the file exists a placeholder says so, and is not kept.
const shellPath = new URL("../admin/console.html", import.meta.url);
const PLACEHOLDER = `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Prudence admin</title></head>
<body><h1>Admin console shell missing</h1><p>src/admin/console.html is not there yet; the API under /api/admin/ works.</p></body></html>`;
let shell = null;
async function consoleShell() {
  if (!shell) {
    try { shell = await readFile(shellPath, "utf8"); } catch { return PLACEHOLDER; }
  }
  return shell;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export default async function adminRoutes(app) {
  // The shell answers in HTML, so the refusals are pages, not JSON.
  const serveShell = async (request, reply) => {
    reply.type("text/html; charset=utf-8");
    if (!request.user) {
      // Only the local sign-in (Google off, on this computer) follows next
      // back to the console; Google sign-in ignores it, so it is left out there.
      const signin = googleConfigured() ? "/auth/google?mode=basic" : "/auth/google?mode=basic&next=%2Fadmin%2F";
      return reply.code(403).send(page({ title: "Sign in first", body: `<h1>Sign in first</h1>
<p>The admin console is for the people who run Prudence.</p>
<p><a class="btn" href="${esc(signin)}">Sign in with Google</a></p>` }));
    }
    if (!request.user.isAdmin) {
      return reply.code(403).send(page({ title: "Admins only", body: `<h1>Admins only</h1>
<p>This account is not listed in ADMIN_EMAILS.</p><p><a href="/">Back to Prudence</a></p>` }));
    }
    return consoleShell();
  };
  app.get("/admin", serveShell);
  app.get("/admin/", serveShell);

  app.register(async (adm) => {
    adm.addHook("preHandler", requireUser);
    adm.addHook("preHandler", requireAdmin);

    adm.get("/api/admin/health", async () => {
      const [health] = await Promise.all([healthReport(), hydrateJobs()]);
      return { generatedAt: health.generatedAt, overall: health.overall, server: health.server, checks: health.checks,
        jobs: jobsReport().jobs, counts: health.counts };
    });

    adm.get("/api/admin/jobs", async () => {
      await hydrateJobs();
      const { jobs, errors } = jobsReport();
      return { jobs, runs: await recentRuns(), errors };
    });

    // The run goes on in the background; the page polls the jobs list.
    adm.post("/api/admin/jobs/:id/run", async (request, reply) => {
      const id = request.params.id;
      try {
        runJob(id, { trigger: "manual" }).catch((e) => request.log.error(e, `job ${id}`));
      } catch (e) {
        if (e.statusCode) return reply.code(e.statusCode).send({ error: e.message });
        throw e;
      }
      return reply.code(202).send({ started: true, job: id });
    });

    adm.get("/api/admin/users", async () => ({ users: await listUsers() }));

    adm.get("/api/admin/users/:id", async (request, reply) => {
      const detail = UUID.test(request.params.id) ? await userDetail(request.params.id) : null;
      if (!detail) return reply.code(404).send({ error: "unknown user" });
      return detail;
    });

    adm.post("/api/admin/users/:id/sync", async (request, reply) => {
      const id = request.params.id;
      const row = UUID.test(id) ? await one(`SELECT (s.user_id IS NOT NULL) AS senior, t.status FROM users u
                                              LEFT JOIN gmail_state s ON s.user_id = u.id LEFT JOIN google_tokens t ON t.user_id = u.id
                                              WHERE u.id = $1`, [id]) : null;
      if (!row) return reply.code(404).send({ error: "unknown user" });
      if (!row.senior || row.status !== "ok") return reply.code(409).send({ error: "Gmail is not connected for this person" });
      syncUser(id).catch(() => {});
      return reply.code(202).send({ started: true });
    });

    // Never the text (outboxList): outside production the page links to the
    // local outbox instead, which only this machine can open.
    adm.get("/api/admin/outbox", async () => ({ mails: await outboxList(), localOutbox: config.production ? null : "/dev/outbox" }));

    adm.get("/api/admin/cards", async () => ({ cards: await reviewQueue(), sources: SOURCES, jobs: jobStatus }));

    adm.post("/api/admin/cards/:id/approve", async (request, reply) => {
      const row = await one("SELECT * FROM pattern_cards WHERE id = $1", [request.params.id]);
      if (!row) return reply.code(404).send({ error: "unknown card" });
      const edited = request.body?.card && typeof request.body.card === "object" ? { ...request.body.card, id: row.id } : row.card;
      const errors = validatePatternCard(edited);
      if (errors.length) return reply.code(400).send({ error: errors.join("; ") });
      const today = new Date().toISOString().slice(0, 10);
      const card = promoteCard({ ...edited, last_seen: today, first_seen: edited.first_seen || today });
      await q("UPDATE pattern_cards SET card = $2, status = 'active', updated_at = now() WHERE id = $1", [row.id, card]);
      return { ok: true, card };
    });

    adm.post("/api/admin/cards/:id/reject", async (request) => {
      await q("UPDATE pattern_cards SET status = 'rejected', updated_at = now() WHERE id = $1", [request.params.id]);
      return { ok: true };
    });

    // Fetch now is a manual run of the Threat feed job, so it shows in the
    // run history and is refused (409) while a run is in flight. It waits
    // for the fetch (up to ~45 s) so the page can show the report; a failed
    // run (every source down) reports its error line.
    adm.post("/api/admin/feed/run", async (request, reply) => {
      let run;
      try {
        run = await runJob("threatfeed", { trigger: "manual" });
      } catch (e) {
        if (e.statusCode) return reply.code(e.statusCode).send({ error: e.message });
        throw e;
      }
      return { report: run.result ?? { fetched: 0, newItems: 0, cards: 0, errors: [run.error] }, run };
    });
  });

  // Local outbox: only outside production, only from this machine (its
  // copies hold live one-tap links); the rule and why: src/localDev.js.
  app.get("/dev/outbox", async (request, reply) => {
    if (!isLocalDevRequest(request)) return reply.code(404).send();
    const mails = await many("SELECT * FROM outbox ORDER BY created_at DESC LIMIT 50");
    reply.type("text/html");
    return page({
      title: "Local outbox",
      body: `<h1>Local outbox</h1><p class="small">Emails Prudence would have sent (no email provider configured). Kept 7 days.</p>
${mails.map((m) => `<article class="shared-card"><p class="mail-meta">To ${esc(m.to_email)} · ${esc(m.created_at.toISOString())} · via ${esc(m.sent_via)}</p>
<h2>${esc(m.subject)}</h2><pre class="mail-body">${esc(m.text_body).replace(/(https?:\/\/[^\s<]+)/g, '<a href="$1">$1</a>')}</pre></article>`).join("") || "<p>No emails yet.</p>"}`,
    });
  });
}
