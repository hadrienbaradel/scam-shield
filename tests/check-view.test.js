// The Check screens' pure helpers (public/js/views/check.js;
// _product/specs/protection-menu.md, Behavior line 5 and frames 1g to 1n):
// what the chips of "Paste the words" send, and the plain words a failed
// check shows instead of the server's own error. No database, no browser.
import { test } from "node:test";
import assert from "node:assert/strict";
import { STRINGS, setLang } from "../public/js/i18n.js";
import { ApiError } from "../public/js/api.js";
import { WHO, WHERE, pasteRequest, checkProblem, firstName } from "../public/js/views/check.js";

const inLang = (lang, fn) => {
  globalThis.document = { documentElement: {} }; // setLang records the language on <html>
  try { setLang(lang); return fn(); } finally { setLang("en"); delete globalThis.document; }
};

test("Paste the words sends the words, where they came from as the channel and who sent them as a name, never as an address, and no subject", () => {
  assert.deepEqual(pasteRequest({ text: "Your parcel is waiting. Pay $1.99: https://usps-redeliver.test" }),
    { channel: "sms", from: "", fromName: "", body: "Your parcel is waiting. Pay $1.99: https://usps-redeliver.test" },
    "the defaults of frame 1i: I don't know, Text message");
  const where = Object.fromEntries(WHERE.map((w) => [w.key, pasteRequest({ text: "x", where: w.key }).channel]));
  assert.deepEqual(where, { sms: "sms", whatsapp: "whatsapp", facebook: "social", letter: "letter", other: "other" });
  const who = Object.fromEntries(WHO.map((w) => [w.key, pasteRequest({ text: "x", who: w.key }).fromName]));
  assert.deepEqual(who, { bank: "My bank", company: "A company", known: "Someone I know", unknown: "" });
  assert.equal(inLang("fr", () => pasteRequest({ text: "x", who: "bank" }).fromName), "Ma banque", "in the senior's language");
  assert.deepEqual(pasteRequest({ text: "x", who: "nobody", where: "fax" }), { channel: "sms", from: "", fromName: "", body: "x" }, "an unknown chip falls back to the defaults");
});

test("a check that could not run says so in plain words with Try again; never fetch failed or a status code", () => {
  const unreachable = new ApiError(500, { statusCode: 500, error: "Internal Server Error", message: "fetch failed" });
  assert.equal(unreachable.message, "fetch failed", "what the old page showed the senior");
  for (const [why, e] of [
    ["the model unreachable (Nov 3)", unreachable],
    ["the picture route's plain 502", new ApiError(502, { error: "image_failed", message: "We could not read this picture right now." })],
    ["the voice route's 502", new ApiError(502, { error: "voice_failed" })],
    ["too many checks in a minute", new ApiError(429, { error: "Too Many Requests", message: "Rate limit exceeded, retry in 1 minute" })],
    ["no network", new TypeError("Failed to fetch")],
  ]) for (const kind of ["text", "image", "voice", "eml"]) assert.deepEqual(checkProblem(e, kind), { key: "ck_failed", retry: true }, `${why}, ${kind}`);
  assert.equal(checkProblem(new DOMException("The user aborted a request.", "AbortError"), "image"), null, "Stop says nothing");
  assert.deepEqual(checkProblem(new ApiError(401, {}), "text"), { signedOut: true });
});

test("a picture, a recording or a file that cannot be used sends the senior back to choose another, with one sentence saying why", () => {
  const cases = [
    [new ApiError(422, { error: "no_message" }), "image", "photo_none"],
    [new ApiError(422, { error: "no_message" }), "eml", "ck_eml_none"],
    [new ApiError(422, { error: "no_speech" }), "voice", "voice_none"],
    [new ApiError(503, { error: "screenshots_need_muse" }), "image", "photo_needs_muse"],
    [new ApiError(503, { error: "voice_needs_muse" }), "voice", "voice_needs_muse"],
    [new ApiError(400, { error: "Please choose a PNG or JPEG picture." }), "image", "ck_photo_unreadable"],
    [new ApiError(413, { error: "Payload Too Large" }), "image", "ck_photo_unreadable"],
    [new ApiError(400, { error: "wav_not_mono" }), "voice", "voice_unreadable"],
    [Object.assign(new Error("unreadable"), { code: "unreadable" }), "voice", "voice_unreadable"],
    [Object.assign(new Error("unreadable"), { code: "unreadable" }), "image", "ck_photo_unreadable"],
    [new ApiError(400, { error: "Please choose an email file (.eml)." }), "eml", "ck_eml_none"],
    [new ApiError(400, { error: "Paste the message text first." }), "text", "ck_paste_empty"],
  ];
  for (const [e, kind, key] of cases) assert.deepEqual(checkProblem(e, kind), { key, retry: false }, `${kind}: ${e.message}`);
});

test("every word the Check screens can show exists in English and French", () => {
  const keys = new Set(["ck_failed", "ck_failed_note", "ck_listening", "ck_paste_empty", "ck_photo_unreadable", "ck_eml_none",
    "photo_none", "voice_none", "voice_unreadable", "photo_needs_muse", "voice_needs_muse", "voice_heard", "voice_lead", "voice_btn",
    "eml_title", "eml_lead", "eml_btn", "channel_q", "retry", "v2_read", "v2_read_short", "v2_tab_check",
    ...WHO.map((w) => w.label), ...WHERE.map((w) => w.label)]);
  for (const key of keys) for (const lang of ["en", "fr"]) assert.ok(STRINGS[lang][key], `${lang}.${key}`);
  for (const lang of ["en", "fr"]) assert.doesNotMatch(`${STRINGS[lang].ck_failed} ${STRINGS[lang].ck_failed_note}`, /fetch|error|erreur|\d{3}/i, `${lang}: plain words`);
});

test("Ask uses the trusted person's first name", () => {
  assert.equal(firstName("Thomas Martin"), "Thomas");
  assert.equal(firstName("  "), "");
  assert.equal(firstName(undefined), "");
});
