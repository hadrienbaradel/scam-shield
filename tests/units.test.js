// Unit tests for the server's building blocks (no database, no network).
import "./helpers/env.js";
import { test } from "node:test";
import assert from "node:assert/strict";
import { encrypt, decrypt, pkcePair, sha256 } from "../src/crypto.js";
import { gmailClient, normalizeMessage, parseAuthResults, htmlToText } from "../src/google/gmail.js";
import { extractOrder, buildContext, correspondents, withGuardians, forgetItem, lookupBreaches, lookedUp, leakedWords, resetBreachCatalogue } from "../src/context/builder.js";
import { breachLeaking } from "../lib/context.js";
import { decideAction, isProtectedSender } from "../src/sync/actions.js";
import { isPrivateAddress, registrableDomain, resolveLink, describePage, domainAgeDays, inspectMessageLinks, urlhausHost, urlhausState } from "../src/links/resolver.js";
import { config } from "../src/config.js";
import { detect } from "../lib/detector.js";
import { parseFeed } from "../src/jobs/threatfeed.js";
import { parseEml } from "../src/google/eml.js";
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

test("gmail: only Gmail's topmost, aligned authentication result counts", () => {
  const AR = (value) => ({ name: "Authentication-Results", value });
  // Failures are reported as failures.
  assert.equal(parseAuthResults([AR("mx.google.com; dkim=fail header.i=@x.test; spf=softfail smtp.mailfrom=a@x.test; dmarc=fail (p=REJECT) header.from=x.test")], "a@x.test"),
    "spf=fail dkim=fail dmarc=fail");
  // A sender-written header below Gmail's is ignored; one above it means Gmail did not write the top one.
  assert.equal(parseAuthResults([AR("mx.google.com; spf=fail smtp.mailfrom=a@chase.test"), AR("mx.google.com; spf=pass smtp.mailfrom=a@chase.test")], "a@chase.test"), "spf=fail dkim=none dmarc=none");
  assert.equal(parseAuthResults([AR("evil.example; spf=pass"), AR("mx.google.com; spf=pass smtp.mailfrom=a@chase.test")], "a@chase.test"), "spf=none dkim=none dmarc=none");
  assert.equal(parseAuthResults([AR("mx.google.com.evil.test; spf=pass smtp.mailfrom=a@b.test")], "a@b.test"), "spf=none dkim=none dmarc=none");
  // A pass for another domain (the email service's) proves nothing about the From domain.
  assert.equal(parseAuthResults([AR("mx.google.com; dkim=pass header.i=@sendgrid.info; spf=pass smtp.mailfrom=bounce@sendgrid.net; dmarc=fail header.from=chase.test")], "alerts@chase.test"),
    "spf=none dkim=none dmarc=fail");
  assert.equal(parseAuthResults([AR("mx.google.com; dkim=pass header.i=@certdata.com.br; dkim=pass header.i=@sendgrid.info; spf=pass smtp.mailfrom=bounces+1@em6365.certdata.com.br; dmarc=pass header.from=certdata.com.br")], "noreply@certdata.com.br"),
    "spf=pass dkim=pass dmarc=pass");
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
  assert.equal(decideAction({ verdict: scam, message: { from: "x@y.test", auth: "spf=fail" }, ctx, actMode: "move", moveConsent: true }).removeInbox, true);
  // No recorded consent, or a failed AI check: label only.
  assert.equal(decideAction({ verdict: scam, message: { from: "x@y.test", auth: "spf=fail" }, ctx, actMode: "move" }).removeInbox, false);
  assert.equal(decideAction({ verdict: { verdict: "scam", degraded: true }, message: { from: "x@y.test", auth: "spf=fail" }, ctx, actMode: "move", moveConsent: true }).removeInbox, false);
  assert.equal(decideAction({ verdict: scam, message: { from: "x@y.test", auth: "spf=fail" }, ctx, actMode: "label" }).removeInbox, false);
  // Never move authenticated mail from someone the user knows, even if judged scam.
  const known = decideAction({ verdict: scam, message: { from: "alerts@secure.chase.com", auth: PASS }, ctx, actMode: "move", moveConsent: true });
  assert.deepEqual(known, { label: "scam", removeInbox: false, protectedSender: true });
  // A spoofed known address that fails authentication is not protected.
  assert.equal(isProtectedSender({ from: "statements@chase.com", auth: "spf=fail dkim=none dmarc=fail" }, ctx), false);
});

test("links: private networks are refused before any request", async () => {
  for (const ip of ["127.0.0.1", "10.1.2.3", "192.168.68.54", "172.20.0.1", "169.254.169.254", "::1", "fd00::1", "::ffff:127.0.0.1", "100.64.0.1",
    // Codex's bypasses: IPv4-mapped IPv6 in hex, plus other special ranges.
    "::ffff:7f00:1", "::ffff:a9fe:a9fe", "0:0:0:0:0:ffff:7f00:1", "192.0.0.8", "198.18.0.1", "64:ff9b::7f00:1", "2001:db8::1", "::", "fe80::1", "0.0.0.0"]) {
    assert.ok(isPrivateAddress(ip), ip);
  }
  for (const ip of ["8.8.8.8", "2606:4700::1111", "::ffff:8.8.8.8", "::ffff:808:808"]) assert.ok(!isPrivateAddress(ip), ip);
  assert.ok(isPrivateAddress("not-an-ip"), "anything unparseable is refused");
  let fetched = false;
  await assert.rejects(resolveLink("http://127.0.0.1/admin", { fetchImpl: async () => { fetched = true; } }), /private/);
  await assert.rejects(resolveLink("http://169.254.169.254/latest/meta-data/", { fetchImpl: async () => { fetched = true; } }), /private/);
  await assert.rejects(resolveLink("file:///etc/passwd", { fetchImpl: async () => { fetched = true; } }), /refusing/);
  await assert.rejects(resolveLink("http://2130706433/", { fetchImpl: async () => { fetched = true; } }), /private/, "decimal IPv4 is normalised");
  await assert.rejects(resolveLink("http://[::ffff:7f00:1]/", { fetchImpl: async () => { fetched = true; } }), /private/);
  assert.equal(fetched, false);
  // DNS rebinding: a name that resolves to an internal address is refused at connect time.
  await assert.rejects(resolveLink("http://localhost/", { checkHost: async () => {} }), (e) => e.cause?.code === "EPRIVATE");
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
    if (url === "https://data.iana.org/rdap/dns.json") return new Response(JSON.stringify({ services: [[["top"], ["https://rdap.example-registry.test/"]], [["com"], ["https://rdap.verisign.test/com/v1/"]]] }), { status: 200 });
    if (url.includes("rdap.example-registry.test/domain/fresh-scam.top")) return new Response(JSON.stringify({ events: [{ eventAction: "registration", eventDate: new Date(Date.now() - 4.5 * 86400000).toISOString() }] }), { status: 200 });
    return new Response("{}", { status: 404 });
  };
  assert.equal(await domainAgeDays("www.fresh-scam.top", { fetchImpl }), 4);
  const out = await inspectMessageLinks({ links: [
    { text: "Pay", href: "https://pay.fresh-scam.top/x" }, { text: "Chase", href: "https://www.chase.com/x" }, { text: "Known", href: "https://click.em.cvs.com/y" },
  ] }, { knownLinkDomains: ["cvs.com"] }, { fetchImpl });
  assert.equal(out["https://pay.fresh-scam.top/x"].domain_age_days, 4);
  assert.ok(!seen.some((u) => u.includes("chase.com") || u.includes("cvs.com")), "brand and known domains are never looked up");
  assert.ok(!seen.some((u) => u.includes("rdap.org")), "registries are queried directly");
});

test("links: opening links for a second look never opens unsubscribe, delete or cancel links", async () => {
  const opened = [];
  const fetchImpl = async (url) => {
    if (!String(url).includes("news.example-shop.test")) return new Response("{}", { status: 404 });
    opened.push(String(url));
    return new Response("<html><title>Spring report</title></html>", { status: 200, headers: { "content-type": "text/html" } });
  };
  const links = [{ text: "Unsubscribe", href: "https://news.example-shop.test/u?id=7" }, { text: "Read the report", href: "https://news.example-shop.test/report" },
    { text: "Manage preferences", href: "https://news.example-shop.test/prefs" }, { text: "Supprimer mon compte", href: "https://news.example-shop.test/delete" }];
  const out = await inspectMessageLinks({ links }, {}, { resolve: true, fetchImpl, checkHost: async () => {} });
  assert.deepEqual(opened, ["https://news.example-shop.test/report"]);
  assert.equal(out["https://news.example-shop.test/report"].page_shows, 'Page titled "Spring report"');
});

test("links: URLhaus gets host names only, and shared hosts need the exact link", async () => {
  const listings = {
    "files.evil-host.example": { query_status: "ok", blacklists: { spamhaus_dbl: "not listed" }, urls: [{ url: "http://files.evil-host.example/a.exe", url_status: "online", threat: "malware_download", tags: ["exe"] }] },
    "raw.githubusercontent.com": { query_status: "ok", blacklists: { spamhaus_dbl: "abused_legit_malware" }, urls: [{ url: "https://raw.githubusercontent.com/bad/repo/main/x.ps1", url_status: "online", threat: "malware_download", tags: [] }] },
    "login.phish-host.example": { query_status: "ok", blacklists: { spamhaus_dbl: "phishing_domain" }, urls: [{ url: "http://login.phish-host.example/old", url_status: "offline", threat: "malware_download", tags: [] }] },
  };
  const sent = [];
  const urlhausFetch = async (url, init) => {
    sent.push({ url, body: String(init.body), key: init.headers["Auth-Key"] });
    const host = new URLSearchParams(String(init.body)).get("host");
    return new Response(JSON.stringify(listings[host] || { query_status: "no_results" }), { status: 200 });
  };
  const noRdap = async () => new Response("{}", { status: 404 });
  const links = [
    { text: "Invoice", href: "https://files.evil-host.example/invoice?to=reader@example.com" },
    { text: "Script", href: "https://raw.githubusercontent.com/bad/repo/main/x.ps1" },
    { text: "Readme", href: "https://raw.githubusercontent.com/good/repo/main/README.md" },
    { text: "Sign in", href: "https://login.phish-host.example/new" },
    { text: "Shop", href: "https://shop.clean.example/" },
  ];
  assert.deepEqual(await inspectMessageLinks({ links }, {}, { fetchImpl: noRdap, urlhausFetch }), {}, "no key, no lookup");
  assert.equal(sent.length, 0);
  config.abusechKey = "test-key";
  try {
    const out = await inspectMessageLinks({ links }, {}, { fetchImpl: noRdap, urlhausFetch });
    assert.ok(sent.every((s) => /^host=[^&/?]+$/.test(s.body) && s.key === "test-key"), "only the host leaves, with the key header");
    assert.ok(!sent.some((s) => s.body.includes("reader")), "the reader's address in the link is never sent");
    assert.equal(out[links[0].href].urlhaus.hostBad, true);
    assert.equal(out[links[1].href].urlhaus.exact, true);
    assert.equal(out[links[2].href], undefined, "another file on a shared host is not condemned");
    assert.equal(out[links[3].href].urlhaus.phishing, true);
    assert.equal(out[links[4].href], undefined);
    // A listed link outranks a known contact: accounts get hacked.
    const v = detect({ locale: "en-US", patternCards: [], mockLinkInspection: out,
      personalContext: { trustedContacts: [{ name: "Ann", email: "ann@example.com", relation: "friend" }] },
      message: { channel: "email", from: "ann@example.com", fromName: "Ann", subject: "photos", body: "here you go", links: [links[0]], auth: "" } });
    assert.equal(v.verdict, "scam");
    // A refused key stops the lookups for good and says so.
    const refused = async () => new Response(JSON.stringify({ query_status: "unknown_auth_key" }), { status: 403 });
    assert.equal(await urlhausHost("new-host.example", { fetchImpl: refused }), null);
    assert.match(urlhausState.off, /refused/);
    let called = false;
    assert.equal(await urlhausHost("other-host.example", { fetchImpl: async () => { called = true; } }), null);
    assert.equal(called, false);
  } finally {
    config.abusechKey = "";
    urlhausState.off = null;
  }
});

test("threat feed: parses RSS and Atom", () => {
  const rss = `<rss><channel><item><title>Scammers Impersonating USPS</title><link>https://www.ic3.gov/PSA/2026/1</link><description><![CDATA[<p>Text messages claiming a <b>package</b> is on hold.</p>]]></description><pubDate>Mon, 20 Oct 2026 10:00:00 GMT</pubDate></item></channel></rss>`;
  const atom = `<feed><entry><title>Faux SMS Ameli</title><link href="https://www.cybermalveillance.gouv.fr/a"/><summary>Carte Vitale</summary><updated>2026-10-21T00:00:00Z</updated></entry></feed>`;
  assert.deepEqual(parseFeed(rss).map((i) => [i.title, i.url, i.summary]), [["Scammers Impersonating USPS", "https://www.ic3.gov/PSA/2026/1", "Text messages claiming a package is on hold."]]);
  assert.equal(parseFeed(atom)[0].url, "https://www.cybermalveillance.gouv.fr/a");
});

test("eml: a downloaded email parses into the same shape as Gmail sync", async () => {
  const eml = [
    "Received: from relay.aol.test (relay.aol.test. [66.163.188.110]) by mx.google.com with ESMTPS id x1; Fri, 13 Feb 2026 04:54:01 -0800 (PST)",
    "Authentication-Results: mx.google.com;",
    "       dkim=pass header.i=@aol.com;",
    "       spf=pass (google.com: domain of x@aol.com designates 1.2.3.4) smtp.mailfrom=x@aol.com;",
    "       dmarc=pass (p=REJECT) header.from=aol.com",
    "From: Societe GeneraIe <X@AOL.COM>",
    "To: someone@example.test",
    "Subject: =?UTF-8?Q?Alerte_de_s=C3=A9curit=C3=A9?=",
    "Date: Fri, 13 Feb 2026 04:54:00 +0000",
    "MIME-Version: 1.0",
    'Content-Type: multipart/alternative; boundary="b"',
    "",
    "--b",
    "Content-Type: text/plain; charset=UTF-8",
    "Content-Transfer-Encoding: quoted-printable",
    "",
    "Op=C3=A9ration inhabituelle. Acc=C3=A9der au service antifraude.",
    "--b",
    "Content-Type: text/html; charset=UTF-8",
    "",
    '<p>Opération inhabituelle.</p><a href="https://3.massemiaks.test/">Accéder au service antifraude</a>',
    "--b--", "",
  ].join("\r\n");
  const m = await parseEml(Buffer.from(eml));
  assert.equal(m.fromName, "Societe GeneraIe");
  assert.equal(m.from, "x@aol.com");
  assert.equal(m.subject, "Alerte de sécurité");
  assert.equal(m.auth, "spf=pass dkim=pass dmarc=pass");
  assert.equal(m.authVerified, true);
  assert.match(m.body, /Opération inhabituelle/);
  // The same file without Gmail's delivery hop: its claims are unverified.
  const forged = await parseEml(Buffer.from(eml.split("\r\n").filter((l) => !l.startsWith("Received:")).join("\r\n")));
  assert.equal(forged.auth, "spf=none dkim=none dmarc=none");
  assert.equal(forged.authVerified, false);
  assert.deepEqual(m.links, [{ href: "https://3.massemiaks.test/", text: "Accéder au service antifraude" }]);
});

test("a second look at the landing pages only for Be careful with web links, never for Scam", async () => {
  const { needsLandingLook } = await import("../src/sync/checker.js");
  const withLink = { links: [{ text: "Read", href: "https://news.example-shop.test/r" }] };
  assert.equal(needsLandingLook({ verdict: "be_careful" }, withLink), true);
  assert.equal(needsLandingLook({ verdict: "scam" }, withLink), false, "opening a scam's links only tells it the address is read");
  assert.equal(needsLandingLook({ verdict: "safe" }, withLink), false);
  assert.equal(needsLandingLook({ verdict: "be_careful" }, { links: [] }), false);
  assert.equal(needsLandingLook({ verdict: "be_careful" }, withLink, true), false, "already opened when the person asked");
});

test("links: a page 'asks for card details' only when it has card fields, not when its code says cvc or expires", () => {
  assert.equal(describePage('<html><title>Quiz</title><p>Session expirée</p><script>var x={cvc:1,expiry:2}</script></html>'), 'Page titled "Quiz"');
  assert.match(describePage('<form><input autocomplete="cc-number" name="n"></form>'), /asks for card details/);
  assert.match(describePage('<form><input type="text" name="cardNumber"><input name="cvv"></form>'), /asks for card details/);
  assert.match(describePage('<form><input type="password" name="p"></form>'), /asks for a password/);
});

// --- Breach lookup (_product/specs/breach-exposure.md) ---
const XON_URL = "https://api.xposedornot.com/v1/breach-analytics?email=";
const CATALOGUE_URL = "https://haveibeenpwned.com/api/v3/breaches";
const HIBP_SEARCH = "https://haveibeenpwned.com/api/v3/breachedaccount/";
const json = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
const xonAnswer = (details) => json({ ExposedBreaches: { breaches_details: details } });
const XON_BOUYGUES = { breach: "BouyguesTelecom", domain: "bouyguestelecom.fr", xposed_date: "2025", xposed_data: "Email addresses;Names;Phone numbers;Dates of birth;Physical addresses" };
const XON_SHOP = { breach: "SomeShop", domain: "someshop.example", xposed_date: "2021", xposed_data: "Email addresses;Passwords;IP addresses" };
const CATALOGUE = [
  { Name: "BouyguesTelecom", Title: "Bouygues Telecom", Domain: "bouyguestelecom.fr", BreachDate: "2025-07-23", DataClasses: ["Bank account numbers", "Dates of birth", "Email addresses", "Names", "Phone numbers", "Physical addresses"] },
  { Name: "Adobe", Title: "Adobe", Domain: "adobe.com", BreachDate: "2013-10-04", DataClasses: ["Email addresses", "Password hints", "Passwords", "Usernames"] },
];
const breachFetch = ({ xon = xonAnswer([XON_BOUYGUES, XON_SHOP]), catalogue = json(CATALOGUE), hibp = json([]) } = {}) => {
  const calls = [];
  const fetchImpl = async (url, init = {}) => {
    calls.push({ url: String(url), headers: init.headers || {} });
    if (String(url).startsWith(XON_URL)) return typeof xon === "function" ? xon() : xon;
    if (String(url) === CATALOGUE_URL) return typeof catalogue === "function" ? catalogue() : catalogue;
    if (String(url).startsWith(HIBP_SEARCH)) return hibp;
    throw new Error(`unexpected fetch ${url}`);
  };
  return { fetchImpl, calls };
};

test("breach lookup: without a Have I Been Pwned key, the lookup asks the free list and completes what leaked from the catalogue", async () => {
  resetBreachCatalogue();
  const { fetchImpl, calls } = breachFetch();
  const out = await lookupBreaches("linda+test@example.test", { fetchImpl });
  assert.equal(out.source, "xposedornot");
  assert.equal(calls[0].url, `${XON_URL}linda%2Btest%40example.test`, "the address travels encoded, to the free list first");
  assert.ok(!("hibp-api-key" in calls[0].headers), "no key is sent to the free list");
  assert.equal(calls[1].url, CATALOGUE_URL, "the free catalogue completes the answer");
  const [bouygues, shop] = out.breaches;
  assert.equal(bouygues.id, "xon-BouyguesTelecom");
  assert.equal(bouygues.source, "Bouygues Telecom", "the catalogue's title, not the list's compact name");
  assert.equal(bouygues.date, "2025");
  assert.ok(bouygues.leaked.includes("IBAN"), "bank account numbers come from the catalogue");
  assert.deepEqual(bouygues.leaked, ["email", "name", "phone", "date of birth", "address", "IBAN"]);
  assert.equal(shop.source, "Some Shop", "a name the catalogue does not know is still readable");
  assert.deepEqual(shop.leaked, ["email", "old password"], "IP addresses are not a word for the senior");
  assert.ok(out.breaches.every(lookedUp) && !lookedUp({ id: "bouygues-2025" }), "looked-up breaches are told apart from the curated ones");
  assert.equal(breachLeaking({ breaches: out.breaches }, "IBAN")?.source, "Bouygues Telecom");
});

test("breach lookup: an address in no known breach gives an empty list, not an error, and never fetches the catalogue", async () => {
  resetBreachCatalogue();
  const notFound = breachFetch({ xon: json({ Error: "Not found", email: null }, 404) });
  assert.deepEqual(await lookupBreaches("nobody@example.test", { fetchImpl: notFound.fetchImpl }), { source: "xposedornot", breaches: [] });
  assert.equal(notFound.calls.length, 1, "nothing to complete, so no catalogue");
  const nothingExposed = breachFetch({ xon: json({ BreachMetrics: null, ExposedBreaches: null }) });
  assert.deepEqual((await lookupBreaches("nobody@example.test", { fetchImpl: nothingExposed.fetchImpl })).breaches, []);
  assert.equal(nothingExposed.calls.length, 1);
});

test("breach lookup: with a Have I Been Pwned key, the lookup asks Have I Been Pwned itself and never the free list", async () => {
  resetBreachCatalogue();
  const { fetchImpl, calls } = breachFetch({ hibp: json([{ Name: "FreeMobile", Title: "Free Mobile", Domain: "free.fr", BreachDate: "2024-10-17", DataClasses: ["Bank account numbers", "Names", "Physical addresses"] }]) });
  const out = await lookupBreaches("linda@example.test", { hibpKey: "k-test", fetchImpl });
  assert.equal(out.source, "hibp");
  assert.equal(calls.length, 1);
  assert.ok(calls[0].url.startsWith(`${HIBP_SEARCH}linda%40example.test`));
  assert.equal(calls[0].headers["hibp-api-key"], "k-test");
  assert.deepEqual(out.breaches, [{ id: "hibp-FreeMobile", source: "Free Mobile", domain: "free.fr", date: "2024", leaked: ["IBAN", "name", "address"] }]);
  const none = breachFetch({ hibp: new Response("", { status: 404 }) });
  assert.deepEqual((await lookupBreaches("linda@example.test", { hibpKey: "k-test", fetchImpl: none.fetchImpl })).breaches, []);
});

test("breach lookup: a busy or broken list is a plain error; a missing catalogue only costs the nicer names", async () => {
  resetBreachCatalogue();
  await assert.rejects(lookupBreaches("a@example.test", { fetchImpl: breachFetch({ xon: json({}, 429) }).fetchImpl }), /busy/);
  await assert.rejects(lookupBreaches("a@example.test", { fetchImpl: breachFetch({ xon: json({}, 500) }).fetchImpl }), /XposedOrNot 500/);
  await assert.rejects(lookupBreaches("a@example.test", { hibpKey: "k", fetchImpl: breachFetch({ hibp: json({}, 429) }).fetchImpl }), /busy/);
  const noCatalogue = breachFetch({ catalogue: json({}, 503) });
  const out = await lookupBreaches("a@example.test", { fetchImpl: noCatalogue.fetchImpl });
  assert.equal(out.breaches[0].source, "Bouygues Telecom", "the compact name is still read as words");
  assert.deepEqual(out.breaches[0].leaked, ["email", "name", "phone", "date of birth", "address"], "only what the free list knows");
});

test("breach lookup: the catalogue is fetched once a day, not per lookup", async () => {
  resetBreachCatalogue();
  const { fetchImpl, calls } = breachFetch();
  await lookupBreaches("a@example.test", { fetchImpl });
  await lookupBreaches("b@example.test", { fetchImpl });
  assert.deepEqual(calls.map((c) => c.url === CATALOGUE_URL), [false, true, false], "two lookups, one catalogue");
  assert.deepEqual(leakedWords(["Passwords", "Bank account numbers", "Unknown thing", " Names "]), ["old password", "IBAN", "name"]);
});

test("breach lookup: a bank number found by the lookup is explained away in the verdict", async () => {
  resetBreachCatalogue();
  const { breaches } = await lookupBreaches("francoise@example.test", { fetchImpl: breachFetch().fetchImpl });
  const message = { channel: "email", fromName: "Bouygues Telecom", from: "service@contestation-bouygues.test", claimedBrand: "Bouygues Telecom",
    auth: "spf=softfail dkim=none dmarc=fail", subject: "Avis de prélèvement de 69,90 €",
    body: "Madame, un prélèvement de 69,90 € sera effectué sur votre compte FR76 3000 3000 3000 3000 3000 1234. Contester : https://contestation-prelevement.test/fr",
    links: [{ text: "Contester", href: "https://contestation-prelevement.test/fr" }] };
  const v = detect({ locale: "fr-FR", message, personalContext: { breaches, providers: [], orders: [], trustedContacts: [], knownSenders: [], subscriptions: [] }, patternCards: [] });
  // The card keeps three reasons; the breach one outranks the link so the
  // senior reads it (specs/breach-exposure.md, line 4; the verdict engine's demo path).
  const reason = v.reasons.find((r) => r.evidence === "breach");
  assert.ok(reason, "the breach reason is on the card");
  assert.match(reason.text, /^Ce numéro de compte est réel, mais il a fuité lors du piratage de Bouygues Telecom \(2025\)/);
  const without = detect({ locale: "fr-FR", message, personalContext: { breaches: [], providers: [], orders: [], trustedContacts: [], knownSenders: [], subscriptions: [] }, patternCards: [] });
  assert.ok(!without._signals.some((r) => r.evidence === "breach"), "no breach known, no breach signal");
  const blank = detect({ locale: "fr-FR", message: { ...message, body: "Votre facture est disponible dans votre espace client." }, personalContext: { breaches, providers: [], orders: [], trustedContacts: [], knownSenders: [], subscriptions: [] }, patternCards: [] });
  assert.ok(!blank._signals.some((r) => r.evidence === "breach"), "a breach known but nothing quoted adds nothing");
});

test("breach rule: a social security number, a date of birth or the end of a card quoted in a message is explained away when a known breach leaked it, in both languages", () => {
  const ctx = (breaches) => ({ breaches, providers: [], orders: [], trustedContacts: [], knownSenders: [], subscriptions: [] });
  const npd = { id: "npd-2024", source: "National Public Data", date: "2024", leaked: ["name", "address", "phone", "Social Security number"] };
  const viamedis = { id: "viamedis-almerys-2024", source: "Viamedis / Almerys", date: "2024", leaked: ["name", "date of birth", "social security number", "health insurer"] };
  const ticketmaster = { id: "ticketmaster-2024", source: "Ticketmaster", date: "2024", leaked: ["name", "email", "phone", "partial card number"] };
  const scam = (body, locale = "en-US") => ({ locale, message: { channel: "email", fromName: "Medicare", from: "benefits@medicare-renewal.test", claimedBrand: "Medicare", auth: "spf=fail dkim=none dmarc=fail", subject: "Action required", body, links: [{ text: "Confirm", href: "https://medicare-renewal.test/confirm" }] }, patternCards: [] });
  const breachText = (v) => v._signals.find((r) => r.evidence === "breach")?.text || null;

  assert.match(breachText(detect({ ...scam("Your social security number 078-05-1120 is on file. Confirm your benefits today."), personalContext: ctx([npd]) })),
    /^That social security number is real, but it leaked in the National Public Data breach \(2024\)/);
  assert.equal(breachText(detect({ ...scam("Your social security number 078-05-1120 is on file."), personalContext: ctx([ticketmaster]) })), null, "a breach that leaked something else does not explain a social security number");
  assert.match(breachText(detect({ ...scam("Nous avons bien votre numéro de sécurité sociale 1 55 03 75 123 456 78. Confirmez vos droits.", "fr-FR"), personalContext: ctx([viamedis]) })),
    /^Ce numéro de sécurité sociale est réel, mais il a fuité lors du piratage de Viamedis \/ Almerys \(2024\)/);
  assert.match(breachText(detect({ ...scam("Née le 12/03/1951, vous devez confirmer votre mutuelle.", "fr-FR"), personalContext: ctx([viamedis]) })),
    /^Cette date de naissance est réelle, mais elle a fuité lors du piratage de Viamedis \/ Almerys \(2024\)/);
  assert.match(breachText(detect({ ...scam("Your card ending in 4421 was charged $249. Dispute it now."), personalContext: ctx([ticketmaster]) })),
    /^Those card digits are real, but it leaked in the Ticketmaster breach \(2024\)/);
  assert.match(breachText(detect({ ...scam("Votre carte se terminant par 4421 a été débitée de 249 €.", "fr-FR"), personalContext: ctx([ticketmaster]) })),
    /^Ces chiffres de carte sont réels, mais ils ont fuité lors du piratage de Ticketmaster \(2024\)/);
  assert.equal(breachText(detect({ ...scam("A parcel 1 55 03 75 123 456 78 is waiting for you."), personalContext: ctx([viamedis]) })), null, "digits alone, not announced as a social security number, are not one");
  assert.match(breachText(detect({ ...scam("Ihr Konto FR76 3000 3000 3000 3000 3000 1234 ... your old password is Linda1951."), personalContext: ctx([{ id: "old-password", source: "a website you used", date: "unknown", leaked: ["old password", "email"] }]) })),
    /^That old password is real/, "the old-password wording stands");
});
