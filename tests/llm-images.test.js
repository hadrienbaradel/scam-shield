// lib/llm photos (ad studio, _product/specs/ad-studio.md lines 4 and 9):
// Muse Image and any OpenAI-style images endpoint, request shapes for making
// and editing a photo, the retry on 503, the safety refusal, errors that
// never carry a key, and the shared mock. Every fetch is injected: no network.
import "./helpers/env.js";
import { test, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import {
  generateImage, editImage, imageConfigured, imageModel, imageLabel, imageProviderName, getImageProvider, getProvider, IMAGE_PROVIDER_NAMES,
} from "../lib/llm/index.js";
import { createMetaImages, createOpenAiImages, sniffMime, nearestStandardSize, titleOf } from "../lib/llm/images.js";
import { TINY_JPEG } from "../lib/llm/mock.js";

const ENV = ["IMAGE_PROVIDER", "IMAGE_MODEL", "IMAGE_BASE_URL", "META_MODEL_API_KEY", "META_MODEL_BASE_URL", "OPENAI_API_KEY", "LLM_PROVIDER"];
const clean = () => { for (const k of ENV) delete process.env[k]; getProvider("mock").reset(); };
beforeEach(clean);
afterEach(clean);

const PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(8)]);
const b64 = (buf) => buf.toString("base64");
const answer = (...bufs) => ({ status: 200, json: { created: 1, data: bufs.map((b) => ({ b64_json: b64(b) })), output_format: "jpeg", background: "opaque", usage: {} } });
const fail = (status, message, extra = {}) => ({ status, json: { error: { message, ...extra } } });

// Records every request (the JSON body parsed, or the FormData as is) and
// answers from a script: { status, json } | { status, text } | { status, bytes },
// or a function of (request, n); the last entry repeats.
function fakeFetch(script) {
  const calls = [];
  const queue = [].concat(script);
  const fetchImpl = async (url, opts = {}) => {
    const body = typeof opts.body === "string" ? JSON.parse(opts.body) : opts.body;
    const call = { url, opts, body, headers: opts.headers || {}, signal: opts.signal };
    calls.push(call);
    const next = queue.length > 1 ? queue.shift() : queue[0];
    const r = typeof next === "function" ? next(call, calls.length) : next;
    if (r instanceof Error) throw r;
    if (r.bytes) return new Response(r.bytes, { status: r.status || 200 });
    return new Response(r.text ?? JSON.stringify(r.json), { status: r.status });
  };
  return { fetchImpl, calls };
}

test("selection: Muse Image on the Meta Model API is the default photo maker; IMAGE_PROVIDER and IMAGE_MODEL change it", () => {
  assert.equal(imageProviderName(), "meta");
  assert.equal(imageModel(), "muse-image-1.0");
  assert.equal(imageLabel(), "Muse Image 1.0");
  assert.equal(imageConfigured(), false, "no key, no photos");
  process.env.META_MODEL_API_KEY = "k";
  assert.equal(imageConfigured(), true);
  assert.equal(imageConfigured("muse"), true, "alias");
  process.env.IMAGE_MODEL = "muse-image-1.1";
  assert.equal(imageLabel(), "Muse Image 1.1");
  delete process.env.IMAGE_MODEL;
  process.env.IMAGE_PROVIDER = "openai";
  assert.equal(imageModel(), "gpt-image-1");
  assert.equal(imageLabel(), "gpt-image-1");
  assert.equal(imageConfigured(), false, "Meta's key is never OpenAI's");
  process.env.IMAGE_BASE_URL = "http://localhost:8080/v1";
  assert.equal(imageConfigured(), true, "a self-hosted endpoint needs no key");
  delete process.env.IMAGE_BASE_URL;
  process.env.OPENAI_API_KEY = "o";
  assert.equal(imageConfigured(), true);
  process.env.IMAGE_PROVIDER = "mock";
  assert.equal(imageConfigured(), true);
  assert.equal(imageLabel(), "Mock Image");
  assert.equal(getImageProvider(), getProvider("mock"), "one shared mock for words and photos");
  assert.deepEqual(IMAGE_PROVIDER_NAMES, ["meta", "openai", "mock"]);
  process.env.IMAGE_PROVIDER = "nope";
  assert.throws(() => getImageProvider(), /Unknown image provider "nope"/);
  const warn = console.warn;
  const warned = [];
  console.warn = (m) => warned.push(m);
  try {
    assert.equal(imageConfigured(), false);
    assert.equal(imageConfigured(), false);
    assert.equal(warned.length, 1, "said once");
  } finally { console.warn = warn; }
  assert.equal(imageLabel(), "Image model");
});

test("meta: a photo is asked as JSON (model, prompt, n, size 1080x1350, jpeg) with the key as a bearer, and comes back as bytes", async () => {
  process.env.META_MODEL_API_KEY = "test-key";
  const { fetchImpl, calls } = fakeFetch(answer(TINY_JPEG));
  const signal = new AbortController().signal;
  const out = await createMetaImages({ fetchImpl }).generateImage({ prompt: "a daughter and her mother at a kitchen table", signal });
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, "https://api.meta.ai/v1/images/generations");
  assert.equal(calls[0].opts.method, "POST");
  assert.deepEqual(calls[0].headers, { "content-type": "application/json", authorization: "Bearer test-key" });
  assert.deepEqual(calls[0].body, { model: "muse-image-1.0", prompt: "a daughter and her mother at a kitchen table", n: 1, size: "1080x1350", output_format: "jpeg", response_format: "b64_json" });
  assert.equal(calls[0].signal, signal, "the caller's signal goes through");
  assert.equal(out.images.length, 1);
  assert.ok(out.images[0].bytes.equals(TINY_JPEG));
  assert.equal(out.images[0].mime, "image/jpeg");
  assert.deepEqual({ model: out.model, provider: out.provider, label: out.label }, { model: "muse-image-1.0", provider: "meta", label: "Muse Image 1.0" });
});

test("meta: an edit sends the photo as a data URL in images[], no mask, the size only when asked; the base address can move", async () => {
  process.env.META_MODEL_API_KEY = "test-key";
  process.env.META_MODEL_BASE_URL = "https://proxy.test/v1/";
  const { fetchImpl, calls } = fakeFetch(answer(PNG));
  const out = await createMetaImages({ fetchImpl }).editImage({ prompt: "remove the second pair of glasses. Keep everything else the same.", images: [{ bytes: TINY_JPEG, mime: "image/jpeg" }] });
  assert.equal(calls[0].url, "https://proxy.test/v1/images/edits");
  assert.deepEqual(calls[0].body, {
    model: "muse-image-1.0", prompt: "remove the second pair of glasses. Keep everything else the same.", n: 1, output_format: "jpeg", response_format: "b64_json",
    images: [{ image_url: `data:image/jpeg;base64,${b64(TINY_JPEG)}` }],
  });
  assert.equal(out.images[0].mime, "image/png", "the bytes say what they are");
  process.env.IMAGE_BASE_URL = "https://images.test/v1";
  await createMetaImages({ fetchImpl }).editImage({ prompt: "p", images: [{ bytes: TINY_JPEG }], size: "1080x1350" });
  assert.equal(calls[1].url, "https://images.test/v1/images/edits");
  assert.equal(calls[1].body.size, "1080x1350");
  assert.equal(calls[1].body.images[0].image_url.slice(0, 23), "data:image/jpeg;base64,", "a photo without a mime is sniffed");
});

test("meta: a 503 is tried once more; a second 503 fails with the status", async () => {
  process.env.META_MODEL_API_KEY = "test-key";
  const once = fakeFetch([fail(503, "overloaded"), answer(TINY_JPEG)]);
  const out = await createMetaImages({ fetchImpl: once.fetchImpl }).generateImage({ prompt: "p", retryDelayMs: 0 });
  assert.equal(once.calls.length, 2);
  assert.equal(out.images.length, 1);
  const twice = fakeFetch(fail(503, "overloaded"));
  await assert.rejects(createMetaImages({ fetchImpl: twice.fetchImpl }).generateImage({ prompt: "p", retryDelayMs: 1 }), { message: "Muse Image 1.0 503: overloaded", status: 503 });
  assert.equal(twice.calls.length, 2, "one retry, not more");
});

test("meta: a safety block (400 content_policy_violation) becomes one plain sentence; other errors keep the API's words", async () => {
  process.env.META_MODEL_API_KEY = "test-key";
  const blocked = fakeFetch(fail(400, "The image may contain unsafe content.", { code: "content_policy_violation", type: "invalid_request_error" }));
  await assert.rejects(createMetaImages({ fetchImpl: blocked.fetchImpl }).editImage({ prompt: "p", images: [{ bytes: TINY_JPEG }] }),
    { message: "Muse Image 1.0 refused this photo for safety: The image may contain unsafe content.", code: "content_policy", status: 400 });
  const mask = fakeFetch(fail(400, "Unsupported parameter: mask", { code: "unsupported_parameter" }));
  await assert.rejects(createMetaImages({ fetchImpl: mask.fetchImpl }).generateImage({ prompt: "p" }), { message: "Muse Image 1.0 400: Unsupported parameter: mask" });
  assert.equal(mask.calls.length, 1, "Muse Image gets no size fallback");
  const html = fakeFetch({ status: 502, text: "<html>Bad gateway</html>" });
  await assert.rejects(createMetaImages({ fetchImpl: html.fetchImpl }).generateImage({ prompt: "p" }), { message: "Muse Image 1.0 502" });
  const empty = fakeFetch({ status: 200, json: { data: [] } });
  await assert.rejects(createMetaImages({ fetchImpl: empty.fetchImpl }).generateImage({ prompt: "p" }), { message: "Muse Image 1.0 returned no image data" });
  const timeout = fakeFetch(Object.assign(new Error("t"), { name: "TimeoutError" }));
  await assert.rejects(createMetaImages({ fetchImpl: timeout.fetchImpl }).generateImage({ prompt: "p" }), { message: "Muse Image 1.0 timed out", code: "timeout" });
});

test("errors name a key by its name and never carry its value, even when the API echoes it", async () => {
  const meta = createMetaImages({ fetchImpl: fakeFetch(answer(TINY_JPEG)).fetchImpl });
  await assert.rejects(meta.generateImage({ prompt: "p" }), { message: "Muse Image 1.0 needs META_MODEL_API_KEY" });
  process.env.META_MODEL_API_KEY = "mk-secret-value-123456";
  const echo = fakeFetch(fail(401, "Invalid key mk-secret-value-123456 (Bearer mk-secret-value-123456)"));
  const e1 = await createMetaImages({ fetchImpl: echo.fetchImpl }).generateImage({ prompt: "p" }).catch((e) => e);
  assert.equal(e1.status, 401);
  assert.ok(!e1.message.includes("mk-secret-value-123456"), e1.message);
  assert.match(e1.message, /^Muse Image 1\.0 401: Invalid key \[key\]/);
  process.env.IMAGE_PROVIDER = "openai";
  process.env.OPENAI_API_KEY = "sk-other-secret-987654";
  const openai = fakeFetch(fail(401, "Incorrect API key provided: sk-other***7654. You can find your API key at https://platform.openai.com."));
  const e2 = await generateImage({ prompt: "p", fetchImpl: openai.fetchImpl }).catch((e) => e);
  assert.ok(!/sk-other/.test(e2.message), e2.message);
  assert.match(e2.message, /^gpt-image-1 401: Incorrect API key provided: \[key\]/);
  delete process.env.OPENAI_API_KEY;
  await assert.rejects(generateImage({ prompt: "p" }), /needs OPENAI_API_KEY/);
});

test("meta: a Contributor-tier model, an empty prompt or an edit without a photo never leave the server", async () => {
  process.env.META_MODEL_API_KEY = "test-key";
  const { fetchImpl, calls } = fakeFetch(answer(TINY_JPEG));
  const meta = createMetaImages({ fetchImpl });
  process.env.IMAGE_MODEL = "muse-image-1.0-contributor";
  await assert.rejects(meta.generateImage({ prompt: "p" }), /Refusing Contributor-mode model/);
  delete process.env.IMAGE_MODEL;
  await assert.rejects(meta.generateImage({ prompt: "  " }), { message: "Muse Image 1.0 needs a prompt" });
  await assert.rejects(meta.editImage({ prompt: "p", images: [] }), { message: "Muse Image 1.0 needs a photo to edit" });
  assert.equal(calls.length, 0);
});

test("openai: a photo is asked as JSON at IMAGE_BASE_URL; a refused response_format, then a refused size, are each tried once without", async () => {
  process.env.IMAGE_PROVIDER = "openai";
  process.env.OPENAI_API_KEY = "sk-test";
  const { fetchImpl, calls } = fakeFetch([
    fail(400, "Unknown parameter: 'response_format'.", { param: "response_format" }),
    fail(400, "Invalid value: '1080x1350'. Supported values are: '1024x1024', '1024x1536', '1536x1024', and 'auto'.", { param: "size" }),
    answer(PNG),
  ]);
  const out = await generateImage({ prompt: "a son on the phone with his father", format: "png", fetchImpl });
  assert.equal(calls.length, 3);
  assert.equal(calls[0].url, "https://api.openai.com/v1/images/generations");
  assert.deepEqual(calls[0].headers, { "content-type": "application/json", authorization: "Bearer sk-test" });
  assert.deepEqual(calls[0].body, { model: "gpt-image-1", prompt: "a son on the phone with his father", n: 1, size: "1080x1350", output_format: "png", response_format: "b64_json" });
  assert.equal(calls[1].body.response_format, undefined, "asked again without it");
  assert.equal(calls[2].body.size, "1024x1536", "portrait stays portrait");
  assert.equal(out.images[0].mime, "image/png");
  assert.deepEqual({ provider: out.provider, label: out.label }, { provider: "openai", label: "gpt-image-1" });
  assert.deepEqual([nearestStandardSize("1350x1080"), nearestStandardSize("1024x1024"), nearestStandardSize("bad")], ["1536x1024", "1024x1024", "1024x1024"]);
});

test("openai: an edit goes as multipart (model, prompt, the photo as a file; image[] for several), no key header for a keyless server", async () => {
  process.env.IMAGE_PROVIDER = "openai";
  process.env.IMAGE_BASE_URL = "http://localhost:8080/v1";
  process.env.IMAGE_MODEL = "flux-kontext";
  const { fetchImpl, calls } = fakeFetch(answer(TINY_JPEG));
  const out = await editImage({ prompt: "warmer light", images: [{ bytes: TINY_JPEG, mime: "image/jpeg" }], fetchImpl });
  assert.equal(calls[0].url, "http://localhost:8080/v1/images/edits");
  assert.deepEqual(calls[0].headers, {}, "no key, no authorization header, and fetch sets the multipart boundary");
  const form = calls[0].body;
  assert.ok(form instanceof FormData);
  assert.equal(form.get("model"), "flux-kontext");
  assert.equal(form.get("prompt"), "warmer light");
  assert.equal(form.get("n"), "1");
  assert.equal(form.get("output_format"), "jpeg");
  assert.equal(form.get("size"), null);
  const file = form.get("image");
  assert.equal(file.type, "image/jpeg");
  assert.equal(file.name, "photo-1.jpg");
  assert.ok(Buffer.from(await file.arrayBuffer()).equals(TINY_JPEG));
  assert.equal(out.label, "flux-kontext");
  await editImage({ prompt: "p", images: [{ bytes: TINY_JPEG }, { bytes: PNG }], size: "1024x1536", fetchImpl });
  const two = calls[1].body.getAll("image[]");
  assert.deepEqual(two.map((f) => [f.name, f.type]), [["photo-1.jpg", "image/jpeg"], ["photo-2.png", "image/png"]]);
  assert.equal(calls[1].body.get("size"), "1024x1536");
});

test("mock: scripted photos in order (a Buffer, an Error, a function), every call recorded, a tiny JPEG when unscripted, cleared by reset", async () => {
  process.env.IMAGE_PROVIDER = "mock";
  const mock = getProvider("mock");
  mock.scriptImage(PNG, new Error("Muse Image 1.0 503: overloaded"), (req, n) => ({ bytes: Buffer.from(`call ${n}: ${req.prompt}`), mime: "image/webp" }));
  const first = await generateImage({ prompt: "one", size: "1080x1350" });
  assert.ok(first.images[0].bytes.equals(PNG));
  assert.deepEqual({ model: first.model, provider: first.provider, label: first.label }, { model: "mock-image-1", provider: "mock", label: "Mock Image" });
  await assert.rejects(editImage({ prompt: "two", images: [{ bytes: PNG, mime: "image/png" }] }), /503: overloaded/);
  const third = await generateImage({ prompt: "three" });
  assert.equal(third.images[0].bytes.toString(), "call 3: three");
  assert.equal(third.images[0].mime, "image/webp");
  const unscripted = await generateImage({ prompt: "four", n: 2 });
  assert.equal(unscripted.images.length, 2);
  assert.ok(unscripted.images[0].bytes.equals(TINY_JPEG));
  assert.equal(sniffMime(TINY_JPEG), "image/jpeg", "a real JPEG");
  assert.deepEqual(mock.imageCalls.map((c) => [c.kind, c.prompt]), [["generate", "one"], ["edit", "two"], ["generate", "three"], ["generate", "four"]]);
  assert.equal(mock.imageCalls[0].size, "1080x1350");
  assert.equal(mock.imageCalls[1].images[0].mime, "image/png");
  mock.scriptImage(() => ({ nothing: true }));
  await assert.rejects(generateImage({ prompt: "five" }), /mock image: no photo for call 5/);
  mock.scriptImage(PNG);
  mock.reset();
  assert.equal(mock.imageCalls.length, 0);
  assert.ok((await generateImage({ prompt: "after reset" })).images[0].bytes.equals(TINY_JPEG), "the scripted photo was cleared");
});

test("security: an answer that only names a URL is never fetched; it fails with no image data after exactly one request", async () => {
  process.env.META_MODEL_API_KEY = "test-key";
  const meta = fakeFetch({ status: 200, json: { data: [{ url: "http://169.254.169.254/latest/meta-data/" }] } });
  await assert.rejects(createMetaImages({ fetchImpl: meta.fetchImpl }).generateImage({ prompt: "p" }), { message: "Muse Image 1.0 returned no image data" });
  assert.equal(meta.calls.length, 1, "the API call, no second fetch");
  process.env.IMAGE_PROVIDER = "openai";
  process.env.IMAGE_BASE_URL = "http://localhost:8080/v1";
  const openai = fakeFetch({ status: 200, json: { data: [{ url: "http://127.0.0.1:5432/" }] } });
  await assert.rejects(editImage({ prompt: "p", images: [{ bytes: TINY_JPEG }], fetchImpl: openai.fetchImpl }), { message: "gpt-image-1 returned no image data" });
  assert.equal(openai.calls.length, 1);
  assert.equal(openai.calls[0].body.get("response_format"), "b64_json", "the edit asks for the bytes too");
});

test("helpers: the bytes name their type; Muse ids read as names", () => {
  assert.equal(sniffMime(Buffer.from("RIFF0000WEBPVP8 ")), "image/webp");
  assert.equal(sniffMime(Buffer.from("plain"), "image/png"), "image/png");
  assert.equal(sniffMime(undefined), "image/jpeg");
  assert.equal(titleOf("muse-image-1.0"), "Muse Image 1.0");
  assert.equal(titleOf("dall-e-3"), "dall-e-3");
});
