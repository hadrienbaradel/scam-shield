// The one door to any language model. Prompts and policy (redaction,
// guardrails, schema checks, breaker, cache) stay in lib/muse.js; this layer
// only turns a neutral request into a provider's wire format and back.
//
//   complete({ system, messages, maxTokens, temperature, json, thinking, signal, tools })
//     -> { text, usage, model, provider, raw, toolCalls? }
//   messages: [{ role: "user" | "assistant", content: string | parts }]
//             plus, for function calling, the model's turn echoed back
//             { role: "assistant", content, toolCalls } and each answer
//             { role: "tool", toolCallId, content }
//   parts:    { type: "text", text } | { type: "image", mime, base64 }
//   json:     { name, schema } for a JSON-schema answer (or true: any JSON)
//   thinking: effort level ("minimal" | "low" | "medium" | "high"), or falsy
//   tools:    [{ name, description, parameters (JSON schema), strict }];
//             the answer then has toolCalls: [{ id, name, arguments (parsed) }],
//             [] when the model answered in words (tools and json may be sent
//             together: the model either calls tools or answers the schema)
//
//   transcribe({ wav, language, signal, fetchImpl }) -> { text, model, provider, raw }
//   wav:      16 kHz mono 16-bit PCM WAV bytes (inspectWav in ./audio.js checks them)
//   language: optional hint ("fr", "en-US"); without it the model detects the language
//
//   generateImage({ prompt, size = "1080x1350", n = 1, format = "jpeg", signal, provider, fetchImpl })
//   editImage({ prompt, images: [{ bytes, mime }], size, format = "jpeg", signal, provider, fetchImpl })
//     -> { images: [{ bytes: Buffer, mime }], model, provider, label }; both throw on
//        failure with the provider, the HTTP status and the API's own message, never a key
//   IMAGE_PROVIDER (meta = Muse Image, the default; openai = any OpenAI-style images
//   endpoint; mock), IMAGE_MODEL, IMAGE_BASE_URL: apart from LLM_PROVIDER (./images.js).
//
// Selection: LLM_PROVIDER (default meta = Muse Spark), LLM_MODEL,
// LLM_BASE_URL (OpenAI-compatible endpoints), LLM_THINKING (effort for any
// provider; "off" sends none). Keys: META_MODEL_API_KEY, OPENAI_API_KEY,
// ANTHROPIC_API_KEY, BASETEN_API_KEY (LLM_PROVIDER=baseten: Muse Spark Open,
// Meta's open weights). Each provider reads the environment when called, so a
// change takes effect on the next request.
//
// Capabilities, and what happens without them (see _product/docs/llm.md):
//   json       meta/openai: response_format json_schema, resent without it
//              on a 400; anthropic: output_config.format, same fallback.
//              The prompts already say "return only JSON" and the engine
//              parses the first {...} in the text, so a plain answer works.
//   thinking   meta: reasoning_effort (default low); openai-style: sent only
//              when LLM_THINKING is set, dropped on a 400; anthropic:
//              output_config.effort (default low); mock: recorded.
//   temperature meta/openai: sent; anthropic: never (API rejects it).
//   images     meta/anthropic/mock: yes; openai-style: depends on the model.
//   transcribe meta: Muse Voice Transcribe (/asr/transcribe); openai-style:
//              /audio/transcriptions (LLM_TRANSCRIBE_MODEL, default
//              whisper-1); anthropic: no (throws "not supported"); mock: scripted.
//   tools      meta/openai-style: function tools, tool_choice "auto";
//              anthropic: no (throws "tools are not supported by this
//              provider"); mock: scripted ({ toolCalls: [...] }).

import { createMetaProvider } from "./meta.js";
import { createOpenAiCompatibleProvider, PRESETS } from "./openai-compatible.js";
import { createAnthropicProvider } from "./anthropic.js";
import { createMockProvider } from "./mock.js";
import { createMetaImages, createOpenAiImages } from "./images.js";

export const DEFAULT_PROVIDER = "meta";
const FACTORIES = {
  meta: () => createMetaProvider(),
  anthropic: () => createAnthropicProvider(),
  mock: () => createMockProvider(),
  ...Object.fromEntries(Object.keys(PRESETS).map((k) => [k, () => createOpenAiCompatibleProvider({ preset: k })])),
};
const ALIASES = { muse: "meta", claude: "anthropic", llama: "llama-api" };
export const PROVIDER_NAMES = Object.keys(FACTORIES);
const instances = new Map();
const warned = new Set();

export function providerName(name = process.env.LLM_PROVIDER) {
  const key = String(name || DEFAULT_PROVIDER).trim().toLowerCase();
  return ALIASES[key] || key;
}

// getProvider() follows LLM_PROVIDER; getProvider("anthropic") is explicit.
export function getProvider(name) {
  const key = providerName(name);
  if (!FACTORIES[key]) throw new Error(`Unknown LLM provider "${key}" (LLM_PROVIDER); known: ${PROVIDER_NAMES.join(", ")}`);
  if (!instances.has(key)) instances.set(key, FACTORIES[key]());
  return instances.get(key);
}

export const complete = (request = {}) => getProvider(request.provider).complete(request);

// Speech to text, by the active provider unless `provider` names one. Throws
// on any failure, like complete; a provider without it throws "not supported".
export const transcribe = (request = {}) => getProvider(request.provider).transcribe(request);

// A misspelt LLM_PROVIDER means "no AI" (detector only), said once in the log.
export function llmConfigured() {
  try { return getProvider().configured(); } catch (e) {
    if (!warned.has(e.message)) { warned.add(e.message); console.warn(e.message); }
    return false;
  }
}
// The provider (the active one by default) can transcribe and has its key.
export function transcribeConfigured(name) {
  try {
    const p = getProvider(name);
    return Boolean(p.capabilities.transcribe) && Boolean(p.transcribeConfigured?.());
  } catch (e) {
    if (!warned.has(e.message)) { warned.add(e.message); console.warn(e.message); }
    return false;
  }
}
// The active provider is configured and can call function tools (Look closer).
export function toolsConfigured() {
  return llmConfigured() && Boolean(getProvider().capabilities.tools);
}
export const llmModel = () => getProvider().model();
export const llmProviderName = () => providerName();
export function llmLabel() {
  try { return getProvider().label; } catch { return "LLM"; }
}
export function llmThinking() {
  const v = process.env.LLM_THINKING;
  if (v !== undefined) return /^(off|none|false|0)?$/i.test(v.trim()) ? undefined : v.trim();
  return getProvider().defaultThinking();
}
export const capabilities = () => Object.fromEntries(PROVIDER_NAMES.map((n) => [n, getProvider(n).capabilities]));

// Photos: IMAGE_PROVIDER, apart from LLM_PROVIDER, so one model can make a
// photo and another check it. The mock is the same shared instance as above.
export const DEFAULT_IMAGE_PROVIDER = "meta";
const IMAGE_FACTORIES = {
  meta: () => createMetaImages(),
  openai: () => createOpenAiImages(),
  mock: () => getProvider("mock"),
};
const IMAGE_ALIASES = { muse: "meta", "openai-compatible": "openai" };
export const IMAGE_PROVIDER_NAMES = Object.keys(IMAGE_FACTORIES);
const imageInstances = new Map();

export function imageProviderName(name = process.env.IMAGE_PROVIDER) {
  const key = String(name || DEFAULT_IMAGE_PROVIDER).trim().toLowerCase();
  return IMAGE_ALIASES[key] || key;
}
export function getImageProvider(name) {
  const key = imageProviderName(name);
  if (!IMAGE_FACTORIES[key]) throw new Error(`Unknown image provider "${key}" (IMAGE_PROVIDER); known: ${IMAGE_PROVIDER_NAMES.join(", ")}`);
  if (!imageInstances.has(key)) imageInstances.set(key, IMAGE_FACTORIES[key]());
  return imageInstances.get(key);
}
export const generateImage = (request = {}) => getImageProvider(request.provider).generateImage(request);
export const editImage = (request = {}) => getImageProvider(request.provider).editImage(request);
// The image provider (IMAGE_PROVIDER by default) has its key; a misspelt name is said once.
export function imageConfigured(name) {
  try { return Boolean(getImageProvider(name).imageConfigured()); } catch (e) {
    if (!warned.has(e.message)) { warned.add(e.message); console.warn(e.message); }
    return false;
  }
}
export const imageModel = (name) => getImageProvider(name).imageModel();
export function imageLabel(name) {
  try { return getImageProvider(name).imageLabel(); } catch { return "Image model"; }
}
