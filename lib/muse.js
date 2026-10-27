// Muse Spark layer. Builds the exact tagged input from the PRD system
// prompt, calls the Meta Model API when configured, schema-checks the
// answer, and falls back to the deterministic detector on any failure.
// Standard mode only — never Contributor mode (PRD privacy rule).

import { readFile } from "node:fs/promises";
import { validateVerdict } from "./schema.js";
import { detect } from "./detector.js";

let systemPromptCache = null;
export async function systemPrompt() {
  if (!systemPromptCache) {
    systemPromptCache = await readFile(new URL("../prompts/scam-shield-system.md", import.meta.url), "utf8");
  }
  return systemPromptCache;
}

export function buildUserPrompt({ locale, message, linkInspection, personalContext, patternCards, threadHistory }) {
  const links = (message.links || []).map((l) => `[shown "${l.text || l.href}" -> ${l.href}]`).join(" ") || "none";
  return [
    `<locale>${locale || "en-US"}</locale>`,
    `<message channel="${message.channel || "email"}">`,
    `From: "${message.fromName || ""}" ${message.from || ""}`,
    message.replyTo ? `Reply-To: ${message.replyTo}` : "Reply-To: none",
    `Authentication: ${typeof message.auth === "string" ? message.auth : JSON.stringify(message.auth || {})}`,
    message.subject ? `Subject: ${message.subject}` : "",
    `Body: ${message.body || ""}`,
    `Links: ${links}`,
    `</message>`,
    `<link_inspection>${linkInspection ? JSON.stringify(linkInspection) : "none"}</link_inspection>`,
    `<personal_context>${personalContext ? JSON.stringify(personalContext) : "none"}</personal_context>`,
    `<pattern_cards>${patternCards ? JSON.stringify(patternCards) : "[]"}</pattern_cards>`,
    `<thread_history>${threadHistory ? JSON.stringify(threadHistory) : "[]"}</thread_history>`,
  ].filter(Boolean).join("\n");
}

export const museConfigured = () =>
  Boolean(process.env.META_MODEL_API_KEY && process.env.META_MODEL_API_URL && process.env.META_MODEL_NAME);

export async function checkMessage(input) {
  const fallback = detect(input);
  if (!museConfigured()) return { ...stripInternal(fallback), source: "detector (Muse Spark not configured)" };

  try {
    const res = await fetch(process.env.META_MODEL_API_URL, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${process.env.META_MODEL_API_KEY}`,
        // Standard mode only: prompts must never train future models.
        "x-meta-data-mode": "standard",
      },
      body: JSON.stringify({
        model: process.env.META_MODEL_NAME,
        messages: [
          { role: "system", content: await systemPrompt() },
          { role: "user", content: buildUserPrompt(input) },
        ],
        temperature: 0.1,
      }),
    });
    if (!res.ok) throw new Error(`Meta Model API ${res.status}`);
    const data = await res.json();
    const text = data.choices?.[0]?.message?.content || "";
    const parsed = JSON.parse(text.slice(text.indexOf("{"), text.lastIndexOf("}") + 1));
    const errs = validateVerdict(parsed);
    if (errs.length) throw new Error(`schema: ${errs.join("; ")}`);
    // Guardrail: a model may never wave through what the evidence proves,
    // nor condemn an authentic sender the detector cleared.
    if (fallback.verdict === "scam" && parsed.verdict === "safe") parsed.verdict = "be_careful";
    return { ...parsed, source: `Muse Spark (${process.env.META_MODEL_NAME})` };
  } catch {
    return { ...stripInternal(fallback), source: "detector (Muse Spark unavailable)" };
  }
}

function stripInternal(v) {
  const { _score, _signals, ...rest } = v;
  return rest;
}
