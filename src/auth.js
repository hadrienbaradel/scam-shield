// Sessions: a random token in an httpOnly cookie; only its SHA-256 is
// stored. 30-day sliding expiry.

import { config, isAdmin } from "./config.js";
import { randomToken, sha256 } from "./crypto.js";
import { one, q } from "./db/pool.js";

const COOKIE = "ss_sid";
const DAYS = 30;
const cookieOpts = () => ({ path: "/", httpOnly: true, sameSite: "lax", secure: config.secureCookies, maxAge: DAYS * 86400 });

export async function startSession(reply, userId) {
  const token = randomToken();
  await q("INSERT INTO sessions (id_hash, user_id, expires_at) VALUES ($1, $2, now() + interval '30 days')", [sha256(token), userId]);
  reply.setCookie(COOKIE, token, cookieOpts());
}

export async function endSession(request, reply) {
  const token = request.cookies?.[COOKIE];
  if (token) await q("DELETE FROM sessions WHERE id_hash = $1", [sha256(token)]);
  reply.clearCookie(COOKIE, { path: "/" });
}

export async function loadUser(request) {
  const token = request.cookies?.[COOKIE];
  if (!token) return null;
  const row = await one(`SELECT u.*, s.expires_at AS session_expires FROM sessions s JOIN users u ON u.id = s.user_id
                         WHERE s.id_hash = $1 AND s.expires_at > now()`, [sha256(token)]);
  if (!row) return null;
  if (row.session_expires.getTime() - Date.now() < (DAYS - 1) * 86400000) {
    await q("UPDATE sessions SET expires_at = now() + interval '30 days' WHERE id_hash = $1", [sha256(token)]);
    await q("UPDATE users SET last_seen_at = now() WHERE id = $1", [row.id]);
  }
  row.isAdmin = isAdmin(row.email);
  return row;
}

export async function requireUser(request, reply) {
  if (!request.user) return reply.code(401).send({ error: "Please sign in." });
}

export async function requireAdmin(request, reply) {
  if (!request.user?.isAdmin) return reply.code(403).send({ error: "Admins only." });
}
