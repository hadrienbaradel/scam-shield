import { test } from "node:test";
import assert from "node:assert/strict";
import { analyzeEmail } from "../lib/rules.js";
import { DEMO_EMAILS } from "../lib/demo.js";

const byId = (id) => DEMO_EMAILS.find((e) => e.id === id);

test("IRS gift-card style scam is flagged danger", () => {
  const r = analyzeEmail(byId("demo-irs"));
  assert.equal(r.verdict, "danger");
  assert.ok(r.signals.some((s) => s.title.includes("IRS")));
});

test("fake Chase login link is flagged danger", () => {
  const r = analyzeEmail(byId("demo-bank"));
  assert.equal(r.verdict, "danger");
  assert.ok(r.linksChecked >= 1);
});

test("USPS redelivery-fee scam is flagged danger or caution", () => {
  const r = analyzeEmail(byId("demo-usps"));
  assert.notEqual(r.verdict, "ok");
});

test("grandparent gift-card request is not waved through as ok", () => {
  const r = analyzeEmail(byId("demo-grandson"));
  assert.notEqual(r.verdict, "ok");
});

test("real bank statement is not flagged danger", () => {
  const r = analyzeEmail(byId("demo-statement"));
  assert.equal(r.verdict, "ok");
});

test("family email is not flagged danger", () => {
  const r = analyzeEmail(byId("demo-family"));
  assert.equal(r.verdict, "ok");
});

test("repeated warning signs are explained once, not listed twice", () => {
  const r = analyzeEmail(byId("demo-irs"));
  const titles = r.signals.map((s) => s.title);
  assert.equal(new Set(titles).size, titles.length);
});

test("link text that hides the real destination is caught on pasted mail", () => {
  const r = analyzeEmail({
    from: "help@paypal-secure.example.com",
    fromName: "PayPal",
    subject: "Confirm your password",
    body: "Please confirm your password: [paypal.com](https://evil.example.net/login)",
    links: [{ text: "paypal.com", href: "https://evil.example.net/login" }],
  });
  assert.equal(r.verdict, "danger");
});
