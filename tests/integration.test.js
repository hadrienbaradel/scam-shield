// End-to-end against the test database: Gmail sync on a fake mailbox, and
// the HTTP API (guardian loop, phone, admin, account deletion) through
// Fastify's inject. Needs Postgres (scam_shield_test); skipped without it.

import { pool, resetDb, makeUser, sessionFor, dbAvailable } from "./helpers/db.js";
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { one, many } from "../src/db/pool.js";
import { buildApp } from "../src/server.js";
import { syncUser } from "../src/sync/worker.js";
import { putBack, fileAsScam, undoThrow, undoKeep } from "../src/sync/actions.js";
import { seenBeforeFor } from "../src/sync/checker.js";
import { acceptInvite } from "../src/guardians.js";
import { fakeGmail, gmailMessage } from "./helpers/fake-gmail.js";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

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
  assert.equal(ctx.coverage.emailsRead, 3, "the context says how many emails it was drawn from");
  // Earlier messages from the same organisation, dated and split by verdict; never the message itself.
  assert.deepEqual(await seenBeforeFor(user.id, "orders@sub.amazon.com"), { organisation: "amazon.com", messages: 1, judged_safe: 1, first_seen: new Date().toISOString().slice(0, 10) });
  assert.equal((await seenBeforeFor(user.id, "orders@amazon.com", "amz")).messages, 0, "the message being checked is not its own history");
  assert.equal((await seenBeforeFor(user.id, "x@amazon.com.evil.test")).messages, 0, "a lookalike is another organisation");

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

  // "Keep it" then "Undo": back in the Scam folder with its label, the answer withdrawn, the sender forgotten.
  const known = async () => (await one("SELECT data FROM contexts WHERE user_id = $1", [user.id])).data.knownSenders.map((s) => s.email);
  assert.ok((await known()).includes("alerts@usps-delivery.test"));
  await undoKeep({ client: gmail, userId: user.id, check: { ...check, user_feedback: "not_scam" }, labels: { scam: state.label_scam, careful: state.label_careful } });
  assert.ok(!gmail.store.get("usps2").labelIds.includes("INBOX"), "it had been moved: it goes back to the Scam folder");
  assert.ok(gmail.store.get("usps2").labelIds.includes(state.label_scam));
  assert.deepEqual(await one("SELECT restored_at, user_feedback FROM checks WHERE id = $1", [check.id]), { restored_at: null, user_feedback: null });
  assert.ok(!(await known()).includes("alerts@usps-delivery.test"), "the sender this keep taught is forgotten");
  await putBack({ client: gmail, userId: user.id, check, labels: { scam: state.label_scam, careful: state.label_careful },
    message: { from: "alerts@usps-delivery.test", fromName: "USPS" } });

  // "Throw it away" then "Undo": back in the inbox with its Scam label, and the sender is not learned as safe.
  const labels = { scam: state.label_scam, careful: state.label_careful };
  await fileAsScam({ client: gmail, userId: user.id, check, labels });
  assert.ok(!gmail.store.get("usps2").labelIds.includes("INBOX"));
  await undoThrow({ client: gmail, userId: user.id, check: { ...check, verdict_value: "scam" }, labels });
  assert.ok(gmail.store.get("usps2").labelIds.includes("INBOX"));
  assert.ok(gmail.store.get("usps2").labelIds.includes(state.label_scam), "the Scam label stays on");
  const undone = await one("SELECT action, user_feedback FROM checks WHERE id = $1", [check.id]);
  assert.deepEqual(undone, { action: "labeled", user_feedback: null });
  assert.ok(gmail.modifications.every((m) => ![...m.add, ...m.remove].some((l) => ["TRASH", "SPAM"].includes(l))));
});

// A multipart upload with one file, as the browser sends it.
function oneFile(field, filename, type, content) {
  const boundary = `----scamshield${Date.now()}`;
  const payload = Buffer.concat([
    Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="${field}"; filename="${filename}"\r\nContent-Type: ${type}\r\n\r\n`),
    content, Buffer.from(`\r\n--${boundary}--\r\n`)]);
  return { payload, headers: { "content-type": `multipart/form-data; boundary=${boundary}` } };
}

test("HTTP: a voice message is transcribed by Muse Voice Transcribe, judged, and neither audio nor words are kept", opts, async () => {
  const user = await makeUser({ email: "linda.voice@example.test", name: "Linda", locale: "en-US" });
  const h = { cookie: await sessionFor(user), origin: ORIGIN };
  const wav = Buffer.concat([Buffer.from("RIFF\x24\x7d\x00\x00WAVEfmt \x10\x00\x00\x00\x01\x00\x01\x00\x80\x3e\x00\x00\x00\x7d\x00\x00\x02\x00\x10\x00data\x00\x7d\x00\x00", "latin1"), Buffer.alloc(32000)]); // 1 s of 16 kHz mono 16-bit silence, as the page makes
  const upload = oneFile("audio", "voice.wav", "audio/wav", wav);
  const noKey = await app.inject({ method: "POST", url: "/api/check/voice", headers: { ...h, ...upload.headers }, payload: upload.payload });
  assert.equal(noKey.statusCode, 503);
  assert.equal(noKey.json().error, "voice_needs_muse");

  process.env.META_MODEL_API_KEY = "test-key";
  const realFetch = globalThis.fetch;
  const heard = "Grandma it's me, I had an accident and I'm in jail. Please buy $2,000 in gift cards today and don't tell mom.";
  globalThis.fetch = async (url, init) => {
    if (String(url).includes("/asr/transcribe")) return new Response(`${heard}\n`, { status: 200 });
    if (String(url).includes("/chat/completions")) return new Response("{}", { status: 500 });
    return realFetch(url, init);
  };
  try {
    const notAudio = oneFile("audio", "note.txt", "text/plain", Buffer.from("hello"));
    assert.equal((await app.inject({ method: "POST", url: "/api/check/voice", headers: { ...h, ...notAudio.headers }, payload: notAudio.payload })).statusCode, 400);
    const res = await app.inject({ method: "POST", url: "/api/check/voice", headers: { ...h, ...upload.headers }, payload: upload.payload });
    assert.equal(res.statusCode, 200);
    const out = res.json();
    assert.equal(out.transcript, heard);
    assert.equal(out.verdict.verdict, "scam", "gift cards and secrecy: the detector's verdict stands when the AI check fails");
    const row = await one("SELECT * FROM checks WHERE id = $1", [out.checkId]);
    assert.equal(row.channel, "voice");
    assert.ok(!JSON.stringify(row).includes("in jail"), "the words are not stored");
  } finally {
    globalThis.fetch = realFetch;
    delete process.env.META_MODEL_API_KEY;
  }
});

test("HTTP: the demo voicemail is heard by Muse Voice Transcribe and judged; without a file there is none", opts, async () => {
  const dir = await mkdtemp(join(tmpdir(), "demo-voice-"));
  process.env.DEMO_VOICEMAIL_DIR = dir;
  assert.equal((await app.inject({ url: "/api/demo/today?lang=en" })).json().voicemail, false, "no recording, no voicemail box");
  const wav = Buffer.concat([Buffer.from("RIFF\x24\x7d\x00\x00WAVEfmt \x10\x00\x00\x00\x01\x00\x01\x00\x80\x3e\x00\x00\x00\x7d\x00\x00\x02\x00\x10\x00data\x00\x7d\x00\x00", "latin1"), Buffer.alloc(32000)]);
  await writeFile(join(dir, "voicemail-en.wav"), wav);
  process.env.DEMO_VOICEMAIL_DIR = dir;
  process.env.META_MODEL_API_KEY = "test-key";
  const realFetch = globalThis.fetch;
  const heard = "Grandma, it's me. I had an accident and I'm at the police station. Please buy two thousand dollars in gift cards today and don't tell Mom.";
  let heardCalls = 0;
  globalThis.fetch = async (url, init) => {
    if (String(url).includes("/asr/transcribe")) { heardCalls++; return new Response(`${heard}\n`, { status: 200 }); }
    if (String(url).includes("/chat/completions")) return new Response("{}", { status: 500 });
    return realFetch(url, init);
  };
  try {
    assert.equal((await app.inject({ url: "/api/demo/today?lang=en" })).json().voicemail, true);
    const audio = await app.inject({ url: "/api/demo/voicemail?lang=en" });
    assert.equal(audio.statusCode, 200);
    assert.match(audio.headers["content-type"], /audio\/wav/);
    assert.equal((await app.inject({ url: "/api/demo/voicemail?lang=fr" })).statusCode, 404, "no French recording, no French voicemail");
    const res = await app.inject({ method: "POST", url: "/api/demo/voicemail", headers: { origin: ORIGIN }, payload: { lang: "en" } });
    assert.equal(res.statusCode, 200, res.body);
    const out = res.json();
    assert.equal(out.transcript, heard);
    assert.equal(out.message.channel, "voice_transcript");
    assert.equal(out.verdict.verdict, "scam", "gift cards, bail, secrecy: a scam even when the AI check fails");
    assert.equal(heardCalls, 1);
  } finally {
    globalThis.fetch = realFetch;
    delete process.env.META_MODEL_API_KEY;
    delete process.env.DEMO_VOICEMAIL_DIR;
    await rm(dir, { recursive: true, force: true });
  }
});

test("HTTP: the breach lookup runs only on the senior's tap, lists what it found, waits a minute between taps, and an unticked breach goes", opts, async () => {
  const user = await makeUser({ email: "lookup@example.test", name: "Linda", gmail: true });
  const h = { cookie: await sessionFor(user), origin: ORIGIN };
  const fresh = (await app.inject({ url: "/api/context", headers: h })).json();
  assert.equal(fresh.context.breachLookup, undefined, "nothing looked up before the tap");
  assert.equal((await app.inject({ url: "/api/status", headers: h })).json().breachLookup, null, "the status says so too (the protection score reads it)");
  const realFetch = globalThis.fetch;
  let listCalls = 0;
  let listDown = false;
  globalThis.fetch = async (url, init) => {
    const u = String(url);
    if (u.startsWith("https://api.xposedornot.com/v1/breach-analytics")) {
      listCalls++;
      if (listDown) return new Response("", { status: 503 });
      assert.ok(u.endsWith("?email=lookup%40example.test"), u);
      return new Response(JSON.stringify({ ExposedBreaches: { breaches_details: [{ breach: "BouyguesTelecom", domain: "bouyguestelecom.fr", xposed_date: "2025", xposed_data: "Email addresses;Names;Physical addresses" }, { breach: "LeakyShop", domain: "leakyshop.example", xposed_date: "2023", xposed_data: "Email addresses;Names" }] } }), { status: 200 });
    }
    if (u === "https://haveibeenpwned.com/api/v3/breaches") return new Response(JSON.stringify([{ Name: "BouyguesTelecom", Title: "Bouygues Telecom", Domain: "bouyguestelecom.fr", BreachDate: "2025-07-23", DataClasses: ["Bank account numbers", "Email addresses", "Names", "Physical addresses"] }, { Name: "LeakyShop", Title: "Leaky Shop", Domain: "leakyshop.example", BreachDate: "2023-03-01", DataClasses: ["Bank account numbers", "Email addresses", "Names"] }]), { status: 200 });
    return realFetch(url, init);
  };
  try {
    const tap = await app.inject({ method: "POST", url: "/api/context/lookup-breaches", headers: h });
    assert.equal(tap.statusCode, 200, tap.body);
    const { breaches, lookup } = tap.json();
    assert.equal(lookup.found, 2);
    assert.equal(lookup.source, "xposedornot");
    assert.deepEqual(breaches.map((b) => [b.id, b.source, b.date]), [["bouygues-2025", "Bouygues Telecom", "2025"], ["xon-LeakyShop", "Leaky Shop", "2023"]],
      "a found breach that is one of the well-known ones is that one, once; the other keeps its looked-up id");
    assert.ok(breaches[1].leaked.includes("IBAN"), "what leaked comes from the catalogue");
    assert.ok(breaches[0].leaked.includes("BIC") && breaches[0].leaked.includes("email"), "the folded one keeps the list's kinds and adds the lookup's");
    const after = (await app.inject({ url: "/api/context", headers: h })).json();
    assert.equal(after.context.breachLookup.found, 2);
    assert.deepEqual((await app.inject({ url: "/api/status", headers: h })).json().breachLookup, { at: lookup.at, found: 2 }, "the status carries when and how many, for the protection score");
    assert.deepEqual(after.context.breaches.map((b) => b.id), ["bouygues-2025", "xon-LeakyShop"]);
    const events = (await app.inject({ url: "/api/audit", headers: h })).json().events;
    assert.ok(events.some((e) => e.event === "breach_lookup"), "the lookup is in What Prudence did");
    assert.ok(!JSON.stringify(events).includes("example.test"), "the audit holds no address");

    const again = await app.inject({ method: "POST", url: "/api/context/lookup-breaches", headers: h });
    assert.equal(again.statusCode, 429);
    assert.equal(again.json().error, "lookup_wait");
    assert.equal(listCalls, 1, "a second tap within a minute asks nothing");

    // Ticking the well-known Bouygues keeps the looked-up shop; unticking the looked-up one removes it.
    const both = await app.inject({ method: "PUT", url: "/api/context/breaches", headers: h, payload: { ids: ["xon-LeakyShop", "bouygues-2025"] } });
    assert.deepEqual(both.json().breaches.map((b) => b.id), ["xon-LeakyShop", "bouygues-2025"]);
    const gone = await app.inject({ method: "PUT", url: "/api/context/breaches", headers: h, payload: { ids: ["bouygues-2025"] } });
    assert.deepEqual(gone.json().breaches.map((b) => b.id), ["bouygues-2025"], "an unticked looked-up breach goes");

    // A mailbox rescan refreshes the lookup only because the senior asked once.
    const gmail = fakeGmail({ email: "lookup@example.test", messages: [] });
    await syncUser(user.id, { client: gmail });
    const rescanned = (await one("SELECT data FROM contexts WHERE user_id = $1", [user.id])).data;
    assert.equal(listCalls, 2, "the rescan asked the list again");
    assert.deepEqual(rescanned.breaches.map((b) => b.id), ["bouygues-2025", "xon-LeakyShop"], "fresh lookup first: the well-known twin once, the looked-up shop back");
    assert.ok(rescanned.breachLookup.at > lookup.at);

    // The trusted person sees nothing of it (specs/breach-exposure.md, line 9).
    const inv = await app.inject({ method: "POST", url: "/api/guardians", headers: h, payload: { name: "Thomas", email: "thomas.lookup@example.test", relation: "grandson" } });
    assert.equal(inv.statusCode, 200);
    const inviteToken = (await one("SELECT text_body FROM outbox WHERE to_email = 'thomas.lookup@example.test' ORDER BY created_at DESC LIMIT 1")).text_body.match(/\/invite\/([\w-]+)/)[1];
    const guardian = await makeUser({ email: "thomas.lookup@example.test", name: "Thomas" });
    assert.equal((await acceptInvite({ token: inviteToken, user: guardian })).status, "active");
    const dash = await app.inject({ url: "/api/guardian/alerts", headers: { cookie: await sessionFor(guardian) } });
    assert.equal(dash.statusCode, 200);
    assert.equal(dash.json().protecting[0].name, "Linda");
    assert.ok(!/breach|Bouygues|Leaky|xon-|IBAN/i.test(dash.body), "the guardian's view carries none of the senior's breaches");

    // A senior who never tapped is never looked up, even on a rescan.
    const quiet = await makeUser({ email: "quiet@example.test", gmail: true });
    await syncUser(quiet.id, { client: fakeGmail({ email: "quiet@example.test", messages: [] }) });
    assert.equal(listCalls, 2, "no tap, no lookup");

    // A list that does not answer is a plain error, and what was found before stays.
    listDown = true;
    const down = await app.inject({ method: "POST", url: "/api/context/lookup-breaches", headers: { cookie: await sessionFor(quiet), origin: ORIGIN } });
    assert.equal(down.statusCode, 502);
    assert.equal(down.json().error, "lookup_failed");
    assert.equal((await one("SELECT data FROM contexts WHERE user_id = $1", [quiet.id])).data.breachLookup, undefined, "a failed lookup is not a lookup");
  } finally {
    globalThis.fetch = realFetch;
  }
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

test("HTTP: asking by text message returns a ready-to-send text from the senior's phone, and its link answers", opts, async () => {
  const senior = await makeUser({ email: "linda.text@example.test", name: "Linda", locale: "en-US" });
  const h = { cookie: await sessionFor(senior), origin: ORIGIN };
  assert.equal((await app.inject({ method: "POST", url: "/api/guardians", headers: h, payload: { name: "Thomas", email: "thomas.text@example.test", phone: "call me" } })).statusCode, 400);
  const inv = await app.inject({ method: "POST", url: "/api/guardians", headers: h, payload: { name: "Thomas", email: "thomas.text@example.test", relation: "grandson", phone: "+1 (555) 013-0000" } });
  assert.equal(inv.statusCode, 200);
  const inviteToken = (await one("SELECT text_body FROM outbox WHERE to_email = 'thomas.text@example.test' ORDER BY created_at DESC LIMIT 1")).text_body.match(/\/invite\/([\w-]+)/)[1];
  await acceptInvite({ token: inviteToken, user: await makeUser({ email: "thomas.text@example.test", name: "Thomas" }) });
  const listed = (await app.inject({ url: "/api/guardians", headers: h })).json().guardians;
  assert.equal(listed[0].phone, "+1 (555) 013-0000");
  assert.equal((await app.inject({ method: "PATCH", url: `/api/guardians/${listed[0].id}`, headers: h, payload: { phone: "12" } })).statusCode, 400);

  const message = { channel: "sms", from: "+1 555-0199", body: "USPS: your package is on hold, pay $1.99 now https://usps-redeliver.test/pay" };
  const checked = (await app.inject({ method: "POST", url: "/api/check/text", headers: h, payload: message })).json();
  const mailsBefore = Number((await one("SELECT count(*) AS n FROM outbox WHERE to_email = 'thomas.text@example.test'")).n);
  const ask = (await app.inject({ method: "POST", url: "/api/ask", headers: h, payload: { checkId: checked.checkId, message: checked.message, via: "text" } })).json();
  assert.deepEqual(ask.sentTo, ["Thomas"]);
  assert.equal(ask.texts.length, 1);
  assert.equal(ask.texts[0].phone, "+1 (555) 013-0000");
  assert.match(ask.texts[0].body, /^Hi Thomas, can you check this for me\? .* Tap to answer: http:\/\/localhost:3999\/answer\/[\w-]+$/);
  assert.ok(ask.texts[0].body.length <= 320, `short enough for a text: ${ask.texts[0].body.length}`);
  assert.ok(!ask.texts[0].body.includes("pay $1.99 now") || false, "the message text itself is not copied unless shared");
  assert.equal(Number((await one("SELECT count(*) AS n FROM outbox WHERE to_email = 'thomas.text@example.test'")).n), mailsBefore, "no email is sent for a text ask");

  const token = ask.texts[0].body.match(/\/answer\/([\w-]+)/)[1];
  const answered = await app.inject({ method: "POST", url: `/answer/${token}`, headers: { origin: ORIGIN, "content-type": "application/x-www-form-urlencoded" }, payload: "answer=scam" });
  assert.match(answered.body, /Thank you/);
  assert.equal((await one("SELECT answer FROM alerts WHERE check_id = $1", [checked.checkId])).answer, "scam");
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
  assert.deepEqual(ask.json(), { sentTo: ["Thomas"], alreadyAsked: false, texts: [] });
  const again = await app.inject({ method: "POST", url: "/api/ask", headers: h, payload: { checkId: checked.checkId, message: checked.message } });
  assert.deepEqual(again.json(), { sentTo: [], alreadyAsked: true, texts: [] }, "the same guardian is never asked twice about one message");
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

  // Removing the guardian kills their pending links at once.
  const second = (await app.inject({ method: "POST", url: "/api/check/text", headers: h, payload: { ...message, body: `${message.body} again` } })).json();
  await app.inject({ method: "POST", url: "/api/ask", headers: h, payload: { checkId: second.checkId, message: second.message } });
  const mail2 = await one("SELECT text_body FROM outbox WHERE to_email = 'thomas2@example.test' AND subject LIKE '%scam%' ORDER BY created_at DESC LIMIT 1");
  const token2 = mail2.text_body.match(/\/answer\/([\w-]+)/)[1];
  const g = await one("SELECT id FROM guardianships WHERE senior_id = $1", [senior.id]);
  await app.inject({ method: "DELETE", url: `/api/guardians/${g.id}`, headers: h });
  assert.match((await app.inject({ url: `/answer/${token2}` })).body, /already used or has expired/);
});

test("HTTP: sign-in can only be completed by the browser that started it (login CSRF)", opts, async () => {
  const start = await app.inject({ url: "/auth/google?mode=gmail" });
  assert.equal(start.statusCode, 302);
  const state = new URL(start.headers.location).searchParams.get("state");
  const cookie = start.cookies.find((c) => c.name === "ss_oauth");
  assert.ok(cookie?.httpOnly && state);
  // Another browser (no cookie, or someone else's cookie) cannot use this state.
  for (const headers of [{}, { cookie: "ss_oauth=someone-else" }]) {
    const res = await app.inject({ url: `/auth/google/callback?code=attacker-code&state=${state}`, headers });
    assert.equal(res.headers.location, "/?signin=expired");
  }
  assert.ok(await one("SELECT 1 FROM oauth_states WHERE browser_hash IS NOT NULL"), "the real browser can still finish");
});

test("HTTP: re-reading the mailbox is limited to once per 10 minutes", opts, async () => {
  const user = await makeUser({ email: "rebuild@example.test" });
  const h = { cookie: await sessionFor(user), origin: ORIGIN };
  assert.equal((await app.inject({ method: "POST", url: "/api/context/rebuild", headers: h, payload: {} })).statusCode, 200);
  assert.equal((await app.inject({ method: "POST", url: "/api/context/rebuild", headers: h, payload: {} })).statusCode, 429);
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

test("mail safety: without recorded consent a scam is labeled, never moved; a crash mid-action is finished next sync", opts, async () => {
  const fresh = await one(`INSERT INTO users (google_sub, email, name) VALUES ('sub-fresh-${Date.now()}', 'fresh@example.test', 'Fresh') RETURNING *`);
  assert.equal(fresh.act_mode, "label", "new accounts start label-only");
  await pool.query("INSERT INTO gmail_state (user_id, email) VALUES ($1, $2)", [fresh.id, fresh.email]);
  await pool.query("INSERT INTO google_tokens (user_id, scopes, status) VALUES ($1, 'https://www.googleapis.com/auth/gmail.modify', 'ok')", [fresh.id]);
  const gmail = fakeGmail({ email: fresh.email, messages: [scamUsps("u-fresh")] });
  await syncUser(fresh.id, { client: gmail });
  const state = await one("SELECT * FROM gmail_state WHERE user_id = $1", [fresh.id]);
  assert.deepEqual(gmail.modifications, [{ id: "u-fresh", add: [state.label_scam], remove: [] }], "labeled only");

  // Consent to move via the settings API.
  const h = { cookie: await sessionFor(fresh), origin: ORIGIN };
  await app.inject({ method: "PATCH", url: "/api/me", headers: h, payload: { actMode: "move" } });
  assert.ok((await one("SELECT move_consent_at FROM users WHERE id = $1", [fresh.id])).move_consent_at);

  // Gmail fails right after the check is recorded: the intent stays pending...
  const failing = { ...gmail, modifyLabels: async () => { throw Object.assign(new Error("Gmail 503"), { status: 503 }); } };
  gmail.deliver(scamUsps("u-crash"));
  await syncUser(fresh.id, { client: failing });
  const pending = await one("SELECT action, planned FROM checks WHERE user_id = $1 AND gmail_message_id = 'u-crash'", [fresh.id]);
  assert.equal(pending.action, "pending");
  assert.equal(pending.planned.removeInbox, true);
  // ...and the next sync finishes it, even though the message's history entry is gone.
  await syncUser(fresh.id, { client: gmail });
  assert.equal((await one("SELECT action FROM checks WHERE user_id = $1 AND gmail_message_id = 'u-crash'", [fresh.id])).action, "moved");
  assert.ok(!gmail.store.get("u-crash").labelIds.includes("INBOX"));
});

test("sync: expired history rescans since the last sync, mail returning to the inbox is checked, one sync per user across processes", opts, async () => {
  const user = await makeUser({ email: "robust@example.test", gmail: true });
  const gmail = fakeGmail({ email: "robust@example.test", messages: [scamUsps("r1")] });
  await syncUser(user.id, { client: gmail });
  assert.equal((await many("SELECT 1 FROM checks WHERE user_id = $1", [user.id])).length, 1);

  // Gmail has forgotten our position: the rescan still finds new mail.
  gmail.store.set("r2", scamUsps("r2"));
  gmail.forgetHistory();
  await syncUser(user.id, { client: gmail });
  assert.ok(await one("SELECT 1 FROM checks WHERE user_id = $1 AND gmail_message_id = 'r2'", [user.id]), "found by the rescan");

  // A message moved back from Spam into the inbox gets a check.
  gmail.returnToInbox(scamUsps("r3"));
  await syncUser(user.id, { client: gmail });
  assert.ok(await one("SELECT 1 FROM checks WHERE user_id = $1 AND gmail_message_id = 'r3'", [user.id]), "checked when it came back");

  // Another server process holds this user's sync lock: this one skips.
  const other = await pool.connect();
  await other.query("SELECT pg_advisory_lock(hashtext($1))", [`sync:${user.id}`]);
  gmail.deliver(scamUsps("r4"));
  await syncUser(user.id, { client: gmail });
  assert.equal(await one("SELECT 1 FROM checks WHERE user_id = $1 AND gmail_message_id = 'r4'", [user.id]), null);
  await other.query("SELECT pg_advisory_unlock(hashtext($1))", [`sync:${user.id}`]);
  other.release();
  await syncUser(user.id, { client: gmail });
  assert.ok(await one("SELECT 1 FROM checks WHERE user_id = $1 AND gmail_message_id = 'r4'", [user.id]));
});
