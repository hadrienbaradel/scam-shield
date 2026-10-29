// Llama Prompt Guard 2 (86M) on Hugging Face's own inference service
// (hf-inference, through the router): a text-classification call that
// answers {label, score} lists (read by ./parse.js). The model is gated
// (Llama 4 Community License): the token's account accepts the licence on
// the model page, and the token needs the "Inference Providers" permission.
// Key: HF_TOKEN. One call per chunk, no retries.

import { errorDetail, scoreFromLabels } from "./parse.js";

export const HF_MODEL = "meta-llama/Llama-Prompt-Guard-2-86M";
export const HF_URL = `https://router.huggingface.co/hf-inference/models/${HF_MODEL}`;
const HINTS = {
  401: " (HF_TOKEN refused)",
  403: " (accept the model's licence on huggingface.co; the token needs the Inference Providers permission)",
  404: " (model not served for this token)",
  429: " (too many requests)",
  503: " (the model is loading; try again in a minute)",
};

export function createHfGuard() {
  return {
    name: "hf",
    keyName: "HF_TOKEN",
    model: HF_MODEL,
    label: "Llama Prompt Guard 2 (86M)",
    configured: () => Boolean(process.env.HF_TOKEN),
    async score(text, { signal, fetchImpl } = {}) {
      const res = await (fetchImpl || globalThis.fetch)(HF_URL, {
        method: "POST",
        signal,
        headers: { authorization: `Bearer ${process.env.HF_TOKEN}`, "content-type": "application/json" },
        body: JSON.stringify({ inputs: text }),
      });
      const body = await res.text();
      if (!res.ok) throw new Error(`Hugging Face ${res.status}${HINTS[res.status] || ""}${errorDetail(body)}`);
      let data;
      try { data = JSON.parse(body); } catch { throw new Error("Hugging Face answered something that is not JSON"); }
      return scoreFromLabels(data);
    },
  };
}
