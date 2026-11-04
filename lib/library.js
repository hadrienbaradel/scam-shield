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
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { schemaErrors } from "./schema.js";
import { BRANDS, belongsTo } from "./brands.js";

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
// shows them under the Approve button. Returns the errors as string[]; the
// array also carries a `warnings` field (string[]), things a human should
// look at that do not make the entry invalid: the text may still hold a
// first name (nameWarnings below), which no rule can prove absent. The
// reviewer's approval before publishing stays the safeguard (spec line 2).
export function validateEntry(entry, { families = [], sources = [] } = {}) {
  const withWarnings = (errs, warnings) => Object.defineProperty(errs, "warnings", { value: warnings, enumerable: false });
  if (!entry || typeof entry !== "object" || Array.isArray(entry)) return withWarnings(["entry is not an object"], []);
  const errs = withWarnings([], nameWarnings(entry.message));
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
// The patterns of redactForModel (lib/muse.js), with the differences the
// library needs: phone numbers stay (a scammer's number is evidence, the
// suspect list is built on it), the recipient's name becomes [name], an
// IBAN is caught in any case and with dots or dashes between its groups,
// and a one-time code is caught when written in groups ("code: 12 34 56")
// or a few words after the word ("votre code de validation est 123456").
// Email addresses in the text become [someone]@domain: a sender's address
// is evidence in `from`, a recipient's or a reply-to in the body is not.
// Bank account numbers, card numbers, social security numbers and
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
  // Upper case with letter groups (GB29 NWBK 6016...), or any case when the groups are digits (fr76.3000.6000...).
  out = out.replace(/\b[A-Z]{2}\d{2}(?:[ .-]?[A-Z0-9]{2,4}){3,8}\b/g, "[bank account number]");
  out = out.replace(/\b[A-Za-z]{2}\d{2}(?:[ .-]?\d{2,4}){3,8}\b/g, "[bank account number]");
  out = out.replace(/\b(?:\d[ -]?){13,19}\b/g, (m) => (luhn(m.replace(/\D/g, "")) ? "[card number]" : m));
  out = out.replace(/\b\d{3}-\d{2}-\d{4}\b/g, "[social security number]");
  out = out.replace(/\b[12][ ]?\d{2}[ ]?\d{2}[ ]?\d{2}[ ]?\d{3}[ ]?\d{3}(?:[ ]?\d{2})?\b/g, "[social security number]");
  out = out.replace(/\b(code|otp|pin|passcode|mot de passe|password)\b([^.\d]{0,40}?)(\d(?:[ -]?\d){3,7})\b/gi, (m, w, mid) => `${w}${mid}[code]`);
  out = out.replace(/\b[A-Za-z0-9._%+-]+@([A-Za-z0-9.-]+\.[A-Za-z]{2,})\b/g, "[someone]@$1");
  if (name.length >= 3) out = out.replace(new RegExp(`\\b${escapeRe(name)}\\b`, "gi"), "[name]");
  return out;
}

// What no rule can prove absent: a first name. A capitalised word after a
// greeting (Dear, Hi, Bonjour, Madame...) or one opening a sentence before
// a comma ("Françoise, call us") is named so the reviewer looks there. The
// greeting words themselves and the usual stand-ins (Customer, Grandma...)
// are not names.
const GREETINGS = ["dear", "hi", "hello", "hey", "bonjour", "bonsoir", "salut", "madame", "monsieur", "mme", "chère", "cher", "coucou"];
const NOT_NAMES = new Set([...GREETINGS, "customer", "client", "sir", "madam", "user", "member", "valued", "friend", "team", "all", "there",
  "grandma", "grandpa", "grandmother", "grandfather", "mum", "mom", "dad", "mamie", "papi", "papy", "maman", "papa", "mother", "father",
  "merci", "thanks", "thank", "please", "attention", "urgent", "important", "yes", "oui", "non", "ok"]);
const CAP = "[A-ZÀ-ÖØ-Þ][a-zà-öø-ÿ]{2,}";
export function nameWarnings(message = {}) {
  const text = `${message?.subject ?? ""}\n${message?.body ?? ""}`;
  const found = new Set();
  for (const m of text.matchAll(new RegExp(`\\b(${GREETINGS.join("|")})\\s+(${CAP})\\b`, "gi"))) found.add(m[2]);
  for (const m of text.matchAll(new RegExp(`(?:^|[.!?\\n]\\s*)(${CAP})\\s*,`, "gm"))) found.add(m[1]);
  return [...found].filter((w) => !NOT_NAMES.has(w.toLowerCase())).map((w) => `may carry a name: ${w}`);
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

// --------------------------------------------------------- indicators ---
// What the suspect list (lib/suspects.js) counts: the hosts of the links
// and of the addresses written in the text, the sender's address or
// number, the numbers written in the text. Never a reserved or private
// host (the demo's .test addresses), a redacted [someone]@ placeholder or
// a brand's own address (a real site quoted as a decoy, a spoofed real
// sender: lib/threatfeed.js has the same gate for cards). A Be careful
// entry may be a genuine message judged with caution (a real bank's
// alert): it accuses nobody, so it has no indicators; an entry without a
// verdict (an imported spam sample) counts.
const RESERVED_TLDS = ["test", "example", "invalid", "localhost", "local", "onion"];
const PRIVATE_IP = /^(?:10\.|127\.|0\.|169\.254\.|192\.168\.|172\.(?:1[6-9]|2\d|3[01])\.)\d/;
const URL_RE = /https?:\/\/[^\s<>"'`)\]]+/gi;
const EMAIL_RE = /^([^\s@<>]+)@([A-Za-z0-9.-]+\.[A-Za-z]{2,})$/;
const PHONE_RE = /\+\d{1,3}[\s.-]?\(?\d{1,4}\)?(?:[\s.-]?\d{2,4}){2,5}|\b0[1-9](?:[\s.-]?\d{2}){4}\b|\b00\d{9,13}\b|(?:\b1[\s.-])?\(?\b\d{3}\)?[\s.-]\d{3}[\s.-]\d{4}\b|(?:\b1[\s.-])?\b\d{3}[\s.-]\d{4}\b/g;

export function reservedHost(host = "") {
  const h = String(host).toLowerCase();
  if (!h || h === "localhost" || h.startsWith("[") || PRIVATE_IP.test(h)) return true;
  const parts = h.split(".");
  return RESERVED_TLDS.includes(parts.at(-1)) || /^example\.(com|net|org)$/.test(parts.slice(-2).join("."));
}
const brandOwned = (host) => BRANDS.some((b) => belongsTo(host, b));
const hostOf = (url) => { try { return new URL(url).hostname.toLowerCase().replace(/^www\./, ""); } catch { return ""; } };
const phoneDigits = (s) => (s.trim().startsWith("+") ? "+" : "") + s.replace(/\D/g, "");
const isPhone = (s) => /^\+?\d{7,15}$/.test(s.replace(/[\s().-]/g, ""));

export function indicatorsOf(entry = {}) {
  const out = { domains: [], senders: [], phones: [] };
  if (entry?.verdict?.verdict === "be_careful") return out;
  const m = entry?.message || {};
  const text = `${m.subject ?? ""}\n${m.body ?? ""}`;
  const add = (list, v) => { if (v && !list.includes(v)) list.push(v); };
  for (const href of [...(m.links || []).map((l) => l?.href), ...(text.match(URL_RE) || [])]) {
    const host = hostOf(href);
    if (host && !reservedHost(host) && !brandOwned(host)) add(out.domains, host);
  }
  const from = String(m.from ?? "").trim();
  const email = from.match(EMAIL_RE);
  if (email) {
    if (!email[1].startsWith("[") && !reservedHost(email[2]) && !brandOwned(email[2].toLowerCase())) add(out.senders, from.toLowerCase());
  } else if (from && isPhone(from)) {
    add(out.phones, phoneDigits(from));
  }
  for (const p of text.match(PHONE_RE) || []) add(out.phones, phoneDigits(p));
  return out;
}

// ------------------------------------------------- filters and export ---
export function filterEntries(entries, { family, channel, country, language, q } = {}) {
  const words = String(q ?? "").trim().toLowerCase();
  const same = (a, b) => String(a ?? "").toLowerCase() === String(b).toLowerCase();
  return entries.filter((e) => (!family || e.family === family)
    && (!channel || e.channel === channel)
    && (!country || same(e.country, country))
    && (!language || same(e.language, language))
    && (!words || [e.brand, e.lure, e.ask, e.message?.subject, e.message?.body].some((v) => String(v ?? "").toLowerCase().includes(words))));
}

// The whole library as one file, under the licence every entry carries.
export function exportLibrary({ families, sources, entries }) {
  return { licence: LICENCE, generated: new Date().toISOString(), families, sources, entries };
}

// ------------------------------------------------------------- loader ---
// data/library/: families.json, sources.json, entries/*.json. A file that
// does not validate stops the load and is named: a bad entry never reaches
// the site, and `make test` catches it before it is merged.
export async function loadLibraryFiles(dir = LIBRARY_DIR) {
  const readJson = async (name) => {
    try { return JSON.parse(await readFile(join(dir, name), "utf8")); } catch (e) { throw new Error(`${name}: ${e.message}`); }
  };
  const families = await readJson("families.json");
  const sources = await readJson("sources.json");
  const entries = [];
  const seen = new Set();
  // No entries folder yet: an empty library, not a broken one.
  const files = await readdir(join(dir, "entries")).catch((e) => { if (e.code === "ENOENT") return []; throw e; });
  for (const file of files.filter((f) => f.endsWith(".json")).sort()) {
    const entry = await readJson(join("entries", file));
    const errs = validateEntry(entry, { families, sources });
    if (seen.has(entry?.id)) errs.push(`id ${entry.id} is already used`);
    if (errs.length) throw new Error(`${file}: ${errs.join("; ")}`);
    seen.add(entry.id);
    entries.push(entry);
  }
  return { families, sources, entries };
}
