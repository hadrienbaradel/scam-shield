// Turns rule signals into words a 75-year-old can act on.
// Uses Muse Spark via the Meta Model API when configured; otherwise a
// deterministic plain-language fallback so the demo never depends on a key.

import { VERDICT_COPY } from "./rules.js";

function fallbackExplanation(email, result) {
  const copy = VERDICT_COPY[result.verdict];
  const why = result.signals.length
    ? result.signals.map((s) => s.plain)
    : ["The sender, the links and the wording all line up with what we would expect."];
  const steps =
    result.verdict === "danger"
      ? ["Close this email. Do not click, reply, or call any number inside it.",
         "If you are worried about the account it mentions, call the number on your bank card or official statement.",
         "Tap “Ask a trusted person” below and let someone you trust look before you do anything."]
      : result.verdict === "caution"
        ? ["Pause. Do not click anything yet.", "Ask a trusted person to look at this with you.", "If it claims to be your bank or an agency, call them on a number you already know — never one from this email."]
        : ["You do not need to do anything.", "Never share passwords, codes or gift-card numbers by email, even if an email looks fine."];
  return { headline: copy.headline, summary: copy.action, why, steps, source: "built-in explainer" };
}

export async function explainEmail(email, result) {
  const key = process.env.META_MODEL_API_KEY;
  const url = process.env.META_MODEL_API_URL;
  const model = process.env.META_MODEL_NAME;
  if (!key || !url || !model) return fallbackExplanation(email, result);

  const prompt = [
    "You explain email safety to a 75-year-old with no technical background.",
    "Use short sentences. No jargon. Never say the email is 100% safe.",
    "Return JSON only: {\"headline\": string, \"summary\": string, \"why\": string[], \"steps\": string[]}",
    `Verdict: ${result.verdict} (risk score ${result.score}/100)`,
    `From: ${email.fromName || ""} <${email.from || ""}>`,
    `Subject: ${email.subject || ""}`,
    "Facts found by our checker:",
    ...result.signals.map((s) => `- ${s.plain}`),
    "Email text (truncated):",
    String(email.body || "").slice(0, 2000),
  ].join("\n");

  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${key}` },
      body: JSON.stringify({
        model,
        messages: [
          { role: "system", content: "You are a calm, clear safety assistant for older adults." },
          { role: "user", content: prompt },
        ],
        temperature: 0.2,
      }),
    });
    if (!res.ok) throw new Error(`Meta Model API ${res.status}`);
    const data = await res.json();
    const text = data.choices?.[0]?.message?.content || "";
    const parsed = JSON.parse(text.slice(text.indexOf("{"), text.lastIndexOf("}") + 1));
    if (!parsed.headline || !Array.isArray(parsed.why)) throw new Error("bad shape");
    return { ...parsed, steps: Array.isArray(parsed.steps) ? parsed.steps : [], source: `Muse Spark (${model})` };
  } catch {
    return fallbackExplanation(email, result);
  }
}
