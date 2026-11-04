// The landing page (_product/specs/landing-page.md): / without a session
// answers the landing as plain HTML (the question, the two doors, Linda's
// three messages with their cards, the life lines and the promises, how it
// works with the app's screenshots, the measured block, the early-access form,
// the public database's three doors, the footer), in English and French, with
// no script or font from another origin and nothing inline the CSP would
// refuse. The hint script hides it before the first paint for a signed-in
// browser or a #/ route; sign-in sets the prudence_in hint cookie and sign-out
// clears it (those need Postgres and skip without it). One test per
// behavior line at least; the headless pass covers the rest (the Done line).

import "./helpers/env.js";
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, statSync } from "node:fs";
import { runInNewContext } from "node:vm";
import { pool, resetDb, dbAvailable } from "./helpers/db.js";
import { buildApp } from "../src/server.js";

const ORIGIN = "http://localhost:3999";
const hasDb = await dbAvailable();
const withDb = { skip: hasDb ? false : "Postgres test database not available" };
let app;
let html;

before(async () => {
  if (hasDb) await resetDb();
  app = await buildApp({ logger: false });
  const res = await app.inject({ url: "/" });
  assert.equal(res.statusCode, 200);
  assert.match(res.headers["content-type"], /text\/html/);
  html = res.body;
});
after(async () => {
  await app?.close();
  await pool.end();
});

// The landing as served, cut into its two language blocks.
const landing = () => html.slice(html.indexOf('<div id="landing"'), html.indexOf('<a class="skip-link" href="#view"'));
const blockOf = (lang) => {
  const all = landing();
  const start = all.indexOf(`<div class="l-lang" data-lang="${lang}"`);
  const next = all.indexOf('<div class="l-lang" data-lang=', start + 10);
  return all.slice(start, next < 0 ? undefined : next);
};
const count = (s, re) => (s.match(re) || []).length;

test("signed out, / is the landing page as plain HTML before the app, with header, main sections and footer", () => {
  assert.ok(html.indexOf('<div id="landing"') < html.indexOf('<main id="view"'), "the landing comes before the app's screen");
  assert.match(html, /<main id="view" class="main" tabindex="-1" hidden><\/main>/, "the app's screen waits hidden until main.js draws it");
  for (const lang of ["en", "fr"]) {
    const b = blockOf(lang);
    assert.equal(count(b, /<header class="l-top">/g), 1, `${lang}: one header`);
    assert.equal(count(b, /<main id="l-main/g), 1, `${lang}: one main`);
    assert.equal(count(b, /<footer class="l-foot">/g), 1, `${lang}: one footer`);
    for (const m of b.matchAll(/<section[^>]*aria-labelledby="([^"]+)"/g)) assert.ok(b.includes(`id="${m[1]}"`), `${lang}: section ${m[1]} is named by its heading`);
    assert.ok(count(b, /<section /g) >= 7, `${lang}: hero, examples, life, how it works, proof, early access, database`);
  }
  assert.match(blockOf("en"), /^<div class="l-lang" data-lang="en" lang="en">/, "English shows without scripts");
  assert.match(blockOf("fr"), /^<div class="l-lang" data-lang="fr" lang="fr" hidden>/, "French waits behind the hidden attribute");
});

test("above the fold: the question, one sentence on what Prudence does, the demo and the early-access doors", () => {
  const en = blockOf("en");
  assert.match(en, /<h1 id="l-h1">Is this message real, for you\?<\/h1>/);
  assert.match(en, /checks every new email against your parent's own life \(her orders, her bank, her providers, the people she writes to\)/);
  assert.match(en, /<a class="l-door l-door-gold" href="#\/demo">.*Try it with Linda's inbox.*No sign-in\. Linda is made up\./);
  assert.match(en, /<a class="l-door l-door-outline" href="#early-access">.*Protect my parent's email.*Early access, usually within a day\./);
  assert.ok(en.includes('id="early-access"'), "the outline door scrolls to the form");
  const fr = blockOf("fr");
  assert.match(fr, /<h1 id="l-h1-fr">Ce message <span class="l-nowrap">est-il<\/span> vrai, pour vous&nbsp;\?<\/h1>/, "a no-break space keeps the question mark on its line");
  assert.match(fr, /href="#\/demo">.*Essayer avec la boîte de Françoise/);
  assert.match(fr, /href="#early-access-fr">.*Protéger les <span class="l-nowrap">e-mails<\/span> de mon parent/);
  assert.equal(count(landing(), /\/auth\/google/g), 2, "one sign-in link per language, in the early-access section only");
});

test("three example messages, each with the Scam card the app draws; senders and links are fictional and never clickable", () => {
  for (const lang of ["en", "fr"]) {
    const b = blockOf(lang);
    const examples = [...b.matchAll(/<article class="l-example"[\s\S]*?<\/article>/g)].map((m) => m[0]);
    assert.equal(examples.length, 3, `${lang}: three messages`);
    for (const e of examples) {
      assert.match(e, /<figure class="l-msg">/, "the message as it arrived");
      assert.match(e, /<div class="v2-card vcard danger">/, "the app's card");
      assert.match(e, /<p class="vcard-word"><span class="vcard-mark" aria-hidden="true"><svg[^>]*>.*<\/svg><\/span>(Scam|Arnaque)<\/p>/, "the word with its icon, never the color alone");
      assert.ok(count(e, /class="vcard-fact"/g) >= 2, "the reasons in plain words");
      assert.ok(count(e, /class="v2-chip">(Checked:|Vérifié&nbsp;:) /g) >= 2, "each reason says what was checked");
      assert.match(e, /class="vcard-next"/, "what to do instead");
      assert.doesNotMatch(e, /<a\s/, "nothing in a message is a link");
      for (const m of e.matchAll(/<b class="l-msg-link">([^<]+)<\/b>/g)) assert.match(m[1], /\.test\//, `${m[1]} is on a reserved .test name`);
      for (const m of e.matchAll(/<p class="l-msg-addr">([^<]+)<\/p>/g)) assert.match(m[1], /\.test$/, `${m[1]} is on a reserved .test name`);
    }
  }
  const en = blockOf("en");
  assert.match(en, /Bank of America[\s\S]*Ethan[\s\S]*\$300 today[\s\S]*don't tell Mom[\s\S]*USPS[\s\S]*\$1\.99/, "the lock notice, Ethan, the USPS fee");
  assert.match(en, /You bank with Chase\. Bank of America has never written to you\./, "Linda banks with Chase (data/profiles/linda.json)");
  assert.match(en, /Linda and her messages are made up for this page/);
  assert.match(en, /every verdict is written by Meta's Muse Spark/);
});

test("the differentiator, the three life lines, the three promises and Ask my trusted person", () => {
  const en = blockOf("en");
  assert.match(en, /A message is only a scam relative to a life\. Prudence knows hers\./);
  assert.match(en, /Amazon Logistics, not USPS/);
  assert.match(en, /Ethan's name, not Ethan's number/);
  assert.match(en, /leaked in a breach, so showing it proves nothing/);
  assert.match(en, /Nothing is ever deleted/);
  assert.match(en, /Any message comes back with one tap/);
  assert.match(en, /you see only what she chose to share/);
  assert.match(en, /Ask my trusted person/);
  assert.match(blockOf("fr"), /pas par Chronopost/, "the French life line says Chronopost");
});

test("how it works: three steps with the app's own screenshots, sized for their slot and lazy", () => {
  for (const lang of ["en", "fr"]) {
    const imgs = [...blockOf(lang).matchAll(/<img src="\/landing\/img\/([^"]+)" width="(\d+)" height="(\d+)" alt="([^"]+)" loading="lazy" decoding="async">/g)];
    assert.equal(imgs.length, 3, `${lang}: three screenshots`);
    for (const [, file, w, , alt] of imgs) {
      const size = statSync(new URL(`../public/landing/img/${file}`, import.meta.url)).size;
      assert.ok(size < 150 * 1024, `${file} is under 150 KB (${size})`);
      assert.ok(Number(w) <= 800, `${file} is at most 800 px wide`);
      assert.ok(alt.length > 20, `${file} says what it shows`);
    }
  }
  assert.match(blockOf("en"), /Sign in with Google[\s\S]*learns her life from her own genuine mail[\s\S]*Every new message gets one verdict/);
});

test("the proof block carries the measured numbers with their source and its limit, and names Muse Spark", () => {
  const en = blockOf("en");
  for (const s of ["18,849", "81%", "29%", "1 in 17,291", "6 seconds", "Muse Spark 1.3", "Standard mode", "Zenodo 8339691", "public emails are not a family's inbox"]) assert.ok(en.includes(s), s);
  const proof = en.slice(en.indexOf('id="proof"'), en.indexOf('id="early-access"'));
  const rest = en.replace(proof, "");
  assert.doesNotMatch(rest, /\d%/, "percentages live in the proof block only");
});

test("early access: the test-phase line, a labeled form that posts to /api/early-access, and the plain line without scripts", () => {
  const en = blockOf("en");
  assert.match(en, /Prudence is in Google's test phase: we add you by hand, usually within a day, then you sign in with Google from this page\./);
  const form = en.match(/<form class="l-form l-js"[\s\S]*?<\/form>/)[0];
  assert.match(form, /method="post" action="\/api\/early-access"/);
  for (const [id, label] of [["l-email", "The Gmail address to protect"], ["l-name", "A first name"], ["l-note", "A note"]]) {
    assert.match(form, new RegExp(`<label for="${id}">${label}`), `${label} is labeled`);
    assert.ok(form.includes(`id="${id}"`));
  }
  assert.match(form, /<legend>Whose address is it\?<\/legend>[\s\S]*value="parent" checked>My parent's[\s\S]*value="mine">Mine/);
  assert.match(form, /<input type="hidden" name="language" value="en">/);
  assert.match(en, /<p class="l-nojs">Sending this request needs a browser with scripts turned on\.<\/p>/);
  assert.match(en, /<p class="l-thanks-line">Thank you\. We will write to <span class="l-sent"><\/span>\.<\/p>/);
  assert.match(blockOf("fr"), /<input type="hidden" name="language" value="fr">/);
});

test("the public database: the lookup box to /public/#/suspects, the library with its count, the week's breaches", () => {
  const en = blockOf("en");
  assert.match(en, /What scammers are doing this week/);
  assert.match(en, /<form class="l-look l-js" role="search" action="\/public\/" method="get">[\s\S]*<label for="l-q">Check a website, a sender address or a phone number<\/label>/);
  assert.match(en, /<a class="l-btn l-btn-teal" href="\/public\/#\/suspects">/, "without scripts, a plain link to the lookup");
  assert.match(en, /<a class="l-db-card" href="\/public\/#\/library">[\s\S]*<span class="l-lib-count">\d+<\/span> examples in <span class="l-lib-families">\d+<\/span> families, free to reuse \(CC BY 4\.0\)/);
  assert.match(en, /<a class="l-db-card" href="\/public\/#\/watch">[\s\S]*This week's breaches and new techniques/);
  const js = readFileSync(new URL("../public/landing/landing.js", import.meta.url), "utf8");
  assert.match(js, /`\/public\/#\/suspects\?q=\$\{encodeURIComponent\(q\)\}`/, "the script opens the lookup with the text typed");
  assert.match(js, /\/api\/public\/about/, "the count is read live");
});

test("footer: privacy, terms, the public repository, the hackathon, the operator and contact, the language switch, no cookie banner", () => {
  const en = blockOf("en");
  const foot = en.slice(en.indexOf('<footer class="l-foot">'));
  for (const href of ["/privacy.html", "/terms.html", "https://github.com/hadrienbaradel/scam-shield", "https://github.com/hadrienbaradel/scam-shield/issues"]) assert.ok(foot.includes(`href="${href}"`), href);
  assert.match(foot, /Built for the Meta Global AI Developer Hackathon 2026, Indie track\./);
  assert.match(foot, /Run by Hadrien Baradel and Vlad Zloteanu/);
  assert.match(foot, /data-to="en"[^>]*>English<\/button>[\s\S]*data-to="fr"[^>]*>Français<\/button>/);
  assert.doesNotMatch(landing(), /cookie consent|accept cookies/i);
});

test("one page, our own stylesheets, scripts and font only: nothing from another origin, nothing inline", () => {
  for (const m of html.matchAll(/<script\b([^>]*)>/g)) {
    const src = m[1].match(/src="([^"]+)"/);
    assert.ok(src, "no inline script: the CSP is script-src 'self'");
    assert.match(src[1], /^\/(?!\/)/, `${src[1]} is served from our host`);
  }
  for (const m of html.matchAll(/<link\b[^>]*href="([^"]+)"/g)) assert.match(m[1], /^\/(?!\/)/, `${m[1]} is served from our host`);
  assert.doesNotMatch(html, /\sstyle=/, "no style attribute: the CSP allows only same-origin stylesheets");
  assert.doesNotMatch(html, /<style\b/);
  assert.doesNotMatch(html, /\son[a-z]+=/i, "no inline handler");
  assert.match(html, /<link rel="stylesheet" href="\/landing\/landing\.css">\n<script src="\/landing\/hint\.js"><\/script>\n<\/head>/, "the hint runs in the head, before the body is drawn");
  for (const file of ["/landing/landing.css", "/landing/hint.js", "/landing/landing.js", "/fonts/atkinson-hyperlegible-next-400.woff2"]) {
    assert.ok(statSync(new URL(`../public${file}`, import.meta.url)).size > 0, file);
  }
});

test("the static files of the landing are served", async () => {
  for (const [url, type] of [["/landing/landing.css", /text\/css/], ["/landing/hint.js", /javascript/], ["/landing/landing.js", /javascript/], ["/landing/img/step1-en.png", /image\/png/]]) {
    const res = await app.inject({ url });
    assert.equal(res.statusCode, 200, url);
    assert.match(res.headers["content-type"], type, url);
  }
});

// landing/hint.js run as a browser would, before the body: the classes it leaves on <html>.
function hint({ cookie = "", hash = "", saved = null, language = "en-US", storage = true } = {}) {
  const classes = new Set();
  const localStorage = { getItem: (k) => { if (!storage) throw new Error("private mode"); return k === "ss_lang" ? saved : null; } };
  runInNewContext(readFileSync(new URL("../public/landing/hint.js", import.meta.url), "utf8"), {
    document: { cookie, documentElement: { classList: { add: (c) => classes.add(c) } } },
    location: { hash }, localStorage, navigator: { language },
  });
  return [...classes].sort().join(" ");
}

test("a signed-in browser or a #/ link goes straight to the app, without a flash of the landing", () => {
  assert.equal(hint(), "js", "a visitor: the landing, in English");
  assert.equal(hint({ cookie: "prudence_in=1" }), "in-app js");
  assert.equal(hint({ cookie: "ss_lang=fr; prudence_in=1; other=2" }), "in-app js");
  assert.equal(hint({ cookie: "xprudence_in=1" }), "js", "another cookie's name does not count");
  assert.equal(hint({ cookie: "prudence_in=0" }), "js");
  for (const hash of ["#/demo", "#/demo/learn", "#/guardian?accepted=1", "#/today"]) assert.equal(hint({ hash }), "in-app js", hash);
  assert.equal(hint({ hash: "#early-access" }), "js", "a place on the landing is no route");
});

test("the language: the one the app keeps, else the browser's; French shows without a flash", () => {
  assert.equal(hint({ saved: "fr" }), "js l-fr");
  assert.equal(hint({ language: "fr-FR" }), "js l-fr");
  assert.equal(hint({ saved: "en", language: "fr-FR" }), "js", "the choice the person made wins");
  assert.equal(hint({ storage: false, language: "fr-CA" }), "js l-fr", "private mode: the browser's language");
});

// ------------------------------------------------- the hint cookie (Postgres) --

const FORM = { "content-type": "application/x-www-form-urlencoded", origin: ORIGIN };
const cookieOf = (res, name) => res.cookies.find((c) => c.name === name);

test("signing in sets prudence_in beside the session, readable by the page; signing out clears it", withDb, async () => {
  const res = await app.inject({ method: "POST", url: "/dev/signin", headers: FORM, payload: new URLSearchParams({ email: "landing-hint@example.test", role: "senior" }).toString() });
  assert.equal(res.statusCode, 302);
  const sid = cookieOf(res, "ss_sid");
  const hintCookie = cookieOf(res, "prudence_in");
  assert.ok(sid && hintCookie, "both cookies");
  assert.equal(hintCookie.value, "1", "it carries nothing but the hint");
  assert.equal(hintCookie.httpOnly, undefined, "the page reads it before the first paint");
  assert.equal(sid.httpOnly, true, "the session stays httpOnly");
  assert.deepEqual([hintCookie.path, hintCookie.sameSite, hintCookie.maxAge], [sid.path, sid.sameSite, sid.maxAge], "same path, SameSite and lifetime as the session");

  const out = await app.inject({ method: "POST", url: "/auth/logout", headers: { cookie: `ss_sid=${sid.value}; prudence_in=1`, origin: ORIGIN }, payload: {} });
  assert.equal(out.statusCode, 200);
  const cleared = cookieOf(out, "prudence_in");
  assert.ok(cleared, "sign-out sends prudence_in back");
  assert.equal(cleared.value, "");
  assert.ok(cleared.expires && cleared.expires.getTime() <= Date.now(), "expired");
  assert.equal(cleared.path, "/");
});

test("deleting the account clears the hint too", withDb, async () => {
  const res = await app.inject({ method: "POST", url: "/dev/signin", headers: FORM, payload: new URLSearchParams({ email: "landing-delete@example.test", role: "trusted" }).toString() });
  const sid = cookieOf(res, "ss_sid");
  const gone = await app.inject({ method: "DELETE", url: "/api/account", headers: { cookie: `ss_sid=${sid.value}; prudence_in=1`, origin: ORIGIN } });
  assert.equal(gone.statusCode, 200);
  assert.equal(cookieOf(gone, "prudence_in")?.value, "");
});

// --------------------------------------- landing/landing.js on a fake page --

// The few parts of the page landing.js touches: <html>'s classes, #view,
// #landing (gone once a signed-in person's app removed it), the cookie, the address.
function fakePage() {
  const classes = new Set();
  const page = {
    replaced: [], removed: false, landingThere: true,
    view: { innerHTML: "", hidden: false },
    landing: { querySelectorAll: () => [], querySelector: () => null, addEventListener: () => {}, remove: () => { page.removed = true; page.landingThere = false; } },
  };
  globalThis.document = {
    cookie: "",
    documentElement: { classList: { add: (c) => classes.add(c), remove: (c) => classes.delete(c), toggle: (c, on) => (on ? classes.add(c) : classes.delete(c)), contains: (c) => classes.has(c) }, lang: "en" },
    getElementById: (id) => (id === "view" ? page.view : id === "landing" && page.landingThere ? page.landing : null),
  };
  globalThis.location = { hash: "", search: "", replace: (u) => page.replaced.push(u) };
  globalThis.fetch = () => new Promise(() => {}); // the library count never answers here
  page.classes = classes;
  return page;
}

test("signed out after a session ended with the page open: nothing of the app stays, the page comes back clean at /", async () => {
  const page = fakePage();
  const { showLanding, hideLanding, landingAnchor } = await import("../public/landing/landing.js");
  // A signed-in senior: the app drew her inbox and removed the landing.
  page.classes.add("in-app");
  hideLanding(true);
  page.view.innerHTML = "<section>Linda's inbox: Your slippers are on the way</section>";
  assert.ok(page.removed, "a signed-in person's landing leaves the page");
  assert.equal(page.view.hidden, false);
  // Her session ends (sign-out elsewhere, expiry, Delete my account) and the next draw finds no one.
  showLanding({ googleConfigured: true });
  assert.equal(page.view.innerHTML, "", "her inbox is emptied, not merely hidden");
  assert.equal(page.view.hidden, true);
  assert.deepEqual(page.replaced, ["/"], "no landing left in this page: it reloads at /");

  // A visitor back from the demo: the demo is emptied and the landing shows again.
  const visitor = fakePage();
  visitor.classes.add("in-app");
  hideLanding(false);
  visitor.view.innerHTML = "<section>Example: this is Linda's day</section>";
  assert.equal(visitor.removed, false, "a visitor's landing stays for the Back button");
  showLanding({ googleConfigured: true });
  assert.equal(visitor.view.innerHTML, "");
  assert.equal(visitor.view.hidden, true);
  assert.equal(visitor.classes.has("in-app"), false, "the landing shows");
  assert.deepEqual(visitor.replaced, [], "no reload needed");
  assert.equal(landingAnchor(), true, "a place on the landing is left to the browser");
  location.hash = "#/demo";
  assert.equal(landingAnchor(), false, "a route is the router's");
});
