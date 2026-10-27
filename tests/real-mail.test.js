// Real-inbox shapes. The PRD seed cases carry hand-set fields (claimedBrand,
// mock link inspection) that live Gmail never provides; these messages look
// exactly like what src/google/gmail.js normalizes from a real mailbox.
// Everyday legitimate mail must never be Scam; real-shaped scams must still be.

import { test } from "node:test";
import assert from "node:assert/strict";
import { detect } from "../lib/detector.js";
import { emptyContext } from "../lib/context.js";

const PASS = "spf=pass dkim=pass dmarc=pass";
const ctx = { ...emptyContext("Linda"), orders: [{ merchant: "Amazon", carrier: "Amazon Logistics", tracking: "TBA123456789012", date: "2026-10-20" }] };
const run = (message, context = ctx) => detect({ locale: "en-US", message: { channel: "email", ...message }, personalContext: context });

const LEGIT = [
  { name: "shop receipt mentioning a purchase", m: { fromName: "Etsy", from: "transaction@etsy.com", auth: PASS,
    subject: "Your purchase from CozyKnits", body: "Thanks for your purchase! Order #3141. We'll email you when it ships.",
    links: [{ text: "View your order", href: "https://www.etsy.com/your/purchases/3141" }, { text: "Shop", href: "https://www.etsy.com" }] } },
  { name: "Google Groups digest", m: { fromName: "Garden Club via Google Groups", from: "garden-club@googlegroups.com", auth: PASS,
    subject: "Digest for garden-club@googlegroups.com - 3 updates in 1 topic", body: "Tulip bulbs swap on Saturday at 10am.",
    links: [{ text: "Unsubscribe", href: "https://groups.google.com/g/garden-club/unsubscribe" }] } },
  { name: "newsletter through its email-service provider", m: { fromName: "The Boston Globe", from: "newsletters@globe.com", auth: PASS,
    subject: "Today's headlines", body: "Red Sox name new manager. Read more inside.",
    links: [{ text: "Read more", href: "https://click.e.globe.com/?qs=abc" }, { text: "Unsubscribe", href: "https://click.e.globe.com/u?qs=def" }] } },
  { name: "retailer advert naming another brand in the subject", m: { fromName: "Best Buy", from: "BestBuyInfo@emailinfo.bestbuy.com", auth: PASS,
    subject: "Apple AirPods deals end Sunday", body: "Save on Apple AirPods this week only. Shop now.",
    links: [{ text: "Shop now", href: "https://emailinfo.bestbuy.com/c/abc" }] } },
  { name: "real Amazon shipping notice", m: { fromName: "Amazon.com", from: "shipment-tracking@amazon.com", auth: PASS,
    subject: "Your Amazon.com order has shipped", body: "Your package with slippers is on the way. Track your package.",
    links: [{ text: "Track package", href: "https://www.amazon.com/gp/your-account/ship-track?id=1" }, { text: "amazon.com", href: "https://www.amazon.com/" }] } },
  { name: "friend writing normally", m: { fromName: "Margaret Lee", from: "margaret.lee@example-mail.test", auth: PASS,
    subject: "Lunch on Thursday?", body: "Hi Linda, are you free for lunch on Thursday? The usual place at noon.", links: [] } },
  { name: "pharmacy reminder", m: { fromName: "CVS Pharmacy", from: "CVS@pharmacy-cvs.com", auth: PASS,
    subject: "Your prescription is ready", body: "Your prescription is ready for pickup at your CVS on Main Street.",
    links: [{ text: "Manage prescriptions", href: "https://www.cvs.com/account" }] } },
  { name: "Meetup with 'ups' inside a word", m: { fromName: "Meetup", from: "info@meetup.com", auth: PASS,
    subject: "New events in your groups: Startups & signups", body: "3 new events from your groups this week.",
    links: [{ text: "See events", href: "https://www.meetup.com/home" }] } },
  { name: "French newsletter", m: { fromName: "Fnac", from: "newsletter@fnac.com", auth: PASS,
    subject: "Les nouveautés de la semaine", body: "Découvrez nos nouveautés livres et musique. Livraison gratuite en magasin.",
    links: [{ text: "Découvrir", href: "https://click.fnac.com/abc" }] } },
];

for (const { name, m } of LEGIT) {
  test(`legit: ${name} is never Scam`, () => {
    const v = run(m);
    assert.notEqual(v.verdict, "scam", `${name}: ${v.reasons.map((r) => r.text).join(" | ")}`);
  });
}

test("legit: an advert naming another brand stays Safe, not just not-Scam", () => {
  assert.equal(run(LEGIT[3].m).verdict, "safe");
});

const SCAMS = [
  { name: "display-name spoof of a bank with a look-alike link", m: { fromName: "Chase Bank", from: "secure@chase-alerts-verify.top", auth: "spf=pass dkim=none dmarc=none",
    subject: "Unusual sign-in attempt", body: "We detected unusual activity. Confirm your password within 24 hours or your account will be locked.",
    links: [{ text: "chase.com", href: "https://chase-alerts-verify.top/login" }] } },
  { name: "USPS redelivery fee by text, no claimedBrand", m: { channel: "sms", fromName: "", from: "+1 555-0199",
    body: "USPS: Your package is on hold due to an incomplete address. Pay $1.99 here: https://usps-redeliver.top/pay",
    links: [{ text: "https://usps-redeliver.top/pay", href: "https://usps-redeliver.top/pay" }] } },
  { name: "unauthenticated mail claiming Amazon in the subject", m: { fromName: "Customer Service", from: "support@amaz0n-billing.top", auth: "spf=fail dkim=none dmarc=fail",
    subject: "Your Amazon account is suspended", body: "Your Amazon account is suspended. Update your card details immediately to avoid fees.",
    links: [{ text: "Update now", href: "https://amaz0n-billing.top/update" }] } },
  { name: "gift-card request from an unknown sender", m: { fromName: "Pastor John", from: "pastor.john.office@freemail.test", auth: PASS,
    subject: "Quick favor", body: "I need you to buy 4 Apple gift cards of $100 for the church today. Keep it between us, send me the codes.", links: [] } },
];

for (const { name, m } of SCAMS) {
  test(`scam: ${name} is caught`, () => {
    const v = run(m);
    assert.equal(v.verdict, "scam", `${name}: got ${v.verdict} — ${v.reasons.map((r) => r.text).join(" | ")}`);
  });
}

test("authenticated brand mail that fits history is marked _authentic for the model guardrail", () => {
  const amazonCtx = { ...ctx, providers: [{ type: "retail", name: "Amazon", realDomains: ["amazon.com"] }] };
  const v = run(LEGIT[4].m, amazonCtx);
  assert.equal(v.verdict, "safe");
  assert.equal(v._authentic, true);
});
