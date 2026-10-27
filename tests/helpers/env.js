// Imported first by every test that touches src/: a fixed test
// environment, independent of the developer's .env.
// No import statement in this file: with one, Node evaluated the src/ modules of the
// test graph before this one (seen with node --test on 25.x), and src/config.js read
// BASE_URL before it was set here. So the test database rule below is inlined; it is the
// same as testDatabaseUrl() in src/db/testDatabase.js (tests/infra.test.js checks that).
// The database is TEST_DATABASE_URL (default postgres://localhost/scam_shield_test), or
// its <name>_<TEST_DB_SUFFIX> copy ([a-z0-9_], at most 40 characters) so agents can run
// suites side by side; tests/helpers/db.js creates it on first use.
{
  const base = process.env.TEST_DATABASE_URL || "postgres://localhost/scam_shield_test";
  const suffix = String(process.env.TEST_DB_SUFFIX ?? "").toLowerCase().replace(/[^a-z0-9_]+/g, "_").replace(/^_+|_+$/g, "").slice(0, 40).replace(/_+$/, "");
  process.env.DATABASE_URL = suffix ? base.replace(/(\/[^/?#]+)(?=[?#]|$)/, `$1_${suffix}`) : base;
}
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
