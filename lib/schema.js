// The fixed verdict contract from the PRD. UI, Gmail labels and guardian
// alerts all read this one shape — never free text from a model.

export const VERDICTS = ["safe", "be_careful", "scam"];

export const ACTIONS = [
  "do_nothing", "delete", "verify_with_real_person", "call_official_number",
  "check_official_website", "ask_guardian", "report",
];

export const EVIDENCE_KINDS = [
  "auth", "sender", "link", "breach", "personal_context", "pattern",
  "pressure", "payment", "contact_history", "thread", "link_inspection",
];

export const SCAM_TYPES = [
  "impersonation", "fake_invoice_or_renewal", "parcel", "toll", "government",
  "bank", "tech_support", "account_takeover_contact", "voice_clone_family",
  "sextortion", "recovery", "romance_investment", "code_theft", "other",
];

export const VERDICT_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["verdict", "confidence", "headline", "reasons", "action", "action_text",
    "real_company_says", "impersonated_brand", "scam_type", "matched_pattern_ids",
    "escalate_to_guardian", "guardian_summary", "language"],
  properties: {
    verdict: { type: "string", enum: VERDICTS },
    confidence: { type: "number", minimum: 0, maximum: 1 },
    headline: { type: "string", maxLength: 140 },
    reasons: {
      type: "array", minItems: 1, maxItems: 3,
      items: {
        type: "object", additionalProperties: false, required: ["text", "evidence"],
        properties: {
          text: { type: "string", maxLength: 200 },
          evidence: { type: "string", enum: EVIDENCE_KINDS },
        },
      },
    },
    action: { type: "string", enum: ACTIONS },
    action_text: { type: "string", maxLength: 240 },
    real_company_says: { type: ["string", "null"] },
    impersonated_brand: { type: ["string", "null"] },
    scam_type: { type: ["string", "null"], enum: [...SCAM_TYPES, null] },
    matched_pattern_ids: { type: "array", items: { type: "string" } },
    escalate_to_guardian: { type: "boolean" },
    guardian_summary: { type: ["string", "null"] },
    language: { type: "string", enum: ["en", "fr"] },
  },
};

// A small JSON Schema checker covering what VERDICT_SCHEMA uses: type
// (incl. unions), enum, required, properties, additionalProperties:false,
// items, min/maxItems, maxLength, minimum/maximum.
const typeOf = (x) => (x === null ? "null" : Array.isArray(x) ? "array" : typeof x);
export function schemaErrors(schema, value, path = "$") {
  const errs = [];
  const types = [].concat(schema.type || []);
  if (types.length && !types.includes(typeOf(value)) && !(types.includes("integer") && Number.isInteger(value))) {
    return [`${path}: expected ${types.join("|")}, got ${typeOf(value)}`];
  }
  if (schema.enum && !schema.enum.includes(value)) errs.push(`${path}: not one of ${schema.enum.join(", ")}`);
  if (typeof value === "string" && schema.maxLength && value.length > schema.maxLength) errs.push(`${path}: longer than ${schema.maxLength}`);
  if (typeof value === "number") {
    if (schema.minimum !== undefined && value < schema.minimum) errs.push(`${path}: below ${schema.minimum}`);
    if (schema.maximum !== undefined && value > schema.maximum) errs.push(`${path}: above ${schema.maximum}`);
  }
  if (Array.isArray(value)) {
    if (schema.minItems !== undefined && value.length < schema.minItems) errs.push(`${path}: fewer than ${schema.minItems} items`);
    if (schema.maxItems !== undefined && value.length > schema.maxItems) errs.push(`${path}: more than ${schema.maxItems} items`);
    if (schema.items) value.forEach((item, i) => errs.push(...schemaErrors(schema.items, item, `${path}[${i}]`)));
  }
  if (typeOf(value) === "object") {
    for (const k of schema.required || []) if (!(k in value)) errs.push(`${path}.${k}: missing`);
    for (const [k, sub] of Object.entries(schema.properties || {})) if (k in value) errs.push(...schemaErrors(sub, value[k], `${path}.${k}`));
    if (schema.additionalProperties === false) {
      for (const k of Object.keys(value)) if (!(k in (schema.properties || {}))) errs.push(`${path}.${k}: not allowed`);
    }
  }
  return errs;
}

// Keeps only the fields the schema knows (a model may add harmless extras;
// nothing unknown ever reaches the UI, labels or guardians).
export function pickVerdictFields(v) {
  if (!v || typeof v !== "object") return v;
  return Object.fromEntries(Object.keys(VERDICT_SCHEMA.properties).filter((k) => k in v).map((k) => [k, v[k]]));
}

export function validateVerdict(v) {
  if (!v || typeof v !== "object") return ["verdict is not an object"];
  // Underscore fields are the detector's internal evidence, never shown.
  const errs = schemaErrors(VERDICT_SCHEMA, Object.fromEntries(Object.entries(v).filter(([k]) => !k.startsWith("_"))));
  if (!VERDICTS.includes(v.verdict)) errs.push(`bad verdict: ${v.verdict}`);
  if (typeof v.confidence !== "number" || v.confidence < 0 || v.confidence > 1) errs.push("confidence out of range");
  if (!v.headline || typeof v.headline !== "string") errs.push("missing headline");
  if (!Array.isArray(v.reasons) || v.reasons.length < 1 || v.reasons.length > 3) errs.push("reasons must be 1-3");
  for (const r of v.reasons || []) {
    if (!r.text || !EVIDENCE_KINDS.includes(r.evidence)) errs.push(`bad reason: ${JSON.stringify(r)}`);
  }
  if (!ACTIONS.includes(v.action)) errs.push(`bad action: ${v.action}`);
  if (!v.action_text) errs.push("missing action_text");
  if (!("real_company_says" in v)) errs.push("missing real_company_says");
  if (!("impersonated_brand" in v)) errs.push("missing impersonated_brand");
  if (!("scam_type" in v) || (v.scam_type !== null && !SCAM_TYPES.includes(v.scam_type))) errs.push(`bad scam_type: ${v.scam_type}`);
  if (!Array.isArray(v.matched_pattern_ids)) errs.push("matched_pattern_ids must be array");
  if (typeof v.escalate_to_guardian !== "boolean") errs.push("escalate_to_guardian must be boolean");
  if (!("guardian_summary" in v)) errs.push("missing guardian_summary");
  if (!["en", "fr"].includes(v.language)) errs.push(`bad language: ${v.language}`);
  return errs;
}

export const isValidVerdict = (v) => validateVerdict(v).length === 0;
