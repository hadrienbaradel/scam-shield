// All settings come from the environment (.env via `node --env-file`).
// Nothing secret has a default; features without their keys switch off
// cleanly and say so in /api/status.

const env = process.env;
const list = (v) => String(v || "").split(",").map((s) => s.trim().toLowerCase()).filter(Boolean);

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
  resend: { apiKey: env.RESEND_API_KEY || "", from: env.MAIL_FROM || "Scam Shield <alerts@example.test>" },
  hibpKey: env.HIBP_API_KEY || "",
  adminEmails: list(env.ADMIN_EMAILS),
  pollSeconds: Number(env.SYNC_POLL_SECONDS || 120),
  worker: env.WORKER !== "0",
  backfillCount: Number(env.BACKFILL_COUNT || 50),
  contextScanCount: Number(env.CONTEXT_SCAN_COUNT || 300),
  production: env.NODE_ENV === "production",
};

config.redirectUri = env.GOOGLE_REDIRECT_URI || `${config.baseUrl}/auth/google/callback`;
config.secureCookies = config.baseUrl.startsWith("https://");
export const googleConfigured = () => Boolean(config.google.clientId && config.google.clientSecret && config.tokenKey);
export const pubsubConfigured = () => Boolean(config.google.pubsubTopic && config.google.pubsubSubscription);
export const isAdmin = (email) => config.adminEmails.includes(String(email || "").toLowerCase());
