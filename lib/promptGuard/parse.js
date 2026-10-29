// Reading Prompt Guard 2's answer, whoever hosts it, as one number: the
// probability that the text is an attack (0 to 1). Hugging Face answers a
// list of {label, score}; Groq's answer text is not documented (checked
// 2026-10-29), so a probability, a label and JSON holding either are read.
// Label names differ too: "malicious"/"benign" on the model card, LABEL_1 /
// LABEL_0 in the model's config according to a third-party benchmark
// (unverified), so both are understood.

const MALICIOUS = /^(malicious|injection|jailbreak|unsafe|attack|label_1)$/i;
const BENIGN = /^(benign|safe|label_0)$/i;
const clamp = (n) => Math.min(1, Math.max(0, n));

// A {label, score} list, flat or nested once ([[...]] for one input), or a
// single object: the attack class's probability, else 1 minus the benign one.
export function scoreFromLabels(answer) {
  const list = Array.isArray(answer) ? (Array.isArray(answer[0]) ? answer[0] : answer) : [answer];
  const items = list.filter((x) => x && typeof x.label === "string" && Number.isFinite(Number(x.score)));
  const bad = items.find((x) => MALICIOUS.test(x.label.trim()));
  if (bad) return clamp(Number(bad.score));
  const good = items.find((x) => BENIGN.test(x.label.trim()));
  if (good) return clamp(1 - Number(good.score));
  throw new Error(`labels we do not know (${JSON.stringify(items.map((x) => x.label)).slice(0, 60) || "none"})`);
}

// An answer text: "0.997", "MALICIOUS", "BENIGN", {"label": ..., "score": ...}, [...].
export function readScore(content) {
  if (typeof content === "number" && Number.isFinite(content)) return clamp(content);
  const s = String(content ?? "").trim();
  if (/^[-+]?(\d+\.?\d*|\.\d+)(e[-+]?\d+)?$/i.test(s)) return clamp(Number(s));
  if (/^[[{]/.test(s)) {
    let json;
    try { json = JSON.parse(s); } catch { json = undefined; }
    if (typeof json === "number") return clamp(json);
    if (json && !Array.isArray(json) && typeof json.label !== "string" && Number.isFinite(Number(json.score))) return clamp(Number(json.score));
    if (json !== undefined) return scoreFromLabels(json);
  }
  const word = s.replace(/[^A-Za-z0-9_]+/g, " ").trim().split(" ")[0] || "";
  if (MALICIOUS.test(word)) return 1;
  if (BENIGN.test(word)) return 0;
  throw new Error(`an answer we cannot read (${s.slice(0, 40) || "empty"})`);
}

// The useful part of an error body, on one line: {"error": {"message"}},
// {"error": "..."} or {"message"}; nothing when there is none.
export function errorDetail(body) {
  let text = "";
  try {
    const j = JSON.parse(body);
    text = j?.error?.message || (typeof j?.error === "string" ? j.error : "") || j?.message || "";
  } catch { text = ""; }
  text = String(text).replace(/\s+/g, " ").trim();
  return text ? `: ${text.slice(0, 160)}` : "";
}
