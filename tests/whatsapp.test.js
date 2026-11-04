// WhatsApp channel ("forward it to Prudence"): the webhook handshake and
// signature, then every behavior line of _product/specs/whatsapp-channel.md
// against a fake Graph API (injected fetch) and the mock LLM. No network,
// no Postgres; ffmpeg only in one test that skips itself without it.
import "./helpers/env.js";
import { test, afterEach, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { spawnSync } from "node:child_process";
import Fastify from "fastify";
import { getProvider } from "../lib/llm/index.js";
import { breaker } from "../lib/muse.js";
import {
  createWhatsAppChannel, createLimiter, createSeen, detectLanguage, ffmpegToWav, fixWavSizes, formatReply, mediaUrl, parseWebhook,
  shippedCards, verificationChallenge, verifySignature, whatsappConfigured, WORDS,
} from "../src/channels/whatsapp.js";
import whatsappRoutes from "../src/routes/whatsapp.js";
import { buildApp } from "../src/server.js";

for (const k of Object.keys(process.env)) if (k.startsWith("WHATSAPP_")) delete process.env[k];
const ENV = { WHATSAPP_ACCESS_TOKEN: "tok-123", WHATSAPP_PHONE_NUMBER_ID: "PHONE1", WHATSAPP_VERIFY_TOKEN: "verify-me", WHATSAPP_APP_SECRET: "s3cret" };
const SENDER = "15551230100";
const quiet = { info() {}, warn() {}, error() {} };
const mock = getProvider("mock");

beforeEach(() => { process.env.LLM_PROVIDER = "mock"; mock.reset(); breaker.failures = 0; breaker.openUntil = 0; });
afterEach(() => { delete process.env.LLM_PROVIDER; delete process.env.META_MODEL_API_KEY; mock.reset(); });

// The Graph API as the channel sees it: media lookup, media bytes, the
// reply endpoint, and Muse Voice Transcribe. Every call is recorded.
const CDN = "https://lookaside.fbsbx.com/whatsapp_business/attachments/?mid=MEDIA1&ext=1761750600&hash=abc";
function fakeGraph({ mediaMime = "image/jpeg", mediaBytes = Buffer.from("fake-image"), transcript = "", lookupStatus = 200, mediaUrl = CDN } = {}) {
  const calls = [];
  const fetchImpl = async (url, init = {}) => {
    const u = String(url);
    calls.push({ url: u, method: init.method || "GET", headers: init.headers || {}, body: init.body, redirect: init.redirect });
    if (/\/messages$/.test(u)) return Response.json({ messaging_product: "whatsapp", messages: [{ id: `wamid.reply.${calls.length}` }] });
    if (/graph\.facebook\.com\/v\d+\.\d+\/MEDIA/.test(u)) {
      if (lookupStatus !== 200) return new Response("{}", { status: lookupStatus });
      return Response.json({ url: mediaUrl, mime_type: mediaMime, sha256: "x", file_size: mediaBytes.length, id: "MEDIA1" });
    }
    if (u.startsWith("https://lookaside.fbsbx.com/")) return new Response(mediaBytes, { status: 200, headers: { "content-type": mediaMime } });
    if (u.includes("/asr/transcribe")) return new Response(`${transcript}\n`, { status: 200 });
    throw new Error(`unexpected fetch ${u}`);
  };
  fetchImpl.calls = calls;
  fetchImpl.replies = () => calls.filter((c) => /\/messages$/.test(c.url)).map((c) => ({ ...JSON.parse(c.body), authorization: c.headers.authorization }));
  return fetchImpl;
}

const channelWith = (graph, extra = {}) => createWhatsAppChannel({
  env: ENV, fetchImpl: graph, patternCards: async () => [], inspectLinks: async () => ({}), log: quiet, ...extra,
});

let n = 0;
const delivery = (message, { from = SENDER, name = "Linda", id = `wamid.${++n}` } = {}) => ({
  object: "whatsapp_business_account",
  entry: [{ id: "WABA1", changes: [{ field: "messages", value: {
    messaging_product: "whatsapp", metadata: { display_phone_number: "15550001111", phone_number_id: "PHONE1" },
    contacts: [{ profile: { name }, wa_id: from }],
    messages: [{ from, id, timestamp: "1761750000", ...message }],
  } }] }],
});
const text = (body, extra = {}) => ({ type: "text", text: { body }, ...extra });
const USPS = "USPS: your package is on hold. Pay the $1.99 redelivery fee today: https://usps-delivery.test/pay";
const verdict = (v, lang = "en") => ({
  verdict: v, confidence: 0.9,
  headline: lang === "fr" ? "Arnaque : ne payez rien, Chronopost ne demande jamais de frais par SMS." : "Scam: USPS never asks for a fee by text.",
  reasons: [{ text: lang === "fr" ? "Le lien mène à chronopost-suivi.test, pas à chronopost.fr." : "The link goes to usps-delivery.test, not usps.com.", evidence: "link" }],
  action: "delete", action_text: lang === "fr" ? "Supprimez-le. Si vous attendez un colis, ouvrez vous-même l'application." : "Delete it. If you expect a package, open the USPS app yourself.",
  real_company_says: null, impersonated_brand: lang === "fr" ? "Chronopost" : "USPS", scam_type: "parcel", matched_pattern_ids: [],
  escalate_to_guardian: false, guardian_summary: null, language: lang,
});
const sign = (raw, secret = ENV.WHATSAPP_APP_SECRET) => `sha256=${createHmac("sha256", secret).update(raw).digest("hex")}`;

async function routeApp({ env = ENV, channel } = {}) {
  const app = Fastify({ logger: false });
  await app.register(whatsappRoutes, { env, channel: channel || { handle: async () => [] } });
  return app;
}

test("Meta's verification handshake: the challenge comes back as plain text with the right token, 403 otherwise", async () => {
  const app = await routeApp();
  const ok = await app.inject({ url: "/api/whatsapp/webhook", query: { "hub.mode": "subscribe", "hub.verify_token": "verify-me", "hub.challenge": "1158201444" } });
  assert.equal(ok.statusCode, 200);
  assert.equal(ok.body, "1158201444");
  assert.match(ok.headers["content-type"], /^text\/plain/);
  assert.equal((await app.inject({ url: "/api/whatsapp/webhook", query: { "hub.mode": "subscribe", "hub.verify_token": "guess", "hub.challenge": "1" } })).statusCode, 403);
  assert.equal((await app.inject({ url: "/api/whatsapp/webhook", query: { "hub.mode": "unsubscribe", "hub.verify_token": "verify-me", "hub.challenge": "1" } })).statusCode, 403);
  assert.equal((await app.inject({ url: "/api/whatsapp/webhook" })).statusCode, 403);
  await app.close();
  const noToken = await routeApp({ env: { ...ENV, WHATSAPP_VERIFY_TOKEN: "" } });
  assert.equal((await noToken.inject({ url: "/api/whatsapp/webhook", query: { "hub.mode": "subscribe", "hub.verify_token": "", "hub.challenge": "1" } })).statusCode, 403, "no verify token set: nothing verifies");
  await noToken.close();
  assert.equal(verificationChallenge({ "hub.mode": "subscribe", "hub.verify_token": "verify-me" }, "verify-me"), "");
});

test("a delivery is accepted only with Meta's signature, refused while the app secret is unset, and 200 comes back before the work", async () => {
  const got = [];
  let release;
  const slow = new Promise((r) => { release = r; });
  const channel = { handle: async (body) => { got.push(body); await slow; } };
  const app = await routeApp({ channel });
  const raw = JSON.stringify(delivery(text("hello")));
  const headers = { "content-type": "application/json" };
  const signed = await app.inject({ method: "POST", url: "/api/whatsapp/webhook", payload: raw, headers: { ...headers, "x-hub-signature-256": sign(raw) } });
  assert.equal(signed.statusCode, 200, signed.body);
  assert.equal(signed.body, "EVENT_RECEIVED");
  assert.equal(got.length, 1, "the delivery reached the channel while it was still working");
  assert.equal(got[0].entry[0].changes[0].value.messages[0].text.body, "hello");
  release();
  assert.equal((await app.inject({ method: "POST", url: "/api/whatsapp/webhook", payload: raw, headers: { ...headers, "x-hub-signature-256": sign(raw, "other") } })).statusCode, 403, "wrong secret");
  assert.equal((await app.inject({ method: "POST", url: "/api/whatsapp/webhook", payload: raw, headers: { ...headers, "x-hub-signature-256": sign(`${raw} `) } })).statusCode, 403, "body changed");
  assert.equal((await app.inject({ method: "POST", url: "/api/whatsapp/webhook", payload: raw, headers })).statusCode, 403, "no header");
  assert.equal((await app.inject({ method: "POST", url: "/api/whatsapp/webhook", payload: "not json", headers: { ...headers, "x-hub-signature-256": sign("not json") } })).statusCode, 400);
  assert.equal(got.length, 1);
  await app.close();

  const noSecret = await routeApp({ env: { ...ENV, WHATSAPP_APP_SECRET: "" }, channel });
  const refused = await noSecret.inject({ method: "POST", url: "/api/whatsapp/webhook", payload: raw, headers: { ...headers, "x-hub-signature-256": sign(raw) } });
  assert.equal(refused.statusCode, 403, "no app secret: fail closed, whatever the header says");
  assert.match(refused.json().error, /WHATSAPP_APP_SECRET/);
  assert.equal(got.length, 1, "nothing reached the channel");
  const handshake = await noSecret.inject({ url: "/api/whatsapp/webhook", query: { "hub.mode": "subscribe", "hub.verify_token": "verify-me", "hub.challenge": "42" } });
  assert.equal(handshake.body, "42", "the handshake still works, so the dashboard can be wired before the secret is stored");
  await noSecret.close();
  assert.equal(verifySignature(raw, sign(raw), ""), false, "the pure check never passes without a secret");
  assert.equal(verifySignature(raw, "md5=abc", "s3cret"), false);
});

test("a text forwarded to Prudence gets exactly one reply, quoted under it: the verdict word, the reasons, one next step, who checked", async () => {
  const graph = fakeGraph();
  const channel = channelWith(graph);
  mock.script(verdict("scam"));
  const results = await channel.handle(delivery(text(USPS), { id: "wamid.text1" }));
  const replies = graph.replies();
  assert.equal(replies.length, 1);
  assert.equal(replies[0].messaging_product, "whatsapp");
  assert.equal(replies[0].to, SENDER);
  assert.equal(replies[0].type, "text");
  assert.deepEqual(replies[0].context, { message_id: "wamid.text1" });
  assert.equal(replies[0].authorization, "Bearer tok-123");
  const body = replies[0].text.body;
  assert.match(body, /^🔴 Scam\nUSPS never asks for a fee by text\./, body);
  assert.match(body, /Why:\n• The link goes to usps-delivery\.test, not usps\.com\./);
  assert.match(body, /What to do: Delete it\. If you expect a package, open the USPS app yourself\./);
  assert.match(body, /Checked with Mock LLM\.$/);
  assert.ok(!body.includes("forwarded"), "not forwarded: no forward line");
  assert.equal(graph.calls.filter((c) => c.url.endsWith("/messages")).length, 1);
  assert.match(graph.calls[0].url, /^https:\/\/graph\.facebook\.com\/v22\.0\/PHONE1\/messages$/);
  // The engine saw a WhatsApp message in English, judged on the message alone.
  assert.equal(mock.calls.length, 1);
  const prompt = mock.calls[0].messages[0].content;
  assert.ok(prompt.includes("<locale>en-US</locale>") && prompt.includes('"channel":"whatsapp"') && prompt.includes("redelivery fee"), prompt);
  assert.ok(prompt.includes('"sender_is_known":false') && prompt.includes('"providers":[]'), "no personal context");
  assert.deepEqual(results.map((r) => [r.id, r.type, r.lang, r.verdict]), [["wamid.text1", "text", "en", "scam"]]);
});

test("a forwarded message says so in the reply, and a chain message says that those are often scams", async () => {
  const graph = fakeGraph();
  const channel = channelWith(graph);
  mock.script(verdict("scam"), verdict("be_careful"));
  await channel.handle(delivery(text(USPS, { context: { forwarded: true } })));
  await channel.handle(delivery(text("Forward this to 10 friends or your WhatsApp will be closed tonight!", { context: { frequently_forwarded: true } })));
  const [once, many] = graph.replies().map((r) => r.text.body);
  assert.ok(once.includes("This message was forwarded to you."), once);
  assert.ok(!once.includes("many times"));
  assert.ok(many.includes("This message has been forwarded many times. Chain messages like this are often scams."), many);
  assert.match(many, /^🟠 Be careful/);
  // The engine sees the label WhatsApp shows, as the message's subject.
  assert.ok(mock.calls[0].messages[0].content.includes('"subject":"Forwarded message"'));
  assert.ok(mock.calls[1].messages[0].content.includes('"subject":"Forwarded many times"'));
  assert.deepEqual(parseWebhook(delivery(text("x", { context: { from: SENDER, id: "wamid.0" } }))).messages[0].forwarded, null, "a plain reply context is not a forward");
});

test("a picture goes through the screenshot path: downloaded with the token, read by Muse Spark, then judged like text", async () => {
  const graph = fakeGraph({ mediaMime: "image/jpeg", mediaBytes: Buffer.from("jpeg-bytes") });
  const channel = channelWith(graph);
  mock.script(
    { is_message: true, channel: "sms", sender_name: "USPS", sender: "+1 555 0100", subject: null, body: USPS, links: [{ text: "usps-delivery.test/pay", href: "usps-delivery.test/pay" }] },
    verdict("scam"),
  );
  const [r] = await channel.handle(delivery({ type: "image", image: { id: "MEDIA1", mime_type: "image/jpeg", sha256: "x" } }));
  assert.equal(r.verdict, "scam");
  const [lookup, download] = graph.calls;
  assert.equal(lookup.url, "https://graph.facebook.com/v22.0/MEDIA1");
  assert.equal(lookup.headers.authorization, "Bearer tok-123");
  assert.equal(download.url, CDN);
  assert.equal(download.headers.authorization, "Bearer tok-123");
  assert.equal(download.redirect, "manual", "the token never follows a redirect");
  const read = mock.calls[0].messages[0].content;
  assert.deepEqual(read[1], { type: "image", mime: "image/jpeg", base64: Buffer.from("jpeg-bytes").toString("base64") });
  assert.ok(mock.calls[1].messages[0].content.includes('"channel":"sms"') && mock.calls[1].messages[0].content.includes('"from_name":"USPS"'));
  assert.match(graph.replies()[0].text.body, /^🔴 Scam/);

  // Muse Spark failing on a harmless picture: the rules' Safe is withheld.
  mock.reset();
  mock.script({ is_message: true, channel: "sms", sender_name: "Mom", sender: null, subject: null, body: "See you Sunday for lunch, love you", links: [] }, new Error("Muse Spark 503: overloaded"));
  await channel.handle(delivery({ type: "image", image: { id: "MEDIA1", mime_type: "image/jpeg" } }));
  await channel.idle();
  assert.equal(graph.replies().at(-1).text.body, WORDS.en.failed);

  mock.reset();
  mock.script({ is_message: false, channel: "other", sender_name: null, sender: null, subject: null, body: "", links: [] });
  await channel.handle(delivery({ type: "image", image: { id: "MEDIA1", mime_type: "image/jpeg" } }));
  assert.equal(graph.replies().at(-1).text.body, "I could not find a message in this picture.");
  assert.equal(mock.calls.length, 1, "nothing to judge");

  const noMuse = fakeGraph();
  delete process.env.LLM_PROVIDER; // Muse Spark not switched on (no META_MODEL_API_KEY either)
  await channelWith(noMuse).handle(delivery({ type: "image", image: { id: "MEDIA1", mime_type: "image/jpeg" } }));
  assert.equal(noMuse.replies()[0].text.body, WORDS.en.needsMuse);
  assert.equal(noMuse.calls.length, 1, "no download without the model");
});

test("the token goes only to a Graph-returned https URL on Meta's media host: a url in the payload is ignored, any other host is refused", async () => {
  assert.equal(mediaUrl(CDN), CDN);
  assert.throws(() => mediaUrl("http://lookaside.fbsbx.com/whatsapp_business/attachments/?mid=1"), /not https/);
  assert.throws(() => mediaUrl("https://evil.example/collect"), /host evil\.example is not Meta's media CDN/);
  assert.throws(() => mediaUrl("https://lookaside.fbsbx.com.evil.example/x"), /not Meta's media CDN/);
  assert.throws(() => mediaUrl("https://user:pw@lookaside.fbsbx.com/x"), /credentials/);
  assert.throws(() => mediaUrl(""), /unreadable/);
  // The payload says where the bytes are; the channel does not listen.
  const graph = fakeGraph();
  mock.script({ is_message: true, channel: "sms", sender_name: "USPS", sender: null, subject: null, body: USPS, links: [] }, verdict("scam"));
  await channelWith(graph).handle(delivery({ type: "image", image: { id: "MEDIA1", mime_type: "image/jpeg", url: "https://evil.example/steal-the-token" } }));
  assert.ok(graph.calls.every((c) => !c.url.includes("evil.example")), graph.calls.map((c) => c.url).join("\n"));
  assert.deepEqual(graph.calls.slice(0, 2).map((c) => c.url), ["https://graph.facebook.com/v22.0/MEDIA1", CDN]);
  assert.deepEqual(parseWebhook(delivery({ type: "image", image: { id: "M", url: "https://evil.example/x" } })).messages[0].media, { id: "M", mime: "", filename: "", voice: false });
  // A lookup that points elsewhere ends the check: no bytes, no token, the senior told not to click.
  const elsewhere = fakeGraph({ mediaUrl: "https://evil.example/collect?mid=MEDIA1" });
  const [r] = await channelWith(elsewhere).handle(delivery({ type: "image", image: { id: "MEDIA1", mime_type: "image/jpeg" } }));
  assert.match(r.error, /host evil\.example is not Meta's media CDN/);
  assert.deepEqual(elsewhere.calls.map((c) => c.url.split("?")[0]), ["https://graph.facebook.com/v22.0/MEDIA1", "https://graph.facebook.com/v22.0/PHONE1/messages"]);
  assert.equal(elsewhere.replies()[0].text.body, WORDS.en.failed);
  // No media id: nothing to look up, the plain reply.
  const noId = fakeGraph();
  await channelWith(noId).handle(delivery({ type: "image", image: { mime_type: "image/jpeg", url: CDN } }));
  assert.equal(noId.replies()[0].text.body, WORDS.en.onlyTypes);
  assert.equal(noId.calls.length, 1);
});

test("a voice note goes through the voice path: ffmpeg to WAV, Muse Voice Transcribe, then the verdict with the words quoted", async () => {
  const heard = "Grandma it's me, I had an accident and I'm in jail. Please buy $2,000 in gift cards today and don't tell mom.";
  const ogg = Buffer.from("OggS-opus-bytes");
  const wav = Buffer.concat([Buffer.from("RIFF\x24\x00\x00\x00WAVEfmt ", "latin1"), Buffer.alloc(64)]);
  const graph = fakeGraph({ mediaMime: "audio/ogg", mediaBytes: ogg, transcript: heard });
  let transcoded = null;
  const channel = channelWith(graph, { transcode: async (buf) => { transcoded = buf; return wav; } });
  process.env.META_MODEL_API_KEY = "test-key";
  mock.script({ ...verdict("scam"), headline: "Scam: this is the grandchild-in-trouble scam.", reasons: [{ text: "It asks for gift cards and secrecy.", evidence: "payment" }], action: "verify_with_real_person", action_text: "Call your grandson on the number you already have." });
  const [r] = await channel.handle(delivery({ type: "audio", audio: { id: "MEDIA1", mime_type: "audio/ogg; codecs=opus", sha256: "x", voice: true } }));
  assert.equal(r.verdict, "scam");
  assert.ok(transcoded?.equals(ogg), "the downloaded Ogg/Opus bytes went to ffmpeg");
  const asr = graph.calls.find((c) => c.url.includes("/asr/transcribe"));
  assert.equal(asr.method, "POST");
  assert.equal(asr.headers.authorization, "Bearer test-key");
  assert.ok(asr.body instanceof FormData && asr.body.get("audio").type === "audio/wav" && asr.body.get("audio").size === wav.length);
  assert.ok(mock.calls[0].messages[0].content.includes('"channel":"voice_transcript"') && mock.calls[0].messages[0].content.includes("gift cards"));
  const body = graph.replies()[0].text.body;
  assert.match(body, /^🔴 Scam\nThis is the grandchild-in-trouble scam\./);
  assert.ok(body.includes(`What the voice note says: "${heard}"`), body);
  assert.ok(body.includes("What to do: Call your grandson on the number you already have."));

  const silent = fakeGraph({ mediaMime: "audio/ogg", mediaBytes: ogg, transcript: "" });
  await channelWith(silent, { transcode: async () => wav }).handle(delivery({ type: "audio", audio: { id: "MEDIA1", mime_type: "audio/ogg" } }));
  assert.equal(silent.replies()[0].text.body, "I could not hear any words in this voice note.");

  delete process.env.META_MODEL_API_KEY;
  const noKey = fakeGraph();
  await channelWith(noKey).handle(delivery({ type: "audio", audio: { id: "MEDIA1", mime_type: "audio/ogg" } }));
  assert.equal(noKey.replies()[0].text.body, WORDS.en.needsMuse);
  assert.equal(noKey.calls.length, 1, "no download without Muse Voice Transcribe");
});

test("a message delivered twice is answered once; delivery receipts get no reply", async () => {
  const graph = fakeGraph();
  const channel = channelWith(graph);
  mock.script(verdict("scam"), verdict("scam"));
  const again = delivery(text(USPS), { id: "wamid.same" });
  const first = await channel.handle(again);
  const second = await channel.handle(structuredClone(again));
  assert.equal(first[0].verdict, "scam");
  assert.equal(second[0].skipped, "duplicate");
  assert.equal(graph.replies().length, 1);
  assert.equal(mock.calls.length, 1);
  const receipts = { object: "whatsapp_business_account", entry: [{ id: "WABA1", changes: [{ field: "messages", value: { messaging_product: "whatsapp",
    statuses: [{ id: "wamid.reply.1", status: "delivered", timestamp: "1761750001", recipient_id: SENDER }] } }] }] };
  assert.deepEqual(parseWebhook(receipts), { messages: [], statuses: 1 });
  assert.deepEqual(await channel.handle(receipts), []);
  assert.equal(graph.replies().length, 1);
  const seen = createSeen({ cap: 2 });
  seen.add("a"); seen.add("b"); seen.add("c");
  assert.ok(!seen.has("a") && seen.has("c"), "the oldest id falls out past the cap");
});

test("a sticker, a video, a PDF or an unknown type gets the plain 'texts, pictures and voice notes' reply; a reaction gets nothing", async () => {
  const graph = fakeGraph();
  const channel = channelWith(graph);
  const results = await Promise.all([
    channel.handle(delivery({ type: "sticker", sticker: { id: "M2", mime_type: "image/webp", animated: false } })),
    channel.handle(delivery({ type: "video", video: { id: "M3", mime_type: "video/mp4" } })),
    channel.handle(delivery({ type: "document", document: { id: "M4", mime_type: "application/pdf", filename: "facture.pdf" } })),
    channel.handle(delivery({ type: "unsupported", errors: [{ code: 131051, title: "Unsupported message type" }] })),
    channel.handle(delivery({ type: "reaction", reaction: { message_id: "wamid.reply.1", emoji: "👍" } })),
  ]);
  assert.deepEqual(graph.replies().map((r) => r.text.body), Array(4).fill("I can only check texts, pictures and voice notes for now."));
  assert.equal(results[4][0].skipped, "reaction");
  assert.equal(mock.calls.length, 0, "nothing was judged");
  // A picture sent as a file is still a picture.
  mock.script({ is_message: true, channel: "whatsapp", sender_name: "Maman", sender: null, subject: null, body: "Coucou, tu viens dimanche ?", links: [] }, { ...verdict("safe", "fr"), headline: "Rassurez-vous : un message ordinaire.", reasons: [{ text: "Rien n'est demandé.", evidence: "personal_context" }], action: "do_nothing", action_text: "Rien à faire.", impersonated_brand: null, scam_type: null });
  await channel.handle(delivery({ type: "document", document: { id: "MEDIA1", mime_type: "image/jpeg", filename: "IMG_0001.jpg" } }));
  assert.match(graph.replies().at(-1).text.body, /^🟢 Rassurant\nUn message ordinaire\./);
});

test("the reply is in the senior's language: French words, or a +33 number when the words do not say", async () => {
  assert.equal(detectLanguage("Chronopost : votre colis est en attente. Réglez 1,99 € ici", SENDER), "fr");
  assert.equal(detectLanguage(USPS, "33612345678"), "en", "the words win over the number");
  assert.equal(detectLanguage("", "33612345678"), "fr");
  assert.equal(detectLanguage("", "+33612345678"), "fr");
  assert.equal(detectLanguage("", SENDER), "en");
  assert.equal(detectLanguage("ok merci", SENDER), "fr");
  assert.equal(detectLanguage("Coucou, tu viens dimanche ?", SENDER), "fr");
  assert.equal(detectLanguage("Hi Grandma, it's Ethan, new number, can you send $300 today?", "33612345678"), "en");
  const graph = fakeGraph();
  const channel = channelWith(graph);
  mock.script(verdict("scam", "fr"));
  const [r] = await channel.handle(delivery(text("Chronopost : votre colis est en attente. Réglez 1,99 € ici : https://chronopost-suivi.test/payer", { context: { forwarded: true } }), { from: "33612345678" }));
  assert.equal(r.lang, "fr");
  assert.ok(mock.calls[0].messages[0].content.includes("<locale>fr-FR</locale>"));
  const body = graph.replies()[0].text.body;
  assert.match(body, /^🔴 Arnaque\nNe payez rien, Chronopost ne demande jamais de frais par SMS\./, body);
  assert.ok(body.includes("Pourquoi :\n• Le lien mène à") && body.includes("Que faire : Supprimez-le.") && body.includes("Ce message vous a été transféré.") && body.includes("Vérifié avec Mock LLM."), body);
});

test("a sender gets ten checks a minute: the eleventh gets one 'please wait', then silence until the minute passes", async () => {
  let now = 1_000_000;
  const graph = fakeGraph();
  const channel = channelWith(graph, { limiter: createLimiter({ max: 2, windowMs: 60000, now: () => now }) });
  mock.respondWith(() => verdict("scam"));
  const results = [];
  for (let i = 0; i < 4; i++) results.push((await channel.handle(delivery(text(USPS))))[0]);
  assert.deepEqual(results.map((r) => r.skipped || r.verdict), ["scam", "scam", "rate_limited", "rate_limited"]);
  const bodies = graph.replies().map((r) => r.text.body);
  assert.equal(bodies.length, 3);
  assert.equal(bodies[2], "Please wait a minute before sending another message.");
  const other = (await channel.handle(delivery(text(USPS), { from: "15551230199" })))[0];
  assert.equal(other.verdict, "scam", "another sender is not held back");
  now += 61_000;
  assert.equal((await channel.handle(delivery(text(USPS))))[0].verdict, "scam");
  assert.equal(graph.replies().length, 5);
});

test("when something fails on our side the senior is told not to click; when only the model is down the rules still answer", async () => {
  const broken = fakeGraph({ lookupStatus: 500 });
  const channel = channelWith(broken);
  const [r] = await channel.handle(delivery({ type: "image", image: { id: "MEDIA1", mime_type: "image/jpeg" } }));
  assert.match(r.error, /media lookup 500/);
  assert.equal(broken.replies()[0].text.body, "Something went wrong on our side. To be safe, do not click anything in the message.");
  const big = fakeGraph({ mediaBytes: Buffer.alloc(9 * 1024 * 1024) });
  await channelWith(big).handle(delivery({ type: "image", image: { id: "MEDIA1", mime_type: "image/jpeg" } }));
  assert.equal(big.replies()[0].text.body, WORDS.en.tooBig);
  assert.equal(big.calls.length, 2, "the size is known before the download");

  const graph = fakeGraph();
  mock.script(new Error("model down"));
  const [d] = await channelWith(graph).handle(delivery(text(USPS)));
  assert.equal(d.verdict, "scam", "the detector's verdict on the USPS fee text");
  const body = graph.replies()[0].text.body;
  assert.match(body, /^🔴 Scam\nDo not click, pay, or reply to this\./, body);
  assert.match(body, /Checked with Prudence's rules \(Mock LLM was not available\)\.$/);
  // The reply call itself failing is logged, never thrown into the webhook.
  const dead = async (url, init) => (/\/messages$/.test(String(url)) ? new Response(JSON.stringify({ error: { message: "(#131030) Recipient phone number not in allowed list" } }), { status: 400 }) : graph(url, init));
  mock.script(verdict("scam"));
  const [e] = await channelWith(dead).handle(delivery(text(USPS)));
  assert.match(e.error, /WhatsApp send 400: \(#131030\)/);
});

test("the reply reads as one verdict, the reasons, one step: the headline's own word is not repeated, long notes are cut", () => {
  const safe = { verdict: "safe", headline: "Safe: this looks like a genuine message.", reasons: [{ text: "Nothing is asked of you.", evidence: "personal_context" }], action: "do_nothing", action_text: "Nothing to do.", source: "Muse Spark (muse-spark-1.3)" };
  assert.equal(formatReply(safe, { lang: "en", label: "Muse Spark" }),
    "🟢 Safe\nThis looks like a genuine message.\n\nWhy:\n• Nothing is asked of you.\n\nWhat to do: Nothing to do.\n\nChecked with Meta's Muse Spark.");
  const fr = formatReply({ ...safe, headline: "Rassurez-vous : ce message semble authentique.", reasons: [], action_text: "" }, { lang: "fr", label: "Muse Spark", forwarded: "once" });
  assert.equal(fr, "🟢 Rassurant\nCe message semble authentique.\n\nCe message vous a été transféré.\n\nVérifié avec Muse Spark de Meta.");
  const long = formatReply({ ...safe, reasons: Array(5).fill({ text: "r" }) }, { lang: "en", transcript: "a".repeat(500), label: "Muse Spark" });
  assert.equal((long.match(/• r/g) || []).length, 3, "three reasons at most");
  assert.ok(long.includes(`What the voice note says: "${"a".repeat(199)}…"`));
  assert.ok(formatReply({ ...safe, action_text: "x".repeat(5000) }, { label: "Muse Spark" }).length <= 4000);
});

test("the shipped pattern cards are the default evidence when no live cards are available", async () => {
  const cards = await shippedCards();
  assert.ok(Array.isArray(cards) && cards.length > 0 && cards.every((c) => c.id));
  assert.equal(await shippedCards(), cards, "read once");
});

test("ffmpeg turns an Ogg/Opus voice note into 16 kHz mono 16-bit WAV with real sizes in the header", { skip: !ffmpegWithOpus() }, async () => {
  const made = spawnSync("ffmpeg", ["-hide_banner", "-loglevel", "error", "-f", "lavfi", "-i", "sine=frequency=440:duration=0.5", "-c:a", "libopus", "-f", "ogg", "pipe:1"], { maxBuffer: 16 * 1024 * 1024 });
  assert.equal(made.status, 0, made.stderr?.toString());
  const wav = await ffmpegToWav(made.stdout);
  assert.equal(wav.toString("ascii", 0, 4), "RIFF");
  assert.equal(wav.toString("ascii", 8, 12), "WAVE");
  assert.equal(wav.readUInt16LE(22), 1, "mono");
  assert.equal(wav.readUInt32LE(24), 16000, "16 kHz");
  assert.equal(wav.readUInt16LE(34), 16, "16-bit");
  assert.equal(wav.readUInt32LE(4), wav.length - 8, "RIFF size patched");
  await assert.rejects(ffmpegToWav(Buffer.from("not audio")), /ffmpeg exited/);
  await assert.rejects(ffmpegToWav(made.stdout, { ffmpegPath: "/nonexistent/ffmpeg" }), /ffmpeg not available/);
});

test("a WAV from a pipe gets its RIFF and data sizes written; anything else passes through", () => {
  const pcm = Buffer.alloc(100, 1);
  const header = Buffer.alloc(44);
  header.write("RIFF", 0, "ascii"); header.writeUInt32LE(0xFFFFFFFF, 4); header.write("WAVE", 8, "ascii");
  header.write("fmt ", 12, "ascii"); header.writeUInt32LE(16, 16);
  header.write("data", 36, "ascii"); header.writeUInt32LE(0xFFFFFFFF, 40);
  const fixed = fixWavSizes(Buffer.concat([header, pcm]));
  assert.equal(fixed.readUInt32LE(4), 144 - 8);
  assert.equal(fixed.readUInt32LE(40), 100);
  const list = Buffer.alloc(12); list.write("LIST", 0, "ascii"); list.writeUInt32LE(4, 4); list.write("INFO", 8, "ascii");
  const withList = fixWavSizes(Buffer.concat([header.subarray(0, 36), list, header.subarray(36), pcm]));
  assert.equal(withList.readUInt32LE(48 + 4), 100, "the data chunk is found past a LIST chunk");
  const other = Buffer.from("OggS");
  assert.equal(fixWavSizes(other), other);
});

test("the server starts without the WhatsApp keys: the webhook answers 501, the handshake 403, and the rest parses JSON as before", async () => {
  assert.equal(whatsappConfigured(process.env), false);
  const app = await buildApp({ logger: false });
  try {
    const post = await app.inject({ method: "POST", url: "/api/whatsapp/webhook", payload: delivery(text(USPS)) });
    assert.equal(post.statusCode, 501, "no Origin header needed, no keys: inactive");
    assert.match(post.json().error, /WHATSAPP_ACCESS_TOKEN/);
    assert.equal((await app.inject({ url: "/api/whatsapp/webhook", query: { "hub.mode": "subscribe", "hub.verify_token": "x", "hub.challenge": "1" } })).statusCode, 403);
    const demo = await app.inject({ method: "POST", url: "/api/demo/check", headers: { origin: "http://localhost:3999" }, payload: { id: "nope" } });
    assert.equal(demo.statusCode, 404, "other routes still read their JSON body");
    assert.equal(demo.json().error, "unknown example");
  } finally {
    await app.close();
  }
});

function ffmpegWithOpus() {
  const r = spawnSync("ffmpeg", ["-hide_banner", "-encoders"], { encoding: "utf8" });
  return r.status === 0 && /\blibopus\b/.test(r.stdout || "");
}
