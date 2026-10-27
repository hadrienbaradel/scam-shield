// Imported first by every test that touches src/: a fixed test
// environment, independent of the developer's .env.
process.env.DATABASE_URL = process.env.TEST_DATABASE_URL || "postgres://localhost/scam_shield_test";
process.env.TOKEN_ENC_KEY = Buffer.alloc(32, 7).toString("base64");
process.env.BASE_URL = "http://localhost:3999";
process.env.GOOGLE_CLIENT_ID = "test-client.apps.googleusercontent.com";
process.env.GOOGLE_CLIENT_SECRET = "test-secret";
process.env.ADMIN_EMAILS = "admin@example.test";
process.env.WORKER = "0";
delete process.env.META_MODEL_API_KEY;
delete process.env.RESEND_API_KEY;
delete process.env.HIBP_API_KEY;
delete process.env.ABUSECH_AUTH_KEY;
delete process.env.GMAIL_PUBSUB_TOPIC;
delete process.env.GMAIL_PUBSUB_SUBSCRIPTION;
// The model layer: each test picks its provider; nothing comes from the shell.
for (const k of ["LLM_PROVIDER", "LLM_MODEL", "LLM_BASE_URL", "LLM_THINKING", "OPENAI_API_KEY", "ANTHROPIC_API_KEY", "ANTHROPIC_BASE_URL",
  "META_MODEL_NAME", "META_MODEL_BASE_URL", "META_MODEL_REASONING_EFFORT"]) delete process.env[k];
