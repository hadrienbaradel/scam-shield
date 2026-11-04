// The scam watch (_product/specs/public-database.md, lines 8 to 10): the
// pure part first (a HIBP breach turned into watch fields, what makes an
// item important, the one action in both languages), then the daily job
// over fixture feeds with an injected fetch and classifier, the review
// (approve, reject) and the public week, then the routes. The Postgres
// parts skip without a database; nothing here opens the network.
import "./helpers/env.js";
import { test } from "node:test";
import assert from "node:assert/strict";
import { WATCH_KINDS, HIGH_DATA_CLASSES, breachFromHibp, importanceOf, oneActionFor } from "../lib/watch.js";

const NOW = new Date("2026-11-04T12:00:00Z");
const daysAgo = (n) => new Date(NOW - n * 86400000).toISOString();
const HIBP = {
  Name: "AcmeShop", Title: "Acme Shop", Domain: "acme-shop.example", BreachDate: "2026-10-20", AddedDate: daysAgo(3), PwnCount: 2500000,
  DataClasses: ["Email addresses", "Passwords"], IsVerified: true, IsFabricated: false, IsSpamList: false, IsMalware: false, IsStealerLog: false,
  Description: "In October 2026, <a href=\"https://acme-shop.example\">Acme Shop</a> had a breach.",
};

test("a HIBP breach becomes a watch item: the fields a reviewer needs, verified only when every HIBP flag agrees", () => {
  assert.deepEqual(WATCH_KINDS, ["breach", "technique", "other"]);
  assert.ok(HIGH_DATA_CLASSES.includes("Passwords") && HIGH_DATA_CLASSES.includes("Bank account numbers"));
  const item = breachFromHibp(HIBP);
  assert.equal(item.kind, "breach");
  assert.equal(item.title, "Acme Shop");
  assert.equal(item.url, "https://haveibeenpwned.com/PwnedWebsites#AcmeShop");
  assert.equal(item.source, "hibp");
  assert.equal(item.published_at, HIBP.AddedDate);
  assert.deepEqual(item.fields, { org: "Acme Shop", domain: "acme-shop.example", people: 2500000, dataClasses: ["Email addresses", "Passwords"], verified: true,
    breachDate: "2026-10-20", addedDate: HIBP.AddedDate, country: null, sourceKind: "hibp" });
  assert.equal(breachFromHibp({ ...HIBP, IsSpamList: true }).fields.verified, false, "a spam list is not a breach");
  assert.equal(breachFromHibp({ ...HIBP, IsVerified: false }).fields.verified, false);
  assert.equal(breachFromHibp({ ...HIBP, IsStealerLog: true }).fields.verified, false);
});

test("important: a verified breach of 1M+ people or of high-value data added within 30 days; a new technique in the senior's country", () => {
  const big = importanceOf(breachFromHibp(HIBP), { now: NOW });
  assert.equal(big.important, true);
  assert.ok(big.reasons.some((r) => r.includes("2,500,000")), `the count is named: ${big.reasons}`);
  assert.ok(big.reasons.some((r) => r.includes("Passwords")), `the data class is named: ${big.reasons}`);
  // Small and harmless: not important.
  const small = importanceOf(breachFromHibp({ ...HIBP, PwnCount: 1000, DataClasses: ["Email addresses"] }), { now: NOW });
  assert.equal(small.important, false);
  // High-value data makes a small breach important.
  assert.equal(importanceOf(breachFromHibp({ ...HIBP, PwnCount: 1000, DataClasses: ["Email addresses", "Dates of birth"] }), { now: NOW }).important, true);
  // Old news and unverified claims are not.
  assert.equal(importanceOf(breachFromHibp({ ...HIBP, AddedDate: daysAgo(45) }), { now: NOW }).important, false);
  assert.equal(importanceOf(breachFromHibp({ ...HIBP, IsVerified: false }), { now: NOW }).important, false);
  assert.equal(importanceOf(breachFromHibp({ ...HIBP, AddedDate: "not a date" }), { now: NOW }).important, false);
  // Techniques: new and here.
  const technique = (fields) => ({ kind: "technique", fields: { channel: "sms", family: "delivery", novelty: "new", country: "FR", ...fields } });
  const fresh = importanceOf(technique({}), { now: NOW });
  assert.equal(fresh.important, true);
  assert.ok(fresh.reasons.length >= 1);
  assert.equal(importanceOf(technique({ novelty: "variant" }), { now: NOW }).important, false);
  assert.equal(importanceOf(technique({ country: "DE" }), { now: NOW }).important, false);
  assert.equal(importanceOf(technique({ country: null }), { now: NOW }).important, true, "a technique with no country is everyone's");
  assert.equal(importanceOf(technique({ country: "US" }), { now: NOW, countries: ["FR"] }).important, false, "the countries are a parameter");
  // Nothing classified, nothing important.
  assert.deepEqual(importanceOf({ kind: null, fields: null }, { now: NOW }), { important: false, reasons: [] });
  assert.deepEqual(importanceOf({ kind: "other", fields: {} }, { now: NOW }), { important: false, reasons: [] });
});

test("the one action in English and French: passwords, bank or card data, any other leak; a technique's own line or its family's", () => {
  const pw = oneActionFor(breachFromHibp(HIBP));
  assert.match(pw.en, /password/i);
  assert.match(pw.fr, /mot de passe/i);
  assert.match(pw.en, /Acme Shop/);
  const bank = oneActionFor(breachFromHibp({ ...HIBP, DataClasses: ["Email addresses", "Bank account numbers"] }));
  assert.match(bank.en, /bank statement/i);
  assert.match(bank.fr, /relev/i);
  const card = oneActionFor(breachFromHibp({ ...HIBP, DataClasses: ["Credit cards"] }));
  assert.match(card.en, /statement/i);
  const other = oneActionFor(breachFromHibp({ ...HIBP, DataClasses: ["Email addresses", "Names"] }));
  assert.match(other.en, /prove nothing/i);
  assert.match(other.fr, /ne prouve/i);
  // A breach with no data classes at all still gets the generic line.
  assert.match(oneActionFor({ kind: "breach", fields: { org: "Somewhere" } }).en, /prove nothing/i);
  // A technique keeps the classifier's line when it gave both languages.
  const own = { en: "Hang up and call your bank on the number on your card.", fr: "Raccrochez et rappelez votre banque au numéro de votre carte." };
  assert.deepEqual(oneActionFor({ kind: "technique", fields: { family: "bank", one_action: own } }), own);
  // Half a line is no line: the family template answers.
  const half = oneActionFor({ kind: "technique", fields: { family: "delivery", one_action: { en: "Only English", fr: "" } } });
  assert.ok(half.en && half.fr && half.en !== "Only English");
  const delivery = oneActionFor({ kind: "technique", fields: { family: "delivery" } });
  const bankT = oneActionFor({ kind: "technique", fields: { family: "bank" } });
  assert.ok(delivery.en && delivery.fr && bankT.en && bankT.fr);
  assert.notEqual(delivery.en, bankT.en, "each family has its own line");
  const unknown = oneActionFor({ kind: "technique", fields: { family: "something-else" } });
  assert.ok(unknown.en && unknown.fr, "an unknown family gets the general line");
  assert.deepEqual(oneActionFor({ kind: "technique", fields: null }), unknown);
  assert.deepEqual(oneActionFor({ kind: "other", fields: {} }), unknown);
  assert.deepEqual(oneActionFor({ kind: null }), unknown);
});
