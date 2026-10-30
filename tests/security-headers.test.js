// The security headers, without a database. Every page says Referrer-Policy:
// same-origin, so a form posted from our own script-free pages (the trusted
// person's one-tap answer at /answer/:token, the local sign-in) carries a
// real Origin and passes the Origin check (src/server.js); under helmet's
// default no-referrer a browser would send Origin: null, which stays refused.
// The Content-Security-Policy is still there. The one lookup the answer page
// makes is answered empty here, so nothing opens a connection.
import "./helpers/env.js";
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { pool } from "../src/db/pool.js";
import { buildApp } from "../src/server.js";

const ORIGIN = "http://localhost:3999";
let app;

before(async () => {
  pool.query = async () => ({ rows: [] }); // no database: every lookup finds nothing
  app = await buildApp({ logger: false });
});
after(async () => {
  delete pool.query; // back to pg's own
  await app?.close();
});

test("the welcome page and the one-tap answer page say Referrer-Policy: same-origin and keep their Content-Security-Policy", async () => {
  for (const url of ["/", "/answer/some-token"]) {
    const res = await app.inject({ url });
    assert.equal(res.statusCode, 200, url);
    assert.match(res.headers["content-type"], /text\/html/, url);
    assert.equal(res.headers["referrer-policy"], "same-origin", url);
    const csp = res.headers["content-security-policy"];
    assert.ok(csp, `${url}: a Content-Security-Policy`);
    assert.match(csp, /script-src 'self'/, url);
    assert.match(csp, /form-action 'self'/, `${url}: forms post only to this site`);
  }
});

test("a form posted to the answer page with this site's Origin passes the Origin check; Origin: null and another site are still refused", async () => {
  const post = (origin) => app.inject({ method: "POST", url: "/answer/some-token", payload: "answer=scam",
    headers: { "content-type": "application/x-www-form-urlencoded", origin } });
  const ours = await post(ORIGIN);
  assert.equal(ours.statusCode, 200);
  assert.match(ours.body, /already used or has expired/, "it reaches the page (no alert has this token here)");
  for (const origin of ["null", "https://evil.example.test"]) {
    const res = await post(origin);
    assert.equal(res.statusCode, 403, origin);
    assert.deepEqual(res.json(), { error: `Requests must come from ${ORIGIN}` }, origin);
  }
});
