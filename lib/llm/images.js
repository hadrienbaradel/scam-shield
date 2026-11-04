// Making and editing photos, the image side of the model layer (the ad
// studio's photos, _product/specs/ad-studio.md line 4). IMAGE_PROVIDER picks
// the adapter, apart from LLM_PROVIDER, so Muse Spark can check a photo that
// another model made:
//   meta    Muse Image (muse-image-1.0) on the Meta Model API, the default:
//           POST /images/generations and /images/edits, JSON both ways; an
//           edit sends its photos as data URLs in `images: [{ image_url }]`.
//   openai  any OpenAI-style images endpoint (IMAGE_BASE_URL, default
//           OpenAI's), key OPENAI_API_KEY; edits as multipart, OpenAI's way.
//   mock    lib/llm/mock.js (scriptImage, imageCalls).
// IMAGE_MODEL names the model; IMAGE_BASE_URL the address (for meta it
// overrides META_MODEL_BASE_URL). Each adapter reads the environment when
// called, like the chat adapters.
//
// Measured on the Meta Model API (2026-11-04, docs/plans/2026-11-04-ad-studio.md):
// a generation answered 200 in 20.7 s, data[0].b64_json, a 1408x1760 JPEG of
// 670 KB for size 1080x1350 (size sets the ratio, not the pixels); an edit
// 200 in 15.7 s; $0.01 per returned image. No `mask` (400
// unsupported_parameter); a safety block is 400 content_policy_violation;
// 503 is worth one more try.
// Security: the photo comes back inside the answer (response_format b64_json),
// never as a URL to fetch: an endpoint's answer never makes the server fetch
// an address it names (SSRF). An answer without b64_json is a failure.

import { assertStandardMode, DEFAULT_BASE_URL as META_BASE_URL } from "./meta.js";
import { httpError, named, send } from "./audio.js";

export const DEFAULT_IMAGE_MODEL = "muse-image-1.0";
export const DEFAULT_OPENAI_IMAGE_MODEL = "gpt-image-1";
export const DEFAULT_OPENAI_IMAGE_BASE_URL = "https://api.openai.com/v1";
export const DEFAULT_SIZE = "1080x1350";
const RETRY_DELAY_MS = 1500;

const MIME = { jpeg: "image/jpeg", jpg: "image/jpeg", png: "image/png", webp: "image/webp" };
const EXT = { "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp" };

// The bytes say what they are; the asked format is the fallback.
export function sniffMime(bytes, fallback = "image/jpeg") {
  const b = Buffer.isBuffer(bytes) ? bytes : Buffer.from(bytes || []);
  if (b.length >= 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return "image/jpeg";
  if (b.length >= 8 && b.toString("latin1", 1, 4) === "PNG") return "image/png";
  if (b.length >= 12 && b.toString("latin1", 0, 4) === "RIFF" && b.toString("latin1", 8, 12) === "WEBP") return "image/webp";
  return fallback;
}

// "muse-image-1.0" -> "Muse Image 1.0"; any other id stays as it is.
export const titleOf = (model) => (/^muse-/i.test(model)
  ? model.split("-").map((w) => (/^\d/.test(w) ? w : w[0].toUpperCase() + w.slice(1))).join(" ")
  : model);

// OpenAI's own sizes, for an endpoint that refuses the asked one.
export function nearestStandardSize(size = DEFAULT_SIZE) {
  const [w, h] = String(size).split("x").map(Number);
  if (!w || !h || w === h) return "1024x1024";
  return h > w ? "1024x1536" : "1536x1024";
}

// An error never carries the key, even when an API echoes it back.
function scrub(text, key) {
  let s = String(text || "");
  if (key) s = s.split(key).join("[key]");
  return s.replace(/(api key provided:)\s*\S+/gi, "$1 [key]").replace(/Bearer\s+\S+/gi, "Bearer [key]");
}

const wait = (ms, signal) => new Promise((resolve, reject) => {
  if (!ms) return resolve();
  if (signal?.aborted) return reject(signal.reason);
  const t = setTimeout(() => { signal?.removeEventListener?.("abort", stop); resolve(); }, ms);
  const stop = () => { clearTimeout(t); reject(signal.reason); };
  signal?.addEventListener?.("abort", stop, { once: true });
});

function createImageAdapter(cfg) {
  const label = () => cfg.label(cfg.model());
  const adapter = {
    name: cfg.name,
    imageConfigured: cfg.configured,
    imageModel: cfg.model,
    imageLabel: label,

    generateImage: (request = {}) => run("generations", request),
    editImage: (request = {}) => run("edits", request),
  };

  async function run(kind, { prompt, images = [], size, n = 1, format = "jpeg", signal, fetchImpl, retryDelayMs = RETRY_DELAY_MS } = {}) {
    const name = label();
    if (!cfg.configured()) throw new Error(`${name} needs ${cfg.keyName}`);
    if (!String(prompt || "").trim()) throw new Error(`${name} needs a prompt`);
    if (kind === "edits" && !images.length) throw new Error(`${name} needs a photo to edit`);
    const model = cfg.model();
    cfg.beforeRequest?.(model);
    const doFetch = fetchImpl || cfg.fetchImpl || globalThis.fetch;
    const key = cfg.apiKey();
    const url = `${cfg.baseUrl().replace(/\/$/, "")}/images/${kind}`;
    const asked = { model, prompt: String(prompt), n, size: kind === "generations" ? size || DEFAULT_SIZE : size, format, images };
    const state = { size: asked.size, responseFormat: true };
    const call = async () => {
      const init = cfg.body(kind, { ...asked, size: state.size, responseFormat: state.responseFormat });
      if (key || cfg.alwaysAuth) init.headers = { ...init.headers, authorization: `Bearer ${key}` };
      const res = await send(name, doFetch, url, { method: "POST", signal, ...init });
      const text = await res.text().catch((e) => { throw named(name, e); });
      let data = null;
      try { data = JSON.parse(text); } catch { /* not JSON */ }
      return { res, data };
    };
    let { res, data } = await call();
    if (res.status === 503) {
      await wait(retryDelayMs, signal);
      ({ res, data } = await call());
    }
    // A 400 that names a parameter the endpoint lacks: once more without it,
    // as the chat adapters do. response_format (OpenAI's gpt-image models
    // always answer b64_json and may refuse the field); the size (OpenAI takes
    // three): its nearest own size. A safety block is never retried.
    const rules = [
      { when: (said) => state.responseFormat && /response_format/i.test(said), apply: () => { state.responseFormat = false; } },
      ...(cfg.sizeFallback ? [{ when: (said) => Boolean(state.size) && /size/i.test(said) && nearestStandardSize(state.size) !== state.size, apply: () => { state.size = nearestStandardSize(state.size); } }] : []),
    ];
    for (const rule of rules) {
      const said = JSON.stringify(data ?? "");
      if (res.status === 400 && !/content_policy_violation/i.test(said) && rule.when(said)) { rule.apply(); ({ res, data } = await call()); }
    }
    if (!res.ok) {
      const message = scrub(data?.error?.message || data?.message || "", key).slice(0, 300);
      if (res.status === 400 && /content_policy_violation/i.test(JSON.stringify(data ?? ""))) {
        throw Object.assign(httpError(`${name} refused this photo for safety${message ? `: ${message}` : ""}`, 400), { code: "content_policy" });
      }
      throw httpError(`${name} ${res.status}${message ? `: ${message}` : ""}`, res.status);
    }
    const items = Array.isArray(data?.data) ? data.data : [];
    const fallbackMime = MIME[String(data?.output_format || format).toLowerCase()] || "image/jpeg";
    const out = [];
    for (const item of items) {
      // Only the bytes in the answer: a `url` is never fetched (see the top of this file).
      const bytes = typeof item?.b64_json === "string" && item.b64_json ? Buffer.from(item.b64_json, "base64") : null;
      if (bytes?.length) out.push({ bytes, mime: sniffMime(bytes, fallbackMime) });
    }
    if (!out.length) throw new Error(`${name} returned no image data`);
    return { images: out, model, provider: cfg.name, label: name };
  }
  return adapter;
}

// Muse Image: JSON both ways; an edit's photos travel as data URLs.
export function createMetaImages({ fetchImpl } = {}) {
  return createImageAdapter({
    name: "meta",
    keyName: "META_MODEL_API_KEY",
    fetchImpl,
    alwaysAuth: true,
    label: titleOf,
    baseUrl: () => process.env.IMAGE_BASE_URL || process.env.META_MODEL_BASE_URL || META_BASE_URL,
    apiKey: () => process.env.META_MODEL_API_KEY,
    model: () => process.env.IMAGE_MODEL || DEFAULT_IMAGE_MODEL,
    configured: () => Boolean(process.env.META_MODEL_API_KEY),
    beforeRequest: assertStandardMode,
    body: (kind, { model, prompt, n, size, format, images, responseFormat }) => ({
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        model, prompt, n,
        ...(size ? { size } : {}),
        output_format: format,
        ...(responseFormat ? { response_format: "b64_json" } : {}),
        ...(kind === "edits" ? { images: images.map((im) => ({ image_url: `data:${im.mime || sniffMime(im.bytes)};base64,${Buffer.from(im.bytes).toString("base64")}` })) } : {}),
      }),
    }),
  });
}

// Any OpenAI-style images endpoint: JSON to generate, multipart to edit
// (`image` for one photo, `image[]` for several, as OpenAI's own docs show).
export function createOpenAiImages({ fetchImpl } = {}) {
  return createImageAdapter({
    name: "openai",
    keyName: "OPENAI_API_KEY (or IMAGE_BASE_URL for a server without a key)",
    fetchImpl,
    sizeFallback: true,
    label: (model) => model,
    baseUrl: () => process.env.IMAGE_BASE_URL || DEFAULT_OPENAI_IMAGE_BASE_URL,
    apiKey: () => process.env.OPENAI_API_KEY,
    model: () => process.env.IMAGE_MODEL || DEFAULT_OPENAI_IMAGE_MODEL,
    configured: () => Boolean(process.env.OPENAI_API_KEY || process.env.IMAGE_BASE_URL),
    body: (kind, { model, prompt, n, size, format, images, responseFormat }) => {
      if (kind === "generations") {
        return { headers: { "content-type": "application/json" }, body: JSON.stringify({ model, prompt, n, ...(size ? { size } : {}), output_format: format, ...(responseFormat ? { response_format: "b64_json" } : {}) }) };
      }
      const form = new FormData();
      form.append("model", model);
      form.append("prompt", prompt);
      form.append("n", String(n));
      if (size) form.append("size", size);
      form.append("output_format", format);
      if (responseFormat) form.append("response_format", "b64_json");
      images.forEach((im, i) => {
        const mime = im.mime || sniffMime(im.bytes);
        form.append(images.length > 1 ? "image[]" : "image", new Blob([im.bytes], { type: mime }), `photo-${i + 1}.${EXT[mime] || "jpg"}`);
      });
      return { body: form };
    },
  });
}
