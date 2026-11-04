// The public scam library (_product/specs/public-database.md, lines 1-5):
// the shape of an entry, what makes one valid, the redaction that keeps a
// scam's evidence (its sender, links and phone numbers) but never the
// recipient's data, the body hash that spots a resubmitted message, the
// indicators behind the suspect list, the filters of the public page, the
// CC BY 4.0 export and the loader of data/library/. The repo is the
// database: one JSON file per entry, families and sources as JSON, every
// file validated when loaded. Pure: no network, no database
// (src/library/store.js adds Postgres for the submissions).

import { createHash } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { schemaErrors } from "./schema.js";

export const LIBRARY_DIR = fileURLToPath(new URL("../data/library/", import.meta.url));
export const LICENCE = "CC BY 4.0";
export const CHANNELS = ["email", "sms", "chat", "voice", "web", "letter"];
export const LIBRARY_VERDICTS = ["scam", "be_careful"];
// retired: pulled from the site (a contest upheld, a takedown) without losing the file.
export const STATUSES = ["published", "retired"];
export const BODY_MIN = 20;
export const BODY_MAX = 10000;

const nullable = (type, extra = {}) => ({ type: [type, "null"], ...extra });
export const ENTRY_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["id", "family", "channel", "country", "language", "brand", "lure", "ask", "message", "first_seen", "last_seen", "source", "verdict", "status"],
  properties: {
    id: { type: "string", maxLength: 80 },
    family: { type: "string", maxLength: 40 },
    channel: { type: "string", enum: CHANNELS },
    country: nullable("string", { maxLength: 2 }),
    language: nullable("string", { maxLength: 2 }),
    brand: nullable("string", { maxLength: 120 }),
    lure: { type: "string", maxLength: 200 },
    ask: { type: "string", maxLength: 200 },
    message: {
      type: "object", additionalProperties: false, required: ["body"],
      properties: {
        from: nullable("string", { maxLength: 320 }),
        subject: nullable("string", { maxLength: 500 }),
        body: { type: "string", maxLength: BODY_MAX },
        links: {
          type: "array", maxItems: 50,
          items: { type: "object", additionalProperties: false, required: ["href"],
            properties: { text: nullable("string", { maxLength: 500 }), href: { type: "string", maxLength: 2000 } } },
        },
      },
    },
    first_seen: { type: "string", maxLength: 10 },
    last_seen: { type: "string", maxLength: 10 },
    source: {
      type: "object", additionalProperties: false, required: ["id", "licence", "attribution"],
      properties: { id: { type: "string", maxLength: 40 }, url: nullable("string", { maxLength: 2000 }), licence: { type: "string", maxLength: 40 }, attribution: { type: "string", maxLength: 300 } },
    },
    verdict: {
      type: ["object", "null"], additionalProperties: false, required: ["verdict", "headline", "reasons"],
      properties: {
        verdict: { type: "string", enum: LIBRARY_VERDICTS },
        headline: { type: "string", maxLength: 200 },
        reasons: { type: "array", maxItems: 5, items: { type: "string", maxLength: 300 } },
      },
    },
    status: { type: "string", enum: STATUSES },
  },
};

const isoDate = (s) => typeof s === "string" && /^\d{4}-\d{2}-\d{2}$/.test(s) && !Number.isNaN(Date.parse(`${s}T00:00:00Z`)) && new Date(`${s}T00:00:00Z`).toISOString().startsWith(s);

// Every problem at once, in words a reviewer can act on: the admin page
// shows them under the Approve button.
export function validateEntry(entry, { families = [], sources = [] } = {}) {
  if (!entry || typeof entry !== "object" || Array.isArray(entry)) return ["entry is not an object"];
  const errs = [];
  for (const k of ENTRY_SCHEMA.required) if (!(k in entry)) errs.push(`missing ${k}`);
  errs.push(...schemaErrors(ENTRY_SCHEMA, entry).filter((e) => !e.endsWith(": missing")));
  if (typeof entry.id === "string" && !/^lib-[a-z0-9][a-z0-9-]*$/.test(entry.id)) errs.push("id must be lib- followed by lowercase letters, digits and dashes");
  if (typeof entry.family === "string" && !families.some((f) => f.id === entry.family)) errs.push(`unknown family ${entry.family}`);
  if (typeof entry.country === "string" && !/^[A-Z]{2}$/.test(entry.country)) errs.push("country must be an ISO 3166-1 alpha-2 code or null");
  if (typeof entry.language === "string" && !/^[a-z]{2}$/.test(entry.language)) errs.push("language must be an ISO 639-1 code or null");
  const m = entry.message;
  if (m && typeof m === "object" && typeof m.body === "string") {
    if (m.body.length < BODY_MIN || m.body.length > BODY_MAX) errs.push(`body must be ${BODY_MIN} to ${BODY_MAX} characters`);
    const r = redactExample(m);
    if (r.body !== m.body || r.subject !== (m.subject ?? null)) errs.push("body carries personal data");
  }
  for (const k of ["first_seen", "last_seen"]) if (typeof entry[k] === "string" && !isoDate(entry[k])) errs.push(`${k} must be a YYYY-MM-DD date`);
  if (isoDate(entry.first_seen) && isoDate(entry.last_seen) && entry.last_seen < entry.first_seen) errs.push("last_seen is before first_seen");
  if (entry.source && typeof entry.source === "object" && typeof entry.source.id === "string" && !sources.some((s) => s.id === entry.source.id)) errs.push(`unknown source ${entry.source.id}`);
  return errs;
}

// ---------------------------------------------------------- redaction ---
// The same patterns as redactForModel (lib/muse.js), with two differences
// the library needs: phone numbers stay (a scammer's number is evidence,
// the suspect list is built on it) and the recipient's name becomes
// [name]. Email addresses in the text become [someone]@domain: a sender's
// address is evidence in `from`, a recipient's or a reply-to in the body
// is not. Bank account numbers, card numbers, social security numbers and
// one-time codes go: the only numbers a scam quotes that belong to its
// victim.
const luhn = (digits) => {
  let sum = 0;
  for (let i = 0; i < digits.length; i++) {
    let n = Number(digits[digits.length - 1 - i]);
    if (i % 2) { n *= 2; if (n > 9) n -= 9; }
    sum += n;
  }
  return sum % 10 === 0;
};
const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

function redactText(text, name) {
  let out = String(text);
  out = out.replace(/\b[A-Z]{2}\d{2}(?:[ -]?[A-Z0-9]{2,4}){3,8}\b/g, "[bank account number]");
  out = out.replace(/\b(?:\d[ -]?){13,19}\b/g, (m) => (luhn(m.replace(/\D/g, "")) ? "[card number]" : m));
  out = out.replace(/\b\d{3}-\d{2}-\d{4}\b/g, "[social security number]");
  out = out.replace(/\b[12][ ]?\d{2}[ ]?\d{2}[ ]?\d{2}[ ]?\d{3}[ ]?\d{3}(?:[ ]?\d{2})?\b/g, "[social security number]");
  out = out.replace(/\b(code|otp|pin|passcode|mot de passe|password)([^.\d]{0,25})(\d{4,8})\b/gi, (m, w, mid) => `${w}${mid}[code]`);
  out = out.replace(/\b[A-Za-z0-9._%+-]+@([A-Za-z0-9.-]+\.[A-Za-z]{2,})\b/g, "[someone]@$1");
  if (name.length >= 3) out = out.replace(new RegExp(`\\b${escapeRe(name)}\\b`, "gi"), "[name]");
  return out;
}

export function redactExample(message = {}, { recipientName = "" } = {}) {
  const name = String(recipientName || "").trim();
  return {
    ...message,
    subject: message.subject == null ? null : redactText(message.subject, name),
    body: redactText(message.body ?? "", name),
  };
}

// The same words make the same message: case, digits, punctuation and
// spacing do not count, so "Pay $1.99 now!" and "pay 1 99 NOW" are one.
export function bodyHash(message) {
  const body = typeof message === "string" ? message : message?.body ?? "";
  const text = String(body).toLowerCase().replace(/[\p{P}\p{S}\d]+/gu, " ").replace(/\s+/g, " ").trim();
  return createHash("sha256").update(text).digest("hex");
}
