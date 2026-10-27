// The one door to any language model. Prompts and policy (redaction,
// guardrails, schema checks, breaker, cache) stay in lib/muse.js; this layer
// only turns a neutral request into a provider's wire format and back.
//
//   complete({ system, messages, maxTokens, temperature, json, thinking, signal })
//     -> { text, usage, model, provider, raw }
//   messages: [{ role: "user" | "assistant", content: string | parts }]
//   parts:    { type: "text", text } | { type: "image", mime, base64 }
//   json:     { name, schema } for a JSON-schema answer (or true: any JSON)
//   thinking: effort level ("minimal" | "low" | "medium" | "high"), or falsy
//
// Selection: LLM_PROVIDER (default meta = Muse Spark), LLM_MODEL,
// LLM_BASE_URL (OpenAI-compatible endpoints), LLM_THINKING (effort for any
// provider; "off" sends none). Keys: META_MODEL_API_KEY, OPENAI_API_KEY,
// ANTHROPIC_API_KEY. Each provider reads the environment when called, so a
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

import { createMetaProvider } from "./meta.js";
import { createOpenAiCompatibleProvider, PRESETS } from "./openai-compatible.js";
import { createAnthropicProvider } from "./anthropic.js";
import { createMockProvider } from "./mock.js";

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

// A misspelt LLM_PROVIDER means "no AI" (detector only), said once in the log.
export function llmConfigured() {
  try { return getProvider().configured(); } catch (e) {
    if (!warned.has(e.message)) { warned.add(e.message); console.warn(e.message); }
    return false;
  }
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
