// All settings come from the environment (.env via `node --env-file`).
// Nothing secret has a default; features without their keys switch off
// cleanly and say so in /api/status.

const env = process.env;
const list = (v) => String(v || "").split(",").map((s) => s.trim().toLowerCase()).filter(Boolean);

// TRUST_PROXY, Fastify's trustProxy (_product/specs/observability.md, line 7).
// Unset, "false" or "0": no proxy is trusted, request.ip is the socket's
// address. "true" or "1": the proxies on this machine or its private networks
// (the tunnel's cloudflared, a local reverse proxy), so request.ip is the first
// address from the right that is not one of them: the one Cloudflare appended.
// Not Fastify's own true, which takes the leftmost X-Forwarded-For entry, one
// a visitor writes. Anything else: the proxies' addresses, CIDRs or
// proxy-addr names, comma-separated. A hop count is no option: Fastify 5.12
// trusts nothing for a number.
export const PRIVATE_PROXIES = ["loopback", "linklocal", "uniquelocal"];
export function parseTrustProxy(value) {
  const v = String(value ?? "").trim();
  if (!v || /^(false|0)$/i.test(v)) return false;
  if (/^(true|1)$/i.test(v)) return [...PRIVATE_PROXIES];
  return v.split(",").map((s) => s.trim()).filter(Boolean);
}

export const config = {
  port: Number(env.PORT || 3000),
  // Loopback only by default. Pairing a real phone on the LAN needs HOST=0.0.0.0.
  host: env.HOST || "127.0.0.1",
  baseUrl: (env.BASE_URL || `http://localhost:${env.PORT || 3000}`).replace(/\/$/, ""),
  databaseUrl: env.DATABASE_URL || "postgres://localhost/scam_shield",
  tokenKey: env.TOKEN_ENC_KEY || "",
  google: {
    clientId: env.GOOGLE_CLIENT_ID || "",
    clientSecret: env.GOOGLE_CLIENT_SECRET || "",
    pubsubTopic: env.GMAIL_PUBSUB_TOPIC || "",
    pubsubSubscription: env.GMAIL_PUBSUB_SUBSCRIPTION || "",
  },
  resend: { apiKey: env.RESEND_API_KEY || "", from: env.MAIL_FROM || "Prudence <alerts@example.test>" },
  hibpKey: env.HIBP_API_KEY || "",
  // abuse.ch URLhaus lookups (fair use, not-for-profit): host names only.
  abusechKey: env.ABUSECH_AUTH_KEY || "",
  adminEmails: list(env.ADMIN_EMAILS),
  pollSeconds: Number(env.SYNC_POLL_SECONDS || 120),
  worker: env.WORKER !== "0",
  backfillCount: Number(env.BACKFILL_COUNT || 50),
  contextScanCount: Number(env.CONTEXT_SCAN_COUNT || 300),
  production: env.NODE_ENV === "production",
  // Observability (_product/specs/observability.md): the git sha the image was
  // built with (make prod-build), named by /api/health and Rollbar; "dev" otherwise.
  appVersion: env.APP_VERSION || "dev",
  // One heartbeat URL per scheduled job, pinged in production only. Secrets.
  heartbeats: {
    poll: env.HEARTBEAT_POLL_URL || "",
    watch: env.HEARTBEAT_WATCH_URL || "",
    threatfeed: env.HEARTBEAT_THREATFEED_URL || "",
    retention: env.HEARTBEAT_RETENTION_URL || "",
  },
  trustProxy: parseTrustProxy(env.TRUST_PROXY),
};

config.redirectUri = env.GOOGLE_REDIRECT_URI || `${config.baseUrl}/auth/google/callback`;
config.secureCookies = config.baseUrl.startsWith("https://");
export const googleConfigured = () => Boolean(config.google.clientId && config.google.clientSecret && config.tokenKey);
export const pubsubConfigured = () => Boolean(config.google.pubsubTopic && config.google.pubsubSubscription);
export const isAdmin = (email) => config.adminEmails.includes(String(email || "").toLowerCase());
