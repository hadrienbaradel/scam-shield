// Unit tests for the server's building blocks (no database, no network).
import "./helpers/env.js";
import { test } from "node:test";
import assert from "node:assert/strict";
import { encrypt, decrypt, pkcePair, sha256 } from "../src/crypto.js";
import { gmailClient, normalizeMessage, parseAuthResults, htmlToText } from "../src/google/gmail.js";
import { extractOrder, buildContext, correspondents, withGuardians, forgetItem } from "../src/context/builder.js";
import { decideAction, isProtectedSender } from "../src/sync/actions.js";
import { isPrivateAddress, registrableDomain, resolveLink, describePage, domainAgeDays, inspectMessageLinks } from "../src/links/resolver.js";
import { parseFeed } from "../src/jobs/threatfeed.js";
import { gmailMessage } from "./helpers/fake-gmail.js";

const KEY = process.env.TOKEN_ENC_KEY;

test("tokens: AES-GCM round trip, tamper detection, wrong key", () => {
  const packed = encrypt("1//refresh-token", KEY);
  assert.notEqual(packed, "1//refresh-token");
  assert.equal(decrypt(packed, KEY), "1//refresh-token");
  const parts = packed.split(".");
  parts[3] = Buffer.from("tampered!").toString("base64");
  assert.throws(() => decrypt(parts.join("."), KEY));
  assert.throws(() => decrypt(packed, Buffer.alloc(32, 9).toString("base64")));
  assert.throws(() => encrypt("x", "short"), /32 bytes/);
});

test("PKCE challenge is the S256 of the verifier", () => {
  const { verifier, challenge } = pkcePair();
  assert.ok(verifier.length >= 43);
  assert.equal(challenge, Buffer.from(sha256(verifier), "hex").toString("base64url"));
});

test("gmail: normalizes a real-shaped multipart message", () => {
  const m = normalizeMessage(gmailMessage({
    id: "m1", from: '"Chase" <no.reply@alertsp.chase.com>', subject: "Your statement is ready",
    text: "Your statement is ready. Visit https://www.chase.com/statements.",
    html: '<p>Your statement is <b>ready</b>&nbsp;&amp; waiting.</p><a href="https://www.chase.com/statements?a=1&amp;b=2">View statement</a><a href="mailto:x@y.z">mail</a>',
  }));
  assert.equal(m.from, "no.reply@alertsp.chase.com");
  assert.equal(m.fromName, "Chase");
  assert.equal(m.auth, "spf=pass dkim=pass dmarc=pass");
  assert.ok(m.body.startsWith("Your statement is ready."));
  assert.deepEqual(m.links.map((l) => l.href), ["https://www.chase.com/statements?a=1&b=2", "https://www.chase.com/statements"]);
  assert.equal(m.links[0].text, "View statement");
});

test("gmail: html-only mail becomes readable text, latin-1 is decoded", () => {
  assert.equal(htmlToText("<style>p{}</style><p>Bonjour&nbsp;Fran&ccedil;oise</p><p>&#8364;69,90</p>"), "Bonjour Françoise\n€69,90");
  const latin = gmailMessage({ id: "m2", from: "a@b.fr", subject: "x" });
  latin.payload.parts = [{ mimeType: "text/plain", headers: [{ name: "Content-Type", value: "text/plain; charset=ISO-8859-1" }],
    body: { data: Buffer.from([0x46, 0x72, 0x61, 0x6e, 0xe7, 0x6f, 0x69, 0x73, 0x65]).toString("base64url") } }];
  assert.equal(normalizeMessage(latin).body, "Françoise");
});

test("gmail: authentication results prefer Google's own header", () => {
  const h = [{ name: "Authentication-Results", value: "evil.example; spf=pass" },
    { name: "Authentication-Results", value: "mx.google.com; dkim=fail header.i=@x; spf=softfail smtp.mailfrom=x; dmarc=fail (p=REJECT)" }];
  assert.equal(parseAuthResults(h), "spf=softfail dkim=fail dmarc=fail");
});

test("gmail client: refuses trash/spam, retries 429, sends bearer token", async () => {
  const calls = [];
  let n = 0;
  const fetchImpl = async (url, opts) => {
    calls.push({ url, opts });
    n++;
    if (n === 1) return new Response("{}", { status: 429 });
    return new Response(JSON.stringify({ emailAddress: "a@b.test", historyId: "5" }), { status: 200 });
  };
  const c = gmailClient(async () => "tok", { fetchImpl });
  assert.throws(() => c.modifyLabels("id", { add: ["TRASH"] }), /never/);
  assert.throws(() => c.modifyLabels("id", { add: ["SPAM"] }), /never/);
  assert.equal((await c.profile()).historyId, "5");
  assert.equal(calls.length, 2);
  assert.equal(calls[1].opts.headers.authorization, "Bearer tok");
  assert.ok(!("send" in c) && !("trash" in c) && !("delete" in c));
});

test("context: order extraction needs a carrier and recognises tracking formats", () => {
  assert.deepEqual(extractOrder({ from: "ship-confirm@amazon.com", subject: "Your order has shipped", body: "Tracking TBA123456789012", date: "2026-10-20T10:00:00Z" }),
    { merchant: "Amazon", carrier: "Amazon Logistics", tracking: "TBA123456789012", items: "Your order has shipped", date: "2026-10-20" });
  assert.equal(extractOrder({ from: "x@shop.test", subject: "Order shipped", body: "UPS tracking 1Z999AA10123456784" }).carrier, "UPS");
  assert.equal(extractOrder({ from: "x@fnac.com", subject: "Votre commande est expédiée", body: "Chronopost XW123456789FR" }).carrier, "Chronopost");
  assert.equal(extractOrder({ from: "x@shop.test", subject: "Weekly newsletter", body: "Spring collection" }), null);
  assert.equal(extractOrder({ from: "x@shop.test", subject: "Your order", body: "We received your order." }), null);
});

test("context: only authenticated mail the detector judges safe can teach", () => {
  const PASS = "spf=pass dkim=pass dmarc=pass";
  const messages = [
    { from: "ship-confirm@amazon.com", fromName: "Amazon.com", subject: "Your order has shipped", body: "Track TBA123456789012", auth: PASS, links: [{ text: "Track", href: "https://www.amazon.com/track" }], date: new Date().toISOString() },
    { from: "alerts@chase.com", fromName: "Chase", subject: "Your statement is ready", body: "View it online.", auth: PASS, links: [{ text: "View", href: "https://secure.chase.com/s" }], date: new Date().toISOString() },
    // Scam with its own valid SPF: must not plant an order or a link domain.
    { from: "track@usps-redelivery.top", fromName: "USPS", subject: "Package on hold", body: "USPS tracking 9400100000000000000000 pay $1.99 now https://usps-redelivery.top/pay", auth: PASS, links: [{ text: "Pay", href: "https://usps-redelivery.top/pay" }], date: new Date().toISOString() },
    // Unauthenticated: ignored.
    { from: "orders@shop.test", fromName: "Shop", subject: "Order shipped", body: "UPS 1Z999AA10123456784", auth: "spf=fail dkim=none dmarc=fail", links: [], date: new Date().toISOString() },
  ];
  const ctx = buildContext({ userName: "Linda", selfEmail: "linda@example.test", messages });
  assert.deepEqual(ctx.orders.map((o) => o.carrier), ["Amazon Logistics"]);
  assert.deepEqual(ctx.providers.map((p) => p.name).sort(), ["Amazon", "Chase"]);
  assert.ok(ctx.knownLinkDomains.includes("secure.chase.com"));
  assert.ok(!ctx.knownLinkDomains.some((d) => d.includes("usps-redelivery")));
  assert.ok(!ctx.knownSenders.some((s) => s.email.includes("usps-redelivery")));
});

test("context: people you write to twice become recognised contacts; removed items stay removed", () => {
  const sent = [1, 2, 3].map((i) => ({ payload: { headers: [{ name: "To", value: i < 3 ? '"Thomas B" <thomas@example.test>' : "once@example.test" }] } }));
  assert.deepEqual(correspondents(sent, "linda@example.test").map((c) => c.email), ["thomas@example.test"]);
  let ctx = buildContext({ userName: "Linda", selfEmail: "linda@example.test", sent });
  assert.equal(ctx.trustedContacts[0].name, "Thomas B");
  ctx = forgetItem({ ...ctx, trustedContacts: [] }, "contact", { email: "thomas@example.test" });
  ctx = buildContext({ userName: "Linda", selfEmail: "linda@example.test", sent, previous: ctx });
  assert.equal(ctx.trustedContacts.length, 0);
  const g = withGuardians(ctx, [{ status: "active", guardian_name: "Hadrien", guardian_email: "h@example.test", relation: "grandson" }]);
  assert.equal(g.trustedContacts[0].relation, "grandson (guardian)");
});

test("actions: what happens to a message for each verdict", () => {
  const PASS = "spf=pass dkim=pass dmarc=pass";
  const ctx = { knownSenders: [{ email: "statements@chase.com" }], providers: [{ name: "Chase", realDomains: ["chase.com"] }], trustedContacts: [] };
  const scam = { verdict: "scam" };
  assert.deepEqual(decideAction({ verdict: { verdict: "safe" }, message: {}, ctx, actMode: "move" }), { label: null, removeInbox: false, protectedSender: false });
  assert.equal(decideAction({ verdict: { verdict: "be_careful" }, message: { from: "x@y.test" }, ctx, actMode: "move" }).removeInbox, false);
  assert.equal(decideAction({ verdict: scam, message: { from: "x@y.test", auth: "spf=fail" }, ctx, actMode: "move" }).removeInbox, true);
  assert.equal(decideAction({ verdict: scam, message: { from: "x@y.test", auth: "spf=fail" }, ctx, actMode: "label" }).removeInbox, false);
  // Never move authenticated mail from someone the user knows, even if judged scam.
  const known = decideAction({ verdict: scam, message: { from: "alerts@secure.chase.com", auth: PASS }, ctx, actMode: "move" });
  assert.deepEqual(known, { label: "scam", removeInbox: false, protectedSender: true });
  // A spoofed known address that fails authentication is not protected.
  assert.equal(isProtectedSender({ from: "statements@chase.com", auth: "spf=fail dkim=none dmarc=fail" }, ctx), false);
});

test("links: private networks are refused before any request", async () => {
  for (const ip of ["127.0.0.1", "10.1.2.3", "192.168.68.54", "172.20.0.1", "169.254.169.254", "::1", "fd00::1", "::ffff:127.0.0.1", "100.64.0.1"]) assert.ok(isPrivateAddress(ip), ip);
  for (const ip of ["8.8.8.8", "2606:4700::1111"]) assert.ok(!isPrivateAddress(ip), ip);
  let fetched = false;
  await assert.rejects(resolveLink("http://127.0.0.1/admin", { fetchImpl: async () => { fetched = true; } }), /private/);
  await assert.rejects(resolveLink("http://169.254.169.254/latest/meta-data/", { fetchImpl: async () => { fetched = true; } }), /private/);
  await assert.rejects(resolveLink("file:///etc/passwd", { fetchImpl: async () => { fetched = true; } }), /refusing/);
  assert.equal(fetched, false);
});

test("links: follows redirects to the final page and describes it", async () => {
  const pages = {
    "https://bit.ly/x": new Response(null, { status: 301, headers: { location: "https://tracker.example/r" } }),
    "https://tracker.example/r": new Response(null, { status: 302, headers: { location: "https://usps-redeliver.top/pay" } }),
    "https://usps-redeliver.top/pay": new Response('<title>USPS Redelivery</title><form><input type="password"><input name="cardnumber"></form>', { status: 200, headers: { "content-type": "text/html" } }),
  };
  const r = await resolveLink("https://bit.ly/x", { fetchImpl: async (u) => pages[u], checkHost: async () => {} });
  assert.equal(r.final_url, "https://usps-redeliver.top/pay");
  assert.deepEqual(r.redirects, ["https://tracker.example/r", "https://usps-redeliver.top/pay"]);
  assert.match(r.page_shows, /USPS Redelivery.*password.*card/);
  assert.equal(describePage(""), null);
  assert.equal(registrableDomain("a.b.example.co.uk"), "example.co.uk");
});

test("links: RDAP domain age, and only unknown domains are looked up", async () => {
  const seen = [];
  const fetchImpl = async (url) => {
    seen.push(url);
    if (url.includes("rdap.org/domain/fresh-scam.top")) return new Response(JSON.stringify({ events: [{ eventAction: "registration", eventDate: new Date(Date.now() - 4 * 86400000).toISOString() }] }), { status: 200 });
    return new Response("{}", { status: 404 });
  };
  assert.equal(await domainAgeDays("www.fresh-scam.top", { fetchImpl }), 4);
  const out = await inspectMessageLinks({ links: [
    { text: "Pay", href: "https://pay.fresh-scam.top/x" }, { text: "Chase", href: "https://www.chase.com/x" }, { text: "Known", href: "https://click.em.cvs.com/y" },
  ] }, { knownLinkDomains: ["cvs.com"] }, { fetchImpl });
  assert.equal(out["https://pay.fresh-scam.top/x"].domain_age_days, 4);
  assert.ok(!seen.some((u) => u.includes("chase.com") || u.includes("cvs.com")), "brand and known domains are never looked up");
});

test("threat feed: parses RSS and Atom", () => {
  const rss = `<rss><channel><item><title>Scammers Impersonating USPS</title><link>https://www.ic3.gov/PSA/2026/1</link><description><![CDATA[<p>Text messages claiming a <b>package</b> is on hold.</p>]]></description><pubDate>Mon, 20 Oct 2026 10:00:00 GMT</pubDate></item></channel></rss>`;
  const atom = `<feed><entry><title>Faux SMS Ameli</title><link href="https://www.cybermalveillance.gouv.fr/a"/><summary>Carte Vitale</summary><updated>2026-10-21T00:00:00Z</updated></entry></feed>`;
  assert.deepEqual(parseFeed(rss).map((i) => [i.title, i.url, i.summary]), [["Scammers Impersonating USPS", "https://www.ic3.gov/PSA/2026/1", "Text messages claiming a package is on hold."]]);
  assert.equal(parseFeed(atom)[0].url, "https://www.cybermalveillance.gouv.fr/a");
});
