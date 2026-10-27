// Muse Spark layer against a fake Meta Model API.
import "./helpers/env.js";
import { test, afterEach } from "node:test";
import assert from "node:assert/strict";
import { checkMessage, extractFromImage, compactContext } from "../lib/muse.js";

const realFetch = globalThis.fetch;
afterEach(() => { globalThis.fetch = realFetch; delete process.env.META_MODEL_API_KEY; delete process.env.META_MODEL_NAME; });

const verdict = (v) => ({ verdict: v, confidence: 0.9, headline: "x", reasons: [{ text: "r", evidence: "sender" }], action: "delete", action_text: "a",
  real_company_says: null, impersonated_brand: null, scam_type: null, matched_pattern_ids: [], escalate_to_guardian: false, guardian_summary: null, language: "en" });
function fakeApi(content, { status = 200, capture } = {}) {
  process.env.META_MODEL_API_KEY = "test-key";
  globalThis.fetch = async (url, opts) => {
    capture?.push({ url, body: JSON.parse(opts.body), headers: opts.headers });
    return new Response(JSON.stringify(status === 200 ? { choices: [{ message: { content: JSON.stringify(content) } }], usage: { total_tokens: 1234 } } : { error: { message: "bad" } }), { status });
  };
}

const PASS = "spf=pass dkim=pass dmarc=pass";
const ctx = { userName: "Linda", knownSenders: [{ email: "statements@chase.com" }], providers: [{ type: "bank", name: "Chase", realDomains: ["chase.com"] }],
  trustedContacts: [{ name: "Ethan", email: "ethan@example.test", phone: "+1 555-0142", relation: "grandson" }], orders: [], breaches: [], subscriptions: [], knownLinkDomains: [] };
const realChase = { channel: "email", fromName: "Chase", from: "statements@chase.com", auth: PASS, subject: "Your statement is ready", body: "Your October statement is ready.", links: [] };
const fakeChase = { channel: "email", fromName: "Chase", from: "secure@chase-verify.top", auth: "spf=fail dkim=none dmarc=fail", subject: "Account locked", body: "Confirm your password now.", links: [{ text: "chase.com", href: "https://chase-verify.top/login" }] };

test("calls api.meta.ai chat completions with muse-spark-1.3 and a JSON schema", async () => {
  const capture = [];
  fakeApi(verdict("safe"), { capture });
  const v = await checkMessage({ locale: "en-US", message: realChase, personalContext: ctx, patternCards: [] });
  assert.equal(capture[0].url, "https://api.meta.ai/v1/chat/completions");
  assert.equal(capture[0].body.model, "muse-spark-1.3");
  assert.equal(capture[0].body.response_format.type, "json_schema");
  assert.equal(capture[0].headers.authorization, "Bearer test-key");
  assert.match(v.source, /Muse Spark \(muse-spark-1\.3\)/);
  assert.equal(v.usage.total_tokens, 1234);
});

test("guardrail: the model cannot clear what the evidence proves is a scam", async () => {
  fakeApi(verdict("safe"));
  const v = await checkMessage({ locale: "en-US", message: fakeChase, personalContext: ctx, patternCards: [] });
  assert.equal(v.verdict, "be_careful");
});

test("guardrail: the model cannot condemn an authenticated sender from the user's history", async () => {
  fakeApi(verdict("scam"));
  const v = await checkMessage({ locale: "en-US", message: realChase, personalContext: ctx, patternCards: [] });
  assert.equal(v.verdict, "be_careful");
});

test("Contributor-mode models are refused; the detector answers instead", async () => {
  const capture = [];
  fakeApi(verdict("safe"), { capture });
  process.env.META_MODEL_NAME = "muse-spark-1.3-contributor";
  const v = await checkMessage({ locale: "en-US", message: fakeChase, personalContext: ctx, patternCards: [] });
  assert.equal(capture.length, 0, "no request may leave in Contributor mode");
  assert.match(v.source, /detector/);
  assert.match(v.error, /Contributor/);
  assert.equal(v.verdict, "scam");
});

test("API errors and invalid JSON fall back to the detector", async () => {
  fakeApi(null, { status: 500 });
  assert.match((await checkMessage({ locale: "en-US", message: fakeChase, personalContext: ctx })).source, /unavailable/);
  fakeApi({ verdict: "maybe" });
  assert.match((await checkMessage({ locale: "en-US", message: fakeChase, personalContext: ctx })).source, /unavailable/);
});

test("retries without response_format when the endpoint rejects it", async () => {
  process.env.META_MODEL_API_KEY = "k";
  const bodies = [];
  globalThis.fetch = async (url, opts) => {
    const body = JSON.parse(opts.body);
    bodies.push(body);
    if (body.response_format) return new Response(JSON.stringify({ error: { message: "response_format not supported" } }), { status: 400 });
    return new Response(JSON.stringify({ choices: [{ message: { content: `Here: ${JSON.stringify(verdict("be_careful"))}` } }] }), { status: 200 });
  };
  const v = await checkMessage({ locale: "en-US", message: fakeChase, personalContext: ctx });
  assert.equal(bodies.length, 2);
  assert.equal(v.verdict, "be_careful");
  assert.match(v.source, /Muse Spark/);
});

test("screenshot transcription sends the image and returns a checkable message", async () => {
  const capture = [];
  fakeApi({ is_message: true, channel: "sms", sender_name: null, sender: "+1 555 0199", subject: null,
    body: "USPS: package on hold, pay $1.99", links: [{ text: "usps-redeliver.top/pay", href: "usps-redeliver.top/pay" }] }, { capture });
  const out = await extractFromImage({ imageBase64: "aGVsbG8=", mime: "image/png" });
  assert.equal(capture[0].body.messages[1].content[1].image_url.url, "data:image/png;base64,aGVsbG8=");
  assert.equal(out.message.channel, "sms");
  assert.equal(out.message.links[0].href, "https://usps-redeliver.top/pay");
});

test("the model never receives trusted contacts' phone numbers", () => {
  const c = compactContext(ctx, realChase);
  assert.equal(c.trustedContacts[0].phone, undefined);
  assert.equal(c.knownSenders[0].email, "statements@chase.com");
});
