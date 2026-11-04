// An ad's landing variant (_product/specs/ad-studio.md, lines 7 and 8; contract
// C5 in docs/plans/2026-11-04-ad-studio.md): the live landing page,
// public/index.html, with the ad's own headline and opening line in the
// English block, the page's title set to that headline, and the ad's code in a
// hidden "variant" field of the English early-access form, so a request says
// which ad it came from. The words are a model's: text, never HTML, escaped
// here and put in those places only. Everything else is the page at / byte for
// byte, the French block included (the ads are in English; a visitor can still
// switch, public/landing/landing.js).
//
// The anchors are the page's exact markup: when one is missing (the landing
// changed), the page goes out unchanged and the server says so once.
// The page's own addresses are all absolute (/styles.css, /landing/..., /js/...),
// so it loads at /a/<code> exactly what it loads at /; no <base> is needed (one
// would send #/demo and #early-access to / and lose the variant).
// tests/ads-landing.test.js keeps that true.

import { esc } from "../pages.js";

const EN_BLOCK = '<div class="l-lang" data-lang="en"';
const FR_BLOCK = '<div class="l-lang" data-lang="fr"';
const TITLE = /<title>[^<]*<\/title>/;
const H1 = /<h1 id="l-h1">[\s\S]*?<\/h1>/;
// The hero's opening line: the p.l-lead right after the h1, nothing between but spaces.
const LEAD = /^(\s*)<p class="l-lead">[\s\S]*?<\/p>/;
const FORM = /<form class="l-form[ "][^>]*>/;

let warned = false;
function unchanged(indexHtml, what) {
  if (!warned) {
    warned = true;
    console.warn(`Landing variant: ${what} not found in public/index.html; /a/<code> serves the landing unchanged until src/ads/landingVariant.js follows the page.`);
  }
  return indexHtml;
}

const words = (v) => (typeof v === "string" && v.trim() ? esc(v.trim()) : null);

// The page with the ad's words; an empty headline or lead keeps the page's own.
export function renderVariant(indexHtml, { code, headline, lead } = {}) {
  const page = String(indexHtml ?? "");
  const start = page.indexOf(EN_BLOCK);
  const end = page.indexOf(FR_BLOCK, start + 1);
  if (start < 0 || end < 0) return unchanged(page, "the English block");
  let en = page.slice(start, end);

  const h1 = H1.exec(en);
  if (!h1) return unchanged(page, 'the English <h1 id="l-h1">');
  const afterH1 = h1.index + h1[0].length;
  const p = LEAD.exec(en.slice(afterH1));
  if (!p) return unchanged(page, "the p.l-lead after the English h1");
  const form = FORM.exec(en);
  if (!form || form.index < afterH1 + p[0].length) return unchanged(page, "the English early-access form");
  const title = TITLE.exec(page);
  if (!title || title.index > start) return unchanged(page, "the page's <title>");

  const h = words(headline);
  const l = words(lead);
  const field = `<input type="hidden" name="variant" value="${esc(code)}">`;
  // Right to left inside the block, so the earlier offsets stay true.
  const formEnd = form.index + form[0].length;
  en = en.slice(0, formEnd) + field + en.slice(formEnd);
  if (l !== null) en = en.slice(0, afterH1) + `${p[1]}<p class="l-lead">${l}</p>` + en.slice(afterH1 + p[0].length);
  if (h !== null) en = en.slice(0, h1.index) + `<h1 id="l-h1">${h}</h1>` + en.slice(afterH1);

  const head = h === null ? page.slice(0, start) : page.slice(0, title.index) + `<title>${h}</title>` + page.slice(title.index + title[0].length, start);
  return head + en + page.slice(end);
}
