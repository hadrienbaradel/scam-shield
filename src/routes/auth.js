// Sign in with Google. mode=gmail (seniors: protect my mailbox, grants
// gmail.modify) or mode=basic (guardians: sign in only, no mail access).

import { config, googleConfigured } from "../config.js";
import { pkcePair, randomToken, sha256 } from "../crypto.js";
import { one, q } from "../db/pool.js";
import { authUrl, exchangeCode, readIdToken, GMAIL_SCOPE } from "../google/oauth.js";
import { saveTokens } from "../google/tokens.js";
import { startSession, endSession } from "../auth.js";
import { acceptInvite } from "../guardians.js";
import { syncUser } from "../sync/worker.js";
import { renewWatches } from "../jobs/scheduler.js";

export default async function authRoutes(app) {
  const limited = { config: { rateLimit: { max: 30, timeWindow: "1 minute" } } };

  app.get("/auth/google", limited, async (request, reply) => {
    if (!googleConfigured()) return reply.code(503).send({ error: "Google sign-in is not configured yet (see docs/GOOGLE_SETUP.md)." });
    const mode = request.query.mode === "basic" ? "basic" : "gmail";
    const invite = typeof request.query.invite === "string" ? request.query.invite.slice(0, 200) : null;
    const state = randomToken();
    const { verifier, challenge } = pkcePair();
    await q("INSERT INTO oauth_states (state_hash, verifier, mode, invite) VALUES ($1, $2, $3, $4)", [sha256(state), verifier, mode, invite]);
    return reply.redirect(authUrl({ state, challenge, mode }));
  });

  app.get("/auth/google/callback", limited, async (request, reply) => {
    const { code, state, error } = request.query;
    if (error) return reply.redirect(`/?signin=${encodeURIComponent(error === "access_denied" ? "cancelled" : "error")}`);
    const st = state && await one("DELETE FROM oauth_states WHERE state_hash = $1 AND created_at > now() - interval '15 minutes' RETURNING *", [sha256(state)]);
    if (!st || !code) return reply.redirect("/?signin=expired");

    const tokens = await exchangeCode(code, st.verifier);
    const claims = readIdToken(tokens.id_token);
    const user = await one(`INSERT INTO users (google_sub, email, name, locale) VALUES ($1, $2, $3, $4)
                            ON CONFLICT (google_sub) DO UPDATE SET email = EXCLUDED.email, name = COALESCE(users.name, EXCLUDED.name), last_seen_at = now()
                            RETURNING *`,
    [claims.sub, claims.email.toLowerCase(), claims.given_name || claims.name || null, /^fr/i.test(claims.locale || "") ? "fr-FR" : "en-US"]);

    if (st.mode === "gmail") {
      const granted = String(tokens.scope || "").split(" ");
      if (!granted.includes(GMAIL_SCOPE)) {
        await startSession(reply, user.id);
        return reply.redirect("/?signin=need_gmail");
      }
      await saveTokens(user.id, tokens);
      await q(`INSERT INTO gmail_state (user_id, email) VALUES ($1, $2) ON CONFLICT (user_id) DO UPDATE SET email = EXCLUDED.email`,
        [user.id, claims.email.toLowerCase()]);
      syncUser(user.id).then(() => renewWatches()).catch((e) => request.log.error(e, "first sync failed"));
    }
    await startSession(reply, user.id);
    if (st.invite) {
      try {
        const g = await acceptInvite({ token: st.invite, user });
        return reply.redirect(g ? "/#/guardian?accepted=1" : "/?invite=expired");
      } catch (e) {
        return reply.redirect(`/?invite=${encodeURIComponent(e.message)}`);
      }
    }
    return reply.redirect(st.mode === "gmail" ? "/#/inbox" : "/#/guardian");
  });

  app.post("/auth/logout", async (request, reply) => {
    await endSession(request, reply);
    return { ok: true };
  });

  app.get("/auth/config", async () => ({ googleConfigured: googleConfigured(), redirectUri: config.redirectUri }));
}
