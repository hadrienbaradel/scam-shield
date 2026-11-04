// The suspect list (_product/specs/public-database.md, lines 6 and 7): the
// pure part first (one indicator out of whatever was typed, the lookup
// with its age weights, the phone match on the last 9 digits, what a
// contest does to a listing), then the routes over Postgres through
// Fastify's inject: the public lookup, the notice with its four elements,
// the status of a notice, the admin queue and its decisions. The Postgres
// parts skip without a database.
import "./helpers/env.js";
import { test } from "node:test";
import assert from "node:assert/strict";
import { normalizeIndicator, lookupSuspect, phoneKey, sameIndicator, ageWeight, AGE_WEIGHTS, INDICATOR_KINDS, CONTEST_STATUSES } from "../lib/suspects.js";
import { loadLibraryFiles } from "../lib/library.js";

const NOW = new Date("2026-11-04T12:00:00Z");
const daysAgo = (n) => new Date(NOW - n * 86400000).toISOString().slice(0, 10);
const SOURCE = { id: "prudence-demo", url: null, licence: "CC BY 4.0", attribution: "Prudence demo cases" };
const VERDICT = { verdict: "scam", headline: "Not your bank.", reasons: ["The link is not the bank's."] };
const entry = (id, over = {}) => ({
  id, family: "bank", channel: "email", country: "US", language: "en", brand: "Chase", lure: "a fraud alert", ask: "verify on a link",
  message: { from: "Alerts@Secure-Chase-Login.com", subject: null, body: "Chase: unusual sign-in. Verify at https://www.secure-chase-login.com/verify or call +1 555-013-0199 now.", links: [{ text: "verify", href: "https://secure-chase-login.com/verify" }] },
  first_seen: daysAgo(10), last_seen: daysAgo(10), source: SOURCE, verdict: VERDICT, status: "published", ...over,
});

// ---------------------------------------------------------------- pure ---

test("normalizeIndicator: a website from a pasted URL, an address lowercased, a number as digits, nothing for what is reserved or not an indicator", () => {
  assert.deepEqual(INDICATOR_KINDS, ["domain", "email", "phone"]);
  assert.deepEqual(CONTEST_STATUSES, ["open", "upheld", "dismissed"]);
  assert.deepEqual(normalizeIndicator("https://www.Secure-Chase-Login.com/verify?x=1"), { kind: "domain", value: "secure-chase-login.com" });
  assert.deepEqual(normalizeIndicator("  www.Secure-Chase-Login.com:8443/verify#top "), { kind: "domain", value: "secure-chase-login.com" }, "no scheme: still a website, port and path dropped");
  assert.deepEqual(normalizeIndicator("http://user:pw@secure-chase-login.com/"), { kind: "domain", value: "secure-chase-login.com" }, "a URL with credentials is a website, not an address");
  assert.deepEqual(normalizeIndicator("xn--bcher-kva.de"), { kind: "domain", value: "xn--bcher-kva.de" }, "punycode left as is");
  assert.deepEqual(normalizeIndicator("bücher.de"), { kind: "domain", value: "xn--bcher-kva.de" }, "an IDN compares in its punycode form, as the entries' hosts do");
  assert.deepEqual(normalizeIndicator("8.8.8.8"), { kind: "domain", value: "8.8.8.8" });
  assert.deepEqual(normalizeIndicator("Alerts@Secure-Chase-Login.com"), { kind: "email", value: "alerts@secure-chase-login.com" });
  assert.deepEqual(normalizeIndicator("mailto:Alerts@Secure-Chase-Login.com"), { kind: "email", value: "alerts@secure-chase-login.com" });
  assert.deepEqual(normalizeIndicator("<alerts@secure-chase-login.com>"), { kind: "email", value: "alerts@secure-chase-login.com" });
  assert.deepEqual(normalizeIndicator("+33 6 12 34 56 78"), { kind: "phone", value: "+33612345678" });
  assert.deepEqual(normalizeIndicator("0612345678"), { kind: "phone", value: "0612345678" });
  assert.deepEqual(normalizeIndicator("06.12.34.56.78"), { kind: "phone", value: "0612345678" });
  assert.deepEqual(normalizeIndicator("tel:+1 (555) 013-0199"), { kind: "phone", value: "+15550130199" });
  for (const [a, b] of [["+33 6 12 34 56 78", "0612345678"], ["0612345678", "06.12.34.56.78"], ["+33 (0)6 12 34 56 78", "0612345678"]]) {
    assert.ok(sameIndicator(normalizeIndicator(a), normalizeIndicator(b)), `${a} and ${b} are one number`);
  }
  assert.equal(phoneKey("+33612345678"), "612345678");
  assert.equal(sameIndicator(normalizeIndicator("0612345678"), normalizeIndicator("0612345679")), false);
  assert.equal(sameIndicator(normalizeIndicator("0612345678"), normalizeIndicator("secure-chase-login.com")), false, "a kind never matches another");
  assert.equal(sameIndicator(null, normalizeIndicator("0612345678")), false);
  assert.equal(normalizeIndicator("contestation-bouygues.test"), null, "reserved");
  assert.equal(normalizeIndicator("service@contestation-bouygues.test"), null, "a reserved host's address");
  assert.equal(normalizeIndicator("[someone]@gmail.com"), null, "a redacted placeholder is nobody");
  assert.equal(normalizeIndicator("http://192.168.1.10/login"), null, "a private IP");
  assert.equal(normalizeIndicator("http://[::1]/"), null);
  assert.equal(normalizeIndicator(""), null);
  assert.equal(normalizeIndicator("   "), null);
  assert.equal(normalizeIndicator(null), null);
  assert.equal(normalizeIndicator("chase"), null, "a bare word is not a website");
  assert.equal(normalizeIndicator("hello world"), null);
  assert.equal(normalizeIndicator("not an@address"), null);
  assert.equal(normalizeIndicator("123"), null, "too short for a number, not a website");
  assert.equal(normalizeIndicator("12345678901234567"), null, "too long for a number");
  assert.equal(normalizeIndicator("-bad-.com"), null, "not a hostname");
});

test("ageWeight: 1 within 90 days, 0.5 within a year, 0.25 after; whole days; a bad date is old", () => {
  assert.deepEqual(AGE_WEIGHTS, [[90, 1], [365, 0.5], [Infinity, 0.25]]);
  assert.equal(ageWeight(daysAgo(0), NOW), 1);
  assert.equal(ageWeight(daysAgo(90), NOW), 1, "90 days ago at midnight, now at noon: still within 90 days");
  assert.equal(ageWeight(daysAgo(91), NOW), 0.5);
  assert.equal(ageWeight(daysAgo(365), NOW), 0.5);
  assert.equal(ageWeight(daysAgo(366), NOW), 0.25);
  assert.equal(ageWeight("2020-01-01", NOW), 0.25);
  assert.equal(ageWeight(daysAgo(-5), NOW), 1, "a date ahead of the clock counts as fresh");
  assert.equal(ageWeight("not a date", NOW), 0.25);
  assert.equal(ageWeight(undefined, NOW), 0.25);
});

test("lookupSuspect: the entries that used the indicator, reports and weight by age, first and last seen; a website, an address and a number written three ways", () => {
  const entries = [
    entry("lib-a"),
    entry("lib-b", { first_seen: daysAgo(200), last_seen: daysAgo(200), channel: "sms", country: "FR", brand: null, message: { from: "alerts@secure-chase-login.com", body: "Your account is locked, call 555 013 0199 today." } }),
    entry("lib-c", { message: { from: "support@other-bank-help.com", body: "Dear Customer, confirm your card at https://other-bank-help.com/x" } }),
  ];
  const out = lookupSuspect(entries, "Alerts@Secure-Chase-Login.com", { now: NOW });
  assert.deepEqual(out.indicator, { kind: "email", value: "alerts@secure-chase-login.com" });
  assert.deepEqual([out.reports, out.weight, out.firstSeen, out.lastSeen, out.contested, out.removed, out.removedAt], [2, 1.5, daysAgo(200), daysAgo(10), false, false, null]);
  assert.deepEqual(out.entries, [
    { id: "lib-a", family: "bank", channel: "email", country: "US", brand: "Chase", first_seen: daysAgo(10), last_seen: daysAgo(10) },
    { id: "lib-b", family: "bank", channel: "sms", country: "FR", brand: null, first_seen: daysAgo(200), last_seen: daysAgo(200) },
  ], "newest first, the fields the table shows and nothing of the message");

  const site = lookupSuspect(entries, "https://www.secure-chase-login.com/verify?x=1", { now: NOW });
  assert.deepEqual([site.indicator.value, site.reports, site.weight, site.entries.map((e) => e.id)], ["secure-chase-login.com", 1, 1, ["lib-a"]], "the link's host and the URL in the body are one website");
  assert.deepEqual(lookupSuspect(entries, "other-bank-help.com", { now: NOW }).entries.map((e) => e.id), ["lib-c"], "a URL in the body alone");
  for (const written of ["+1 555-013-0199", "555.013.0199", "(555) 013-0199", "15550130199"]) {
    const phone = lookupSuspect(entries, written, { now: NOW });
    assert.deepEqual([phone.indicator.kind, phone.reports, phone.weight], ["phone", 2, 1.5], `${written}: the sender's number and the number in a body, one number`);
  }
  assert.equal(lookupSuspect(entries, "+1 555-013-0100", { now: NOW }).reports, 0, "another number");
  const old = lookupSuspect([entry("lib-old", { last_seen: daysAgo(400) }), entry("lib-mid", { last_seen: daysAgo(100) })], "secure-chase-login.com", { now: NOW });
  assert.deepEqual([old.reports, old.weight], [2, 0.75]);
  assert.deepEqual(lookupSuspect(entries, "nobody@nowhere-at-all.com", { now: NOW }),
    { indicator: { kind: "email", value: "nobody@nowhere-at-all.com" }, reports: 0, weight: 0, firstSeen: null, lastSeen: null, contested: false, removed: false, removedAt: null, entries: [] }, "nothing reported: an empty listing, never a verdict");
  assert.equal(lookupSuspect(entries, "chronopost-colis.test", { now: NOW }), null, "a reserved host is no indicator");
  assert.equal(lookupSuspect(entries, "", { now: NOW }), null);
  assert.equal(lookupSuspect([entry("lib-x", { status: "retired" })], "secure-chase-login.com", { now: NOW }).reports, 0, "a retired entry is evidence no more");
  assert.equal(lookupSuspect([entry("lib-y", { verdict: { ...VERDICT, verdict: "be_careful" } }), null], "secure-chase-login.com", { now: NOW }).reports, 0, "a Be careful entry accuses nobody");
  assert.equal(lookupSuspect([entry("lib-z", { verdict: null })], "secure-chase-login.com", { now: NOW }).reports, 1, "an entry without a verdict (a corpus sample) counts");
  assert.equal(lookupSuspect([entry("lib-w", { last_seen: "2026-13-45" })], "secure-chase-login.com", { now: NOW }).weight, 0.25);
});

test("a contest marks the listing contested while open and removes it when upheld; a dismissed one changes nothing", () => {
  const entries = [entry("lib-a"), entry("lib-b", { last_seen: daysAgo(200) })];
  const open = { indicator_kind: "email", indicator: "alerts@secure-chase-login.com", status: "open", decided_at: null };
  const contested = lookupSuspect(entries, "alerts@secure-chase-login.com", { now: NOW, contests: [open] });
  assert.deepEqual([contested.contested, contested.removed, contested.reports, contested.weight], [true, false, 2, 1.5], "contested at once, the count stays until a decision");
  const upheld = { indicator_kind: "email", indicator: "alerts@secure-chase-login.com", status: "upheld", decided_at: "2026-11-03T10:00:00.000Z" };
  const removed = lookupSuspect(entries, "ALERTS@secure-chase-login.com", { now: NOW, contests: [upheld, { ...upheld, decided_at: "2026-11-01T10:00:00.000Z" }] });
  assert.deepEqual([removed.contested, removed.removed, removed.removedAt, removed.reports, removed.weight, removed.firstSeen, removed.lastSeen, removed.entries],
    [false, true, "2026-11-03T10:00:00.000Z", 0, 0, null, null, []], "removed: the latest decision's date, no count, no entries");
  const dismissed = lookupSuspect(entries, "alerts@secure-chase-login.com", { now: NOW, contests: [{ ...open, status: "dismissed", decided_at: "2026-11-02T10:00:00.000Z" }] });
  assert.deepEqual([dismissed.contested, dismissed.removed, dismissed.reports], [false, false, 2]);
  const other = lookupSuspect(entries, "alerts@secure-chase-login.com", { now: NOW, contests: [{ ...open, indicator: "other@secure-chase-login.com" }, { ...open, indicator_kind: "domain", indicator: "secure-chase-login.com" }] });
  assert.deepEqual([other.contested, other.removed], [false, false], "a contest on another address or on the website is not one on this address");
  const phone = lookupSuspect(entries, "555-013-0199", { now: NOW, contests: [{ kind: "phone", value: "+15550130199", status: "open" }] });
  assert.equal(phone.contested, true, "a number's contest matches on the last 9 digits, rows given as kind and value too");
  const both = lookupSuspect(entries, "alerts@secure-chase-login.com", { now: NOW, contests: [open, upheld] });
  assert.deepEqual([both.contested, both.removed], [true, true], "an open contest on a removed listing is still shown as such");
});

test("the seed: a website two demo entries used is reported twice; a number two entries used is one number however it is written", async () => {
  const { entries } = await loadLibraryFiles();
  const site = lookupSuspect(entries, "https://calendar.adecco-hrjobs.com/x", { now: NOW });
  assert.equal(site.reports, 2, "lib-demo-a8 and a9 share it");
  assert.deepEqual(site.entries.map((e) => e.id).sort(), ["lib-demo-a8", "lib-demo-a9"]);
  assert.ok(site.weight > 0 && site.firstSeen <= site.lastSeen);
  const number = lookupSuspect(entries, "1.555.0177", { now: NOW });
  assert.ok(number.reports >= 2, `+1 555-0177 is the sender of two demo cases: ${number.reports}`);
  assert.equal(lookupSuspect(entries, "messaging-service@post.xero.com", { now: NOW }).reports, 0, "a real sending platform's address is no suspect");
  assert.equal(lookupSuspect(entries, "chronopost-colis.test", { now: NOW }), null, "the demo's .test hosts are never listed");
});
