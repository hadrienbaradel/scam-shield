// OpenAI-style chat completions: the wire format shared by OpenAI, Groq,
// Together, Ollama, Llama API's /compat endpoint and Meta's Model API.
// `createOpenAiStyleProvider` is the core (meta.js builds on it with Meta's
// defaults); `createOpenAiCompatibleProvider` is the generic provider behind
// LLM_PROVIDER=openai|groq|together|ollama|llama-api (or openai-compatible
// with LLM_BASE_URL pointing anywhere that speaks this format).

// Known endpoints. LLM_BASE_URL overrides the address, LLM_MODEL the model.
export const PRESETS = {
  "openai-compatible": { label: "OpenAI-compatible", baseUrl: "https://api.openai.com/v1" },
  openai: { label: "OpenAI", baseUrl: "https://api.openai.com/v1", model: "gpt-4o-mini" },
  groq: { label: "Groq", baseUrl: "https://api.groq.com/openai/v1", model: "llama-3.3-70b-versatile" },
  together: { label: "Together", baseUrl: "https://api.together.xyz/v1", model: "meta-llama/Llama-3.3-70B-Instruct-Turbo" },
  ollama: { label: "Ollama", baseUrl: "http://localhost:11434/v1", model: "llama3.2", keyOptional: true },
  "llama-api": { label: "Llama API", baseUrl: "https://api.llama.com/compat/v1", model: "Llama-4-Maverick-17B-128E-Instruct-FP8" },
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

export function createOpenAiStyleProvider(cfg) {
  const rules = cfg.retryRules || [RULES.noEffort, RULES.noFormat];
  const provider = {
    name: cfg.name,
    label: cfg.label,
    capabilities: { json: "schema", thinking: cfg.thinking || "effort", temperature: true, images: cfg.images ?? "model" },
    configured: cfg.configured,
    model: cfg.model,
    defaultThinking: cfg.defaultThinking || (() => undefined),

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
  const apiKey = () => process.env.OPENAI_API_KEY;
  const model = () => process.env.LLM_MODEL || def.model || "";
  return createOpenAiStyleProvider({
    name: preset,
    label: def.label,
    errorLabel: `${def.label} API`,
    fetchImpl,
    baseUrl: () => process.env.LLM_BASE_URL || def.baseUrl,
    apiKey,
    model,
    // A self-hosted endpoint (Ollama, or any LLM_BASE_URL) needs no key.
    configured: () => Boolean(model() && (apiKey() || def.keyOptional || process.env.LLM_BASE_URL)),
    defaultThinking: () => undefined,
    retryRules: [RULES.noEffort, RULES.noFormat, RULES.completionTokens, RULES.noTemperature],
  });
}
