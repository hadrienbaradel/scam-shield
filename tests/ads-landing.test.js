// An ad's landing variant (_product/specs/ad-studio.md, lines 7 and 8;
// contract C5 in docs/plans/2026-11-04-ad-studio.md). The pure part first:
// renderVariant puts the ad's headline and opening line in the English block,
// the headline in the title and the ad's code in the English form, escaped,
// and nothing else changes; a missing anchor leaves the page as it is. The
// hint script and landing.js keep the variant in English and on the landing.
// Then GET /a/<code> over Postgres: a published or paused ad is served,
// anything else is the site's plain 404 for a visitor, an admin previews any
// ad; visits are counted, but never robots, link previewers, previews,
// admins or HEAD; no fbclid, no cookie, no-store and the security headers of
// /. The Postgres parts skip without a database.
import "./helpers/env.js";
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, writeFileSync, mkdtempSync, utimesSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runInNewContext } from "node:vm";
import Fastify from "fastify";
import { renderVariant } from "../src/ads/landingVariant.js";
import adLandingRoutes, { countsAsVisit, ROBOT } from "../src/routes/adLanding.js";
import { pool, resetDb, makeUser, sessionFor, dbAvailable } from "./helpers/db.js";
import { one } from "../src/db/pool.js";
import { buildApp } from "../src/server.js";

const INDEX = readFileSync(new URL("../public/index.html", import.meta.url), "utf8");
const AD = { code: "k3v9q2xa", headline: "Is that text from the bank real?", lead: "Prudence checks your mother's new email against her own life and tells her in plain words." };
const enBlock = (html) => html.slice(html.indexOf('<div class="l-lang" data-lang="en"'), html.indexOf('<div class="l-lang" data-lang="fr"'));
const frOnward = (html) => html.slice(html.indexOf('<div class="l-lang" data-lang="fr"'));
const titleOf = (html) => /<title>([^<]*)<\/title>/.exec(html)[1];
const h1Of = (html) => /<h1 id="l-h1">([\s\S]*?)<\/h1>/.exec(html)[1];
const heroLeadOf = (html) => {
  const en = enBlock(html);
  const after = en.slice(en.indexOf("</h1>") + 5);
  return /^\s*<p class="l-lead">([\s\S]*?)<\/p>/.exec(after)[1];
};
// The English early-access form, from its opening tag to </form>.
const enForm = (html) => { const en = enBlock(html); const at = en.indexOf('<form class="l-form'); return en.slice(at, en.indexOf("</form>", at)); };

// ---------------------------------------------------------------- pure ---

test("the variant is the live landing with the ad's headline, opening line and title in English, and its code in the English form; nothing else changes", () => {
  const out = renderVariant(INDEX, AD);
  assert.equal(h1Of(out), AD.headline);
  assert.equal(heroLeadOf(out), "Prudence checks your mother&#39;s new email against her own life and tells her in plain words.");
  assert.equal(titleOf(out), AD.headline);
  assert.ok(enForm(out).includes(`<input type="hidden" name="variant" value="${AD.code}">`), "the code rides in the English early-access form");
  assert.equal((out.match(/name="variant"/g) || []).length, 1, "one field, in the English form only");
  assert.equal(frOnward(out), frOnward(INDEX), "the French block and everything after it, byte for byte");

  // Undo the four changes: what is left is the page at /, byte for byte.
  const restored = out
    .replace(`<title>${AD.headline}</title>`, `<title>${titleOf(INDEX)}</title>`)
    .replace(`<h1 id="l-h1">${AD.headline}</h1>`, `<h1 id="l-h1">${h1Of(INDEX)}</h1>`)
    .replace(`<p class="l-lead">${heroLeadOf(out)}</p>`, `<p class="l-lead">${heroLeadOf(INDEX)}</p>`)
    .replace(`<input type="hidden" name="variant" value="${AD.code}">`, "");
  assert.equal(restored, INDEX);
  assert.equal(INDEX.includes(AD.headline), false, "the fixture's words are new to the page");
});

test("the ad's words are text, never HTML: <script>, quotes and & are escaped", () => {
  const out = renderVariant(INDEX, { code: 'k3v9q2xa"><script>x()</script>', headline: '<script>alert("hi")</script> Tom & Jerry', lead: '"Mom" & <b>me</b>' });
  assert.equal(h1Of(out), "&lt;script&gt;alert(&quot;hi&quot;)&lt;/script&gt; Tom &amp; Jerry");
  assert.equal(titleOf(out), "&lt;script&gt;alert(&quot;hi&quot;)&lt;/script&gt; Tom &amp; Jerry");
  assert.equal(heroLeadOf(out), "&quot;Mom&quot; &amp; &lt;b&gt;me&lt;/b&gt;");
  assert.ok(out.includes('value="k3v9q2xa&quot;&gt;&lt;script&gt;x()&lt;/script&gt;"'), "the code stays inside its attribute");
  assert.equal(out.includes("<script>alert"), false);
  assert.equal(out.includes("<script>x()"), false);
  assert.equal((out.match(/<script/g) || []).length, (INDEX.match(/<script/g) || []).length, "no script more than the page's own");
});

test("an ad without landing words keeps the page's headline, opening line and title, and still carries its code", () => {
  const out = renderVariant(INDEX, { code: AD.code, headline: "   ", lead: undefined });
  assert.equal(h1Of(out), h1Of(INDEX));
  assert.equal(heroLeadOf(out), heroLeadOf(INDEX));
  assert.equal(titleOf(out), titleOf(INDEX));
  assert.ok(enForm(out).includes(`value="${AD.code}"`));
  assert.equal(renderVariant(INDEX, { ...AD, lead: null }).includes(heroLeadOf(INDEX)), true, "only the headline changes");
});

test("when the landing changed and an anchor is gone, the page goes out unchanged and the server says so once", (t) => {
  const warn = t.mock.method(console, "warn", () => {});
  const changed = [
    INDEX.replace('<h1 id="l-h1">', "<h1>"),
    INDEX.replace(/(<h1 id="l-h1">[^<]*<\/h1>)/, '$1\n<p class="l-kicker">New</p>'),
    INDEX.replace('<form class="l-form l-js" method="post" action="/api/early-access" novalidate aria-labelledby="l-ea-title"', '<form class="l-request"'),
    INDEX.replace('<div class="l-lang" data-lang="fr"', '<div class="l-lang" data-lang="de"'),
    INDEX.replace(/<title>[^<]*<\/title>/, ""),
    "",
  ];
  for (const page of changed) assert.equal(renderVariant(page, AD), page);
  assert.equal(renderVariant(undefined, AD), "");
  assert.equal(warn.mock.callCount(), 1, "one line in the log, not one per visit");
  assert.match(warn.mock.calls[0].arguments[0], /Landing variant: .* not found in public\/index\.html/);
});

test("the landing's own addresses are absolute, so /a/<code> loads exactly what / loads", () => {
  const relative = [...INDEX.matchAll(/\s(?:src|href|action|srcset|poster)="([^"]*)"/g)].map((m) => m[1])
    .filter((u) => !/^(?:\/|#|https?:|mailto:|data:)/.test(u));
  assert.deepEqual(relative, [], "a relative address would break under /a/");
  assert.equal(/<base\s/i.test(INDEX), false, "no <base>: #/demo and #early-access stay on the variant");
});

// landing/hint.js run as a browser would, before the body, at an address.
function hint({ pathname = "/", cookie = "", hash = "", saved = null, language = "en-US" } = {}) {
  const classes = new Set();
  runInNewContext(readFileSync(new URL("../public/landing/hint.js", import.meta.url), "utf8"), {
    document: { cookie, documentElement: { classList: { add: (c) => classes.add(c) } } },
    location: { pathname, hash }, localStorage: { getItem: (k) => (k === "ss_lang" ? saved : null) }, navigator: { language },
  });
  return [...classes].sort().join(" ");
}

test("an ad's variant opens on the landing in English, for a French or signed-in browser too; a #/ route still opens the app; / is as before", () => {
  const at = "/a/k3v9q2xa";
  assert.equal(hint({ pathname: at }), "js");
  assert.equal(hint({ pathname: at, language: "fr-FR" }), "js", "a French browser still gets the English page");
  assert.equal(hint({ pathname: at, saved: "fr" }), "js", "and a saved French choice");
  assert.equal(hint({ pathname: at, cookie: "prudence_in=1" }), "js", "a signed-in admin's preview shows the landing");
  assert.equal(hint({ pathname: at, hash: "#/demo" }), "in-app js", "the demo door still opens the app");
  for (const pathname of ["/", "/a/K3V9Q2XA", "/a/k3v9q2x", "/b/k3v9q2xa"]) {
    assert.equal(hint({ pathname, language: "fr-FR" }), "js l-fr", pathname);
    assert.equal(hint({ pathname, cookie: "prudence_in=1" }), "in-app js", pathname);
  }
});

// landing.js on a fake page that carries a variant field: its own module
// instance per scenario (the ?query), as each page load has its own.
function fakeVariantPage({ variant = AD.code } = {}) {
  const classes = new Set();
  const blocks = ["en", "fr"].map((lang) => ({ dataset: { lang }, hidden: lang !== "en", querySelector: () => null }));
  const page = {
    removed: false, landingThere: true, listeners: {},
    view: { innerHTML: "", hidden: false },
    landing: {
      querySelectorAll: (s) => (s === ".l-lang" ? blocks : []),
      querySelector: (s) => (s === 'input[name="variant"]' ? (variant ? { value: variant } : null)
        : s === "#l-h1" ? { textContent: AD.headline }
          : blocks.find((b) => s === `.l-lang[data-lang="${b.dataset.lang}"]`) || null),
      addEventListener: (type, fn) => { page.listeners[type] = fn; },
      remove: () => { page.removed = true; page.landingThere = false; },
    },
    blocks,
  };
  globalThis.document = {
    cookie: "prudence_in=1", title: `Prudence — Ce message est-il vrai, pour vous ?`,
    documentElement: { classList: { add: (c) => classes.add(c), remove: (c) => classes.delete(c), toggle: (c, on) => (on ? classes.add(c) : classes.delete(c)), contains: (c) => classes.has(c) }, lang: "fr" },
    getElementById: (id) => (id === "view" ? page.view : id === "landing" && page.landingThere ? page.landing : null),
  };
  globalThis.location = { hash: "", search: "?preview=1", replace: () => {} };
  globalThis.fetch = () => new Promise(() => {});
  page.classes = classes;
  return page;
}

test("on an ad's variant a signed-in admin sees the landing in English with the ad's headline as the title; the language switch keeps it; #/demo opens the app", async () => {
  const i18n = await import("../public/js/i18n.js");
  const page = fakeVariantPage();
  i18n.setLang("fr"); // main.js applied a French browser's language before drawing
  page.classes.add("l-fr");
  const { hideLanding, landingAnchor } = await import("../public/landing/landing.js?variant-admin");
  hideLanding(true); // main.js: someone is signed in
  assert.equal(page.removed, false, "the landing stays");
  assert.equal(page.classes.has("in-app"), false);
  assert.equal(page.view.hidden, true, "the app draws behind it, hidden");
  assert.equal(i18n.getLang(), "en");
  assert.equal(page.classes.has("l-fr"), false);
  assert.deepEqual(page.blocks.map((b) => b.hidden), [false, true], "the English block shows");
  assert.equal(document.title, AD.headline);
  assert.equal(document.cookie, "prudence_in=1", "a signed-in person's hint is left alone");
  assert.equal(landingAnchor(), true, "#early-access is left to the browser");

  // The visitor switches to French, then back: the tab follows, the ad's headline in English.
  const button = (to) => ({ target: { closest: () => ({ dataset: { to }, classList: { contains: () => true } }) } });
  page.listeners.click(button("fr"));
  assert.deepEqual(page.blocks.map((b) => b.hidden), [true, false]);
  assert.match(document.title, /^Prudence — /);
  page.listeners.click(button("en"));
  assert.equal(document.title, AD.headline);

  location.hash = "#/demo";
  hideLanding(true);
  assert.equal(page.classes.has("in-app"), true, "a #/ route opens the app");
  assert.equal(page.removed, true, "a signed-in person's landing then leaves the page, as on /");
});

test("a visitor on an ad's variant gets the English landing even after a French start; on / the language stays the browser's", async () => {
  const i18n = await import("../public/js/i18n.js");
  const page = fakeVariantPage();
  document.cookie = "";
  i18n.setLang("fr");
  const { showLanding } = await import("../public/landing/landing.js?variant-visitor");
  showLanding({ googleConfigured: true });
  assert.equal(i18n.getLang(), "en");
  assert.deepEqual(page.blocks.map((b) => b.hidden), [false, true]);
  assert.equal(document.title, AD.headline);

  const plain = fakeVariantPage({ variant: null });
  document.cookie = "";
  i18n.setLang("fr");
  const landing = await import("../public/landing/landing.js?plain-root");
  landing.showLanding({ googleConfigured: true });
  assert.equal(i18n.getLang(), "fr", "the page at / keeps the visitor's language");
  assert.deepEqual(plain.blocks.map((b) => b.hidden), [true, false]);
  assert.match(document.title, /^Prudence — /, "and its own title");
  landing.hideLanding(false);
  assert.equal(plain.classes.has("in-app"), true, "a visitor's demo opens over the landing, as before");
});

test("a visit is a person's GET: robots, link previewers, previews, admins and HEAD are not counted", () => {
  const chrome = "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1 [FBAN/FBIOS;FBAV/480.0]";
  assert.equal(countsAsVisit({ method: "GET", userAgent: chrome }), true, "Facebook's in-app browser is a person");
  assert.equal(countsAsVisit({ method: "GET", userAgent: undefined }), true);
  for (const ua of ["facebookexternalhit/1.1 (+http://www.facebook.com/externalhit_uatext.php)", "Facebot", "Mozilla/5.0 (compatible; Googlebot/2.1)",
    "Twitterbot/1.0", "Slackbot-LinkExpanding 1.0", "SomeCrawler/2", "Baiduspider", "WhatsApp link Preview", "FACEBOOKEXTERNALHIT"]) {
    assert.ok(ROBOT.test(ua), ua);
    assert.equal(countsAsVisit({ method: "GET", userAgent: ua }), false, ua);
  }
  assert.equal(countsAsVisit({ method: "GET", userAgent: chrome, preview: true }), false);
  assert.equal(countsAsVisit({ method: "GET", userAgent: chrome, admin: true }), false);
  assert.equal(countsAsVisit({ method: "HEAD", userAgent: chrome }), false);
});

// ------------------------------------------------------------- the routes ---

const ORIGIN = "http://localhost:3999";
const PERSON = "Mozilla/5.0 (Macintosh; Intel Mac OS X 14_0) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36";
const hasDb = await dbAvailable();
const withDb = { skip: hasDb ? false : "Postgres test database not available" };
let app;
before(async () => {
  if (!hasDb) return;
  await resetDb();
  await pool.query("DELETE FROM ads");
  app = await buildApp({ logger: false });
});
after(async () => { await app?.close(); await pool.end(); });

async function makeAd(code, status, landing = { headline: AD.headline, lead: AD.lead }) {
  const ad = await one("INSERT INTO ads (code, status, version) VALUES ($1, $2, $3) RETURNING id", [code, status, landing ? 1 : 0]);
  if (landing) {
    await pool.query("INSERT INTO ad_versions (ad_id, version, words) VALUES ($1, 1, $2)",
      [ad.id, { headline: "Ad headline", primary_text: "Text", description: "", cta: "LEARN_MORE", photo_brief: "A kitchen", landing }]);
  }
  return ad.id;
}
const visits = async (code) => (await one("SELECT visits FROM ads WHERE code = $1", [code])).visits;
const get = (url, headers = {}, method = "GET") => app.inject({ method, url, headers: { "user-agent": PERSON, ...headers } });

test("a published ad's variant is served with its words and counted once per visit; never a cookie, never the fbclid, no-store and the security headers of /", withDb, async () => {
  await makeAd("pub1ad01", "published");
  const res = await get("/a/pub1ad01?fbclid=IwAR3xYzSecretClick_aem_q1w2e3");
  assert.equal(res.statusCode, 200, res.body);
  assert.match(res.headers["content-type"], /^text\/html; charset=utf-8/);
  assert.equal(h1Of(res.body), AD.headline);
  assert.equal(titleOf(res.body), AD.headline);
  assert.ok(enForm(res.body).includes('<input type="hidden" name="variant" value="pub1ad01">'));
  assert.equal(res.body.includes("IwAR3xYz"), false, "the fbclid is not in the page");
  assert.equal(res.body.includes("fbclid"), false);
  assert.equal(res.headers["set-cookie"], undefined, "no cookie");
  assert.equal(res.headers["cache-control"], "no-store");
  assert.equal(await visits("pub1ad01"), 1);
  assert.equal((await get("/a/pub1ad01")).statusCode, 200);
  assert.equal(await visits("pub1ad01"), 2, "one per visit");
  const kept = await one("SELECT * FROM ads WHERE code = 'pub1ad01'");
  assert.equal(JSON.stringify(kept).includes("IwAR3xYz"), false, "nothing of the address is kept");

  const root = await app.inject({ url: "/" });
  for (const [name, value] of Object.entries(root.headers)) {
    if (["content-security-policy", "referrer-policy", "x-frame-options", "x-content-type-options", "cross-origin-opener-policy", "cross-origin-resource-policy",
      "origin-agent-cluster", "x-dns-prefetch-control", "x-download-options", "x-permitted-cross-domain-policies", "x-xss-protection", "strict-transport-security"].includes(name)) {
      assert.equal(res.headers[name], value, name);
    }
  }
  assert.match(res.headers["content-security-policy"], /script-src 'self'/);

  await makeAd("paused01", "paused");
  assert.equal((await get("/a/paused01")).statusCode, 200, "a paused ad's link still works");
  assert.equal(await visits("paused01"), 1);
});

test("robots and link previewers, ?preview=1 and HEAD are served but not counted", withDb, async () => {
  await makeAd("robots01", "published");
  for (const ua of ["facebookexternalhit/1.1 (+http://www.facebook.com/externalhit_uatext.php)", "Facebot", "Mozilla/5.0 (compatible; bingbot/2.0)", "LinkPreview/1.0"]) {
    const res = await get("/a/robots01", { "user-agent": ua });
    assert.equal(res.statusCode, 200, ua);
    assert.equal(h1Of(res.body), AD.headline, "Facebook's crawler sees the ad's page");
  }
  assert.equal((await get("/a/robots01?preview=1")).statusCode, 200);
  assert.equal((await get("/a/robots01", {}, "HEAD")).statusCode, 200);
  assert.equal(await visits("robots01"), 0);
});

test("a draft, a rejected ad, an unknown or a malformed code is the site's plain 404 for a visitor, even with ?preview=1", withDb, async () => {
  await makeAd("draft001", "draft");
  await makeAd("reject01", "rejected");
  await makeAd("drafting", "drafting", null);
  const plain = await app.inject({ url: "/no-such-page" });
  const signedIn = await sessionFor(await makeUser({ email: "trusted-ads@example.test" }));
  for (const [url, headers] of [["/a/draft001", {}], ["/a/draft001?preview=1", {}], ["/a/reject01", {}], ["/a/drafting?preview=1", {}], ["/a/unknown1", {}],
    ["/a/draft001?preview=1", { cookie: signedIn }], ["/a/ABCDEFGH", {}], ["/a/abc", {}], ["/a/abcdefgh1", {}], ["/a/pub1ad0%21", {}]]) {
    const res = await get(url, headers);
    assert.equal(res.statusCode, 404, url);
    assert.equal(res.headers["content-type"], plain.headers["content-type"], url);
    assert.deepEqual(Object.keys(res.json()), Object.keys(plain.json()), `${url}: the same 404 as any missing page`);
  }
  assert.equal(await visits("draft001"), 0);
});

test("an admin previews any ad with ?preview=1, never counted; without it a draft stays a 404; an admin's visit is not counted", withDb, async () => {
  await makeAd("adm1draf", "draft");
  await makeAd("adm1pubd", "published");
  await makeAd("adm1none", "drafting", null);
  const admin = await sessionFor(await makeUser({ email: "admin@example.test" }));
  const preview = await get("/a/adm1draf?preview=1", { cookie: admin });
  assert.equal(preview.statusCode, 200);
  assert.equal(h1Of(preview.body), AD.headline);
  assert.equal(preview.headers["set-cookie"], undefined);
  assert.equal((await get("/a/adm1draf", { cookie: admin })).statusCode, 404, "Preview is a deliberate link");
  const empty = await get("/a/adm1none?preview=1", { cookie: admin });
  assert.equal(empty.statusCode, 200, "an idea still being written previews as the landing");
  assert.equal(h1Of(empty.body), h1Of(INDEX));
  assert.ok(enForm(empty.body).includes('value="adm1none"'));
  assert.equal((await get("/a/adm1pubd", { cookie: admin })).statusCode, 200);
  assert.equal(await visits("adm1draf"), 0);
  assert.equal(await visits("adm1pubd"), 0, "an admin is not a visitor");
});

test("the page follows public/index.html: read once, read again when it changes", withDb, async () => {
  await makeAd("follow01", "published");
  const dir = mkdtempSync(join(tmpdir(), "ads-landing-"));
  const indexPath = join(dir, "index.html");
  writeFileSync(indexPath, INDEX);
  const mini = Fastify({ logger: false });
  await mini.register(adLandingRoutes, { indexPath });
  try {
    const first = await mini.inject({ url: "/a/follow01" });
    assert.equal(first.statusCode, 200);
    assert.equal(h1Of(first.body), AD.headline);
    assert.equal(first.body.includes("Linda's new inbox"), false);
    writeFileSync(indexPath, INDEX.replace("Linda's inbox", "Linda's new inbox"));
    utimesSync(indexPath, new Date(), new Date(Date.now() + 5000));
    const second = await mini.inject({ url: "/a/follow01" });
    assert.ok(second.body.includes("Linda's new inbox"), "the new page");
    assert.equal(h1Of(second.body), AD.headline);
  } finally {
    await mini.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

test("/ is unchanged: the landing file as it is, with no variant field", withDb, async () => {
  const res = await app.inject({ url: "/" });
  assert.equal(res.statusCode, 200);
  assert.equal(res.body, INDEX);
  assert.equal(res.body.includes('name="variant"'), false);
});
