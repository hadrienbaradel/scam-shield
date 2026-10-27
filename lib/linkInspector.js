// Link inspection. Offline backbone: uses mock inspection data from the
// seed manifest when present (scam links are .test and can never resolve),
// plus pure-URL heuristics. The live version swaps fetchLandingPage() for
// a sandboxed headless browser (PRD: isolated container, screenshot only).

import { domainOf, FREE_HOSTING_SUFFIXES, sameOrSub } from "./brands.js";

const SHORTENERS = ["bit.ly", "tinyurl.com", "t.co", "goo.gl", "rb.gy", "cutt.ly"];

export function inspectLink(link, mock = null) {
  const startDomain = domainOf(link.href || link.finalHref || "");
  const redirects = mock?.redirects || link.redirects || [];
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
    isShortener: SHORTENERS.includes(startDomain),
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
