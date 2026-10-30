// Sign in with Google. mode=gmail (seniors: protect my mailbox, grants
// gmail.modify) or mode=basic (guardians: sign in only, no mail access).
// Without Google keys, the developer's own computer gets a local sign-in
// instead (/dev/signin, _product/specs/developer-sign-in.md): the same
// session, never a Google token, and nowhere else (src/localDev.js). With
// the keys set it stays there for the local test people only.

import { config, googleConfigured, isAdmin } from "../config.js";
import { pkcePair, randomToken, sha256 } from "../crypto.js";
import { many, one, q } from "../db/pool.js";
import { authUrl, exchangeCode, readIdToken, GMAIL_SCOPE } from "../google/oauth.js";
import { saveTokens } from "../google/tokens.js";
import { startSession, endSession } from "../auth.js";
import { acceptInvite } from "../guardians.js";
import { syncUser } from "../sync/worker.js";
import { audit } from "../sync/actions.js";
import { renewWatches } from "../jobs/scheduler.js";
import { isLocalDevRequest } from "../localDev.js";
import { page, esc } from "../pages.js";

const OAUTH_COOKIE = "ss_oauth";
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// An invitation followed before signing in is accepted by whoever signs in,
// with the same landing after Google and after the local sign-in.
async function acceptAndLand(reply, token, user) {
  try {
    const g = await acceptInvite({ token, user });
    return reply.redirect(g ? "/#/guardian?accepted=1" : "/?invite=expired");
  } catch (e) {
    return reply.redirect(`/?invite=${encodeURIComponent(e.message)}`);
  }
}

// What the local sign-in carries from the button through its page and form:
// the mode, and the invitation or the page to come back to when there is one.
function carried(from = {}) {
  const out = { mode: from.mode === "basic" ? "basic" : "gmail" };
  for (const k of ["invite", "next"]) if (typeof from[k] === "string" && from[k]) out[k] = from[k].slice(0, 200);
  return out;
}

// next stays on this site: a path of visible ASCII with no "//" and no
// backslash anywhere (a browser reads either as the start of another host).
const isLocalPath = (s) => typeof s === "string" && /^\/[\x21-\x5b\x5d-\x7e]*$/.test(s) && !s.includes("//");

const hidden = (fields) => Object.entries(fields).map(([k, v]) => `<input type="hidden" name="${k}" value="${esc(v)}">`).join("");

// A person this page created (google_sub "local:<email>"), never one who came through Google.
const isLocalPerson = (user) => user.google_sub.startsWith("local:");

// The local sign-in page: everyone already in the database (only the local
// test people while Google keys are set), one tap each, then a form for a
// new person. Plain forms, no script.
async function signinPage(reply, keep, { status = 200, error = "" } = {}) {
  const onlyLocal = googleConfigured();
  const people = await many(`SELECT u.id, u.name, u.email, u.google_sub, (s.user_id IS NOT NULL) AS senior
                             FROM users u LEFT JOIN gmail_state s ON s.user_id = u.id
                             ${onlyLocal ? "WHERE u.google_sub LIKE 'local:%'" : ""}
                             ORDER BY lower(coalesce(u.name, u.email)), lower(u.email)`);
  const tags = (p) => [p.senior ? "senior" : "trusted person", isAdmin(p.email) && "admin", isLocalPerson(p) && "local"].filter(Boolean).join(" · ");
  const trusted = keep.mode === "basic";
  reply.code(status).type("text/html; charset=utf-8");
  return page({ title: "Local sign-in", body: `<h1>Local sign-in</h1>
${error ? `<p class="banner danger">${esc(error)}</p>` : ""}
<p>Sign in without Google, to test Prudence. This page works only on this computer, and never in production.</p>
${onlyLocal ? "<p>Google sign-in is on: this page lists only local test people, and everyone else signs in with Google.</p>" : ""}
<p class="small">Real Google sign-in is set up as described in docs/GOOGLE_SETUP.md.</p>
${keep.invite ? "<p>You followed an invitation: the person you sign in as accepts it.</p>" : ""}
<h2>Sign in as</h2>
${people.length ? `<ul class="people">${people.map((p) => `<li><form method="post" action="/dev/signin">${hidden({ ...keep, user_id: p.id })}
<button class="btn btn-light-dark" type="submit">${esc(p.name || p.email)}</button> <span class="small">${esc(p.email)} · ${tags(p)}</span></form></li>`).join("\n")}</ul>`
    : onlyLocal ? "<p>No local test person yet: create one below.</p>" : "<p>No one yet: create the first person below.</p>"}
<h2>New person</h2>
<form method="post" action="/dev/signin">${hidden(keep)}
<label>Email<input type="email" name="email" required maxlength="200" autocomplete="off"></label>
<label>Name (optional)<input name="name" maxlength="100" autocomplete="off"></label>
<label>Language<select name="locale"><option value="en-US">English</option><option value="fr-FR">Français</option></select></label>
<fieldset><legend>Role</legend>
<label class="check"><input type="radio" name="role" value="senior"${trusted ? "" : " checked"}> Senior, with a mailbox</label>
<label class="check"><input type="radio" name="role" value="trusted"${trusted ? " checked" : ""}> Trusted person</label>
</fieldset>
<label class="check"><input type="checkbox" name="welcome" value="1"> Show the welcome steps</label>
<button class="btn btn-gold btn-big" type="submit">Create and sign in</button>
</form>` });
}

// A new local person, ready like a seeded test person unless the welcome
// steps were asked for. A senior gets a mailbox entry that reads synced and
// never a Google token, so nothing ever tries to read their mail.
async function createLocalPerson(email, body, mode) {
  const role = ["senior", "trusted"].includes(body.role) ? body.role : mode === "basic" ? "trusted" : "senior";
  const name = String(body.name ?? "").trim().slice(0, 100) || email.split("@")[0].replace(/^./, (c) => c.toUpperCase());
  const user = await one(`INSERT INTO users (google_sub, email, name, locale, act_mode, onboarded, move_consent_at)
                          VALUES ($1, $2, $3, $4, $5, $6, CASE WHEN $5 = 'move' THEN now() END)
                          ON CONFLICT (google_sub) DO UPDATE SET last_seen_at = now() RETURNING *`,
  [`local:${email}`, email, name, body.locale === "fr-FR" ? "fr-FR" : "en-US", body.welcome ? "label" : "move", !body.welcome]);
  if (role === "senior") {
    await q(`INSERT INTO gmail_state (user_id, email, sync_status, backfill_done, last_sync_at) VALUES ($1, $2, 'ok', true, now())
             ON CONFLICT (user_id) DO NOTHING`, [user.id, email]);
  }
  return user;
}

export default async function authRoutes(app) {
  const limited = { config: { rateLimit: { max: 30, timeWindow: "1 minute" } } };

  app.get("/auth/google", limited, async (request, reply) => {
    if (!googleConfigured()) {
      if (isLocalDevRequest(request)) return reply.redirect(`/dev/signin?${new URLSearchParams(carried(request.query))}`);
      return reply.code(503).send({ error: "Google sign-in is not configured yet (see docs/GOOGLE_SETUP.md)." });
    }
    const mode = request.query.mode === "basic" ? "basic" : "gmail";
    const invite = typeof request.query.invite === "string" ? request.query.invite.slice(0, 200) : null;
    const state = randomToken();
    const { verifier, challenge } = pkcePair();
    // Login-CSRF defense: the sign-in can only be completed by the browser
    // that started it (PKCE alone does not bind it to a browser).
    const browser = randomToken();
    reply.setCookie(OAUTH_COOKIE, browser, { path: "/auth/google", httpOnly: true, sameSite: "lax", secure: config.secureCookies, maxAge: 900 });
    await q("INSERT INTO oauth_states (state_hash, verifier, mode, invite, browser_hash) VALUES ($1, $2, $3, $4, $5)",
      [sha256(state), verifier, mode, invite, sha256(browser)]);
    return reply.redirect(authUrl({ state, challenge, mode }));
  });

  app.get("/auth/google/callback", limited, async (request, reply) => {
    const { code, state, error } = request.query;
    if (error) return reply.redirect(`/?signin=${encodeURIComponent(error === "access_denied" ? "cancelled" : "error")}`);
    const browser = request.cookies?.[OAUTH_COOKIE];
    reply.clearCookie(OAUTH_COOKIE, { path: "/auth/google" });
    const st = state && browser && await one(`DELETE FROM oauth_states WHERE state_hash = $1 AND browser_hash = $2
                                              AND created_at > now() - interval '15 minutes' RETURNING *`, [sha256(state), sha256(browser)]);
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
    if (st.invite) return acceptAndLand(reply, st.invite, user);
    return reply.redirect(st.mode === "gmail" ? "/#/inbox" : "/#/guardian");
  });

  app.post("/auth/logout", async (request, reply) => {
    await endSession(request, reply);
    return { ok: true };
  });

  app.get("/auth/config", async (request) => ({ googleConfigured: googleConfigured(), redirectUri: config.redirectUri, devSignin: isLocalDevRequest(request) }));

  // The local sign-in: not found anywhere but on this computer (src/localDev.js).
  app.get("/dev/signin", async (request, reply) => {
    if (!isLocalDevRequest(request)) return reply.code(404).send();
    return signinPage(reply, carried(request.query));
  });

  // One person from the list (user_id), or the one with this email, created
  // when there is none; while Google keys are set, only a local test person.
  // Then the landing a Google sign-in would give: the invitation, else next,
  // else the senior's Today or the trusted person's page.
  app.post("/dev/signin", async (request, reply) => {
    if (!isLocalDevRequest(request)) return reply.code(404).send();
    const body = request.body && typeof request.body === "object" ? request.body : {};
    const keep = carried(body);
    let user;
    if (body.user_id) {
      user = UUID.test(String(body.user_id)) ? await one("SELECT * FROM users WHERE id = $1", [body.user_id]) : null;
      if (!user) return signinPage(reply, keep, { status: 404, error: "That person is not in the database any more. Pick someone in the list." });
    } else {
      const email = String(body.email ?? "").trim().toLowerCase();
      if (email.length > 200 || !/^[^\s@]+@[^\s@]+$/.test(email)) return signinPage(reply, keep, { status: 400, error: "Type an email address, such as linda@example.com." });
      // A Google person and a local test person may share an address: the
      // Google person comes first, so the two are never confused.
      user = await one("SELECT * FROM users WHERE lower(email) = $1 ORDER BY google_sub LIKE 'local:%', created_at LIMIT 1", [email])
        || await createLocalPerson(email, body, keep.mode);
    }
    if (googleConfigured() && !isLocalPerson(user)) {
      return signinPage(reply, keep, { status: 403, error: "That person signs in with Google. Pick a local test person, or create one with another address." });
    }
    await audit(user.id, "signed_in_locally", {});
    await startSession(reply, user.id);
    if (keep.invite) return acceptAndLand(reply, keep.invite, user);
    if (isLocalPath(keep.next)) return reply.redirect(keep.next);
    const senior = await one("SELECT 1 FROM gmail_state WHERE user_id = $1", [user.id]);
    return reply.redirect(senior ? "/#/today" : "/#/guardian");
  });
}
