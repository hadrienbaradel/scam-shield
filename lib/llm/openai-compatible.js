// OpenAI-style chat completions: the wire format shared by OpenAI, Groq,
// Together, Ollama, Llama API's /compat endpoint and Meta's Model API.
// `createOpenAiStyleProvider` is the core (meta.js builds on it with Meta's
// defaults); `createOpenAiCompatibleProvider` is the generic provider behind
// LLM_PROVIDER=openai|groq|together|ollama|llama-api|baseten (or
// openai-compatible with LLM_BASE_URL pointing anywhere that speaks this
// format). Speech to text goes to the same address's /audio/transcriptions
// (meta.js has its own).

import { httpError, languageCode, named, send } from "./audio.js";

// Known endpoints. LLM_BASE_URL overrides the address, LLM_MODEL the model.
export const PRESETS = {
  "openai-compatible": { label: "OpenAI-compatible", baseUrl: "https://api.openai.com/v1" },
  openai: { label: "OpenAI", baseUrl: "https://api.openai.com/v1", model: "gpt-4o-mini" },
  groq: { label: "Groq", baseUrl: "https://api.groq.com/openai/v1", model: "llama-3.3-70b-versatile" },
  together: { label: "Together", baseUrl: "https://api.together.xyz/v1", model: "meta-llama/Llama-3.3-70B-Instruct-Turbo" },
  ollama: { label: "Ollama", baseUrl: "http://localhost:11434/v1", model: "llama3.2", keyOptional: true },
  "llama-api": { label: "Llama API", baseUrl: "https://api.llama.com/compat/v1", model: "Llama-4-Maverick-17B-128E-Instruct-FP8" },
  // Muse Spark Open, Meta's open weights, on Baseten's Model APIs (the hackathon's partner
  // inference; -1026 is the hackathon's model id). Its own key (keyEnv), never OPENAI_API_KEY.
  // It always reasons and Baseten's default effort is xhigh, so low, as Muse Spark on the API.
  baseten: { label: "Baseten", baseUrl: "https://inference.baseten.co/v1", model: "meta-models/muse-spark-open-1026", keyEnv: "BASETEN_API_KEY", thinking: "low" },
};

// Neutral messages ({ role, content: string | parts }) to the OpenAI shape.
// Parts: { type: "text", text } stays as is; { type: "image", mime, base64 }
// becomes an image_url data URL; anything else passes through untouched.
export function toOpenAiMessages(system, messages = []) {
  const part = (p) => (p && p.type === "image"
    ? { type: "image_url", image_url: { url: `data:${p.mime};base64,${p.base64}` } }
    : p);
  return [
    ...(system ? [{ role: "system", content: system }] : []),
    ...messages.map((m) => ({ role: m.role, content: Array.isArray(m.content) ? m.content.map(part) : m.content })),
  ];
}

// Degradation rules: on a 400 that names a feature the endpoint lacks, the
// request is sent once more without it. Meta keeps the first two only.
const mentions = (data, re) => re.test(JSON.stringify(data));
export const RULES = {
  // The endpoint does not know reasoning_effort: ask again without it.
  noEffort: { when: (s, d) => Boolean(s.effort) && mentions(d, /reasoning_effort/i), apply: (s) => { s.effort = null; } },
  // The endpoint refuses response_format: ask again and parse the text.
  noFormat: { when: (s, d) => Boolean(s.format) && mentions(d, /response_format|json_schema/i), apply: (s) => { s.format = null; } },
  // Newer OpenAI models take max_completion_tokens instead of max_tokens.
  completionTokens: { when: (s, d) => s.tokensKey === "max_tokens" && mentions(d, /max_completion_tokens/i), apply: (s) => { s.tokensKey = "max_completion_tokens"; } },
  // Reasoning models accept only their default temperature.
  noTemperature: { when: (s, d) => s.temperature !== undefined && mentions(d, /temperature/i), apply: (s) => { s.temperature = undefined; } },
};

// Speech to text, OpenAI's way: POST /audio/transcriptions with a multipart
// `file` (the WAV), `model` and, when hinted, `language` (ISO 639-1); the
// JSON answer's `text` is the transcript. LLM_TRANSCRIBE_MODEL names the
// model: whisper-1 is OpenAI's, other hosts name their own, and an endpoint
// without this route (Ollama, unverified) fails like any other call.
export const DEFAULT_TRANSCRIBE_MODEL = "whisper-1";

export async function audioTranscriptions({ wav, language, signal } = {}, fetchImpl, cfg) {
  const label = cfg.errorLabel || cfg.label;
  if (!(cfg.transcribeConfigured || cfg.configured)()) throw new Error(`${label} needs ${cfg.keyName || "OPENAI_API_KEY"} or LLM_BASE_URL to transcribe`);
  const model = process.env.LLM_TRANSCRIBE_MODEL || DEFAULT_TRANSCRIBE_MODEL;
  const key = cfg.apiKey();
  const form = new FormData();
  form.append("file", new Blob([wav], { type: "audio/wav" }), "voice.wav");
  form.append("model", model);
  const code = languageCode(language);
  if (code) form.append("language", code);
  const res = await send(label, fetchImpl, `${cfg.baseUrl().replace(/\/$/, "")}/audio/transcriptions`, {
    method: "POST", body: form, signal,
    headers: key || cfg.alwaysAuth ? { authorization: `Bearer ${key}` } : {},
  });
  const body = await res.text().catch((e) => { throw named(label, e); });
  let data = {};
  try { data = JSON.parse(body); } catch { /* not JSON */ }
  if (!res.ok) throw httpError(`${label} ${res.status}${data.error?.message ? `: ${String(data.error.message).slice(0, 200)}` : ""}`, res.status);
  if (typeof data.text !== "string") throw new Error(`${label} answered without a transcript`);
  return { text: data.text.replace(/\s+/g, " ").trim(), model, provider: cfg.name, raw: data };
}

export function createOpenAiStyleProvider(cfg) {
  const rules = cfg.retryRules || [RULES.noEffort, RULES.noFormat];
  const provider = {
    name: cfg.name,
    label: cfg.label,
    capabilities: { json: "schema", thinking: cfg.thinking || "effort", temperature: true, images: cfg.images ?? "model", transcribe: true },
    configured: cfg.configured,
    model: cfg.model,
    defaultThinking: cfg.defaultThinking || (() => undefined),
    // Speech to text: cfg.transcribe (Meta's own endpoint) or /audio/transcriptions.
    transcribeConfigured: cfg.transcribeConfigured || cfg.configured,
    transcribe: (request = {}) => (cfg.transcribe || audioTranscriptions)(request, request.fetchImpl || cfg.fetchImpl || globalThis.fetch, cfg),

    async complete({ system, messages = [], maxTokens, temperature, json, thinking, signal } = {}) {
      const model = cfg.model();
      cfg.beforeRequest?.(model);
      const fetchImpl = cfg.fetchImpl || globalThis.fetch;
      const url = `${cfg.baseUrl().replace(/\/$/, "")}/chat/completions`;
      const key = cfg.apiKey();
      const headers = { "content-type": "application/json", ...(key || cfg.alwaysAuth ? { authorization: `Bearer ${key}` } : {}) };
      const state = {
        temperature,
        tokensKey: "max_tokens",
        effort: thinking || null,
        format: json && json.schema
          ? { type: "json_schema", json_schema: { name: json.name || "result", schema: json.schema, strict: false } }
          : json === true ? { type: "json_object" } : null,
      };
      const call = async () => {
        const res = await fetchImpl(url, {
          method: "POST",
          headers,
          body: JSON.stringify({
            model, messages: toOpenAiMessages(system, messages),
            ...(state.temperature !== undefined ? { temperature: state.temperature } : {}),
            ...(maxTokens ? { [state.tokensKey]: maxTokens } : {}),
            ...(state.effort ? { reasoning_effort: state.effort } : {}),
            ...(state.format ? { response_format: state.format } : {}),
          }),
          signal,
        });
        const data = await res.json().catch(() => ({}));
        return { res, data };
      };
      let { res, data } = await call();
      for (const rule of rules) {
        if (res.status === 400 && rule.when(state, data)) { rule.apply(state); ({ res, data } = await call()); }
      }
      if (!res.ok) throw new Error(`${cfg.errorLabel || cfg.label} ${res.status}: ${data.error?.message || ""}`.trim());
      const choice = data.choices?.[0] || {};
      const content = choice.message?.content || "";
      if (!content && choice.finish_reason === "length") {
        throw new Error(`${cfg.label} spent its whole ${maxTokens}-token budget thinking and gave no answer (reasoning ${data.usage?.completion_tokens_details?.reasoning_tokens ?? "?"} tokens)`);
      }
      const text = Array.isArray(content) ? content.map((p) => p.text || "").join("") : content;
      return { text, usage: data.usage || null, model, provider: cfg.name, raw: data };
    },
  };
  return provider;
}

export function createOpenAiCompatibleProvider({ preset = "openai-compatible", fetchImpl } = {}) {
  const def = PRESETS[preset] || PRESETS["openai-compatible"];
  // A preset with its own key name reads only that one: one host's key is never sent to another.
  const apiKey = () => process.env[def.keyEnv || "OPENAI_API_KEY"];
  const model = () => process.env.LLM_MODEL || def.model || "";
  return createOpenAiStyleProvider({
    name: preset,
    label: def.label,
    errorLabel: `${def.label} API`,
    keyName: def.keyEnv || "OPENAI_API_KEY",
    fetchImpl,
    baseUrl: () => process.env.LLM_BASE_URL || def.baseUrl,
    apiKey,
    model,
    // A self-hosted endpoint (Ollama, or any LLM_BASE_URL) needs no key.
    configured: () => Boolean(model() && (apiKey() || def.keyOptional || process.env.LLM_BASE_URL)),
    // Transcription names its own model (LLM_TRANSCRIBE_MODEL), so it needs only the key or address.
    transcribeConfigured: () => Boolean(apiKey() || def.keyOptional || process.env.LLM_BASE_URL),
    defaultThinking: () => def.thinking,
    retryRules: [RULES.noEffort, RULES.noFormat, RULES.completionTokens, RULES.noTemperature],
  });
}
