// The local sign-in over HTTP and Postgres (_product/specs/developer-sign-in.md):
// without Google keys, on the developer's own computer, the welcome buttons
// open /dev/signin, which signs in as someone already here or as a new person
// (a senior gets a mailbox entry and never a Google token); with the keys set
// (the default here, tests/helpers/env.js) only local test people sign in
// there. The session is a real one (the senior's screens, the admin console),
// a post from another site is refused, an invitation is accepted, next is
// followed only within this site, a local senior has nothing to reconnect and
// the background jobs (the push listener included) skip them, and the page is
// not found in production or through a tunnel or a proxy. At least one test
// per behavior line. Needs Postgres; skipped without it.

import { pool, resetDb, makeUser, sessionFor, dbAvailable } from "./helpers/db.js";
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { one } from "../src/db/pool.js";
import { buildApp } from "../src/server.js";
import { config } from "../src/config.js";
import { inviteGuardian } from "../src/guardians.js";
import { pollAll, renewWatches, jobStatus, mailboxForPush } from "../src/jobs/scheduler.js";
import { usersToSync } from "../src/sync/worker.js";

const ORIGIN = "http://localhost:3999";
const hasDb = await dbAvailable();
const opts = { skip: hasDb ? false : "Postgres test database not available" };
const saved = { google: { ...config.google }, production: config.production };
let app;

before(async () => {
  if (!hasDb) return;
  await resetDb();
  app = await buildApp({ logger: false });
});
after(async () => {
  Object.assign(config.google, saved.google);
  config.production = saved.production;
  await app?.close();
  await pool.end();
});

// Google sign-in is off without a client id (googleConfigured() reads config at call time).
async function withoutGoogle(fn) {
  config.google.clientId = "";
  try { return await fn(); } finally { config.google.clientId = saved.google.clientId; }
}
// The same for a whole test, until it ends (t: the test's context).
function withoutGoogleFor(t) {
  config.google.clientId = "";
  t.after(() => { config.google.clientId = saved.google.clientId; });
}

// The local page's forms, as a browser on this computer sends them.
const FORM = { "content-type": "application/x-www-form-urlencoded", origin: ORIGIN };
const signIn = (fields, headers = {}) => app.inject({ method: "POST", url: "/dev/signin", payload: new URLSearchParams(fields).toString(), headers: { ...FORM, ...headers } });
const cookieOf = (res) => { const c = res.cookies.find((k) => k.name === "ss_sid"); return c ? `ss_sid=${c.value}` : null; };
const userByEmail = (email) => one("SELECT * FROM users WHERE lower(email) = lower($1)", [email]);
const as = (cookie, url, more = {}) => app.inject({ url, ...more, headers: { cookie, origin: ORIGIN, ...more.headers } });
// Where a redirect to the local page goes, as a path to request next.
const pathOf = (location) => { const u = new URL(location, ORIGIN); return `${u.pathname}${u.search}`; };

test("without Google keys, on this computer the two buttons open the local sign-in, carrying the mode, the invitation and the way back", opts, async () => {
  await withoutGoogle(async () => {
    const protect = await app.inject({ url: "/auth/google?mode=gmail" });
    assert.equal(protect.statusCode, 302);
    assert.equal(protect.headers.location, "/dev/signin?mode=gmail");
    assert.ok(!protect.cookies.some((c) => c.name === "ss_oauth"), "no Google sign-in is started");
    const trusted = await app.inject({ url: "/auth/google?mode=basic&invite=tok-123&next=%2Fadmin%2F" });
    assert.equal(trusted.statusCode, 302);
    const to = new URL(trusted.headers.location, ORIGIN);
    assert.equal(to.pathname, "/dev/signin");
    assert.deepEqual(Object.fromEntries(to.searchParams), { mode: "basic", invite: "tok-123", next: "/admin/" });
    assert.equal(new URL((await app.inject({ url: "/auth/google" })).headers.location, ORIGIN).searchParams.get("mode"), "gmail", "the senior's mode by default");
    // What the welcome page asks before it enables the buttons and shows the local banner.
    const cfg = (await app.inject({ url: "/auth/config" })).json();
    assert.equal(cfg.googleConfigured, false);
    assert.equal(cfg.devSignin, true);
    // Anywhere else: Google sign-in is still "not configured" (503), and the welcome page keeps its banner.
    for (const extra of [{ headers: { "cf-connecting-ip": "203.0.113.9" } }, { headers: { "x-forwarded-for": "203.0.113.9" } }, { remoteAddress: "203.0.113.9" }, { headers: { host: "demo.example.test" } }]) {
      const res = await app.inject({ url: "/auth/google?mode=gmail", ...extra });
      assert.equal(res.statusCode, 503, JSON.stringify(extra));
      assert.deepEqual(res.json(), { error: "Google sign-in is not configured yet (see docs/GOOGLE_SETUP.md)." });
      assert.equal((await app.inject({ url: "/auth/config", ...extra })).json().devSignin, false, JSON.stringify(extra));
    }
  });
});

test("without Google keys, the local page lists everyone already here (senior or trusted person, admin, local) and signs in as one of them with one tap", opts, async (t) => {
  withoutGoogleFor(t);
  const linda = await makeUser({ email: "linda-list@example.test", name: "Linda", gmail: true });
  const thomas = await makeUser({ email: "thomas-list@example.test", name: "Thomas" });
  await makeUser({ email: "admin@example.test", name: "Ada" });
  await signIn({ email: "local-list@example.test", name: "Lou", role: "trusted" });
  const page = await app.inject({ url: "/dev/signin?mode=basic&next=%2Fadmin%2F" });
  assert.equal(page.statusCode, 200);
  assert.match(page.headers["content-type"], /text\/html/);
  assert.match(page.body, /<title>Local sign-in · Prudence<\/title>/);
  assert.match(page.body, /only on this computer, and never in production/);
  assert.ok(page.body.includes("docs/GOOGLE_SETUP.md"), "points to the real Google sign-in");
  assert.ok(!/<script/i.test(page.body), "no script");
  // The app's referrer policy (src/server.js): under no-referrer a browser would post these forms with Origin: null, which the Origin check refuses.
  assert.equal(page.headers["referrer-policy"], "same-origin", "the page's forms carry the real Origin");
  const row = (email) => page.body.split("<li>").find((li) => li.includes(email)) ?? "";
  assert.match(row("linda-list@example.test"), />Linda<\/button> <span class="small">linda-list@example\.test · senior<\/span>/);
  assert.ok(row("linda-list@example.test").includes(`name="user_id" value="${linda.id}"`), "each row signs in as its person");
  assert.match(row("thomas-list@example.test"), /thomas-list@example\.test · trusted person</);
  assert.match(row("admin@example.test"), /admin@example\.test · trusted person · admin</);
  assert.match(row("local-list@example.test"), /local-list@example\.test · trusted person · local</);
  assert.ok(row("thomas-list@example.test").includes('name="mode" value="basic"') && row("thomas-list@example.test").includes('name="next" value="/admin/"'), "each form carries the mode and the way back");
  assert.match(page.body, /value="trusted" checked/, "the trusted person's button preselects that role");

  const asLinda = await signIn({ user_id: linda.id });
  assert.equal(asLinda.statusCode, 302);
  assert.equal(asLinda.headers.location, "/#/today", "a senior lands on Today");
  assert.equal((await as(cookieOf(asLinda), "/api/status")).json().user.id, linda.id);
  assert.equal((await one("SELECT status FROM google_tokens WHERE user_id = $1", [linda.id])).status, "ok", "a Google senior keeps her Gmail as it was");
  const asThomas = await signIn({ mode: "gmail", user_id: thomas.id });
  assert.equal(asThomas.headers.location, "/#/guardian", "a trusted person lands on their page");
  assert.equal((await as(cookieOf(asThomas), "/api/status")).json().user.id, thomas.id);

  for (const id of ["00000000-0000-4000-8000-000000000000", "not-an-id"]) {
    const gone = await signIn({ user_id: id });
    assert.equal(gone.statusCode, 404, id);
    assert.match(gone.body, /not in the database any more/);
    assert.equal(gone.headers["referrer-policy"], "same-origin", "the page shown again can still post");
    assert.equal(cookieOf(gone), null, "no session");
  }
});

test("a new person is created from an email, a name, a language and a role, past the welcome steps unless they are asked for", opts, async () => {
  const senior = await signIn({ mode: "gmail", email: "  Rose.Local@Example.TEST ", name: "", locale: "fr-FR", role: "senior" });
  assert.equal(senior.statusCode, 302);
  assert.equal(senior.headers.location, "/#/today");
  const rose = await userByEmail("rose.local@example.test");
  assert.equal(rose.email, "rose.local@example.test", "trimmed and lowercased");
  assert.equal(rose.google_sub, "local:rose.local@example.test");
  assert.equal(rose.name, "Rose.local", "the part before @ when no name is given");
  assert.equal(rose.locale, "fr-FR");
  assert.deepEqual([rose.onboarded, rose.act_mode, Boolean(rose.move_consent_at)], [true, "move", true], "ready, like a seeded test person");

  const welcome = await signIn({ email: "welcome-local@example.test", name: "Wendy", role: "senior", welcome: "1" });
  assert.equal(welcome.headers.location, "/#/today");
  const wendy = await userByEmail("welcome-local@example.test");
  assert.deepEqual([wendy.name, wendy.locale, wendy.onboarded, wendy.act_mode, wendy.move_consent_at], ["Wendy", "en-US", false, "label", null], "the welcome steps come first");
  assert.ok(await one("SELECT 1 FROM gmail_state WHERE user_id = $1", [wendy.id]));
  assert.equal((await as(cookieOf(welcome), "/api/status")).json().user.onboarded, false);

  const trusted = await signIn({ mode: "basic", email: "trusted-local@example.test", role: "trusted" });
  assert.equal(trusted.headers.location, "/#/guardian");
  const tess = await userByEmail("trusted-local@example.test");
  assert.equal(await one("SELECT 1 FROM gmail_state WHERE user_id = $1", [tess.id]), null, "a trusted person has no mailbox entry");
  assert.equal((await as(cookieOf(trusted), "/api/status")).json().gmail, null, "so the app shows them the trusted person's page");
  // No role sent: the mode decides, as on the buttons.
  await signIn({ mode: "basic", email: "mode-basic@example.test" });
  assert.equal(await one("SELECT 1 FROM gmail_state s JOIN users u ON u.id = s.user_id WHERE u.email = 'mode-basic@example.test'"), null);

  for (const email of ["", "no-at-sign", "two@@example.test", "a b@example.test", `${"x".repeat(190)}@example.test`]) {
    const bad = await signIn({ email, role: "senior" });
    assert.equal(bad.statusCode, 400, JSON.stringify(email));
    assert.match(bad.body, /Type an email address/);
    assert.equal(cookieOf(bad), null);
  }
  assert.equal(await one("SELECT 1 FROM users WHERE email LIKE '%no-at-sign%' OR email LIKE 'two@@%'"), null, "nobody is created from a bad address");
});

test("the same email twice is the same person, whoever signed them in first", opts, async () => {
  const first = await signIn({ email: "twice@example.test", name: "Tim", role: "senior" });
  const second = await signIn({ email: " TWICE@example.test ", name: "Someone else", role: "trusted", welcome: "1" });
  assert.equal((await one("SELECT count(*)::int AS n FROM users WHERE lower(email) = 'twice@example.test'")).n, 1);
  const a = (await as(cookieOf(first), "/api/status")).json();
  const b = (await as(cookieOf(second), "/api/status")).json();
  assert.equal(a.user.id, b.user.id);
  assert.deepEqual([b.user.name, b.user.onboarded, Boolean(b.gmail)], ["Tim", true, true], "the person is signed in as they are, unchanged");
  // Without Google keys, someone who came through Google is found by their email too, not doubled.
  const google = await makeUser({ email: "google-person@example.test", name: "Gail", gmail: true });
  const res = await withoutGoogle(() => signIn({ email: "Google-Person@example.test", role: "trusted" }));
  assert.equal((await as(cookieOf(res), "/api/status")).json().user.id, google.id);
  assert.equal((await one("SELECT count(*)::int AS n FROM users WHERE lower(email) = 'google-person@example.test'")).n, 1);
});

test("a local sign-in is the same session as Google's: Today, Check, People, Learn, Settings, the audit list and Delete my account work", opts, async () => {
  const res = await signIn({ email: "same-session@example.test", name: "Sam", role: "senior" });
  const cookie = cookieOf(res);
  const sid = res.cookies.find((c) => c.name === "ss_sid");
  assert.ok(sid.httpOnly && sid.path === "/", "the session cookie of a Google sign-in");
  const user = await userByEmail("same-session@example.test");
  const status = (await as(cookie, "/api/status")).json();
  assert.equal(status.signedIn, true);
  assert.equal(status.user.email, "same-session@example.test");
  assert.equal((await as(cookie, "/api/guardians")).statusCode, 200, "People");
  const check = await as(cookie, "/api/check/text", { method: "POST", payload: { body: "Your parcel is on hold, pay the $1.99 fee: https://parcel-fee.example.test/pay", channel: "sms" } });
  assert.equal(check.statusCode, 200, "Check something else");
  assert.ok(check.json().verdict.verdict);
  assert.equal((await as(cookie, "/api/learn/progress")).statusCode, 200, "Learn");
  assert.equal((await as(cookie, "/api/context")).statusCode, 200, "Settings");
  assert.equal((await as(cookie, "/api/checks")).json().checks.length, 1, "the history");
  const gone = await as(cookie, "/api/account", { method: "DELETE" });
  assert.deepEqual(gone.json(), { deleted: true });
  assert.equal(await one("SELECT 1 FROM users WHERE id = $1", [user.id]), null, "Delete my account deletes the local person");
});

test("signed in locally with an address listed in ADMIN_EMAILS, /admin/ opens, and its Sign in first page comes back to it", opts, async () => {
  await withoutGoogle(async () => {
    const door = await app.inject({ url: "/admin/" });
    assert.equal(door.statusCode, 403);
    assert.ok(door.body.includes('href="/auth/google?mode=basic&amp;next=%2Fadmin%2F"'), "the sign-in link carries the way back");
    const start = await app.inject({ url: "/auth/google?mode=basic&next=%2Fadmin%2F" });
    const page = await app.inject({ url: pathOf(start.headers.location) });
    assert.ok(page.body.includes('name="next" value="/admin/"'));
    const res = await signIn({ mode: "basic", next: "/admin/", email: "Admin@Example.test", role: "trusted" });
    assert.equal(res.statusCode, 302);
    assert.equal(res.headers.location, "/admin/");
    const cookie = cookieOf(res);
    const shell = await as(cookie, "/admin/");
    assert.equal(shell.statusCode, 200);
    assert.match(shell.body, /<!doctype html>/i);
    assert.equal((await as(cookie, "/api/admin/users")).statusCode, 200);
    assert.equal((await as(cookie, "/api/status")).json().user.isAdmin, true);
    await as(cookie, "/auth/logout", { method: "POST", payload: {} });
    assert.equal((await as(cookie, "/api/status")).json().signedIn, false, "signing out ends it");
  });
  // With Google keys the link is Google's own, which ignores next.
  assert.ok((await app.inject({ url: "/admin/" })).body.includes('href="/auth/google?mode=basic"'));
});

test("next brings the local sign-in back to a page of this site, never to another site", opts, async () => {
  const cases = [["/admin/", "/admin/"], ["/#/settings", "/#/settings"], ["//evil.example.test", "/#/guardian"], ["https://evil.example.test/", "/#/guardian"],
    ["/\\evil.example.test", "/#/guardian"], ["/\t/evil.example.test", "/#/guardian"], ["/a//b", "/#/guardian"], ["javascript:alert(1)", "/#/guardian"], ["admin/", "/#/guardian"]];
  for (const [next, to] of cases) {
    const res = await signIn({ mode: "basic", email: "next-local@example.test", role: "trusted", next });
    assert.equal(res.statusCode, 302);
    assert.equal(res.headers.location, to, `next=${JSON.stringify(next)}`);
  }
});

test("a local senior has a mailbox entry but no Gmail access: Today reads up to date with nothing to reconnect, and the background jobs never read their mail", opts, async () => {
  const res = await signIn({ email: "today-local@example.test", name: "Tina", role: "senior" });
  const cookie = cookieOf(res);
  const tina = await userByEmail("today-local@example.test");
  assert.equal(await one("SELECT 1 FROM google_tokens WHERE user_id = $1", [tina.id]), null, "never a Google token");
  const mailbox = await one("SELECT * FROM gmail_state WHERE user_id = $1", [tina.id]);
  assert.deepEqual([mailbox.email, mailbox.sync_status, mailbox.backfill_done, Boolean(mailbox.last_sync_at)], ["today-local@example.test", "ok", true, true]);
  // What Today asks for: the fresh inbox (200, never 409), the moved ones, the sync line.
  for (const url of ["/api/inbox?box=inbox&fresh=1", "/api/inbox?box=inbox", "/api/inbox?box=scam"]) {
    const inbox = await as(cookie, url);
    assert.equal(inbox.statusCode, 200, url);
    assert.deepEqual(inbox.json().messages, [], url);
  }
  const { gmail } = (await as(cookie, "/api/status")).json();
  assert.deepEqual({ connected: gmail.connected, needsReconnect: gmail.needsReconnect, syncStatus: gmail.syncStatus, ready: gmail.ready },
    { connected: false, needsReconnect: false, syncStatus: "ok", ready: true }, "Up to date, no Reconnect Gmail banner");
  // A token Google refused still asks to reconnect: the screens rely on that 409.
  const refused = await makeUser({ email: "refused-local@example.test", gmail: true });
  await pool.query("UPDATE google_tokens SET status = 'reauth_needed' WHERE user_id = $1", [refused.id]);
  const reconnect = await as(await sessionFor(refused), "/api/inbox?box=inbox&fresh=1");
  assert.equal(reconnect.statusCode, 409);
  assert.equal(reconnect.json().error, "reconnect");

  // The poll picks only mailboxes with a Google token; the push renewal too.
  assert.ok(!(await usersToSync()).some((u) => u.id === tina.id), "not a mailbox to sync");
  const synced = [];
  await pollAll({ sync: async (id) => { synced.push(id); } });
  assert.ok(!synced.includes(tina.id), "the poll never syncs the local senior");
  // Every other mailbox has a fresh watch, so only a wrong pick of the local senior would try one.
  await pool.query("UPDATE gmail_state SET watch_expiration = now() + interval '7 days' WHERE user_id <> $1", [tina.id]);
  const pubsub = { topic: config.google.pubsubTopic, subscription: config.google.pubsubSubscription };
  Object.assign(config.google, { pubsubTopic: "projects/test/topics/gmail", pubsubSubscription: "projects/test/subscriptions/gmail" });
  try {
    assert.equal(await renewWatches(), 0);
  } finally {
    Object.assign(config.google, { pubsubTopic: pubsub.topic, pubsubSubscription: pubsub.subscription });
  }
  assert.ok(!jobStatus.errors.some((line) => line.includes(tina.id)), "no watch is attempted for the local senior");
  assert.equal((await one("SELECT sync_status FROM gmail_state WHERE user_id = $1", [tina.id])).sync_status, "ok", "still up to date");
});

test("a Gmail push event goes only to a mailbox with a live Google token: never to a local senior, who never shadows a real person with the same address", opts, async () => {
  await signIn({ email: "push-local@example.test", name: "Pia", role: "senior" });
  const local = await userByEmail("push-local@example.test");
  assert.equal((await one("SELECT backfill_done FROM gmail_state WHERE user_id = $1", [local.id])).backfill_done, true, "her mailbox reads synced");
  assert.equal(await mailboxForPush("push-local@example.test"), null, "a push for her address syncs no one");
  // Later the real person with that address signs in with Google: once their first sync is done, the push is theirs.
  const real = await makeUser({ email: "push-local@example.test", name: "Pia", gmail: true });
  assert.equal(await mailboxForPush("push-local@example.test"), null, "not before their first sync");
  await pool.query("UPDATE gmail_state SET backfill_done = true WHERE user_id = $1", [real.id]);
  assert.equal(await mailboxForPush("Push-Local@Example.test"), real.id, "the local senior who came first does not shadow them");
  await pool.query("UPDATE google_tokens SET status = 'reauth_needed' WHERE user_id = $1", [real.id]);
  assert.equal(await mailboxForPush("push-local@example.test"), null, "nor a mailbox whose token Google refused");
});

test("an invitation followed on this computer is accepted by the local sign-in, like after Google", opts, async () => {
  const senior = await makeUser({ email: "inviter-local@example.test", name: "Linda" });
  const { inviteUrl } = await inviteGuardian({ senior, name: "Theo", email: "theo-invited@example.test", relation: "grandson" });
  const token = inviteUrl.split("/invite/")[1];
  const link = (await app.inject({ url: `/invite/${token}` })).body.match(/href="(\/auth\/google\?[^"]+)"/)[1].replaceAll("&amp;", "&");
  await withoutGoogle(async () => {
    const start = await app.inject({ url: link });
    assert.equal(start.statusCode, 302);
    const to = new URL(start.headers.location, ORIGIN);
    assert.equal(to.pathname, "/dev/signin");
    assert.equal(to.searchParams.get("invite"), token);
    const page = await app.inject({ url: pathOf(start.headers.location) });
    assert.match(page.body, /You followed an invitation/);
    assert.ok(page.body.includes(`name="invite" value="${token}"`), "the forms carry it");
    const res = await signIn({ ...Object.fromEntries(to.searchParams), email: "theo-invited@example.test", role: "trusted" });
    assert.equal(res.headers.location, "/#/guardian?accepted=1");
    const theo = await userByEmail("theo-invited@example.test");
    const g = await one("SELECT * FROM guardianships WHERE senior_id = $1", [senior.id]);
    assert.deepEqual([g.status, g.guardian_id], ["active", theo.id]);
    assert.equal((await as(cookieOf(res), "/api/status")).json().isGuardian, true);
    // The same link again is used up; inviting yourself is refused: the Google callback's answers.
    assert.equal((await signIn({ mode: "basic", invite: token, user_id: theo.id })).headers.location, "/?invite=expired");
    const own = (await inviteGuardian({ senior, name: "Me", email: senior.email })).inviteUrl.split("/invite/")[1];
    assert.equal((await signIn({ mode: "basic", invite: own, user_id: senior.id })).headers.location, `/?invite=${encodeURIComponent("You cannot be your own trusted person.")}`);
  });
});

test("the local sign-in is not found in production, through a tunnel or a proxy, or from another machine", opts, async () => {
  const get = (extra = {}) => app.inject({ url: "/dev/signin", ...extra });
  const post = (extra = {}) => app.inject({ method: "POST", url: "/dev/signin", payload: "email=door-local%40example.test&role=senior", ...extra, headers: { ...FORM, ...extra.headers } });
  assert.equal((await get()).statusCode, 200, "this computer");
  assert.equal((await get({ remoteAddress: "::1" })).statusCode, 200, "IPv6 loopback too");
  const refused = [
    ...["cf-connecting-ip", "x-forwarded-for", "x-real-ip"].map((h) => ({ headers: { [h]: "203.0.113.9" } })),
    { headers: { forwarded: "for=203.0.113.9" } },
    // A proxy that keeps the client's address to itself still names the public host, the scheme or itself.
    { headers: { "x-forwarded-host": "demo.example.test" } }, { headers: { "x-forwarded-proto": "https" } }, { headers: { via: "1.1 caddy" } },
    { headers: { host: "demo.example.test" } },
    { remoteAddress: "203.0.113.9" },
  ];
  for (const extra of refused) {
    assert.equal((await get(extra)).statusCode, 404, `GET ${JSON.stringify(extra)}`);
    const res = await post(extra);
    assert.equal(res.statusCode, 404, `POST ${JSON.stringify(extra)}`);
    assert.equal(cookieOf(res), null);
  }
  config.production = true;
  try {
    assert.equal((await get()).statusCode, 404, "never in production");
    assert.equal((await post()).statusCode, 404);
    await withoutGoogle(async () => {
      assert.equal((await app.inject({ url: "/auth/google?mode=gmail" })).statusCode, 503, "the buttons say not configured");
      assert.equal((await app.inject({ url: "/auth/config" })).json().devSignin, false);
    });
  } finally {
    config.production = saved.production;
  }
  assert.equal(await userByEmail("door-local@example.test"), null, "no refused request created anyone");
});

test("a sign-in posted from another site, or from a page that hides its origin (Origin: null), is refused: no login CSRF", opts, async () => {
  await signIn({ email: "csrf-local@example.test", role: "senior" });
  const person = await userByEmail("csrf-local@example.test");
  for (const origin of ["https://evil.example.test", "null"]) {
    for (const fields of [{ user_id: person.id }, { email: "csrf-new@example.test", role: "senior" }]) {
      const res = await signIn(fields, { origin });
      assert.equal(res.statusCode, 403, `${origin} ${JSON.stringify(fields)}`);
      assert.match(res.json().error, /^Requests must come from /);
      assert.equal(cookieOf(res), null, "no session");
    }
  }
  assert.equal(await userByEmail("csrf-new@example.test"), null, "nobody is created");
  assert.equal((await one("SELECT count(*)::int AS n FROM audit_log WHERE user_id = $1 AND event = 'signed_in_locally'", [person.id])).n, 1, "only the real sign-in is recorded");
});

test("each local sign-in appears in the person's audit list as signed in locally", opts, async () => {
  const first = await signIn({ email: "audit-local@example.test", role: "senior" });
  const user = await userByEmail("audit-local@example.test");
  await signIn({ user_id: user.id });
  const { events } = (await as(cookieOf(first), "/api/audit")).json();
  const local = events.filter((e) => e.event === "signed_in_locally");
  assert.equal(local.length, 2, "one per sign-in");
});

test("with Google keys set, the buttons go to Google as before and the local page still opens on this computer", opts, async () => {
  const res = await app.inject({ url: "/auth/google?mode=gmail&next=%2Fadmin%2F" });
  assert.equal(res.statusCode, 302);
  assert.match(res.headers.location, /^https:\/\/accounts\.google\.com\//);
  assert.ok(!res.headers.location.includes("admin"), "next is not Google's business");
  assert.equal((await app.inject({ url: "/auth/config" })).json().googleConfigured, true);
  assert.equal((await app.inject({ url: "/dev/signin" })).statusCode, 200);
  const local = await signIn({ email: "keys-local@example.test", role: "trusted" });
  assert.equal(local.headers.location, "/#/guardian");
});

test("with Google keys set, the local page lists only local test people and refuses anyone who signs in with Google, from the list or by address", opts, async () => {
  const gail = await makeUser({ email: "keys-google@example.test", name: "Gail", gmail: true });
  const created = await signIn({ email: "keys-tess@example.test", name: "Tess", role: "trusted" });
  assert.equal(created.statusCode, 302, "a new local test person is still created");
  const tess = await userByEmail("keys-tess@example.test");
  assert.equal(tess.google_sub, "local:keys-tess@example.test");

  const page = await app.inject({ url: "/dev/signin" });
  assert.equal(page.statusCode, 200);
  assert.match(page.body, /Google sign-in is on: this page lists only local test people, and everyone else signs in with Google\./);
  const rows = page.body.split("<li>").slice(1);
  assert.ok(rows.some((li) => li.includes(`value="${tess.id}"`)), "a local test person is listed");
  assert.ok(rows.every((li) => / · local<\/span>/.test(li)), "and only local test people");
  assert.ok(!page.body.includes("keys-google@example.test") && !page.body.includes(gail.id), "someone who came through Google is not");

  for (const fields of [{ user_id: gail.id }, { email: " Keys-Google@example.test ", role: "senior" }]) {
    const res = await signIn(fields);
    assert.equal(res.statusCode, 403, JSON.stringify(fields));
    assert.match(res.body, /That person signs in with Google\. Pick a local test person, or create one with another address\./);
    assert.equal(cookieOf(res), null, "no session");
  }
  assert.equal((await one("SELECT count(*)::int AS n FROM users WHERE lower(email) = 'keys-google@example.test'")).n, 1, "no local double of her is created");
  assert.equal(await one("SELECT 1 FROM audit_log WHERE user_id = $1 AND event = 'signed_in_locally'", [gail.id]), null, "no sign-in is recorded");

  const again = await signIn({ user_id: tess.id });
  assert.equal(again.headers.location, "/#/guardian", "a local test person signs in from the list");
  assert.equal((await as(cookieOf(again), "/api/status")).json().user.id, tess.id);

  // Without the keys, the same page lists her and signs her in, as before.
  await withoutGoogle(async () => {
    const all = await app.inject({ url: "/dev/signin" });
    assert.ok(all.body.includes("keys-google@example.test") && !all.body.includes("everyone else signs in with Google"));
    assert.equal((await as(cookieOf(await signIn({ user_id: gail.id })), "/api/status")).json().user.id, gail.id);
  });
});

test("an address a Google person shares with a local test person signs in as the Google person without keys, and is refused with them", opts, async () => {
  // The local test person came first, before the keys were set; then the real person signed in with Google.
  await withoutGoogle(() => signIn({ email: "shared@example.test", name: "Sue (local)", role: "senior" }));
  const local = await userByEmail("shared@example.test");
  const real = await makeUser({ email: "shared@example.test", name: "Sue", gmail: true });
  const res = await withoutGoogle(() => signIn({ email: "Shared@Example.test", role: "senior" }));
  assert.equal((await as(cookieOf(res), "/api/status")).json().user.id, real.id, "the Google person, never their local double");
  const refused = await signIn({ email: "shared@example.test", role: "senior" });
  assert.equal(refused.statusCode, 403, "with the keys, the address belongs to someone who signs in with Google");
  assert.equal(cookieOf(refused), null);
  assert.equal((await signIn({ user_id: local.id })).statusCode, 302, "the local test person is still there, from the list");
});
