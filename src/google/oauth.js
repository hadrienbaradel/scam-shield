// Google sign-in (OAuth 2.0 authorization code + PKCE + state).
// Seniors grant gmail.modify so suspected scams can be labeled and moved;
// guardians only sign in (openid email profile) and never grant mail access.

import { config } from "../config.js";

export const SCOPES = {
  basic: ["openid", "email", "profile"],
  gmail: ["openid", "email", "profile", "https://www.googleapis.com/auth/gmail.modify"],
};
export const GMAIL_SCOPE = "https://www.googleapis.com/auth/gmail.modify";

export class ReauthNeeded extends Error {}

export function authUrl({ state, challenge, mode, loginHint }) {
  const p = new URLSearchParams({
    client_id: config.google.clientId,
    redirect_uri: config.redirectUri,
    response_type: "code",
    scope: SCOPES[mode].join(" "),
    state,
    code_challenge: challenge,
    code_challenge_method: "S256",
    include_granted_scopes: "true",
    ...(mode === "gmail" ? { access_type: "offline", prompt: "consent" } : { prompt: "select_account" }),
    ...(loginHint ? { login_hint: loginHint } : {}),
  });
  return `https://accounts.google.com/o/oauth2/v2/auth?${p}`;
}

async function tokenRequest(params) {
  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ client_id: config.google.clientId, client_secret: config.google.clientSecret, ...params }),
    signal: AbortSignal.timeout(15000),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    if (data.error === "invalid_grant") throw new ReauthNeeded(data.error_description || "invalid_grant");
    throw new Error(data.error_description || data.error || `token endpoint ${res.status}`);
  }
  return data;
}

export const exchangeCode = (code, verifier) =>
  tokenRequest({ code, code_verifier: verifier, redirect_uri: config.redirectUri, grant_type: "authorization_code" });

// Testing-mode apps get refresh tokens that Google expires after 7 days:
// that surfaces here as ReauthNeeded and becomes a "Reconnect Gmail" banner.
export const refreshAccessToken = (refreshToken) =>
  tokenRequest({ refresh_token: refreshToken, grant_type: "refresh_token" });

// The ID token arrives straight from Google's token endpoint over TLS, so
// per OpenID Connect Core 3.1.3.7 its claims can be read without fetching
// signing keys; issuer, audience and expiry are still checked.
export function readIdToken(idToken) {
  const claims = JSON.parse(Buffer.from(String(idToken).split(".")[1] || "", "base64url").toString("utf8"));
  if (!["https://accounts.google.com", "accounts.google.com"].includes(claims.iss)) throw new Error("bad id_token issuer");
  if (claims.aud !== config.google.clientId) throw new Error("id_token audience mismatch");
  if (claims.exp * 1000 < Date.now() - 60000) throw new Error("id_token expired");
  if (!claims.email_verified) throw new Error("Google account email is not verified");
  return claims;
}

export async function revoke(token) {
  if (!token) return;
  await fetch(`https://oauth2.googleapis.com/revoke?token=${encodeURIComponent(token)}`, { method: "POST", signal: AbortSignal.timeout(10000) })
    .catch(() => {});
}
