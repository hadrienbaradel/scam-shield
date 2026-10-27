// The signed-in person: profile and settings, live events, what Scam
// Shield knows about them (and the right to correct it), their audit
// trail, and deleting everything.

import { requireUser, endSession } from "../auth.js";
import { config, googleConfigured, pubsubConfigured } from "../config.js";
import { many, one, q } from "../db/pool.js";
import { museConfigured, museModel } from "../../lib/muse.js";
import { subscribe } from "../notify/sse.js";
import { KNOWN_BREACHES, forgetItem } from "../context/builder.js";
import { loadContext } from "../sync/checker.js";
import { clientFor, rebuildContext, syncUser } from "../sync/worker.js";
import { revokeAndForget, tokenStatus } from "../google/tokens.js";
import { audit } from "../sync/actions.js";
import { jobStatus } from "../jobs/scheduler.js";

export default async function accountRoutes(app) {
  app.get("/api/health", async () => ({ ok: true }));

  app.get("/api/status", async (request) => {
    const u = request.user;
    const gmail = u ? await one("SELECT sync_status, sync_error, last_sync_at, backfill_done, watch_expiration FROM gmail_state WHERE user_id = $1", [u.id]) : null;
    const tokens = u ? await tokenStatus(u.id) : null;
    return {
      googleConfigured: googleConfigured(),
      museConfigured: museConfigured(),
      museModel: museConfigured() ? museModel() : null,
      instantChecks: pubsubConfigured() ? jobStatus.pubsub : "off",
      signedIn: Boolean(u),
      user: u && { id: u.id, name: u.name, email: u.email, locale: u.locale, textScale: u.text_scale, actMode: u.act_mode,
        autoAlert: u.auto_alert, onboarded: u.onboarded, isAdmin: u.isAdmin },
      gmail: gmail && { connected: tokens?.status === "ok", needsReconnect: tokens?.status === "reauth_needed", syncStatus: gmail.sync_status,
        lastSyncAt: gmail.last_sync_at, ready: gmail.backfill_done, push: Boolean(gmail.watch_expiration && gmail.watch_expiration > new Date()) },
      isGuardian: u ? Boolean(await one("SELECT 1 FROM guardianships WHERE guardian_id = $1 AND status = 'active' LIMIT 1", [u.id])) : false,
    };
  });

  app.register(async (priv) => {
    priv.addHook("preHandler", requireUser);

    priv.get("/api/events", async (request, reply) => {
      reply.hijack();
      subscribe(request.user.id, reply);
    });

    priv.patch("/api/me", async (request) => {
      const b = request.body || {};
      const sets = [];
      const vals = [request.user.id];
      const set = (col, v) => { vals.push(v); sets.push(`${col} = $${vals.length}`); };
      if (typeof b.name === "string" && b.name.trim()) set("name", b.name.trim().slice(0, 80));
      if (["en-US", "fr-FR"].includes(b.locale)) set("locale", b.locale);
      if (typeof b.textScale === "number" && b.textScale >= 1 && b.textScale <= 1.6) set("text_scale", b.textScale);
      if (["label", "move"].includes(b.actMode)) {
        set("act_mode", b.actMode);
        // Moving mail needs an explicit choice; the moment is recorded.
        sets.push(b.actMode === "move" ? "move_consent_at = now()" : "move_consent_at = NULL");
      }
      if (typeof b.autoAlert === "boolean") set("auto_alert", b.autoAlert);
      if (typeof b.onboarded === "boolean") set("onboarded", b.onboarded);
      if (sets.length) await q(`UPDATE users SET ${sets.join(", ")} WHERE id = $1`, vals);
      if (b.actMode) await audit(request.user.id, "act_mode_changed", { actMode: b.actMode });
      return { ok: true };
    });

    priv.post("/api/sync", async (request) => {
      syncUser(request.user.id).catch(() => {});
      return { started: true };
    });

    priv.get("/api/context", async (request) => ({
      context: await loadContext(request.user),
      breachOptions: KNOWN_BREACHES,
      builtAt: (await one("SELECT built_at FROM contexts WHERE user_id = $1", [request.user.id]))?.built_at || null,
    }));

    priv.post("/api/context/forget", async (request, reply) => {
      const { kind, item } = request.body || {};
      if (!["sender", "contact", "order", "provider", "subscription", "link"].includes(kind) || item == null) return reply.code(400).send({ error: "bad item" });
      const row = await one("SELECT data FROM contexts WHERE user_id = $1", [request.user.id]);
      if (!row) return reply.code(404).send({ error: "nothing learned yet" });
      const field = { sender: "knownSenders", contact: "trustedContacts", order: "orders", provider: "providers", subscription: "subscriptions", link: "knownLinkDomains" }[kind];
      const same = (x) => JSON.stringify(x) === JSON.stringify(item);
      const ctx = forgetItem({ ...row.data, [field]: (row.data[field] || []).filter((x) => !same(x)) }, kind, item);
      await q("UPDATE contexts SET data = $2, updated_at = now() WHERE user_id = $1", [request.user.id, ctx]);
      await audit(request.user.id, "context_item_removed", { kind });
      return { ok: true };
    });

    priv.put("/api/context/breaches", async (request) => {
      const ids = new Set(Array.isArray(request.body?.ids) ? request.body.ids : []);
      const row = await one("SELECT data FROM contexts WHERE user_id = $1", [request.user.id]);
      const ctx = row?.data || { userName: request.user.name, knownSenders: [], knownLinkDomains: [], providers: [], orders: [], breaches: [], trustedContacts: [], subscriptions: [] };
      const fromHibp = (ctx.breaches || []).filter((b) => String(b.id || "").startsWith("hibp-"));
      ctx.breaches = [...fromHibp, ...KNOWN_BREACHES.filter((b) => ids.has(b.id))];
      await q(`INSERT INTO contexts (user_id, data) VALUES ($1, $2) ON CONFLICT (user_id) DO UPDATE SET data = EXCLUDED.data, updated_at = now()`, [request.user.id, ctx]);
      return { breaches: ctx.breaches };
    });

    priv.post("/api/context/rebuild", async (request) => {
      rebuildContext({ user: request.user, client: clientFor(request.user.id) }).catch((e) => request.log.error(e, "context rebuild failed"));
      return { started: true };
    });

    priv.get("/api/audit", async (request) => ({
      events: await many("SELECT event, detail, at FROM audit_log WHERE user_id = $1 ORDER BY at DESC LIMIT 100", [request.user.id]),
    }));

    // Delete my account: stop Gmail push, revoke Google's permission,
    // delete every row (cascades). Labels already in Gmail stay, so
    // nothing in the mailbox disappears.
    priv.delete("/api/account", async (request, reply) => {
      const id = request.user.id;
      if (await one("SELECT 1 FROM google_tokens WHERE user_id = $1 AND status = 'ok'", [id])) {
        await clientFor(id).stop().catch(() => {});
      }
      await revokeAndForget(id);
      await endSession(request, reply);
      await q("DELETE FROM users WHERE id = $1", [id]);
      return { deleted: true };
    });
  });

  app.get("/api/limits", async () => ({ pollSeconds: config.pollSeconds }));
}
