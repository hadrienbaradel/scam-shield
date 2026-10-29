// Threat-feed review (ADMIN_EMAILS only): a candidate card can only reach
// "active" through a human here (PRD). Plus the local outbox for testing
// guardian emails without an email provider.

import { requireUser, requireAdmin } from "../auth.js";
import { config } from "../config.js";
import { many, one, q } from "../db/pool.js";
import { validatePatternCard, promoteCard } from "../../lib/threatfeed.js";
import { runThreatFeed, reviewQueue, SOURCES } from "../jobs/threatfeed.js";
import { jobStatus } from "../jobs/scheduler.js";
import { page, esc } from "../pages.js";

export default async function adminRoutes(app) {
  app.register(async (adm) => {
    adm.addHook("preHandler", requireUser);
    adm.addHook("preHandler", requireAdmin);

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

    adm.post("/api/admin/feed/run", async () => ({ report: await runThreatFeed() }));
  });

  // Local outbox: only outside production, only from this machine.
  app.get("/dev/outbox", async (request, reply) => {
    if (config.production || !["127.0.0.1", "::1", "::ffff:127.0.0.1"].includes(request.ip)) return reply.code(404).send();
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
