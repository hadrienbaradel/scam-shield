// The signed-in person: profile and settings, live events, what Scam
// Shield knows about them (and the right to correct it), their audit
// trail, and deleting everything.

import { requireUser, endSession } from "../auth.js";
import { config, googleConfigured, pubsubConfigured } from "../config.js";
import { many, one, q } from "../db/pool.js";
import { museConfigured, museModel, voiceConfigured } from "../../lib/muse.js";
import { urlhausState } from "../links/resolver.js";
import { subscribe } from "../notify/sse.js";
import { KNOWN_BREACHES, forgetItem, lookupBreaches, lookedUp, mergeBreaches } from "../context/builder.js";
import { loadContext } from "../sync/checker.js";
import { clientFor, rebuildContext, syncUser } from "../sync/worker.js";
import { revokeAndForget, tokenStatus } from "../google/tokens.js";
import { audit } from "../sync/actions.js";
import { jobStatus } from "../jobs/scheduler.js";
import { whatsappConfigured } from "../channels/whatsapp.js";
import { messengerConfigured, messengerLink } from "../channels/messenger.js";

const rebuilds = new Map();
const lookups = new Map();

// The wa.me link of the Prudence WhatsApp number (WHATSAPP_PHONE_NUMBER,
// digits only), only while the channel answers; null otherwise.
export function whatsappLink(env = process.env) {
  const digits = String(env.WHATSAPP_PHONE_NUMBER || "").replace(/[^0-9]/g, "");
  return digits && whatsappConfigured(env) ? `https://wa.me/${digits}` : null;
}

// How long /api/health waits for Postgres to answer SELECT 1 (tests shorten it).
export const healthCheck = { timeoutMs: 2000 };

export default async function accountRoutes(app) {
  // The uptime monitor's and the deploy's check (_product/specs/observability.md,
  // line 6): no sign-in, one SELECT 1, and the version, so a deploy can wait for
  // its own sha. A database that does not answer within 2 s is down too; the
  // timer is cleared (and unref'd) so it never keeps the process alive. Its
  // request lines are not logged (Docker and the monitor call it every few
  // seconds); a database that does not answer is.
  app.get("/api/health", { logLevel: "warn" }, async (request, reply) => {
    const version = config.appVersion;
    let timer;
    const late = new Promise((resolve, reject) => {
      timer = setTimeout(() => reject(Object.assign(new Error("no answer in time"), { code: "TIMEOUT" })), healthCheck.timeoutMs);
      timer.unref?.();
    });
    try {
      await Promise.race([q("SELECT 1"), late]);
      return { ok: true, db: "ok", version };
    } catch (e) {
      request.log.warn(`health: Postgres did not answer (${e?.code || e?.message || e})`);
      return reply.code(503).send({ ok: false, db: "down", version });
    } finally {
      clearTimeout(timer);
    }
  });

  // Whether her address was looked up in the breach list, and when: what the
  // protection score's "breaches" criterion reads (protects.js CRITERIA,
  // breach-exposure.md); { at, found }, or null before the first tap.
  const breachLookupOf = async (userId) => {
    const l = (await one("SELECT data->'breachLookup' AS lookup FROM contexts WHERE user_id = $1", [userId]))?.lookup;
    return l?.at ? { at: l.at, found: Number(l.found) || 0 } : null;
  };

  app.get("/api/status", async (request) => {
    const u = request.user;
    const gmail = u ? await one("SELECT sync_status, sync_error, last_sync_at, backfill_done, watch_expiration FROM gmail_state WHERE user_id = $1", [u.id]) : null;
    const tokens = u ? await tokenStatus(u.id) : null;
    return {
      googleConfigured: googleConfigured(),
      museConfigured: museConfigured(),
      voiceConfigured: voiceConfigured(),
      // The "send it to Prudence" rows in Settings, one shape: is the channel on, and the link that opens it.
      whatsappConfigured: whatsappConfigured(),
      whatsappLink: whatsappLink(),
      messengerConfigured: messengerConfigured(),
      messengerLink: messengerLink(),
      museModel: museConfigured() ? museModel() : null,
      urlhaus: !config.abusechKey ? "off" : urlhausState.off ? "refused" : "on",
      instantChecks: pubsubConfigured() ? jobStatus.pubsub : "off",
      signedIn: Boolean(u),
      user: u && { id: u.id, name: u.name, email: u.email, locale: u.locale, textScale: u.text_scale, actMode: u.act_mode,
        autoAlert: u.auto_alert, onboarded: u.onboarded, isAdmin: u.isAdmin },
      gmail: gmail && { connected: tokens?.status === "ok", needsReconnect: tokens?.status === "reauth_needed", syncStatus: gmail.sync_status,
        lastSyncAt: gmail.last_sync_at, ready: gmail.backfill_done, push: Boolean(gmail.watch_expiration && gmail.watch_expiration > new Date()) },
      isGuardian: u ? Boolean(await one("SELECT 1 FROM guardianships WHERE guardian_id = $1 AND status = 'active' LIMIT 1", [u.id])) : false,
      breachLookup: u ? await breachLookupOf(u.id) : null,
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
      // A looked-up breach stays only while it is ticked (specs/breach-exposure.md, line 3).
      const stillTicked = (ctx.breaches || []).filter((b) => lookedUp(b) && ids.has(b.id));
      ctx.breaches = [...stillTicked, ...KNOWN_BREACHES.filter((b) => ids.has(b.id))];
      await q(`INSERT INTO contexts (user_id, data) VALUES ($1, $2) ON CONFLICT (user_id) DO UPDATE SET data = EXCLUDED.data, updated_at = now()`, [request.user.id, ctx]);
      return { breaches: ctx.breaches };
    });

    // The lookup sends the senior's address to a public breach list, so it
    // runs only on their tap (specs/breach-exposure.md, lines 1-2, 5-6), once
    // a minute per person: the free list allows 25 an hour for the whole server.
    priv.post("/api/context/lookup-breaches", async (request, reply) => {
      const last = lookups.get(request.user.id) || 0;
      if (last > Date.now() - 60000) return reply.code(429).send({ error: "lookup_wait" });
      lookups.set(request.user.id, Date.now());
      const email = (await one("SELECT email FROM gmail_state WHERE user_id = $1", [request.user.id]))?.email || request.user.email;
      let result;
      try { result = await lookupBreaches(email, { hibpKey: config.hibpKey }); } catch (e) {
        request.log.warn(`breach lookup failed: ${e.message}`);
        return reply.code(502).send({ error: "lookup_failed" });
      }
      const row = await one("SELECT data FROM contexts WHERE user_id = $1", [request.user.id]);
      const ctx = row?.data || { userName: request.user.name, knownSenders: [], knownLinkDomains: [], providers: [], orders: [], breaches: [], trustedContacts: [], subscriptions: [] };
      ctx.breaches = mergeBreaches(result.breaches, ctx.breaches);
      ctx.breachLookup = { at: new Date().toISOString(), source: result.source, found: result.breaches.length };
      await q(`INSERT INTO contexts (user_id, data) VALUES ($1, $2) ON CONFLICT (user_id) DO UPDATE SET data = EXCLUDED.data, updated_at = now()`, [request.user.id, ctx]);
      await audit(request.user.id, "breach_lookup", { found: result.breaches.length, source: result.source });
      return { breaches: ctx.breaches, lookup: ctx.breachLookup };
    });

    // A rebuild reads hundreds of messages: once per 10 minutes per person.
    priv.post("/api/context/rebuild", async (request, reply) => {
      const last = rebuilds.get(request.user.id) || 0;
      if (last > Date.now() - 10 * 60000) return reply.code(429).send({ error: "Already looking through your mailbox. Try again in a few minutes." });
      rebuilds.set(request.user.id, Date.now());
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
