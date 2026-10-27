// Per-user Google tokens, encrypted at rest. accessTokenFor() refreshes a
// token about to expire and flags the account for reconnection when
// Google refuses the refresh token.

import { config } from "../config.js";
import { encrypt, decrypt } from "../crypto.js";
import { one, q } from "../db/pool.js";
import { refreshAccessToken, revoke, ReauthNeeded } from "./oauth.js";

export async function saveTokens(userId, t) {
  await q(`INSERT INTO google_tokens (user_id, refresh_token_enc, access_token_enc, expires_at, scopes, status, updated_at)
           VALUES ($1, $2, $3, $4, $5, 'ok', now())
           ON CONFLICT (user_id) DO UPDATE SET
             refresh_token_enc = COALESCE(EXCLUDED.refresh_token_enc, google_tokens.refresh_token_enc),
             access_token_enc = EXCLUDED.access_token_enc, expires_at = EXCLUDED.expires_at,
             scopes = EXCLUDED.scopes, status = 'ok', updated_at = now()`,
  [userId, encrypt(t.refresh_token, config.tokenKey), encrypt(t.access_token, config.tokenKey),
    new Date(Date.now() + (t.expires_in || 3600) * 1000), t.scope || ""]);
}

export async function tokenStatus(userId) {
  return (await one("SELECT status, scopes FROM google_tokens WHERE user_id = $1", [userId])) || null;
}

const inflight = new Map();
export async function accessTokenFor(userId) {
  const row = await one("SELECT * FROM google_tokens WHERE user_id = $1", [userId]);
  if (!row || row.status !== "ok") throw new ReauthNeeded("Gmail is not connected");
  if (row.expires_at && row.expires_at.getTime() - Date.now() > 120000) return decrypt(row.access_token_enc, config.tokenKey);
  if (!row.refresh_token_enc) throw new ReauthNeeded("no refresh token");
  // One refresh at a time per user, however many syncs ask concurrently.
  if (!inflight.has(userId)) {
    inflight.set(userId, (async () => {
      try {
        const t = await refreshAccessToken(decrypt(row.refresh_token_enc, config.tokenKey));
        await q("UPDATE google_tokens SET access_token_enc = $2, expires_at = $3, updated_at = now() WHERE user_id = $1",
          [userId, encrypt(t.access_token, config.tokenKey), new Date(Date.now() + (t.expires_in || 3600) * 1000)]);
        return t.access_token;
      } catch (e) {
        if (e instanceof ReauthNeeded) await q("UPDATE google_tokens SET status = 'reauth_needed', updated_at = now() WHERE user_id = $1", [userId]);
        throw e;
      } finally {
        inflight.delete(userId);
      }
    })());
  }
  return inflight.get(userId);
}

export async function revokeAndForget(userId) {
  const row = await one("SELECT * FROM google_tokens WHERE user_id = $1", [userId]);
  if (row) {
    try { await revoke(decrypt(row.refresh_token_enc || row.access_token_enc, config.tokenKey)); } catch { /* best effort */ }
  }
  await q("DELETE FROM google_tokens WHERE user_id = $1", [userId]);
}
