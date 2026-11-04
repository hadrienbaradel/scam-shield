// Corpus import for the public scam library (spec line 3): the two CC BY
// 4.0 SMS corpora the research kept, the UCI SMS Spam Collection (Almeida
// and Hidalgo, 2011) and Mishra and Soni's SMS Phishing Dataset (Mendeley
// f45bkkt8pr, 2022), become entries. Only CC BY sources: a share-alike
// corpus would put the whole library under SA and a non-commercial one
// would forbid the product's own use (_product/research/public-database/
// corpora.md, Decision notes). Here: each corpus's parser, the pick of spam
// samples not already in the library (deterministic, so two runs with the
// same seed draw the same messages), and the entry built from one sample
// and its classification (lib/libraryMuse.js). A corpus entry is
// classified, not judged: its verdict is null. The raw files never enter
// the repo (scripts/library-import.mjs keeps them under .runtime/). Pure:
// no network, no model, no file system.

import { BODY_MAX, BODY_MIN, bodyHash, redactExample } from "./library.js";

// What each corpus is called in sources.json (its row holds the name, the
// url, the licence and the attribution), the prefix of its entry ids, the
// year it was published (first_seen and last_seen: the corpus does not
// date its messages), how it is fetched and which file holds the rows.
export const CORPORA = {
  "uci-sms": {
    id: "uci-sms", prefix: "lib-uci-", seen: "2011-01-01", parse: parseUciSms,
    download: { url: "https://archive.ics.uci.edu/static/public/228/sms+spam+collection.zip", zip: "sms-spam-collection.zip", file: "SMSSpamCollection" },
  },
  "mishra-soni": {
    id: "mishra-soni", prefix: "lib-mishra-", seen: "2022-01-01", parse: parseMishraSoni,
    // The record page lists its files through this API; the zip's own link is in the answer.
    download: { api: "https://data.mendeley.com/public-api/datasets/f45bkkt8pr/files?folder_id=root&version=1", zip: "Dataset_5971.zip", file: "Dataset_5971.csv" },
  },
};
const SCAM_LABELS = new Set(["spam", "smishing"]);

// ------------------------------------------------------------ parsers ---
// UCI: one message per line, `ham` or `spam`, a tab, the text.
export function parseUciSms(text) {
  const rows = [];
  for (const line of String(text).split(/\r?\n/)) {
    const m = line.match(/^(ham|spam)\t([\s\S]*)$/);
    if (m) rows.push({ label: m[1], body: m[2].trim() });
  }
  return rows;
}

// RFC 4180: quoted fields may hold commas, doubled quotes and newlines.
// Rows keyed by the header; a short row (a blank line) is dropped.
function parseCsv(text) {
  const rows = [];
  let row = [], field = "", quoted = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quoted) {
      if (c === '"') { if (text[i + 1] === '"') { field += '"'; i++; } else quoted = false; } else field += c;
    } else if (c === '"') quoted = true;
    else if (c === ",") { row.push(field); field = ""; }
    else if (c === "\n" || c === "\r") {
      if (c === "\r" && text[i + 1] === "\n") i++;
      row.push(field); rows.push(row); row = []; field = "";
    } else field += c;
  }
  if (field || row.length) { row.push(field); rows.push(row); }
  const [head = [], ...data] = rows;
  const keys = head.map((h) => h.trim().toUpperCase());
  return data.filter((r) => r.length >= keys.length).map((r) => Object.fromEntries(keys.map((k, j) => [k, r[j]])));
}

// Mishra and Soni: a CSV with LABEL (ham, spam or smishing, in any case)
// and TEXT; the other columns (URL, EMAIL, PHONE flags) are not needed.
export function parseMishraSoni(csv) {
  return parseCsv(String(csv))
    .filter((r) => typeof r.LABEL === "string" && typeof r.TEXT === "string")
    .map((r) => ({ label: r.LABEL.trim().toLowerCase(), body: r.TEXT.trim() }));
}

// --------------------------------------------------------------- pick ---
// Same rows on every run with the same seed (mulberry32, as scripts/eval-corpus.mjs).
function shuffle(rows, seed) {
  let t = Number(seed) >>> 0;
  const rand = () => { t = (t + 0x6d2b79f5) >>> 0; let x = Math.imul(t ^ (t >>> 15), 1 | t); x ^= x + Math.imul(x ^ (x >>> 7), 61 | x); return ((x ^ (x >>> 14)) >>> 0) / 4294967296; };
  const a = [...rows];
  for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(rand() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; }
  return a;
}

// The spam and smishing rows, each once (the same words make the same
// message: bodyHash of the redacted body, so two samples that differ only
// by an account number are one) and none already in the library
// (existingHashes), in a fixed random order, the first `limit` of them
// (0: all). A body the library cannot hold is left out before anything
// is spent on it: shorter than BODY_MIN, longer than BODY_MAX, or garbled
// at the source (a U+FFFD replacement character where a pound sign was).
export function pickSamples(rows, { limit = 0, existingHashes = new Set(), seed = 1 } = {}) {
  const seen = new Set(existingHashes);
  const kept = [];
  for (const row of rows) {
    const body = String(row?.body ?? "").trim();
    if (!SCAM_LABELS.has(String(row?.label ?? "").toLowerCase())) continue;
    if (body.length < BODY_MIN || body.length > BODY_MAX || body.includes("�")) continue;
    const hash = bodyHash(redactExample({ body }).body);
    if (seen.has(hash)) continue;
    seen.add(hash);
    kept.push({ ...row, body, hash });
  }
  const out = shuffle(kept, seed);
  return limit > 0 ? out.slice(0, limit) : out;
}

// -------------------------------------------------------------- entry ---
const URL_RE = /\bhttps?:\/\/[^\s<>"')\]]+/gi;

// The message of a sample, redacted: the sender only when the corpus gives
// one (neither does), no subject, the links the body spells out (once
// each, trailing punctuation dropped). The same message goes to the model
// and into the entry.
export function messageFromSample(sample) {
  const body = String(sample?.body ?? "").trim();
  const hrefs = [...new Set([...body.matchAll(URL_RE)].map((m) => m[0].replace(/[.,;:!?]+$/, "")))];
  return redactExample({ from: sample?.from ?? null, subject: null, body, links: hrefs.map((href) => ({ text: null, href })) });
}

// One library entry: the classification's family, brand, lure and ask;
// English, no country (the corpora do not say where a message was
// received); the corpus's year as first and last seen; no verdict.
// `source` is the corpus's row of sources.json.
export function entryFromSample(sample, { id, source, classification = {}, firstSeen }) {
  return {
    id,
    family: classification.family ?? null,
    channel: "sms",
    country: null,
    language: "en",
    brand: classification.brand ?? null,
    lure: classification.lure ?? "",
    ask: classification.ask ?? "",
    message: messageFromSample(sample),
    first_seen: firstSeen,
    last_seen: firstSeen,
    source: { id: source.id, url: source.url ?? null, licence: source.licence, attribution: source.attribution },
    verdict: null,
    status: "published",
  };
}

// lib-uci-007: the prefix and a number from 1, zero-padded to three digits.
export const sampleId = (prefix, n) => `${prefix}${String(n).padStart(3, "0")}`;

// The next number after the entries already numbered with this prefix, so
// a second run adds and never rewrites.
export function nextNumber(ids, prefix) {
  let max = 0;
  for (const id of ids) {
    const m = String(id).match(new RegExp(`^${prefix.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(\\d+)$`));
    if (m) max = Math.max(max, Number(m[1]));
  }
  return max + 1;
}
