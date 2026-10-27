// OAuth tokens are encrypted at rest with AES-256-GCM. The key lives only
// in the environment (TOKEN_ENC_KEY, 32 random bytes, base64).
// Bearer secrets we hand out (sessions, invites, one-tap links, device
// tokens) are stored as SHA-256 hashes, never in clear.

import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";

function key(raw) {
  const k = Buffer.from(raw || "", "base64");
  if (k.length !== 32) throw new Error("TOKEN_ENC_KEY must be 32 bytes, base64-encoded (npm run setup creates one)");
  return k;
}

export function encrypt(plain, rawKey) {
  if (plain == null) return null;
  const iv = randomBytes(12);
  const c = createCipheriv("aes-256-gcm", key(rawKey), iv);
  const body = Buffer.concat([c.update(String(plain), "utf8"), c.final()]);
  return ["v1", iv.toString("base64"), c.getAuthTag().toString("base64"), body.toString("base64")].join(".");
}

export function decrypt(packed, rawKey) {
  if (!packed) return null;
  const [v, iv, tag, body] = packed.split(".");
  if (v !== "v1") throw new Error("unknown token format");
  const d = createDecipheriv("aes-256-gcm", key(rawKey), Buffer.from(iv, "base64"));
  d.setAuthTag(Buffer.from(tag, "base64"));
  return Buffer.concat([d.update(Buffer.from(body, "base64")), d.final()]).toString("utf8");
}

export const randomToken = (bytes = 32) => randomBytes(bytes).toString("base64url");
export const sha256 = (s) => createHash("sha256").update(String(s)).digest("hex");
export const newKey = () => randomBytes(32).toString("base64");

// PKCE (RFC 7636) for the Google sign-in.
export function pkcePair() {
  const verifier = randomToken(48);
  const challenge = createHash("sha256").update(verifier).digest("base64url");
  return { verifier, challenge };
}
