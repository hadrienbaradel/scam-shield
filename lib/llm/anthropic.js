// Anthropic Messages API over raw HTTP (the project adds no npm packages).
// Shapes from the claude-api reference (2026-10): current models think
// adaptively by default, depth is output_config.effort, JSON comes back
// through output_config.format, and API version 2026-10-21 rejects sampling
// parameters, so `temperature` is not sent.

export const DEFAULT_BASE_URL = "https://api.anthropic.com";
export const DEFAULT_MODEL = "claude-opus-5-5";
export const API_VERSION = "2026-10-21";
const EFFORT = { minimal: "low", low: "low", medium: "medium", high: "high", xhigh: "xhigh", max: "max" };
const DROPPED = new Set(["minimum", "maximum", "multipleOf", "minLength", "maxLength", "minItems", "maxItems", "pattern", "format"]);

// Structured outputs take a subset of JSON Schema: every object must close
// with additionalProperties:false, and numeric, string and array
// constraints are not accepted. The engine validates the full schema itself.
export function structuredOutputSchema(schema) {
  if (Array.isArray(schema)) return schema.map(structuredOutputSchema);
  if (!schema || typeof schema !== "object") return schema;
  const out = {};
  for (const [k, v] of Object.entries(schema)) {
    if (DROPPED.has(k)) continue;
    if (k === "properties") out[k] = Object.fromEntries(Object.entries(v).map(([name, sub]) => [name, structuredOutputSchema(sub)]));
    else if (k === "enum" || k === "required" || k === "type") out[k] = v;
    else out[k] = structuredOutputSchema(v);
  }
  if ([].concat(out.type || []).includes("object")) out.additionalProperties = false;
  return out;
}

// Neutral messages to Anthropic content blocks (images become base64 blocks).
export function toAnthropicMessages(messages = []) {
  const part = (p) => (p && p.type === "image"
    ? { type: "image", source: { type: "base64", media_type: p.mime, data: p.base64 } }
    : p);
  return messages.map((m) => ({ role: m.role, content: Array.isArray(m.content) ? m.content.map(part) : m.content }));
}

export function createAnthropicProvider({ fetchImpl } = {}) {
  const provider = {
    name: "anthropic",
    label: "Claude",
    capabilities: { json: "schema", thinking: "effort", temperature: false, images: true, transcribe: false },
    configured: () => Boolean(process.env.ANTHROPIC_API_KEY),
    model: () => process.env.LLM_MODEL || DEFAULT_MODEL,
    defaultThinking: () => "low",
    // No speech to text in this adapter: refused before any request.
    transcribeConfigured: () => false,
    async transcribe() {
      throw Object.assign(new Error("Transcription is not supported by the Claude provider: voice checks need Muse Voice Transcribe (META_MODEL_API_KEY) or an OpenAI-style provider"), { code: "not_supported" });
    },

    async complete({ system, messages = [], maxTokens, json, thinking, signal } = {}) {
      const model = provider.model();
      const f = fetchImpl || globalThis.fetch;
      const url = `${(process.env.ANTHROPIC_BASE_URL || DEFAULT_BASE_URL).replace(/\/$/, "")}/v1/messages`;
      const headers = { "content-type": "application/json", "x-api-key": process.env.ANTHROPIC_API_KEY, "anthropic-version": API_VERSION };
      const state = {
        effort: thinking ? EFFORT[String(thinking).toLowerCase()] || null : null,
        format: json && json.schema ? { type: "json_schema", schema: structuredOutputSchema(json.schema) } : null,
      };
      const call = async () => {
        const outputConfig = { ...(state.effort ? { effort: state.effort } : {}), ...(state.format ? { format: state.format } : {}) };
        const res = await f(url, {
          method: "POST",
          headers,
          body: JSON.stringify({
            model,
            max_tokens: maxTokens || 4096,
            ...(system ? { system } : {}),
            messages: toAnthropicMessages(messages),
            ...(Object.keys(outputConfig).length ? { output_config: outputConfig } : {}),
          }),
          signal,
        });
        const data = await res.json().catch(() => ({}));
        return { res, data };
      };
      let { res, data } = await call();
      const said = (re) => re.test(JSON.stringify(data));
      // Degrade one feature at a time: a schema the API will not take (the
      // prompt already asks for JSON and the engine parses leniently), then
      // an effort level this model does not know.
      if (res.status === 400 && state.format && said(/format|schema/i)) { state.format = null; ({ res, data } = await call()); }
      if (res.status === 400 && state.effort && said(/effort/i)) { state.effort = null; ({ res, data } = await call()); }
      if (!res.ok) throw new Error(`Anthropic API ${res.status}: ${data.error?.message || ""}`.trim());
      if (data.stop_reason === "refusal") throw new Error(`Claude declined this request (${data.stop_details?.category || "safety"})`);
      const text = (data.content || []).filter((b) => b && b.type === "text").map((b) => b.text || "").join("");
      if (!text && data.stop_reason === "max_tokens") {
        throw new Error(`${provider.label} spent its whole ${maxTokens || 4096}-token budget thinking and gave no answer`);
      }
      return { text, usage: data.usage || null, model, provider: "anthropic", raw: data };
    },
  };
  return provider;
}
