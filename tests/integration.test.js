// End-to-end against the test database: Gmail sync on a fake mailbox, and
// the HTTP API (guardian loop, phone, admin, account deletion) through
// Fastify's inject. Needs Postgres (scam_shield_test); skipped without it.

import { pool, resetDb, makeUser, sessionFor, dbAvailable } from "./helpers/db.js";
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { one, many } from "../src/db/pool.js";
import { buildApp } from "../src/server.js";
import { syncUser } from "../src/sync/worker.js";
import { putBack } from "../src/sync/actions.js";
import { acceptInvite } from "../src/guardians.js";
import { fakeGmail, gmailMessage } from "./helpers/fake-gmail.js";

const ORIGIN = "http://localhost:3999";
const PASS = "spf=pass dkim=pass dmarc=pass";
const hasDb = await dbAvailable();
const opts = { skip: hasDb ? false : "Postgres test database not available" };
let app;

before(async () => {
  if (!hasDb) return;
  await resetDb();
  app = await buildApp({ logger: false });
});
after(async () => { await app?.close(); await pool.end(); });

const scamUsps = (id) => gmailMessage({ id, from: '"USPS" <alerts@usps-delivery.test>', subject: "Your package is on hold",
  text: "USPS: your package is on hold. Pay the $1.99 redelivery fee today: https://usps-delivery.test/pay", auth: "spf=fail dkim=none dmarc=fail" });

test("Gmail sync: learns the context, moves the scam, leaves real mail alone, never trashes", opts, async () => {
  const user = await makeUser({ email: "linda@example.test", gmail: true });
  const gmail = fakeGmail({ email: "linda@example.test", messages: [
    gmailMessage({ id: "amz", from: '"Amazon.com" <shipment-tracking@amazon.com>', subject: "Your Amazon.com order has shipped",
      text: "Your slippers are on the way. Tracking TBA123456789012. https://www.amazon.com/track", auth: PASS }),
    gmailMessage({ id: "chase", from: '"Chase" <statements@chase.com>', subject: "Your statement is ready", text: "Your October statement is ready.", auth: PASS }),
    scamUsps("usps1"),
    gmailMessage({ id: "s1", from: "linda@example.test", to: '"Thomas" <thomas@example.test>', subject: "Sunday", text: "See you Sunday", labels: ["SENT"] }),
    gmailMessage({ id: "s2", from: "linda@example.test", to: '"Thomas" <thomas@example.test>', subject: "Photos", text: "Here are the photos", labels: ["SENT"] }),
  ] });

  await syncUser(user.id, { client: gmail });

  const state = await one("SELECT * FROM gmail_state WHERE user_id = $1", [user.id]);
  assert.equal(state.sync_status, "ok", state.sync_error);
  assert.equal(state.backfill_done, true);
  assert.ok(state.label_scam && state.label_careful);

  const ctx = (await one("SELECT data FROM contexts WHERE user_id = $1", [user.id])).data;
  assert.deepEqual(ctx.orders.map((o) => o.carrier), ["Amazon Logistics"]);
  assert.ok(ctx.trustedContacts.some((c) => c.email === "thomas@example.test"));
  assert.ok(!ctx.knownSenders.some((s) => s.email.includes("usps-delivery")));

  const checks = await many("SELECT gmail_message_id, verdict_value, action, verdict FROM checks WHERE user_id = $1 ORDER BY gmail_message_id", [user.id]);
  assert.deepEqual(checks.map((c) => [c.gmail_message_id, c.verdict_value, c.action]),
    [["amz", "safe", "none"], ["chase", "safe", "none"], ["usps1", "scam", "moved"]]);
  assert.ok(!JSON.stringify(checks).includes("redelivery fee today"), "mail bodies are never stored");
  assert.deepEqual(gmail.modifications, [{ id: "usps1", add: [state.label_scam], remove: ["INBOX"] }]);

  // New mail arrives: the incremental sync checks only that message.
  gmail.deliver(scamUsps("usps2"));
  await syncUser(user.id, { client: gmail });
  assert.equal((await one("SELECT action FROM checks WHERE user_id = $1 AND gmail_message_id = 'usps2'", [user.id])).action, "moved");
  assert.equal(gmail.modifications.length, 2);

  // "Put it back" restores the inbox and remembers the sender.
  const check = await one("SELECT * FROM checks WHERE user_id = $1 AND gmail_message_id = 'usps2'", [user.id]);
  await putBack({ client: gmail, userId: user.id, check, labels: { scam: state.label_scam, careful: state.label_careful },
    message: { from: "alerts@usps-delivery.test", fromName: "USPS" } });
  assert.ok(gmail.store.get("usps2").labelIds.includes("INBOX"));
  assert.ok(!gmail.store.get("usps2").labelIds.includes(state.label_scam));
  assert.equal((await one("SELECT user_feedback FROM checks WHERE id = $1", [check.id])).user_feedback, "not_scam");
  const events = (await many("SELECT event FROM audit_log WHERE user_id = $1", [user.id])).map((e) => e.event);
  assert.ok(events.includes("moved_out_of_inbox") && events.includes("put_back"));
  assert.ok(gmail.modifications.every((m) => ![...m.add, ...m.remove].some((l) => ["TRASH", "SPAM"].includes(l))));
});

test("HTTP: sign-in required, Origin enforced, pasted text checked without storing it", opts, async () => {
  assert.equal((await app.inject({ url: "/api/inbox" })).statusCode, 401);
  const user = await makeUser({ email: "francoise@example.test", name: "Françoise", locale: "fr-FR" });
  const cookie = await sessionFor(user);
  const payload = { channel: "sms", from: "+33 7 55 01 99", body: "Chronopost : votre colis est en attente. Payez 1,99 € ici : https://chronopost-suivi.test/payer" };
  assert.equal((await app.inject({ method: "POST", url: "/api/check/text", headers: { cookie }, payload })).statusCode, 403, "no Origin header");
  const res = await app.inject({ method: "POST", url: "/api/check/text", headers: { cookie, origin: ORIGIN }, payload });
  assert.equal(res.statusCode, 200);
  const out = res.json();
  assert.equal(out.verdict.verdict, "scam");
  assert.equal(out.verdict.language, "fr");
  const row = await one("SELECT * FROM checks WHERE id = $1", [out.checkId]);
  assert.equal(row.channel, "pasted");
  assert.ok(!JSON.stringify(row).includes("votre colis est en attente"));
  const status = (await app.inject({ url: "/api/status", headers: { cookie } })).json();
  assert.equal(status.user.name, "Françoise");
});

test("HTTP: guardian invitation, one-tap answer (GET never answers, single use), answer reaches the senior", opts, async () => {
  const senior = await makeUser({ email: "linda2@example.test", name: "Linda" });
  const seniorCookie = await sessionFor(senior);
  const h = { cookie: seniorCookie, origin: ORIGIN };
  const inv = await app.inject({ method: "POST", url: "/api/guardians", headers: h, payload: { name: "Thomas", email: "thomas2@example.test", relation: "grandson" } });
  assert.equal(inv.statusCode, 200);
  const inviteMail = await one("SELECT * FROM outbox WHERE to_email = 'thomas2@example.test' ORDER BY created_at DESC LIMIT 1");
  const inviteToken = inviteMail.text_body.match(/\/invite\/([\w-]+)/)[1];
  assert.match((await app.inject({ url: `/invite/${inviteToken}` })).body, /Sign in with Google to accept/);

  const guardian = await makeUser({ email: "thomas2@example.test", name: "Thomas" });
  assert.equal((await acceptInvite({ token: inviteToken, user: guardian })).status, "active");
  assert.match((await app.inject({ url: `/invite/${inviteToken}` })).body, /expired or was already used/);

  const message = { channel: "sms", from: "+1 555-0199", body: "USPS: your package is on hold, pay $1.99 now https://usps-redeliver.test/pay" };
  const checked = (await app.inject({ method: "POST", url: "/api/check/text", headers: h, payload: message })).json();
  const ask = await app.inject({ method: "POST", url: "/api/ask", headers: h, payload: { checkId: checked.checkId, message: checked.message, includeText: false } });
  assert.deepEqual(ask.json(), { sentTo: ["Thomas"] });
  const alertMail = await one("SELECT * FROM outbox WHERE to_email = 'thomas2@example.test' AND subject LIKE '%scam%'");
  assert.ok(!alertMail.text_body.includes("pay $1.99 now"), "message text not shared unless the senior ticks the box");
  const answerToken = alertMail.text_body.match(/\/answer\/([\w-]+)/)[1];

  const preview = await app.inject({ url: `/answer/${answerToken}?a=scam` });
  assert.match(preview.body, /It&#39;s a scam|It's a scam/);
  assert.equal((await one("SELECT answer FROM alerts WHERE check_id = $1", [checked.checkId])).answer, null, "opening the link must not answer");

  const post = (answer) => app.inject({ method: "POST", url: `/answer/${answerToken}`, headers: { origin: ORIGIN, "content-type": "application/x-www-form-urlencoded" }, payload: `answer=${answer}` });
  assert.match((await post("scam")).body, /Thank you/);
  assert.match((await post("real")).body, /already used/);
  assert.equal((await one("SELECT answer FROM alerts WHERE check_id = $1", [checked.checkId])).answer, "scam");

  const answers = (await app.inject({ url: "/api/answers", headers: { cookie: seniorCookie } })).json().answers;
  assert.deepEqual(answers.map((a) => [a.guardian_name, a.answer]), [["Thomas", "scam"]]);
  const dash = (await app.inject({ url: "/api/guardian/alerts", headers: { cookie: await sessionFor(guardian) } })).json();
  assert.equal(dash.alerts.length, 1);
  assert.equal(dash.protecting[0].name, "Linda");
});

test("HTTP: phone pairing, SMS check, ask, answers, revoked token", opts, async () => {
  const senior = await makeUser({ email: "linda3@example.test" });
  const h = { cookie: await sessionFor(senior), origin: ORIGIN };
  const { code } = (await app.inject({ method: "POST", url: "/api/devices/pair-code", headers: h, payload: { serverUrl: "http://10.0.2.2:3000" } })).json();
  assert.match(code, /^[A-Z2-9]{8}$/);
  const paired = await app.inject({ method: "POST", url: "/api/devices/pair", payload: { code, name: "Pixel" } });
  assert.equal(paired.statusCode, 200);
  const { token } = paired.json();
  assert.equal((await app.inject({ method: "POST", url: "/api/devices/pair", payload: { code, name: "again" } })).statusCode, 400, "codes are single use");

  const bearer = { authorization: `Bearer ${token}` };
  const check = await app.inject({ method: "POST", url: "/api/devices/check", headers: bearer, payload: { from: "5551234", body: "USPS: package on hold, pay $1.99 https://usps-redeliver.test", receivedAt: new Date().toISOString() } });
  assert.equal(check.statusCode, 200);
  assert.equal(check.json().verdict.verdict, "scam");
  assert.deepEqual(check.json().guardians, []);
  assert.deepEqual((await app.inject({ url: "/api/devices/answers", headers: bearer })).json(), { answers: [] });

  const device = await one("SELECT id FROM devices WHERE user_id = $1 AND token_hash IS NOT NULL", [senior.id]);
  await app.inject({ method: "DELETE", url: `/api/devices/${device.id}`, headers: h });
  assert.equal((await app.inject({ url: "/api/devices/answers", headers: bearer })).statusCode, 401);
});

test("HTTP: scam-report review is admin-only; approving makes a card active", opts, async () => {
  const someone = await makeUser({ email: "someone@example.test" });
  assert.equal((await app.inject({ url: "/api/admin/cards", headers: { cookie: await sessionFor(someone) } })).statusCode, 403);
  const admin = await makeUser({ email: "admin@example.test" });
  const h = { cookie: await sessionFor(admin), origin: ORIGIN };
  const { cards } = (await app.inject({ url: "/api/admin/cards", headers: h })).json();
  const candidate = cards.find((c) => c.status === "candidate");
  assert.ok(candidate);
  const res = await app.inject({ method: "POST", url: `/api/admin/cards/${candidate.id}/approve`, headers: h, payload: {} });
  assert.equal(res.statusCode, 200);
  assert.equal((await one("SELECT status FROM pattern_cards WHERE id = $1", [candidate.id])).status, "active");
  const bad = { ...candidate.card, impersonated_brands: ["Amazon"], red_flag_domains: ["amazon.com"] };
  const other = cards.find((c) => c.id !== candidate.id);
  await pool.query("UPDATE pattern_cards SET status = 'candidate' WHERE id = $1", [other.id]);
  assert.equal((await app.inject({ method: "POST", url: `/api/admin/cards/${other.id}/approve`, headers: h, payload: { card: bad } })).statusCode, 400,
    "a card flagging a brand's real address is refused");
});

test("HTTP: deleting the account erases every row", opts, async () => {
  const user = await makeUser({ email: "leaving@example.test" });
  const h = { cookie: await sessionFor(user), origin: ORIGIN };
  await app.inject({ method: "POST", url: "/api/check/text", headers: h, payload: { body: "Hello, lunch Thursday?" } });
  assert.equal((await app.inject({ method: "DELETE", url: "/api/account", headers: h })).json().deleted, true);
  for (const table of ["users", "checks", "sessions"]) {
    const col = table === "users" ? "id" : "user_id";
    assert.equal((await one(`SELECT count(*)::int AS n FROM ${table} WHERE ${col} = $1`, [user.id])).n, 0, table);
  }
  assert.equal((await app.inject({ url: "/api/checks", headers: h })).statusCode, 401);
});

test("HTTP: an uploaded .eml is checked and not stored", opts, async () => {
  const user = await makeUser({ email: "eml-upload@example.test", locale: "fr-FR" });
  const eml = ["Authentication-Results: mx.google.com; dkim=pass header.i=@aol.com; spf=pass smtp.mailfrom=x@aol.com; dmarc=pass header.from=aol.com",
    "From: Societe GeneraIe <x@aol.com>", "Subject: Alerte de securite - Transaction suspecte", "Date: Fri, 13 Feb 2026 04:54:00 +0000",
    "MIME-Version: 1.0", "Content-Type: text/html; charset=UTF-8", "",
    '<p>Operation inhabituelle de 700 EUR. Signalez-la immediatement :</p><a href="https://3.massemiaks.test/">Acceder au service antifraude</a>', ""].join("\r\n");
  const form = new FormData();
  form.append("email", new Blob([eml], { type: "message/rfc822" }), "alerte.eml");
  const req = new Request("http://x/", { method: "POST", body: form });
  const res = await app.inject({ method: "POST", url: "/api/check/eml", payload: Buffer.from(await req.arrayBuffer()),
    headers: { cookie: await sessionFor(user), origin: ORIGIN, "content-type": req.headers.get("content-type") } });
  assert.equal(res.statusCode, 200, res.body);
  assert.equal(res.json().verdict.verdict, "scam");
  assert.ok(res.json().verdict.reasons.some((r) => /lettres qui se ressemblent/.test(r.text)), "explains the look-alike name");
  const row = await one("SELECT * FROM checks WHERE id = $1", [res.json().checkId]);
  assert.equal(row.channel, "email_file");
  assert.ok(!JSON.stringify(row).includes("Operation inhabituelle"));
});
