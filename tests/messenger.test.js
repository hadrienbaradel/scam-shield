// Facebook and Messenger channel ("send it to Prudence"): the webhook
// handshake and signature, then the behavior lines of
// _product/specs/messenger-channel.md that the channel owns, against a fake
// Graph API and Meta CDN (injected fetch), a fake grouping timer and the
// mock LLM. No network, no Postgres; ffmpeg only in one test that skips
// itself without it (the transcoder and the video reader are injected).
import "./helpers/env.js";
import { test, afterEach, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHmac } from "node:crypto";
import { createServer } from "node:http";
import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import Fastify from "fastify";
import { getProvider } from "../lib/llm/index.js";
import { breaker, buildUserPrompt, extractFromImage } from "../lib/muse.js";
import {
  attachmentUrl, createMessengerChannel, DEFAULT_GRAPH_VERSION, messengerConfig, messengerConfigured, messengerLink, parseWebhook, webhookActive,
} from "../src/channels/messenger.js";
import { createLimiter, ffmpegToWav, ffmpegVideo, ffprobeBeside, frameTimes, VIDEO_FORMATS, WORDS } from "../src/channels/whatsapp.js";
import messengerRoutes from "../src/routes/messenger.js";
import { whatsappLink } from "../src/routes/account.js";
import { buildApp } from "../src/server.js";

const clearKeys = () => { for (const k of Object.keys(process.env)) if (k.startsWith("MESSENGER_") || k.startsWith("WHATSAPP_")) delete process.env[k]; };
clearKeys();
const ENV = { MESSENGER_PAGE_ACCESS_TOKEN: "page-tok-123", MESSENGER_PAGE_ID: "PAGE1", MESSENGER_VERIFY_TOKEN: "verify-me", MESSENGER_APP_SECRET: "s3cret", MESSENGER_PAGE_LINK: "https://m.me/PrudencePage" };
const PSID = "7012345678901234";
const mock = getProvider("mock");

beforeEach(() => { process.env.LLM_PROVIDER = "mock"; mock.reset(); breaker.failures = 0; breaker.openUntil = 0; });
afterEach(() => { delete process.env.LLM_PROVIDER; delete process.env.META_MODEL_API_KEY; mock.reset(); clearKeys(); });

// Meta as the channel sees it: the Send API on the Page, and the CDN that
// serves attachments. Every call is recorded, with whether it had headers.
const IMG = "https://scontent.xx.fbcdn.net/v/t1.15752-9/465_n.jpg?_nc_cat=1&oh=abc&oe=6730";
const IMG2 = "https://scontent.xx.fbcdn.net/v/t1.15752-9/466_n.png?_nc_cat=1&oh=abd&oe=6730";
const VOICE = "https://cdn.fbsbx.com/v/t59.3654-21/audioclip-1761750000.mp4?_nc_cat=1&oe=6730";
const VIDEO = "https://video.xx.fbcdn.net/v/t42.3356-2/clip-1761750000.mp4?_nc_cat=1&oe=6730";
const SEND = /^https:\/\/graph\.facebook\.com\/v[\d.]+\/PAGE1\/messages$/;
function fakeMeta({ media = {}, sendStatus = 200, typingStatus = 200 } = {}) {
  const calls = [];
  const fetchImpl = async (url, init = {}) => {
    const u = String(url);
    calls.push({ url: u, method: init.method || "GET", headers: init.headers, hasHeaders: "headers" in init, body: init.body, redirect: init.redirect });
    if (SEND.test(u)) {
      const body = JSON.parse(init.body);
      if (body.sender_action) return typingStatus === 200 ? Response.json({ recipient_id: body.recipient.id }) : Response.json({ error: { message: "typing refused" } }, { status: typingStatus });
      if (sendStatus !== 200) return Response.json({ error: { message: "(#551) This person isn't available right now." } }, { status: sendStatus });
      return Response.json({ recipient_id: body.recipient.id, message_id: `m_reply_${calls.length}` });
    }
    const m = media[u];
    if (m) return new Response(m.bytes ?? Buffer.from("bytes"), { status: m.status || 200, headers: m.headers || { "content-type": m.type || "image/jpeg" } });
    throw new Error(`unexpected fetch ${u}`);
  };
  fetchImpl.calls = calls;
  const sends = () => calls.filter((c) => SEND.test(c.url)).map((c) => ({ ...JSON.parse(c.body), authorization: c.headers.authorization, url: c.url }));
  fetchImpl.sends = sends;
  fetchImpl.replies = () => sends().filter((s) => !s.sender_action).map((s) => s.message.text);
  return fetchImpl;
}

// The grouping window as a timer the test fires by hand.
function fakeTimer() {
  const pending = new Set();
  const setTimer = (fn, ms) => { const t = { fn, ms }; pending.add(t); return () => pending.delete(t); };
  setTimer.fire = () => { for (const t of [...pending]) { pending.delete(t); t.fn(); } };
  setTimer.pending = () => [...pending].map((t) => t.ms);
  return setTimer;
}

const logs = [];
const collect = { info: (o, m) => logs.push([m, o]), warn: (o, m) => logs.push([m, o]), error: (o, m) => logs.push([m, o]) };
const channelWith = (meta, extra = {}) => createMessengerChannel({
  env: ENV, fetchImpl: meta, patternCards: async () => [], inspectLinks: async () => ({}), log: collect, groupMs: 0, ...extra,
});

let n = 0;
// One messaging event; delivery() wraps events the way Meta posts them.
const event = (message, { from = PSID, mid = `m_${++n}`, timestamp = 1761750000000 + (++n) } = {}) => ({
  sender: { id: from }, recipient: { id: "PAGE1" }, timestamp, message: { mid, ...message },
});
const delivery = (...events) => ({ object: "page", entry: [{ id: "PAGE1", time: 1761750000000, messaging: events }] });
const text = (t, opts) => delivery(event({ text: t }, opts));
const attach = (type, payload, opts) => delivery(event({ attachments: [{ type, payload }] }, opts));
async function send(channel, ...bodies) {
  for (const b of bodies) await channel.handle(b);
  await channel.idle();
}

const USPS = "USPS: your package is on hold. Pay the $1.99 redelivery fee today: https://usps-delivery.test/pay";
const verdict = (v, lang = "en") => ({
  verdict: v, confidence: 0.9,
  headline: lang === "fr" ? "Arnaque : ne payez rien, Chronopost ne demande jamais de frais par SMS." : "Scam: USPS never asks for a fee by text.",
  reasons: [{ text: lang === "fr" ? "Le lien mène à chronopost-suivi.test, pas à chronopost.fr." : "The link goes to usps-delivery.test, not usps.com.", evidence: "link" }],
  action: "delete", action_text: lang === "fr" ? "Supprimez-le. Si vous attendez un colis, ouvrez vous-même l'application." : "Delete it. If you expect a package, open the USPS app yourself.",
  real_company_says: null, impersonated_brand: lang === "fr" ? "Chronopost" : "USPS", scam_type: "parcel", matched_pattern_ids: [],
  escalate_to_guardian: false, guardian_summary: null, language: lang,
});
const PIG = {
  ...verdict("scam"), headline: "Scam: this is the 'new friend, then investment' trick.",
  reasons: [{ text: "She wrote to you first and now shows you her profits.", evidence: "pattern" }],
  action: "ask_guardian", action_text: "Send nothing. Show this to someone you trust.", impersonated_brand: null, scam_type: "romance_investment",
};
// What Muse Spark answers when it reads a picture, by kind.
const read = (kind, extra = {}) => ({
  kind, channel: kind === "message" ? "sms" : "messenger", platform: kind === "message" ? null : "Facebook", sender_name: null, sender: null, subject: null,
  body: "", links: [], turns: [], profile_facts: [], ...extra,
});
const CHAT = read("conversation", { sender_name: "Anna", turns: [
  { who: "them", name: "Anna", text: "Hi handsome, I saw your profile. Is this Mark?" },
  { who: "you", name: null, text: "No, sorry, wrong person." },
  { who: "them", name: "Anna", text: "My mentor's platform made me $8,400 this month, start with $500." },
] });
const PROFILE = read("profile", { sender_name: "Anna Petrova", profile_facts: ["Anna Petrova", "Joined August 2026", "Based in Nigeria", "12 friends"] });

const sign = (raw, secret = ENV.MESSENGER_APP_SECRET) => `sha256=${createHmac("sha256", secret).update(raw).digest("hex")}`;
async function routeApp({ env = ENV, channel } = {}) {
  const app = Fastify({ logger: false });
  await app.register(messengerRoutes, { env, channel: channel || { handle: async () => [] } });
  return app;
}

test("Meta's verification handshake: the challenge comes back as plain text with the right verify token, 403 otherwise", async () => {
  const app = await routeApp();
  const ok = await app.inject({ url: "/api/messenger/webhook", query: { "hub.mode": "subscribe", "hub.verify_token": "verify-me", "hub.challenge": "1158201444" } });
  assert.equal(ok.statusCode, 200);
  assert.equal(ok.body, "1158201444");
  assert.match(ok.headers["content-type"], /^text\/plain/);
  assert.equal((await app.inject({ url: "/api/messenger/webhook", query: { "hub.mode": "subscribe", "hub.verify_token": "guess", "hub.challenge": "1" } })).statusCode, 403);
  assert.equal((await app.inject({ url: "/api/messenger/webhook" })).statusCode, 403);
  await app.close();
  const tokenOnly = await routeApp({ env: { MESSENGER_VERIFY_TOKEN: "verify-me" } });
  const early = await tokenOnly.inject({ url: "/api/messenger/webhook", query: { "hub.mode": "subscribe", "hub.verify_token": "verify-me", "hub.challenge": "42" } });
  assert.equal(early.body, "42", "the handshake works with the verify token alone, before the Page is wired");
  await tokenOnly.close();
});

test("a delivery is accepted only with Meta's signature, refused while the app secret is unset, and 200 comes back before the work", async () => {
  const got = [];
  let release;
  const slow = new Promise((r) => { release = r; });
  const channel = { handle: async (body) => { got.push(body); await slow; } };
  const app = await routeApp({ channel });
  const raw = JSON.stringify(text("hello"));
  const headers = { "content-type": "application/json" };
  const post = (payload, h) => app.inject({ method: "POST", url: "/api/messenger/webhook", payload, headers: { ...headers, ...h } });
  const signed = await post(raw, { "x-hub-signature-256": sign(raw) });
  assert.equal(signed.statusCode, 200, signed.body);
  assert.equal(signed.body, "EVENT_RECEIVED");
  assert.equal(got.length, 1, "the delivery reached the channel while it was still working");
  assert.equal(got[0].entry[0].messaging[0].message.text, "hello");
  release();
  assert.equal((await post(raw, { "x-hub-signature-256": sign(raw, "other") })).statusCode, 403, "wrong secret");
  assert.equal((await post(raw, { "x-hub-signature-256": sign(`${raw} `) })).statusCode, 403, "body changed");
  assert.equal((await post(raw, {})).statusCode, 403, "no header");
  assert.equal((await post("not json", { "x-hub-signature-256": sign("not json") })).statusCode, 400);
  assert.equal(got.length, 1);
  await app.close();

  const noSecret = await routeApp({ env: { ...ENV, MESSENGER_APP_SECRET: "" }, channel });
  const refused = await noSecret.inject({ method: "POST", url: "/api/messenger/webhook", payload: raw, headers: { ...headers, "x-hub-signature-256": sign(raw) } });
  assert.equal(refused.statusCode, 403, "no app secret: fail closed, whatever the header says");
  assert.match(refused.json().error, /MESSENGER_APP_SECRET/);
  assert.equal(got.length, 1, "nothing reached the channel");
  await noSecret.close();
});

test("without the Page token the webhook answers 501 and nothing is handled", async () => {
  const got = [];
  const app = await routeApp({ env: { MESSENGER_VERIFY_TOKEN: "verify-me", MESSENGER_APP_SECRET: "s3cret" }, channel: { handle: async (b) => got.push(b) } });
  const raw = JSON.stringify(text("hello"));
  const res = await app.inject({ method: "POST", url: "/api/messenger/webhook", payload: raw, headers: { "content-type": "application/json", "x-hub-signature-256": sign(raw) } });
  assert.equal(res.statusCode, 501);
  assert.match(res.json().error, /MESSENGER_PAGE_ACCESS_TOKEN/);
  assert.equal(got.length, 0);
  await app.close();
  assert.equal(messengerConfigured({ MESSENGER_PAGE_ACCESS_TOKEN: "t" }), false, "the Page id is needed too");
  assert.equal(webhookActive({ ...ENV, MESSENGER_APP_SECRET: "" }), false);
  assert.equal(webhookActive(ENV), true);
});

test("a text sent to Prudence gets the typing dots, then exactly one reply with the verdict words, sent with the Page token", async () => {
  const meta = fakeMeta();
  const channel = channelWith(meta);
  mock.script(verdict("scam"));
  await send(channel, text(USPS));
  const [typing, reply] = meta.sends();
  assert.deepEqual([typing.recipient, typing.sender_action], [{ id: PSID }, "typing_on"]);
  assert.equal(meta.sends().length, 2, "the dots, then one reply");
  assert.equal(reply.url, "https://graph.facebook.com/v26.0/PAGE1/messages");
  assert.equal(reply.authorization, "Bearer page-tok-123");
  assert.ok(meta.calls.every((c) => !c.url.includes("page-tok-123")), "the token never goes in a URL");
  assert.deepEqual(reply.recipient, { id: PSID });
  assert.equal(reply.messaging_type, "RESPONSE");
  const body = reply.message.text;
  assert.match(body, /^🔴 Scam\nUSPS never asks for a fee by text\./, body);
  assert.match(body, /Why:\n• The link goes to usps-delivery\.test, not usps\.com\./);
  assert.match(body, /What to do: Delete it\./);
  assert.match(body, /Checked with Mock LLM\.$/);
  const prompt = mock.calls[0].messages[0].content;
  assert.ok(prompt.includes("<locale>en-US</locale>") && prompt.includes('"channel":"messenger"') && prompt.includes("redelivery fee"), prompt);
  assert.ok(prompt.includes('"sender_is_known":false') && prompt.includes('"providers":[]'), "no personal context");
  assert.ok(!prompt.includes("<social_profile>"), "no profile, no profile block");
});

test("three messages sent within a few seconds get one reply, judged with the earlier ones as thread history", async () => {
  const meta = fakeMeta();
  const timer = fakeTimer();
  const channel = channelWith(meta, { groupMs: undefined, setTimer: timer });
  mock.script(PIG);
  await channel.handle(text("Hi handsome, I saw your profile"));
  assert.deepEqual(timer.pending(), [3000], "Prudence waits about three seconds");
  await channel.handle(text("We have talked for three weeks now, you are so kind"));
  await channel.handle(text("My mentor's platform made me $8,400 this month, start with $500 at https://gold-mentor.test/app"));
  assert.deepEqual(timer.pending(), [3000], "each message restarts the one window");
  assert.equal(meta.replies().length, 0, "nothing judged inside the window");
  assert.equal(meta.sends().length, 1, "only the typing dots so far");
  timer.fire();
  await channel.idle();
  assert.equal(meta.replies().length, 1, "one conversation, one reply");
  assert.match(meta.replies()[0], /^🔴 Scam\nThis is the 'new friend, then investment' trick\./);
  assert.equal(mock.calls.length, 1, "judged once");
  const prompt = mock.calls[0].messages[0].content;
  const history = JSON.parse(prompt.match(/<thread_history>(.*)<\/thread_history>/)[1]);
  assert.deepEqual(history, [
    { from: "The other person", date: null, body: "Hi handsome, I saw your profile" },
    { from: "The other person", date: null, body: "We have talked for three weeks now, you are so kind" },
  ]);
  const message = JSON.parse(prompt.match(/<message>(.*)<\/message>/)[1]);
  assert.match(message.body, /start with \$500/);
  assert.deepEqual(message.links.map((l) => l.goes_to), ["gold-mentor.test/app"]);
  // A message after the reply opens the next conversation.
  mock.script(verdict("scam"));
  await channel.handle(text(USPS));
  timer.fire();
  await channel.idle();
  assert.equal(meta.replies().length, 2);
  assert.equal(mock.calls[1].messages[0].content.match(/<thread_history>(.*)<\/thread_history>/)[1], "[]");
});

test("a waiting conversation is judged at once on shutdown, and a long burst is judged without waiting for the window", async () => {
  const meta = fakeMeta();
  const timer = fakeTimer();
  mock.respondWith(() => verdict("scam"));
  const channel = channelWith(meta, { setTimer: timer, maxGroupItems: 3 });
  await channel.handle(text(USPS));
  channel.flush();
  await channel.idle();
  assert.equal(meta.replies().length, 1, "flush() judged it without the timer");
  for (let i = 0; i < 3; i++) await channel.handle(text(`${USPS} (${i})`));
  await channel.idle();
  assert.equal(meta.replies().length, 2, "the third item fired the group");
  assert.equal(timer.pending().length, 0);
  // The route judges what is waiting when the server stops.
  const app = Fastify({ logger: false });
  const waiting = channelWith(fakeMeta(), { setTimer: fakeTimer() });
  await app.register(messengerRoutes, { env: ENV, channel: waiting });
  await waiting.handle(text(USPS));
  await app.close();
  assert.equal(mock.calls.length, 3, "closing the app answered the waiting message");
});

test("a message Meta delivers twice is answered once, and Prudence's own replies echoed back are ignored", async () => {
  const meta = fakeMeta();
  const channel = channelWith(meta);
  mock.respondWith(() => verdict("scam"));
  const again = text(USPS, { mid: "m_same" });
  const first = await channel.handle(again);
  const second = await channel.handle(structuredClone(again));
  await channel.idle();
  assert.deepEqual(first, [{ id: "m_same", type: "text", queued: true }]);
  assert.deepEqual(second, [{ id: "m_same", skipped: "duplicate" }]);
  assert.equal(meta.replies().length, 1);
  assert.equal(mock.calls.length, 1);
  const echo = delivery({ sender: { id: "PAGE1" }, recipient: { id: PSID }, timestamp: 1, message: { mid: "m_echo", is_echo: true, app_id: 1, text: "🔴 Scam" } });
  assert.deepEqual(await channel.handle(echo), [{ id: "m_echo", skipped: "echo" }]);
  // Receipts, reads, postbacks and reactions carry no message.
  const others = delivery(
    { sender: { id: PSID }, recipient: { id: "PAGE1" }, delivery: { mids: ["m_reply_1"], watermark: 1 } },
    { sender: { id: PSID }, recipient: { id: "PAGE1" }, read: { watermark: 1 } },
    { sender: { id: PSID }, recipient: { id: "PAGE1" }, postback: { payload: "GET_STARTED" } },
    { sender: { id: PSID }, recipient: { id: "PAGE1" }, reaction: { mid: "m_reply_1", action: "react", emoji: "👍" } },
  );
  assert.deepEqual(parseWebhook(others), { messages: [], ignored: 4 });
  assert.deepEqual(await channel.handle(others), []);
  assert.deepEqual(parseWebhook({ object: "instagram", entry: [{ messaging: [event({ text: "x" })] }] }), { messages: [], ignored: 0 });
  assert.deepEqual(await channel.handle(delivery(event({ text: "no sender" }, { from: "" }))), [{ id: `m_${n - 1}`, skipped: "malformed" }]);
  await channel.idle();
  assert.equal(meta.replies().length, 1, "nothing else was answered");
});

test("a picture is fetched only over https from Meta's CDN, with no token and no redirect followed; anywhere else is refused", async () => {
  assert.equal(attachmentUrl(IMG), IMG);
  assert.equal(attachmentUrl(VOICE), VOICE);
  assert.equal(attachmentUrl("https://lookaside.fbsbx.com/ig_messaging_cdn/?asset_id=1"), "https://lookaside.fbsbx.com/ig_messaging_cdn/?asset_id=1");
  assert.equal(attachmentUrl("https://video.xx.fbcdn.net/v/clip.mp4"), "https://video.xx.fbcdn.net/v/clip.mp4");
  assert.throws(() => attachmentUrl("http://scontent.xx.fbcdn.net/v/x.jpg"), /not https/);
  assert.throws(() => attachmentUrl("https://evil.example/x.jpg"), /host evil\.example is not Meta's CDN/);
  assert.throws(() => attachmentUrl("https://scontent.xx.fbcdn.net.evil.example/x.jpg"), /not Meta's CDN/);
  assert.throws(() => attachmentUrl("https://fbcdn.net/x.jpg"), /not Meta's CDN/);
  assert.throws(() => attachmentUrl("https://user:pw@scontent.xx.fbcdn.net/x.jpg"), /credentials/);
  assert.throws(() => attachmentUrl("https://scontent.xx.fbcdn.net:8443/x.jpg"), /port 8443/);
  assert.throws(() => attachmentUrl(""), /unreadable/);

  const meta = fakeMeta({ media: { [IMG]: { bytes: Buffer.from("jpeg-bytes"), type: "image/jpeg" } } });
  mock.script(read("message", { sender_name: "USPS", sender: "+1 555 0100", body: USPS, links: [{ text: "usps-delivery.test/pay", href: "usps-delivery.test/pay" }] }), verdict("scam"));
  await send(channelWith(meta), attach("image", { url: IMG }));
  const download = meta.calls.find((c) => c.url === IMG);
  assert.equal(download.hasHeaders, false, "no token, no header at all");
  assert.equal(download.redirect, "manual");
  assert.deepEqual(mock.calls[0].messages[0].content[1], { type: "image", mime: "image/jpeg", base64: Buffer.from("jpeg-bytes").toString("base64") });
  const prompt = mock.calls[1].messages[0].content;
  assert.ok(prompt.includes('"from_name":"USPS"') && prompt.includes("usps-delivery.test/pay"), "the picture's own links are inspected");
  assert.match(meta.replies()[0], /^🔴 Scam/);

  for (const [url, why] of [["https://evil.example/steal.jpg", /evil\.example/], ["http://scontent.xx.fbcdn.net/v/x.jpg", /not https/]]) {
    const elsewhere = fakeMeta();
    logs.length = 0;
    await send(channelWith(elsewhere), attach("image", { url }));
    assert.ok(elsewhere.calls.every((c) => SEND.test(c.url)), "nothing fetched from there");
    assert.deepEqual(elsewhere.replies(), [WORDS.en.failed]);
    assert.match(logs.find(([m]) => m === "messenger check failed")[1].err, why);
  }
  const redirected = fakeMeta({ media: { [IMG]: { status: 302, headers: { location: "https://evil.example/collect" } } } });
  await send(channelWith(redirected), attach("image", { url: IMG }));
  assert.deepEqual(redirected.replies(), [WORDS.en.failed], "a redirect is never followed");
  assert.ok(redirected.calls.every((c) => !c.url.includes("evil.example")));
});

test("a screenshot of a chat becomes the conversation's turns, and a screenshot of a profile reaches the model as its facts", async () => {
  const meta = fakeMeta({ media: { [IMG]: { type: "image/jpeg" }, [IMG2]: { headers: { "content-type": "application/octet-stream" } } } });
  mock.script(CHAT, PROFILE, PIG);
  const both = delivery(event({ attachments: [{ type: "image", payload: { url: IMG } }, { type: "image", payload: { url: IMG2 } }] }, { mid: "m_two" }));
  assert.deepEqual(parseWebhook(both).messages.map((m) => m.id), ["m_two", "m_two#2"], "two pictures in one message, two items");
  await send(channelWith(meta), both);
  assert.equal(mock.calls[1].messages[0].content[1].mime, "image/png", "the url's extension when the CDN does not say");
  const prompt = mock.calls[2].messages[0].content;
  const history = JSON.parse(prompt.match(/<thread_history>(.*)<\/thread_history>/)[1]);
  assert.deepEqual(history.map((h) => h.from), ["Anna", "You"]);
  const message = JSON.parse(prompt.match(/<message>(.*)<\/message>/)[1]);
  assert.equal(message.from_name, "Anna");
  assert.match(message.body, /start with \$500/);
  assert.ok(prompt.includes('<social_profile>{"platform":"Facebook","facts":["Anna Petrova","Joined August 2026","Based in Nigeria","12 friends"]}</social_profile>'), prompt);
  assert.ok(prompt.indexOf("<thread_history>") < prompt.indexOf("<social_profile>"), "after the thread history");
  assert.match(meta.replies()[0], /^🔴 Scam/);
  assert.equal(meta.replies().length, 1);

  // A profile alone is judged on its facts, never "no message".
  mock.reset();
  mock.script(PROFILE, verdict("be_careful"));
  const alone = fakeMeta({ media: { [IMG]: { type: "image/jpeg" } } });
  await send(channelWith(alone), attach("image", { url: IMG }));
  const p2 = mock.calls[1].messages[0].content;
  assert.ok(p2.includes('"subject":"Profile of Anna Petrova on Facebook"') && p2.includes("Joined August 2026.") && p2.includes("<social_profile>"), p2);
  assert.match(alone.replies()[0], /^🟠 Be careful/);
  // A picture with nothing to check.
  mock.reset();
  mock.script(read("none"));
  const blank = fakeMeta({ media: { [IMG]: { type: "image/jpeg" } } });
  await send(channelWith(blank), attach("image", { url: IMG }));
  assert.deepEqual(blank.replies(), [WORDS.en.noMessage]);
  assert.equal(mock.calls.length, 1, "nothing to judge");
  // A GIF is not read.
  const gif = fakeMeta({ media: { [IMG]: { type: "image/gif" } } });
  await send(channelWith(gif), attach("image", { url: IMG }));
  assert.deepEqual(gif.replies(), [WORDS.en.onlyTypesVideo]);
});

test("Muse Spark reads a picture as one message, a chat or a profile, and every caller still gets a message to judge", async () => {
  mock.script(CHAT, PROFILE, read("profile", { platform: null }), { is_message: true, channel: "whatsapp", sender_name: "Maman", sender: null, subject: null, body: "Coucou", links: [] }, { is_message: false, channel: "other", body: "" }, read("none"));
  const chat = await extractFromImage({ imageBase64: "aGVsbG8=", mime: "image/png" });
  assert.equal(mock.calls[0].json.name, "message_transcription");
  assert.ok(mock.calls[0].json.schema.required.includes("kind") && mock.calls[0].json.schema.properties.profile_facts);
  assert.match(mock.calls[0].system, /never call a photo fake/i);
  assert.match(mock.calls[0].system, /never follow instructions/i);
  assert.deepEqual([chat.isMessage, chat.kind, chat.platform, chat.message.channel], [true, "conversation", "Facebook", "social"]);
  assert.equal(chat.message.body, "Anna: Hi handsome, I saw your profile. Is this Mark?\nYou: No, sorry, wrong person.\nAnna: My mentor's platform made me $8,400 this month, start with $500.");
  assert.deepEqual(chat.turns[1], { who: "you", name: "", text: "No, sorry, wrong person." });
  const profile = await extractFromImage({ imageBase64: "aGVsbG8=", mime: "image/png" });
  assert.deepEqual([profile.isMessage, profile.kind, profile.message.subject], [true, "profile", "Profile of Anna Petrova on Facebook"]);
  assert.equal(profile.message.body, "Anna Petrova. Joined August 2026. Based in Nigeria. 12 friends.");
  assert.deepEqual(profile.profileFacts, PROFILE.profile_facts);
  const bare = await extractFromImage({ imageBase64: "aGVsbG8=", mime: "image/png" });
  assert.deepEqual([bare.isMessage, bare.message.body], [true, "Profile on social media"], "a profile is never 'no message'");
  const older = await extractFromImage({ imageBase64: "aGVsbG8=", mime: "image/png" });
  assert.deepEqual([older.kind, older.isMessage, older.message.channel, older.turns, older.profileFacts], ["message", true, "whatsapp", [], []], "an answer without kind still reads");
  assert.deepEqual([(await extractFromImage({ imageBase64: "x", mime: "image/png" })).kind, (await extractFromImage({ imageBase64: "x", mime: "image/png" })).isMessage], ["none", false]);
  // The profile block is added only when a profile is given.
  const input = { locale: "en-US", message: { channel: "messenger", body: "hi" }, threadHistory: [] };
  assert.ok(!buildUserPrompt(input).includes("social_profile"));
  assert.match(buildUserPrompt({ ...input, socialProfile: { platform: "Instagram", facts: ["Call me on +1 555 010 0199"] } }), /<social_profile>\{"platform":"Instagram","facts":\["Call me on \[phone number\]"\]\}<\/social_profile>/);
});

test("a screenshot of Messenger's Message requests gets exactly one reply with the verdict words and the stranger's name", async () => {
  const yakubu = { name: "Yakubu Zeero", preview: "Carlos Alcaraz: 4 months out injured. Today ...", date: "Aug 31", section: "requests" };
  const INBOX = read("inbox", { platform: "Messenger", threads: [yakubu] });
  const careful = {
    ...verdict("be_careful"), headline: "Be careful: a stranger wrote to you first.",
    reasons: [{ text: "Yakubu Zeero wrote to you first, on Aug 31, about tennis: no reason to contact you.", evidence: "pattern" }],
    action: "do_nothing", action_text: "Do not reply and do not tap any link. To know more, open the chat and send Prudence a screenshot of what they wrote.",
    impersonated_brand: null, scam_type: "romance_investment",
  };
  const meta = fakeMeta({ media: { [IMG]: { type: "image/jpeg" } } });
  mock.script(INBOX, careful);
  await send(channelWith(meta), attach("image", { url: IMG }));
  assert.equal(meta.replies().length, 1, "one picture, one reply");
  const reply = meta.replies()[0];
  assert.match(reply, /^🟠 Be careful\nA stranger wrote to you first\./, reply);
  assert.ok(reply.includes("• Yakubu Zeero wrote to you first, on Aug 31, about tennis") && reply.includes("send Prudence a screenshot"), reply);
  const prompt = mock.calls[1].messages[0].content;
  const message = JSON.parse(prompt.match(/<message>(.*?)<\/message>/)[1]);
  assert.deepEqual([message.channel, message.from_name, message.subject, message.body],
    ["messenger", "Yakubu Zeero", "Message requests on Messenger", "Yakubu Zeero (Aug 31): Carlos Alcaraz: 4 months out injured. Today ..."]);
  assert.ok(prompt.includes("<inbox>") && prompt.includes("<thread_history>[]</thread_history>"), "judged as the list itself, not as a turn of a chat");
  // The model down: the rules still answer Be careful, naming him.
  mock.reset();
  mock.script(INBOX, new Error("down"));
  const rulesOnly = fakeMeta({ media: { [IMG]: { type: "image/jpeg" } } });
  await send(channelWith(rulesOnly), attach("image", { url: IMG }));
  assert.equal(rulesOnly.replies().length, 1);
  assert.match(rulesOnly.replies()[0], /^🟠 Be careful/);
  assert.ok(rulesOnly.replies()[0].includes("Yakubu Zeero wrote to you first, out of the blue."), rulesOnly.replies()[0]);
  // After a forwarded text, the list is still what is judged; the text is its history.
  mock.reset();
  mock.script(INBOX, careful);
  const after = fakeMeta({ media: { [IMG]: { type: "image/jpeg" } } });
  await send(channelWith(after), delivery(event({ text: "Who is this man?" }), event({ attachments: [{ type: "image", payload: { url: IMG } }] })));
  assert.equal(after.replies().length, 1);
  const p2 = mock.calls[1].messages[0].content;
  assert.equal(JSON.parse(p2.match(/<message>(.*?)<\/message>/)[1]).subject, "Message requests on Messenger");
  assert.deepEqual(JSON.parse(p2.match(/<thread_history>(.*?)<\/thread_history>/)[1]).map((h) => h.body), ["Who is this man?"]);
});

test("a voice message is written down by Muse Voice Transcribe and judged, the reply quoting what it says", async () => {
  const heard = "Grandpa it's me, I had an accident and I'm in jail. Please buy $2,000 in gift cards today and don't tell mom.";
  const mp4 = Buffer.from("mp4-aac-bytes");
  const wav = Buffer.from("RIFF-wav");
  const meta = fakeMeta({ media: { [VOICE]: { bytes: mp4, type: "audio/mp4" } } });
  let transcoded = null;
  mock.scriptTranscript(heard);
  mock.script({ ...verdict("scam"), headline: "Scam: this is the grandchild-in-trouble scam.", action_text: "Call your grandson on the number you already have." });
  await send(channelWith(meta, { transcode: async (b) => { transcoded = b; return wav; } }), attach("audio", { url: VOICE }));
  assert.ok(transcoded?.equals(mp4), "the downloaded recording went to ffmpeg");
  assert.ok(mock.transcribeCalls[0].wav.equals(wav));
  assert.ok(mock.calls[0].messages[0].content.includes("gift cards"));
  const body = meta.replies()[0];
  assert.match(body, /^🔴 Scam\nThis is the grandchild-in-trouble scam\./);
  assert.ok(body.includes(`What the voice note says: "${heard}"`), body);
  // No words heard.
  mock.scriptTranscript("");
  const silent = fakeMeta({ media: { [VOICE]: { bytes: mp4, type: "audio/mp4" } } });
  await send(channelWith(silent, { transcode: async () => wav }), attach("audio", { url: VOICE }));
  assert.deepEqual(silent.replies(), [WORDS.en.noWords]);
});

// A video as the injected reader returns it: its length, its sound as WAV,
// its four frames as one JPEG sheet. Each call is recorded.
const CLIP = Buffer.from("mp4-moov-at-the-end");
const SHEET = Buffer.from("jpeg-2x2-sheet");
const CLIP_WAV = Buffer.from("RIFF-video-wav");
function videoReader(out = {}) {
  const calls = [];
  const readVideo = async (buffer, opts) => {
    calls.push({ buffer, opts });
    if (out instanceof Error) throw out;
    return { durationSec: 15, wav: CLIP_WAV, sheet: SHEET, ...out };
  };
  readVideo.calls = calls;
  return readVideo;
}
const ALERT_HEARD = "Warning. Your computer has been locked. Do not restart. Call technical support now at 555 010 0199 to unlock it.";
const ALERT_SCREEN = read("message", {
  sender_name: "Security Center", body: "SYSTEM SECURITY ALERT. Your computer has been locked. DO NOT RESTART. CALL TECHNICAL SUPPORT NOW: (555) 010-0199",
  links: [{ text: "secure-unlock.test/help", href: "secure-unlock.test/help" }],
});
const TECH = {
  ...verdict("scam"), headline: "Scam: this is a fake security alert.",
  reasons: [{ text: "Real security warnings never ask you to call a number.", evidence: "pattern" }],
  action: "delete", action_text: "Do not call the number. Turn the computer off and on.", impersonated_brand: null, scam_type: "tech_support",
};
const verdictCalls = () => mock.calls.filter((c) => typeof c.messages[0].content === "string" && c.messages[0].content.includes("<message>"));
const messageOf = (call) => JSON.parse(call.messages[0].content.match(/<message>(.*)<\/message>/)[1]);

test("a video gets the typing dots and exactly one reply, from one Muse Spark verdict on what it shows and what is said in it", async () => {
  const meta = fakeMeta({ media: { [VIDEO]: { bytes: CLIP, type: "video/mp4" } } });
  const readVideo = videoReader();
  mock.scriptTranscript(ALERT_HEARD);
  mock.script(ALERT_SCREEN, TECH);
  await send(channelWith(meta, { readVideo }), attach("video", { url: VIDEO }));
  assert.ok(readVideo.calls[0].buffer.equals(CLIP), "the downloaded bytes went to the reader");
  assert.equal(readVideo.calls[0].opts.maxSeconds, 180);
  const [typing, ...rest] = meta.sends();
  assert.equal(typing.sender_action, "typing_on");
  assert.equal(rest.length, 1, "the dots, then exactly one reply");
  assert.ok(mock.transcribeCalls[0].wav.equals(CLIP_WAV), "the sound went to Muse Voice Transcribe");
  const frames = mock.calls.find((c) => Array.isArray(c.messages[0].content));
  assert.deepEqual(frames.messages[0].content[1], { type: "image", mime: "image/jpeg", base64: SHEET.toString("base64") }, "the frame sheet went to Muse Spark");
  assert.equal(verdictCalls().length, 1, "one verdict");
  const message = messageOf(verdictCalls()[0]);
  // Both sides in one message (the phone number redacted for the model, as for any message).
  assert.match(message.body, /^What the video shows:\nSYSTEM SECURITY ALERT[^]*\n\nWhat is said in it:\nWarning\. Your computer has been locked\. [^]*Call technical support now at \[phone number\] to unlock it\.$/, message.body);
  assert.match(message.setting, /^A video the person sent: what it shows .* and what is said in it/);
  assert.equal(message.from_name, "Security Center");
  assert.deepEqual(message.links.map((l) => l.goes_to), ["secure-unlock.test/help"]);
  const body = meta.replies()[0];
  assert.match(body, /^🔴 Scam\nThis is a fake security alert\./, body);
  assert.ok(body.includes("What to do: Do not call the number."), body);
  assert.ok(body.includes(`What is said in the video: "${ALERT_HEARD}"`), body);
  assert.match(body, /Checked with Mock LLM\.$/);

  // Only one side has something: that side is judged.
  mock.reset();
  mock.script(read("none"), TECH);
  mock.scriptTranscript(ALERT_HEARD);
  const heardOnly = fakeMeta({ media: { [VIDEO]: { bytes: CLIP, type: "video/mp4" } } });
  await send(channelWith(heardOnly, { readVideo: videoReader() }), attach("video", { url: VIDEO }));
  assert.match(messageOf(verdictCalls()[0]).body, /^What is said in it:\nWarning\. Your computer has been locked\.[^]*unlock it\.$/);
  assert.match(heardOnly.replies()[0], /^🔴 Scam/);
  mock.reset();
  mock.script(ALERT_SCREEN, TECH); // no sound track, so nothing to transcribe
  const shownOnly = fakeMeta({ media: { [VIDEO]: { bytes: CLIP, type: "video/mp4" } } });
  await send(channelWith(shownOnly, { readVideo: videoReader({ wav: null }) }), attach("video", { url: VIDEO }));
  assert.match(messageOf(verdictCalls()[0]).body, /^What the video shows:\nSYSTEM SECURITY ALERT[^]*SUPPORT NOW: \[phone number\]$/);
  assert.equal(mock.transcribeCalls.length, 0);
  assert.ok(!shownOnly.replies()[0].includes("What is said in the video"), "no words heard, none quoted");
});

test("a video too big or too long gets its sentence, and one with nothing heard and nothing read gets its own", async () => {
  const tooLong = "This video is too long for me. Please send a shorter one, or a screenshot.";
  assert.equal(WORDS.en.videoTooLong, tooLong);
  // Too big: the download stops at the cap, or Meta announces more.
  const big = fakeMeta({ media: { [VIDEO]: { bytes: Buffer.alloc(64), type: "video/mp4" } } });
  const reader = videoReader();
  await send(channelWith(big, { readVideo: reader, maxVideoBytes: 32 }), attach("video", { url: VIDEO }));
  assert.deepEqual(big.replies(), [tooLong]);
  const announced = fakeMeta({ media: { [VIDEO]: { bytes: Buffer.alloc(8), headers: { "content-type": "video/mp4", "content-length": String(26 * 1024 * 1024) } } } });
  await send(channelWith(announced, { readVideo: reader }), attach("video", { url: VIDEO }));
  assert.deepEqual(announced.replies(), [tooLong], "over 25 MB by its own announcement");
  assert.equal(reader.calls.length, 0, "never read");
  // Too long: over three minutes, by the reader's word or by its length.
  for (const out of [{ durationSec: 181, tooLong: true, wav: null, sheet: null }, { durationSec: 240 }]) {
    const long = fakeMeta({ media: { [VIDEO]: { bytes: CLIP, type: "video/mp4" } } });
    mock.scriptTranscript("never used");
    await send(channelWith(long, { readVideo: videoReader(out) }), attach("video", { url: VIDEO }));
    assert.deepEqual(long.replies(), [tooLong]);
  }
  assert.equal(mock.calls.length, 0, "nothing judged");
  // Nothing heard, nothing read.
  mock.reset();
  mock.scriptTranscript("");
  mock.script(read("none"));
  const empty = fakeMeta({ media: { [VIDEO]: { bytes: CLIP, type: "video/mp4" } } });
  await send(channelWith(empty, { readVideo: videoReader() }), attach("video", { url: VIDEO }));
  assert.deepEqual(empty.replies(), ["I could not hear or read anything in this video. Please send a screenshot, or type the words."]);
  assert.equal(verdictCalls().length, 0);
});

test("a video the reader cannot read gets the failure wording; French words give French; Muse off needs Muse Spark", async () => {
  logs.length = 0;
  const broken = fakeMeta({ media: { [VIDEO]: { bytes: CLIP, type: "video/mp4" } } });
  await send(channelWith(broken, { readVideo: videoReader(new Error("ffprobe exited 1: Invalid data found when processing input")) }), attach("video", { url: VIDEO }));
  assert.deepEqual(broken.replies(), [WORDS.en.failed]);
  assert.match(logs.find(([m]) => m === "messenger check failed")[1].err, /ffprobe exited 1/);
  // French.
  const heard = "Attention, votre ordinateur est bloqué. N'éteignez pas. Appelez le support technique au 01 23 45 67 89 pour le débloquer.";
  mock.scriptTranscript(heard);
  mock.script(read("message", { body: "ALERTE DE SÉCURITÉ. Votre ordinateur est bloqué. Appelez le support : 01 23 45 67 89" }), {
    ...TECH, headline: "Arnaque : cette alerte de sécurité est fausse.", reasons: [{ text: "Une vraie alerte ne demande jamais d'appeler un numéro.", evidence: "pattern" }],
    action_text: "N'appelez pas ce numéro. Éteignez l'ordinateur.", language: "fr",
  });
  const fr = fakeMeta({ media: { [VIDEO]: { bytes: CLIP, type: "video/mp4" } } });
  await send(channelWith(fr, { readVideo: videoReader() }), attach("video", { url: VIDEO }));
  assert.ok(verdictCalls()[0].messages[0].content.includes("<locale>fr-FR</locale>"), "the labels around the words do not make it English");
  const body = fr.replies()[0];
  assert.match(body, /^🔴 Arnaque\nCette alerte de sécurité est fausse\./, body);
  assert.ok(body.includes(`Ce qui est dit dans la vidéo : "${heard}"`) && body.includes("Que faire : N'appelez pas ce numéro."), body);
  assert.equal(WORDS.fr.videoTooLong, "Cette vidéo est trop longue pour moi. Envoyez-en une plus courte, ou une capture d'écran.");
  assert.equal(WORDS.fr.videoNothing, "Je n'ai rien entendu ni rien pu lire dans cette vidéo. Envoyez une capture d'écran, ou tapez les mots.");
  // Muse off.
  delete process.env.LLM_PROVIDER;
  const off = fakeMeta({ media: { [VIDEO]: { bytes: CLIP, type: "video/mp4" } } });
  const reader = videoReader();
  await send(channelWith(off, { readVideo: reader }), attach("video", { url: VIDEO }));
  assert.deepEqual(off.replies(), [WORDS.en.needsMuse]);
  assert.equal(reader.calls.length, 0);
  assert.ok(off.calls.every((c) => SEND.test(c.url)), "no download without the model");
});

test("nothing of a video is kept: the log names its length, its size and the verdict, never its words or what it shows", async () => {
  const meta = fakeMeta({ media: { [VIDEO]: { bytes: CLIP, type: "video/mp4" } } });
  mock.scriptTranscript(ALERT_HEARD);
  mock.script(ALERT_SCREEN, TECH);
  logs.length = 0;
  await send(channelWith(meta, { readVideo: videoReader({ durationSec: 15.04 }) }), attach("video", { url: VIDEO }));
  const [, answered] = logs.find(([m]) => m === "messenger check answered");
  assert.deepEqual([answered.types, answered.verdict, answered.videos], [["video"], "scam", [{ seconds: 15, bytes: CLIP.length }]]);
  assert.equal(typeof answered.ms, "number");
  const said = JSON.stringify(logs);
  for (const words of ["locked", "technical support", "0199", "SECURITY", "Security Center", "secure-unlock"]) assert.ok(!said.includes(words), words);
  assert.ok(meta.calls.every((c) => SEND.test(c.url) || c.url === VIDEO));
});

test("ffmpeg reads a phone video from a temporary file: the sound as 16 kHz mono WAV, four frames as one 2x2 sheet, the folder gone afterwards", { skip: !ffmpegForVideo() }, async () => {
  const root = await mkdtemp(join(tmpdir(), "prudence-video-test-"));
  try {
    // A 3 s clip with its index at the end (no faststart), as phones write them.
    const made = join(root, "made.mp4");
    const r = spawnSync("ffmpeg", ["-hide_banner", "-loglevel", "error", "-f", "lavfi", "-i", "testsrc=duration=3:size=320x240:rate=10", "-f", "lavfi", "-i", "sine=frequency=440:duration=3",
      "-c:v", "mpeg4", "-c:a", "aac", "-shortest", made]);
    assert.equal(r.status, 0, r.stderr?.toString());
    const clip = await readFile(made);
    await rm(made);
    const work = join(root, "work");
    await mkdir(work);
    const out = await ffmpegVideo(clip, { tmpRoot: work, maxSeconds: 180 });
    assert.ok(Math.abs(out.durationSec - 3) < 0.2, String(out.durationSec));
    assert.equal(out.wav.toString("ascii", 0, 4), "RIFF");
    assert.equal(out.wav.readUInt16LE(22), 1, "mono");
    assert.equal(out.wav.readUInt32LE(24), 16000, "16 kHz");
    assert.equal(out.wav.readUInt16LE(34), 16, "16-bit");
    assert.equal(out.sheet.readUInt16BE(0), 0xffd8, "a JPEG");
    const sheetFile = join(root, "sheet.jpg");
    await writeFile(sheetFile, out.sheet);
    const size = spawnSync("ffprobe", ["-v", "error", "-show_entries", "stream=width,height", "-of", "csv=p=0", sheetFile], { encoding: "utf8" });
    assert.equal(size.stdout.trim(), "640,480", "four 320x240 frames, 2x2");
    assert.deepEqual(await readdir(work), [], "the temporary folder is gone");
    // Too long: nothing extracted, the folder gone too.
    const long = await ffmpegVideo(clip, { tmpRoot: work, maxSeconds: 2 });
    assert.deepEqual([long.tooLong, long.wav, long.sheet], [true, null, null]);
    assert.deepEqual(await readdir(work), []);
    // Not a video, or no ffmpeg: an error, and the folder gone.
    await assert.rejects(ffmpegVideo(Buffer.from("not a video"), { tmpRoot: work }), /ffprobe exited/);
    await assert.rejects(ffmpegVideo(clip, { tmpRoot: work, ffmpegPath: "/nonexistent/ffmpeg" }), /ffprobe not available/);
    await assert.rejects(ffmpegVideo(clip, { tmpRoot: work, timeoutMs: 1 }), /timed out/);
    assert.deepEqual(await readdir(work), []);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
  assert.deepEqual(frameTimes(16), [2, 6, 10, 14], "never the very first or last frame");
  assert.ok(!VIDEO_FORMATS.includes("hls") && !VIDEO_FORMATS.includes("concat"));
  assert.equal(ffprobeBeside("/opt/homebrew/bin/ffmpeg"), "/opt/homebrew/bin/ffprobe");
  assert.equal(ffprobeBeside("ffmpeg"), "ffprobe");
});

test("ffmpeg opens a video only as a local MP4 or WebM: a playlist or a file list dressed as one is refused before anything is read, nothing fetched", { skip: !ffmpegForVideo() }, async () => {
  let hits = 0;
  const server = createServer((req, res) => { hits++; res.end("#EXTM3U\n"); });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  const root = await mkdtemp(join(tmpdir(), "prudence-video-test-"));
  try {
    const { port } = server.address();
    const secret = join(root, "secret.txt");
    await writeFile(secret, "not for the model");
    const work = join(root, "work");
    await mkdir(work);
    const playlist = Buffer.from(`#EXTM3U\n#EXT-X-VERSION:3\n#EXT-X-TARGETDURATION:10\n#EXTINF:10.0,\nhttp://127.0.0.1:${port}/segment.ts\n#EXT-X-ENDLIST\n`);
    await assert.rejects(ffmpegVideo(playlist, { tmpRoot: work }), /ffprobe exited|refused/, "an HLS playlist");
    await assert.rejects(ffmpegToWav(playlist), /ffmpeg exited/, "the same playlist as a voice note");
    await assert.rejects(ffmpegVideo(Buffer.from(`ffconcat version 1.0\nfile '${secret}'\n`), { tmpRoot: work }), /ffprobe exited|refused/, "a concat list");
    // A real recording that is not a video format: refused too.
    const wav = spawnSync("ffmpeg", ["-hide_banner", "-loglevel", "error", "-f", "lavfi", "-i", "sine=frequency=440:duration=1", "-f", "wav", "pipe:1"]);
    await assert.rejects(ffmpegVideo(wav.stdout, { tmpRoot: work }), /ffprobe exited|refused/, "a WAV sent as a video");
    assert.equal(hits, 0, "nothing was fetched");
    assert.deepEqual(await readdir(work), [], "nothing extracted, the folder gone");
  } finally {
    await new Promise((r) => server.close(r));
    await rm(root, { recursive: true, force: true });
  }
});

test("a video whose container lies about its length is never decoded past the cap", { skip: !ffmpegForVideo() }, async () => {
  const root = await mkdtemp(join(tmpdir(), "prudence-video-test-"));
  try {
    const made = join(root, "made.mkv");
    const r = spawnSync("ffmpeg", ["-hide_banner", "-loglevel", "error", "-f", "lavfi", "-i", "testsrc=duration=6:size=160x120:rate=5", "-f", "lavfi", "-i", "sine=frequency=440:duration=6",
      "-c:v", "mpeg4", "-c:a", "aac", made]);
    assert.equal(r.status, 0, r.stderr?.toString());
    // Matroska's Duration (id 0x4489, an 8-byte float in ms) rewritten from 6 s to 1 s.
    const clip = await readFile(made);
    const at = clip.findIndex((b, i) => b === 0x44 && clip[i + 1] === 0x89 && clip[i + 2] === 0x88);
    assert.ok(at > 0, "the Duration element");
    clip.writeDoubleBE(1000, at + 3);
    const work = join(root, "work");
    await mkdir(work);
    const out = await ffmpegVideo(clip, { tmpRoot: work, maxSeconds: 2 });
    assert.equal(out.durationSec, 1, "the container says 1 s");
    const seconds = (out.wav.length - 44) / 32000;
    assert.ok(seconds <= 2.1, `the sound stops at the 2 s cap, not at the 6 s it holds (${seconds} s)`);
    assert.equal(out.sheet.readUInt16BE(0), 0xffd8);
    assert.deepEqual(await readdir(work), []);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("a sticker, a file, a reel or a shared link alone gets the plain reply; beside a text it is skipped", async () => {
  const meta = fakeMeta();
  const channel = channelWith(meta, { limiter: createLimiter({ max: 100 }) });
  const loners = [
    attach("sticker", { url: IMG, sticker_id: 369239263222822 }),
    attach("image", { url: IMG, sticker_id: 369239263222822 }),
    attach("video", {}),
    attach("file", { url: "https://cdn.fbsbx.com/v/facture.pdf" }),
    attach("fallback", { url: "https://l.facebook.com/l.php?u=x", title: "Win a prize" }),
    delivery(event({ attachments: [{ type: "fallback" }] })),
    attach("ig_reel", { url: "https://lookaside.fbsbx.com/reel" }),
    attach("appointment_booking", null),
    delivery(event({ attachments: [{ type: "image" }] })),
    delivery(event({})),
  ];
  for (const b of loners) await send(channel, b);
  assert.deepEqual(meta.replies(), Array(loners.length).fill(WORDS.en.onlyTypesVideo));
  assert.equal(WORDS.en.onlyTypesVideo, "I can only check texts, pictures, voice notes and videos for now.");
  assert.equal(mock.calls.length, 0, "nothing was judged");
  assert.ok(meta.calls.every((c) => SEND.test(c.url)), "nothing was downloaded");
  assert.deepEqual(parseWebhook(loners[0]).messages[0].type, "sticker");
  assert.deepEqual(parseWebhook(loners[4]).messages[0].type, "link");
  assert.deepEqual(parseWebhook(loners[6]).messages[0].type, "unknown");
  // Beside a text, the sticker is skipped and the text judged.
  mock.script(verdict("scam"));
  await send(channel, delivery(event({ text: USPS }), event({ attachments: [{ type: "sticker", payload: { url: IMG, sticker_id: 1 } }] })));
  assert.match(meta.replies().at(-1), /^🔴 Scam/);
  assert.ok(!mock.calls[0].messages[0].content.match(/<thread_history>(.*)<\/thread_history>/)[1].includes("sticker"));
});

test("French words get a French reply; English otherwise", async () => {
  const meta = fakeMeta();
  const channel = channelWith(meta);
  mock.script(verdict("scam", "fr"));
  await send(channel, text("Chronopost : votre colis est en attente. Réglez 1,99 € ici : https://chronopost-suivi.test/payer"));
  assert.ok(mock.calls[0].messages[0].content.includes("<locale>fr-FR</locale>"));
  const body = meta.replies()[0];
  assert.match(body, /^🔴 Arnaque\nNe payez rien, Chronopost ne demande jamais de frais par SMS\./, body);
  assert.ok(body.includes("Pourquoi :\n• Le lien mène à") && body.includes("Que faire : Supprimez-le.") && body.includes("Vérifié avec Mock LLM."), body);
  mock.script(verdict("scam"));
  await send(channel, text("ok 👍 https://usps-delivery.test/pay"));
  assert.ok(mock.calls[1].messages[0].content.includes("<locale>en-US</locale>"), "no words either way: English");
});

test("a sender gets ten checks a minute: the eleventh message gets one 'please wait', the twelfth nothing", async () => {
  let clock = 1_000_000;
  const meta = fakeMeta();
  const timer = fakeTimer();
  const channel = channelWith(meta, { now: () => clock, setTimer: timer });
  mock.respondWith(() => verdict("scam"));
  const arrivals = [];
  for (let i = 0; i < 12; i++) arrivals.push(...await channel.handle(text(`${USPS} #${i}`)));
  assert.deepEqual(arrivals.map((a) => a.skipped || "queued"), [...Array(10).fill("queued"), "rate_limited", "rate_limited"]);
  assert.deepEqual(meta.replies(), ["Please wait a minute before sending another message."], "one wait, then silence");
  timer.fire();
  await channel.idle();
  assert.equal(meta.replies().length, 2, "the ten are answered together");
  assert.equal(JSON.parse(mock.calls[0].messages[0].content.match(/<thread_history>(.*)<\/thread_history>/)[1]).length, 9);
  await channel.handle(text(USPS));
  assert.equal(meta.replies().length, 2, "still silent within the minute");
  const other = await channel.handle(text(USPS, { from: "7099999999999999" }));
  assert.equal(other[0].queued, true, "another sender is not held back");
  clock += 61_000;
  assert.equal((await channel.handle(text(USPS)))[0].queued, true, "a new minute, a new check");
  timer.fire();
  await channel.idle();
  assert.equal(meta.replies().length, 4);
});

test("when something fails on our side the senior is told not to click; a failed typing call or reply never breaks the webhook", async () => {
  const broken = fakeMeta({ media: { [IMG]: { status: 500 } } });
  logs.length = 0;
  await send(channelWith(broken), attach("image", { url: IMG }));
  assert.deepEqual(broken.replies(), ["Something went wrong on our side. To be safe, do not click anything in the message."]);
  assert.match(logs.find(([m]) => m === "messenger check failed")[1].err, /attachment download 500/);
  // Too big: told plainly, the download stops at the limit.
  const big = fakeMeta({ media: { [IMG]: { bytes: Buffer.alloc(64), type: "image/jpeg" } } });
  await send(channelWith(big, { maxImageBytes: 32 }), attach("image", { url: IMG }));
  assert.deepEqual(big.replies(), [WORDS.en.tooBig]);
  const announced = fakeMeta({ media: { [VOICE]: { bytes: Buffer.alloc(8), headers: { "content-type": "audio/mp4", "content-length": String(17 * 1024 * 1024) } } } });
  mock.scriptTranscript("never used");
  await send(channelWith(announced), attach("audio", { url: VOICE }));
  assert.deepEqual(announced.replies(), [WORDS.en.tooBig], "over 16 MB by its own announcement");
  // Typing refused: the reply still goes; the reply refused: logged, no throw.
  const noTyping = fakeMeta({ typingStatus: 400 });
  mock.script(verdict("scam"));
  await send(channelWith(noTyping), text(USPS));
  assert.equal(noTyping.replies().length, 1);
  const dead = fakeMeta({ sendStatus: 400 });
  mock.script(verdict("scam"));
  logs.length = 0;
  await send(channelWith(dead), text(USPS));
  assert.ok(logs.some(([m, o]) => m === "messenger check failed" && /Messenger send 400: \(#551\)/.test(o.err)));
  assert.ok(logs.some(([m]) => m === "messenger reply failed"));
  // The wait reply failing is logged too.
  const limited = channelWith(dead, { limiter: createLimiter({ max: 0 }) });
  assert.equal((await limited.handle(text(USPS)))[0].skipped, "rate_limited");
});

test("when Muse Spark is off a text is judged by the rules and says so; a picture or a voice message needs Muse Spark", async () => {
  delete process.env.LLM_PROVIDER; // Muse Spark not switched on (no META_MODEL_API_KEY either)
  const meta = fakeMeta();
  const channel = channelWith(meta);
  await send(channel, text(USPS));
  assert.match(meta.replies()[0], /^🔴 Scam/);
  assert.match(meta.replies()[0], /Checked with Prudence's rules \(Muse Spark was not available\)\.$/);
  await send(channel, attach("image", { url: IMG }));
  await send(channel, attach("audio", { url: VOICE }));
  assert.deepEqual(meta.replies().slice(1), [WORDS.en.needsMuse, WORDS.en.needsMuse]);
  assert.ok(meta.calls.every((c) => SEND.test(c.url)), "no download without the model");
  // The model failing mid-check: the rules answer.
  process.env.LLM_PROVIDER = "mock";
  mock.script(new Error("model down"));
  const down = fakeMeta();
  await send(channelWith(down), text(USPS));
  assert.match(down.replies()[0], /Checked with Prudence's rules \(Mock LLM was not available\)\.$/);
});

test("nothing is kept: the logs name ids and verdicts, never the words, and nothing leaves for anywhere but Meta", async () => {
  const meta = fakeMeta({ media: { [IMG]: { type: "image/jpeg" } } });
  mock.script(CHAT, PIG);
  logs.length = 0;
  await send(channelWith(meta), delivery(event({ text: "Secret words: my PIN is 4821" }), event({ attachments: [{ type: "image", payload: { url: IMG } }] })));
  const said = JSON.stringify(logs);
  assert.ok(logs.some(([m]) => m === "messenger check answered"));
  for (const words of ["Secret words", "4821", "mentor", "Anna"]) assert.ok(!said.includes(words), words);
  assert.ok(meta.calls.every((c) => SEND.test(c.url) || c.url === IMG));
});

test("the Messenger settings: v26.0 and a three-second window by default, the m.me link only while the Page answers", () => {
  assert.equal(DEFAULT_GRAPH_VERSION, "v26.0");
  assert.deepEqual([messengerConfig({}).graphVersion, messengerConfig({}).groupMs, messengerConfig({}).ffmpegPath], ["v26.0", 3000, "ffmpeg"]);
  assert.deepEqual([messengerConfig({ MESSENGER_GRAPH_VERSION: "v27.0", MESSENGER_GROUP_MS: "1500" }).graphVersion, messengerConfig({ MESSENGER_GROUP_MS: "1500" }).groupMs], ["v27.0", 1500]);
  assert.equal(messengerConfig({ MESSENGER_GROUP_MS: "soon" }).groupMs, 3000);
  assert.equal(messengerConfig({ MESSENGER_GROUP_MS: "0" }).groupMs, 0);
  assert.equal(messengerLink(ENV), "https://m.me/PrudencePage");
  assert.equal(messengerLink({ ...ENV, MESSENGER_PAGE_ACCESS_TOKEN: "" }), null, "no Page, no button");
  assert.equal(messengerLink({ ...ENV, MESSENGER_PAGE_LINK: "javascript:alert(1)" }), null);
  assert.equal(messengerLink({ ...ENV, MESSENGER_PAGE_LINK: "m.me/PrudencePage" }), null, "not a full https address");
  assert.equal(messengerLink({ ...ENV, MESSENGER_PAGE_LINK: "" }), null);
  const wa = { WHATSAPP_ACCESS_TOKEN: "t", WHATSAPP_PHONE_NUMBER_ID: "P" };
  assert.equal(whatsappLink({ ...wa, WHATSAPP_PHONE_NUMBER: "+1 (555) 123-4567" }), "https://wa.me/15551234567");
  assert.equal(whatsappLink({ WHATSAPP_PHONE_NUMBER: "15551234567" }), null, "no channel, no link");
  assert.equal(whatsappLink(wa), null);
});

test("/api/status carries both channel rows: messengerConfigured and its link, whatsappConfigured and its link", async () => {
  const app = await buildApp({ logger: false });
  try {
    const status = async () => (await app.inject({ url: "/api/status" })).json();
    const off = await status();
    assert.deepEqual([off.messengerConfigured, off.messengerLink, off.whatsappConfigured, off.whatsappLink], [false, null, false, null]);
    Object.assign(process.env, ENV, { WHATSAPP_ACCESS_TOKEN: "t", WHATSAPP_PHONE_NUMBER_ID: "P", WHATSAPP_PHONE_NUMBER: "15551234567" });
    const on = await status();
    assert.deepEqual([on.messengerConfigured, on.messengerLink, on.whatsappConfigured, on.whatsappLink], [true, "https://m.me/PrudencePage", true, "https://wa.me/15551234567"]);
  } finally {
    await app.close();
  }
});

test("the server starts without the Messenger keys: the webhook answers 501 without an Origin header, the handshake 403", async () => {
  assert.equal(messengerConfigured(process.env), false);
  const app = await buildApp({ logger: false });
  try {
    const post = await app.inject({ method: "POST", url: "/api/messenger/webhook", payload: text(USPS) });
    assert.equal(post.statusCode, 501, "Meta sends no Origin; the signature is the check");
    assert.match(post.json().error, /MESSENGER_PAGE_ACCESS_TOKEN/);
    assert.equal((await app.inject({ url: "/api/messenger/webhook", query: { "hub.mode": "subscribe", "hub.verify_token": "x", "hub.challenge": "1" } })).statusCode, 403);
    const wa = await app.inject({ method: "POST", url: "/api/whatsapp/webhook", payload: {} });
    assert.equal(wa.statusCode, 501, "the WhatsApp webhook beside it is unchanged");
  } finally {
    await app.close();
  }
});

function ffmpegForVideo() {
  const probe = spawnSync("ffprobe", ["-version"]);
  const filters = spawnSync("ffmpeg", ["-hide_banner", "-filters"], { encoding: "utf8" });
  return probe.status === 0 && filters.status === 0 && /\bxstack\b/.test(filters.stdout || "");
}
