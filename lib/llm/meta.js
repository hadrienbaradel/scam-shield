// Meta Model API (Muse Spark), the default provider: OpenAI-compatible at
// api.meta.ai/v1, Standard mode only (PRD privacy rule: a "-contributor"
// model id is refused before any request leaves).
// Muse Spark thinks before it answers, and the thinking counts against
// max_tokens: at 900 it used them all and returned nothing. Measured on a
// test case (2026-10-26): default effort ~2,950 thinking tokens / 11.5 s,
// "low" ~930 / 4.7 s, "minimal" ~280 / 2.8 s, same verdict. The detector's
// evidence already does the groundwork, so "low" is the default
// (META_MODEL_REASONING_EFFORT; retried without it if the API refuses it).

import { createOpenAiStyleProvider, RULES } from "./openai-compatible.js";

export const DEFAULT_BASE_URL = "https://api.meta.ai/v1";
export const DEFAULT_MODEL = "muse-spark-1.3";

export function assertStandardMode(model) {
  if (/contributor/i.test(model)) throw new Error(`Refusing Contributor-mode model ${model}: Prudence runs in Standard mode only`);
}

export function createMetaProvider({ fetchImpl } = {}) {
  return createOpenAiStyleProvider({
    name: "meta",
    label: "Muse Spark",
    errorLabel: "Meta Model API",
    fetchImpl,
    alwaysAuth: true,
    images: true,
    baseUrl: () => process.env.META_MODEL_BASE_URL || DEFAULT_BASE_URL,
    apiKey: () => process.env.META_MODEL_API_KEY,
    model: () => process.env.LLM_MODEL || process.env.META_MODEL_NAME || DEFAULT_MODEL,
    configured: () => Boolean(process.env.META_MODEL_API_KEY),
    defaultThinking: () => process.env.META_MODEL_REASONING_EFFORT || "low",
    beforeRequest: assertStandardMode,
    retryRules: [RULES.noEffort, RULES.noFormat],
  });
}
