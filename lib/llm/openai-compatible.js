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
// Function calling: the model's turn { role: "assistant", content, toolCalls:
// [{ id, name, arguments }] } goes back as tool_calls (arguments as a JSON
// string), and each answer { role: "tool", toolCallId, content } as a tool
// message (live-tested on the Meta Model API, 2026-11-04).
export function toOpenAiMessages(system, messages = []) {
  const part = (p) => (p && p.type === "image"
    ? { type: "image_url", image_url: { url: `data:${p.mime};base64,${p.base64}` } }
    : p);
  const one = (m) => {
    if (m.role === "tool") return { role: "tool", tool_call_id: m.toolCallId, content: String(m.content ?? "") };
    if (m.role === "assistant" && Array.isArray(m.toolCalls) && m.toolCalls.length) {
      return { role: "assistant", content: m.content || "", tool_calls: m.toolCalls.map((c) => ({
        id: c.id, type: "function",
        function: { name: c.name, arguments: typeof c.arguments === "string" ? c.arguments : JSON.stringify(c.arguments ?? {}) },
      })) };
    }
    return { role: m.role, content: Array.isArray(m.content) ? m.content.map(part) : m.content };
  };
  return [
    ...(system ? [{ role: "system", content: system }] : []),
    ...messages.map(one),
  ];
}

// Neutral tools ({ name, description, parameters, strict }) to OpenAI's
// function tools; tool_choice is always "auto" (the only value Meta takes).
export function toOpenAiTools(tools = []) {
  return tools.map((t) => ({ type: "function", function: {
    name: t.name, description: t.description || "", parameters: t.parameters || { type: "object", properties: {} },
    ...(t.strict !== undefined ? { strict: Boolean(t.strict) } : {}),
  } }));
}

// The model's tool calls, arguments parsed. A call whose arguments are not a
// JSON object (half an object, "null", "[]") comes back with arguments {} and
// `invalid` saying why, so the caller refuses that one call and the others stand.
export function parseToolCalls(calls) {
  return (Array.isArray(calls) ? calls : []).map((c) => {
    const name = c?.function?.name || c?.name || "";
    const raw = c?.function?.arguments ?? c?.arguments ?? "";
    let args = raw;
    let invalid = null;
    if (typeof raw === "string") {
      try { args = raw.trim() ? JSON.parse(raw) : {}; } catch { invalid = "arguments that are not JSON"; }
    }
    if (!invalid && (!args || typeof args !== "object" || Array.isArray(args))) invalid = "arguments that are not an object";
    return { id: String(c?.id || ""), name, arguments: invalid ? {} : args, ...(invalid ? { invalid } : {}) };
  });
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
    capabilities: { json: "schema", thinking: cfg.thinking || "effort", temperature: true, images: cfg.images ?? "model", transcribe: true, tools: true },
    configured: cfg.configured,
    model: cfg.model,
    defaultThinking: cfg.defaultThinking || (() => undefined),
    // Speech to text: cfg.transcribe (Meta's own endpoint) or /audio/transcriptions.
    transcribeConfigured: cfg.transcribeConfigured || cfg.configured,
    transcribe: (request = {}) => (cfg.transcribe || audioTranscriptions)(request, request.fetchImpl || cfg.fetchImpl || globalThis.fetch, cfg),

    // tools: [{ name, description, parameters, strict }] go out as function
    // tools with tool_choice "auto"; the answer then carries toolCalls
    // ([{ id, name, arguments }], empty when the model answered in words).
    async complete({ system, messages = [], maxTokens, temperature, json, thinking, signal, tools } = {}) {
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
      const withTools = Array.isArray(tools) && tools.length > 0;
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
            ...(withTools ? { tools: toOpenAiTools(tools), tool_choice: "auto" } : {}),
          }),
          signal,
        });
        let parsed = true;
        const data = await res.json().catch(() => { parsed = false; return {}; });
        return { res, data, parsed };
      };
      let { res, data, parsed } = await call();
      for (const rule of rules) {
        if (res.status === 400 && rule.when(state, data)) { rule.apply(state); ({ res, data, parsed } = await call()); }
      }
      if (!res.ok) throw new Error(`${cfg.errorLabel || cfg.label} ${res.status}: ${data.error?.message || ""}`.trim());
      // A 200 that is not a chat completion (a proxy's HTML page, a cut body) is a
      // failure like any other, never an empty answer.
      if (!parsed || !Array.isArray(data.choices) || !data.choices.length) {
        throw new Error(`${cfg.errorLabel || cfg.label} answered with something that is not a chat completion`);
      }
      const choice = data.choices[0] || {};
      const content = choice.message?.content || "";
      const toolCalls = parseToolCalls(choice.message?.tool_calls);
      if (!content && !toolCalls.length && choice.finish_reason === "length") {
        throw new Error(`${cfg.label} spent its whole ${maxTokens}-token budget thinking and gave no answer (reasoning ${data.usage?.completion_tokens_details?.reasoning_tokens ?? "?"} tokens)`);
      }
      const text = Array.isArray(content) ? content.map((p) => p.text || "").join("") : content;
      return { text, ...(withTools || toolCalls.length ? { toolCalls } : {}), usage: data.usage || null, model, provider: cfg.name, raw: data };
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
