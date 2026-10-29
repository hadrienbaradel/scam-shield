// Llama Prompt Guard 2 (86M) on Groq: an OpenAI-style chat completion with the
// text as the only user message; the answer text is the classification
// (read by ./parse.js). Preview model, 512-token window, $0.04 per million
// tokens (console.groq.com, 2026-10-29). Key: GROQ_API_KEY. One call per
// chunk, no retries: lib/promptGuard/index.js owns the budget.

import { errorDetail, readScore } from "./parse.js";

export const GROQ_URL = "https://api.groq.com/openai/v1/chat/completions";
export const GROQ_MODEL = "meta-llama/llama-prompt-guard-2-86m";
const HINTS = { 401: " (GROQ_API_KEY refused)", 403: " (GROQ_API_KEY not allowed this model)", 404: " (model not available to this key)", 429: " (too many requests)" };

export function createGroqGuard() {
  return {
    name: "groq",
    keyName: "GROQ_API_KEY",
    model: GROQ_MODEL,
    label: "Llama Prompt Guard 2 (86M)",
    configured: () => Boolean(process.env.GROQ_API_KEY),
    async score(text, { signal, fetchImpl } = {}) {
      const res = await (fetchImpl || globalThis.fetch)(GROQ_URL, {
        method: "POST",
        signal,
        headers: { authorization: `Bearer ${process.env.GROQ_API_KEY}`, "content-type": "application/json" },
        body: JSON.stringify({ model: GROQ_MODEL, messages: [{ role: "user", content: text }] }),
      });
      const body = await res.text();
      if (!res.ok) throw new Error(`Groq ${res.status}${HINTS[res.status] || ""}${errorDetail(body)}`);
      let data;
      try { data = JSON.parse(body); } catch { throw new Error("Groq answered something that is not JSON"); }
      return readScore(data?.choices?.[0]?.message?.content);
    },
  };
}
