// What "Check something" answers when a check cannot run
// (_product/specs/check-something-else.md, line 2, and the To do row of
// 2026-11-03: POST /api/check/image answered 500 with the raw "fetch failed"
// when Muse Spark could not be reached). The senior reads one plain
// sentence, never the model's own error or a status code. Needs Postgres
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
