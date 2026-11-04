// What "Check something" answers when a check cannot run
// (_product/specs/check-something-else.md, line 2, and the To do row of
// 2026-11-03: POST /api/check/image answered 500 with the raw "fetch failed"
// when Muse Spark could not be reached). The senior reads one plain
// sentence, never the model's own error or a status code. Also what the
// pasted text's "Where did you get it?" sends (protection-menu.md, frame 1i):
// a place the route does not know is judged as an email. Needs Postgres
// (skipped without it); the model is the mock provider.
import "./helpers/env.js";
import { test, before, after, afterEach } from "node:test";
import assert from "node:assert/strict";
import { pool, resetDb, makeUser, sessionFor, dbAvailable } from "./helpers/db.js";
import { many } from "../src/db/pool.js";
import { buildApp } from "../src/server.js";
import { getProvider } from "../lib/llm/index.js";
import { breaker } from "../lib/muse.js";

const ORIGIN = "http://localhost:3999";
const mock = getProvider("mock");
const clean = () => {
  delete process.env.LLM_PROVIDER;
  mock.reset();
  breaker.failures = 0;
  breaker.openUntil = 0;
};
clean();
afterEach(clean);

const hasDb = await dbAvailable();
const db = { skip: hasDb ? false : "Postgres test database not available" };
let app;
before(async () => {
  if (!hasDb) return;
  await resetDb();
  app = await buildApp({ logger: false });
});
after(async () => { await app?.close(); await pool.end(); });

// A picture upload as the page sends it (field "image").
function picture(bytes = Buffer.from("\x89PNG\r\n\x1a\nPRUDENCE-TEST-PICTURE", "latin1"), type = "image/png") {
  const boundary = `----prudencepicture${Date.now()}`;
  const payload = Buffer.concat([
    Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="image"; filename="screenshot.png"\r\nContent-Type: ${type}\r\n\r\n`),
    bytes, Buffer.from(`\r\n--${boundary}--\r\n`),
  ]);
  return { payload, headers: { "content-type": `multipart/form-data; boundary=${boundary}` } };
}

test("a picture Muse Spark cannot be reached for gets one plain sentence, never \"fetch failed\", and no check is kept", db, async () => {
  process.env.LLM_PROVIDER = "mock";
  const user = await makeUser({ email: "linda.picture.down@example.test" });
  const cookie = await sessionFor(user);
  const send = () => { const p = picture(); return app.inject({ method: "POST", url: "/api/check/image", headers: { cookie, origin: ORIGIN, ...p.headers }, payload: p.payload }); };

  // The connection to api.meta.ai fails (Nov 3: a 10 s connect timeout), then the answer is not JSON.
  mock.script(Object.assign(new TypeError("fetch failed"), { cause: new Error("Connect Timeout Error") }), "not json at all");
  for (const why of ["unreachable", "broken answer"]) {
    const res = await send();
    assert.equal(res.statusCode, 502, `${why}: ${res.body}`);
    assert.deepEqual(res.json(), { error: "image_failed", message: "We could not read this picture right now. Please try again in a minute." }, why);
    assert.doesNotMatch(res.body, /fetch failed|timeout|json|500/i, `${why}: nothing technical reaches the senior`);
  }
  assert.equal(mock.calls.length, 2, "one model call per picture, nothing else");
  assert.deepEqual(await many("SELECT id FROM checks WHERE user_id = $1", [user.id]), [], "a picture that was never read leaves no check");
});

const CAREFUL = { verdict: "be_careful", confidence: 0.8, headline: "Be careful: check this before you do anything.",
  reasons: [{ text: "It rushes you to reply with a code.", evidence: "pressure" }], action: "check_official_website",
  action_text: "Open your bank's own app yourself.", real_company_says: null, impersonated_brand: null, scam_type: null,
  matched_pattern_ids: [], escalate_to_guardian: false, guardian_summary: null, language: "en" };

test("a pasted text keeps where it came from (a text, WhatsApp, Facebook, a letter, somewhere else) and who the senior says sent it; an unknown place is judged as an email", db, async () => {
  process.env.LLM_PROVIDER = "mock";
  const user = await makeUser({ email: "linda.paste.where@example.test" });
  const cookie = await sessionFor(user);
  const places = [["sms", "sms"], ["whatsapp", "whatsapp"], ["social", "social"], ["letter", "letter"], ["other", "other"], ["fax", "email"], [undefined, "email"]];
  const run = Date.now(); // llm_cache outlives resetDb: new words each run, so the model is asked
  for (const [sent, judged] of places) {
    mock.reset();
    mock.respondWith(() => CAREFUL);
    const body = { channel: sent, from: "", fromName: "My bank", body: `Your account is locked (${sent} ${run}). Reply with your code.` };
    const res = await app.inject({ method: "POST", url: "/api/check/text", headers: { cookie, origin: ORIGIN }, payload: body });
    assert.equal(res.statusCode, 200, res.body);
    assert.equal(res.json().message.channel, judged, `${sent} is judged as ${judged}`);
    assert.equal(res.json().verdict.source, "Mock LLM (mock-1)", `${sent}: the model answered, not the rules`);
    const prompt = JSON.stringify(mock.calls.at(-1)?.messages || []);
    assert.match(prompt, new RegExp(`\\\\"channel\\\\":\\\\"${judged}\\\\"`), `${sent}: the model is told the channel ${judged}`);
    assert.match(prompt, /My bank/, `${sent}: the model hears who the senior says sent it`);
  }
});
