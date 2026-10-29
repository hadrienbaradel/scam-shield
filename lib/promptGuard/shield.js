// What a Prompt Guard 2 finding does to a verdict (_product/specs/prompt-guard.md,
// lines 3 to 6). lib/muse.js applies it to every verdict it returns: the
// model's, a cached one, or the rules' own. A finding is a strong signal,
// never a verdict by itself: it sets a floor (never Safe), puts its reason
// first and names the model. Safe becomes Be careful; Be careful becomes Scam
// only when the rules already said Scam (and the sender is not one this
// person's own history authenticates); Scam stays Scam.

export const INJECTION_REASON = {
  en: "This message tried to trick the AI that checks your mail.",
  fr: "Ce message a essayé de tromper l'IA qui vérifie votre courrier.",
};
// The rules' own line for orders aimed at the checker (lib/detector.js, rule
// 0): the same fact, so it is not repeated under ours.
const RULE_LINES = new Set([
  "This message tries to give orders to the safety checker itself.",
  "Ce message essaie de donner des ordres au vérificateur lui-même.",
]);

// The fact Muse Spark gets, as one more detector finding (redacted quote).
export function injectionFinding(scan) {
  return {
    fact: `The message contains text addressed to AI assistants${scan.hidden ? ", hidden from the reader" : ""}: "${scan.snippet || ""}" (${scan.label}: malicious, score ${scan.score})`,
    kind: "pattern",
    strong: true,
  };
}

// verdict: a full verdict (schema fields plus source and the like).
// scan: scanForInjection's result. rules: the detector's own verdict.
export function applyInjectionShield(verdict, scan, { rules = null } = {}) {
  if (!verdict || !scan?.checked) return verdict;
  const out = {
    ...verdict,
    source: `${verdict.source || "Prudence"} + ${scan.label}`,
    prompt_guard: { model: scan.model, provider: scan.provider, detected: scan.detected, score: scan.score, chunks: scan.chunks },
  };
  if (!scan.detected) return out;
  const fr = verdict.language === "fr";
  const L = (en, f) => (fr ? f : en);
  const reason = { text: L(INJECTION_REASON.en, INJECTION_REASON.fr), evidence: "pattern" };
  const reasons = [reason, ...(verdict.reasons || []).filter((r) => r && r.text !== reason.text && !RULE_LINES.has(r.text))].slice(0, 3);
  const target = verdict.verdict === "scam" || (rules?.verdict === "scam" && !rules._authentic) ? "scam" : "be_careful";
  if (target === verdict.verdict) return { ...out, reasons };
  const common = {
    ...out,
    verdict: target,
    reasons,
    scam_type: verdict.scam_type || rules?.scam_type || "other",
    impersonated_brand: verdict.impersonated_brand ?? rules?.impersonated_brand ?? null,
    real_company_says: verdict.real_company_says ?? rules?.real_company_says ?? null,
    escalate_to_guardian: Boolean(verdict.escalate_to_guardian || rules?.escalate_to_guardian),
    guardrail: "prompt_guard_injection",
  };
  if (target === "scam") {
    return {
      ...common,
      confidence: Math.max(Number(verdict.confidence) || 0, Number(rules.confidence) || 0, 0.8),
      headline: rules.headline,
      action: rules.action,
      action_text: rules.action_text,
      guardian_summary: rules.guardian_summary || verdict.guardian_summary || null,
    };
  }
  return {
    ...common,
    confidence: 0.6,
    headline: L("Be careful: check this before you do anything.", "Attention : vérifiez avant de faire quoi que ce soit."),
    action: "check_official_website",
    action_text: L("Do not use the links in it. Open the company's own app or website yourself, or ask someone you trust.",
      "N'utilisez pas ses liens. Ouvrez vous-même l'application ou le site officiel, ou demandez à un proche."),
    guardian_summary: verdict.guardian_summary || L(
      `Prudence's AI guard (${scan.label}) found text written to trick the AI that checks your relative's mail in a message they received, so it is marked Be careful.`,
      `Le garde IA de Prudence (${scan.label}) a trouvé, dans un message reçu par votre proche, un texte écrit pour tromper l'IA qui vérifie son courrier : il est marqué « Attention ».`),
  };
}
