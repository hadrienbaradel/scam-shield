// The suspect list (_product/specs/public-database.md, lines 6 and 7): one
// indicator out of whatever a visitor typed (a website, a sender address or
// a phone number, written any way), and the evidence-backed answer: how
// many published entries used it, weighted by age so an old sighting
// counts for less, when it was first and last seen, and the entries behind
// the count. A listing never says scam without an entry behind it: the
// count is the number of entries, nothing else, so a number nobody wrote
// an example about is not listed at all. A contest (the notice of line 7)
// marks the listing contested at once; one upheld removes it: the entries
// stay in the library, the indicator is listed no more. Pure: the
// indicators come from lib/library.js, the contests from the caller
// (src/routes/dbSuspects.js reads them from suspect_contests).

import { indicatorsOf, reservedHost } from "./library.js";

export const INDICATOR_KINDS = ["domain", "email", "phone"];
export const CONTEST_STATUSES = ["open", "upheld", "dismissed"];
// An entry seen within 90 days counts 1, within a year 0.5, older 0.25: the count decays (spec line 6).
export const AGE_WEIGHTS = [[90, 1], [365, 0.5], [Infinity, 0.25]];
const DAY = 86400000;
// Phones compare on their last 9 digits: "+33 6 12 34 56 78", "0612345678" and "06.12.34.56.78" are one number.
const PHONE_DIGITS = 9;

const SCHEME = /^[a-z][a-z0-9+.-]*:\/\//i;
const EMAIL = /^([^\s@<>]+)@([a-z0-9.-]+\.[a-z0-9-]{2,})$/i;
const HOST = /^(?:[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.)+[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/i;
const IPV4 = /^\d{1,3}(?:\.\d{1,3}){3}$/;

export const phoneKey = (value) => String(value ?? "").replace(/\D/g, "").slice(-PHONE_DIGITS);

// What the visitor typed, as one indicator: { kind, value } or null when it
// is empty, reserved (the demo's .test addresses, a private IP, a
// [someone]@ placeholder) or not a website, an address or a number at all.
// An address when it holds an @; a number when, without spaces, dots,
// dashes and parentheses, it is 7 to 15 digits with an optional +; a
// website otherwise, with its scheme, port, path, query and www. stripped,
// lowercased, punycode left as is. A pasted URL is a website even when its
// credentials hold an @.
export function normalizeIndicator(q) {
  const s = String(q ?? "").trim().replace(/^(?:mailto|tel|sms):/i, "").replace(/^<(.*)>$/s, "$1").trim();
  if (!s) return null;
  if (SCHEME.test(s)) return domainOf(s);
  if (s.includes("@")) return emailOf(s);
  const compact = s.replace(/[\s().-]/g, "");
  if (/^\+?\d{7,15}$/.test(compact)) return { kind: "phone", value: compact };
  return domainOf(s);
}

function emailOf(s) {
  const m = s.toLowerCase().match(EMAIL);
  if (!m || m[1].startsWith("[") || reservedHost(m[2])) return null;
  return { kind: "email", value: m[0] };
}

function domainOf(s) {
  let host;
  try { host = new URL(SCHEME.test(s) ? s : `http://${s}`).hostname; } catch { return null; }
  host = host.toLowerCase().replace(/^www\./, "").replace(/\.$/, "");
  if (!host || reservedHost(host) || !(HOST.test(host) || IPV4.test(host))) return null;
  return { kind: "domain", value: host };
}

// Two indicators are one when their kind and value agree; numbers on their last 9 digits.
export function sameIndicator(a, b) {
  if (!a || !b || a.kind !== b.kind) return false;
  return a.kind === "phone" ? phoneKey(a.value) === phoneKey(b.value) : a.value === b.value;
}

function matches(indicator, found) {
  if (indicator.kind === "domain") return found.domains.includes(indicator.value);
  if (indicator.kind === "email") return found.senders.includes(indicator.value);
  const key = phoneKey(indicator.value);
  return found.phones.some((p) => phoneKey(p) === key);
}

// 1 within 90 days of now, 0.5 within a year, 0.25 after; a date that does
// not parse counts as old. Whole days: an entry seen 90 days ago this
// morning is still within 90 days this afternoon.
export function ageWeight(lastSeen, now = new Date()) {
  const t = Date.parse(`${lastSeen}T00:00:00Z`);
  if (Number.isNaN(t)) return AGE_WEIGHTS.at(-1)[1];
  const days = Math.floor((now.getTime() - t) / DAY);
  return AGE_WEIGHTS.find(([max]) => days <= max)[1];
}

const contestOf = (c) => ({ kind: c.indicator_kind ?? c.kind, value: c.indicator ?? c.value });
const later = (a, b) => (String(b.decided_at ?? "") > String(a.decided_at ?? "") ? b : a);
const newest = (a, b) => (a.last_seen === b.last_seen ? (a.id < b.id ? -1 : 1) : a.last_seen < b.last_seen ? 1 : -1);

// The listing for what was typed, or null when it is not an indicator.
// contests: rows of suspect_contests (indicator_kind, indicator, status,
// decided_at); one open makes the listing contested, one upheld removes it
// (reports 0, no entries, the date of the decision in removedAt).
export function lookupSuspect(entries, q, { now = new Date(), contests = [] } = {}) {
  const indicator = normalizeIndicator(q);
  if (!indicator) return null;
  const mine = contests.filter((c) => sameIndicator(indicator, contestOf(c)));
  const upheld = mine.filter((c) => c.status === "upheld").reduce((a, c) => (a ? later(a, c) : c), null);
  const out = { indicator, reports: 0, weight: 0, firstSeen: null, lastSeen: null, contested: mine.some((c) => c.status === "open"),
    removed: Boolean(upheld), removedAt: upheld?.decided_at ?? null, entries: [] };
  if (upheld) return out;
  const hits = entries.filter((e) => e && e.status !== "retired" && matches(indicator, indicatorsOf(e))).sort(newest);
  let weight = 0;
  for (const e of hits) {
    weight += ageWeight(e.last_seen, now);
    if (!out.firstSeen || e.first_seen < out.firstSeen) out.firstSeen = e.first_seen;
    if (!out.lastSeen || e.last_seen > out.lastSeen) out.lastSeen = e.last_seen;
    out.entries.push({ id: e.id, family: e.family, channel: e.channel, country: e.country ?? null, brand: e.brand ?? null, first_seen: e.first_seen, last_seen: e.last_seen });
  }
  out.reports = hits.length;
  out.weight = Math.round(weight * 100) / 100;
  return out;
}
