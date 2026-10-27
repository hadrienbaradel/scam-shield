// Link inspection. Offline backbone: uses mock inspection data from the
// seed manifest when present (scam links are .test and can never resolve),
// plus pure-URL heuristics. The live version swaps fetchLandingPage() for
// a sandboxed headless browser (PRD: isolated container, screenshot only).

import { domainOf, FREE_HOSTING_SUFFIXES, SHORTENERS, RISKY_TLDS, sameOrSub, typosquatOf, brandInDomain } from "./brands.js";

// What the address alone reveals, without opening it.
const CREDENTIAL_WORDS = /(log-?in|sign-?in|verif|conf?rm|cnfrm|acc(oun)?t|acct|secure|auth|passw|passwort|webscr|wallet|recover|unlock|update|support|helpdesk|billing|invoice|payment|banking|profile|users)/i;
const EMAIL = /[a-z0-9._%+-]+@[a-z0-9-]+(\.[a-z0-9-]+)+/i;
// Genuine newsletters put your address in unsubscribe links (?email=…);
// trap pages put it in the #fragment, which the server never sees, to
// pre-fill a fake sign-in form. part: "fragment" or "anywhere".
function emailInside(u, part) {
  let tail = "";
  try { tail = part === "fragment" ? decodeURIComponent(u.hash || "") : `${u.pathname}${u.search}${decodeURIComponent(u.hash || "")}`; } catch { tail = u.hash || ""; }
  if (EMAIL.test(tail)) return true;
  return [...tail.matchAll(/[A-Za-z0-9+/_-]{16,}={0,2}/g)].some((m) => {
    try { return EMAIL.test(Buffer.from(m[0].replace(/-/g, "+").replace(/_/g, "/"), "base64").toString("utf8")); } catch { return false; }
  });
}
export function addressSignals(url = "") {
  let u;
  try { u = new URL(url); } catch { return {}; }
  const host = u.hostname.toLowerCase();
  const labels = host.split(".");
  const first = labels[0] === "www" ? labels[1] || "" : labels[0];
  const regLabel = labels.length >= 2 ? labels[labels.length - 2] : first;
  return {
    typosquat: typosquatOf(host, url)?.name || null,
    borrowedBrand: brandInDomain(host, url)?.name || null,
    numericHost: /^\d{5,}$/.test(regLabel),
    riskyTld: RISKY_TLDS.includes(labels.at(-1)),
    machineName: first.split("-").length >= 4 || (first.length >= 16 && (first.match(/\d/g) || []).length >= 3 && first.includes("-")),
    // A sign-in word in the host or in a short path part (/login.php,
    // /verify/) counts; one buried in a blog post's long title does not.
    credentialWords: CREDENTIAL_WORDS.test(host) || u.pathname.split("/").some((p) => p.length <= 24 && CREDENTIAL_WORDS.test(p)),
    emailInFragment: emailInside(u, "fragment"),
    emailInUrl: emailInside(u, "anywhere"),
  };
}

// Many redirectors carry their destination in plain sight
// (medium.com/...?redirectUrl=https://fake-bank.bolt.host/). Reading it
// costs no visit, so the scammer learns nothing.
const TARGET_PARAMS = ["redirecturl", "redirect_url", "redirect", "redirect_uri", "url", "u", "target", "dest", "destination", "next", "continue", "goto", "link", "to", "q"];
export function embeddedTarget(href = "", depth = 0) {
  if (depth > 3) return null;
  let u;
  try { u = new URL(href); } catch { return null; }
  for (const [k, v] of u.searchParams) {
    if (TARGET_PARAMS.includes(k.toLowerCase()) && /^https?:\/\//i.test(v)) return embeddedTarget(v, depth + 1) || v;
  }
  return null;
}

export function inspectLink(link, mock = null) {
  const startDomain = domainOf(link.href || link.finalHref || "");
  const embedded = mock?.final_url ? null : embeddedTarget(link.href || "");
  const redirects = mock?.redirects || link.redirects || (embedded ? [embedded] : []);
  const finalUrl = mock?.final_url || redirects.at(-1) || link.finalHref || link.href || "";
  const finalDomain = domainOf(finalUrl);
  return {
    shownText: link.text || link.href || "",
    startDomain,
    finalDomain,
    finalUrl,
    redirects,
    domainAgeDays: mock?.domain_age_days ?? link.domainAgeDays ?? null,
    pageShows: mock?.page_shows || link.pageShows || null,
    dnsStatus: mock?.dns_status || null,
    deadLink: mock?.dns_status === "NXDOMAIN" || mock?.resolves === false,
    isShortener: SHORTENERS.some((s) => sameOrSub(startDomain, s)),
    ...addressSignals(finalUrl),
    isFreeHosting: FREE_HOSTING_SUFFIXES.some((s) => finalDomain.endsWith(s)),
    isIpAddress: /^\d+\.\d+\.\d+\.\d+$/.test(finalDomain),
    wentThroughTrustedHop: redirects.some((r) => {
      const d = domainOf(r);
      return ["google.com", "medium.com", "click.track", "mailchimp.com"].some((t) => sameOrSub(d, t));
    }),
  };
}

export function inspectLinks(message, mockInspections = {}) {
  return (message.links || []).map((link) =>
    inspectLink(link, mockInspections[link.href] || mockInspections[link.text] || null));
}

// Placeholder for the sandboxed fetch. Never called with real credentials,
// never submits forms. Returns null offline so callers use mock data.
export async function fetchLandingPage(_url) {
  return null;
}
