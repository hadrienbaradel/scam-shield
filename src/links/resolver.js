// Live link checks, built so that checking a link never helps a scammer.
// - Domain age comes from RDAP (public registry data): no visit to the link.
// - The redirect chain is followed only for URL shorteners or when the user
//   asks "where does this link really go?", because opening a scammer's
//   tracking link tells them the address is live.
// - Fetches refuse private, loopback and link-local addresses (SSRF), send
//   no cookies, stop after 5 redirects, 5 seconds and 256 KB, and never
//   submit anything.
// Output uses the same shape as the seed manifests' mockLinkInspection, so
// lib/linkInspector.js and the detector need no change.

import { lookup } from "node:dns/promises";
import { isIP } from "node:net";
import { domainOf, sameOrSub, BRANDS } from "../../lib/brands.js";

const SHORTENERS = ["bit.ly", "tinyurl.com", "t.co", "goo.gl", "rb.gy", "cutt.ly", "is.gd", "ow.ly", "buff.ly", "shorturl.at", "tiny.cc"];
const TWO_PART_SUFFIXES = ["co.uk", "com.br", "com.au", "co.jp", "gouv.fr", "gov.uk", "com.mx", "co.nz", "org.uk", "ac.uk"];
const DAY = 86400000;

export function registrableDomain(host = "") {
  const parts = String(host).toLowerCase().replace(/\.$/, "").split(".").filter(Boolean);
  if (parts.length <= 2) return parts.join(".");
  const lastTwo = parts.slice(-2).join(".");
  return TWO_PART_SUFFIXES.includes(lastTwo) ? parts.slice(-3).join(".") : lastTwo;
}

export function isPrivateAddress(ip) {
  if (isIP(ip) === 4) {
    const [a, b] = ip.split(".").map(Number);
    return a === 10 || a === 127 || a === 0 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31)
      || (a === 192 && b === 168) || (a === 100 && b >= 64 && b <= 127) || a >= 224;
  }
  const v = ip.toLowerCase();
  if (v.startsWith("::ffff:")) return isPrivateAddress(v.slice(7));
  return v === "::1" || v === "::" || v.startsWith("fc") || v.startsWith("fd") || v.startsWith("fe80") || v.startsWith("ff");
}

async function assertPublicHost(url) {
  const u = new URL(url);
  if (!["http:", "https:"].includes(u.protocol)) throw new Error(`refusing ${u.protocol} link`);
  if (u.port && !["80", "443"].includes(u.port)) throw new Error("refusing unusual port");
  const host = u.hostname.replace(/^\[|\]$/g, "");
  const addrs = isIP(host) ? [{ address: host }] : await lookup(host, { all: true });
  if (!addrs.length || addrs.some((a) => isPrivateAddress(a.address))) throw new Error("refusing private network address");
}

// ---------------------------------------------------------------- RDAP ---
const ageCache = new Map();
export async function domainAgeDays(domain, { fetchImpl = fetch } = {}) {
  const d = registrableDomain(domain);
  if (!d || !d.includes(".") || d.endsWith(".test") || isIP(d)) return null;
  const hit = ageCache.get(d);
  if (hit && hit.at > Date.now() - DAY) return hit.days;
  let days = null;
  try {
    const res = await fetchImpl(`https://rdap.org/domain/${encodeURIComponent(d)}`, {
      headers: { accept: "application/rdap+json" }, signal: AbortSignal.timeout(4000), redirect: "follow",
    });
    if (res.ok) {
      const data = await res.json();
      const reg = (data.events || []).find((e) => e.eventAction === "registration")?.eventDate;
      if (reg) days = Math.max(0, Math.floor((Date.now() - new Date(reg).getTime()) / DAY));
    } else if (res.status === 404) {
      days = null;
    }
  } catch { days = null; }
  ageCache.set(d, { days, at: Date.now() });
  return days;
}

// ------------------------------------------------------- redirect chain ---
export async function resolveLink(url, { maxHops = 5, timeoutMs = 5000, fetchImpl = fetch, checkHost = assertPublicHost } = {}) {
  const redirects = [];
  let current = url;
  for (let hop = 0; hop <= maxHops; hop++) {
    await checkHost(current);
    const res = await fetchImpl(current, {
      method: "GET", redirect: "manual", signal: AbortSignal.timeout(timeoutMs),
      headers: { "user-agent": "Mozilla/5.0 (compatible; ScamShieldLinkCheck/1.0)", accept: "text/html,*/*;q=0.5" },
    });
    const location = res.headers.get("location");
    if (res.status >= 300 && res.status < 400 && location) {
      current = new URL(location, current).toString();
      redirects.push(current);
      await res.body?.cancel().catch(() => {});
      continue;
    }
    const page = await readCapped(res, 256 * 1024);
    return { final_url: current, redirects, status: res.status, page_shows: describePage(page) };
  }
  return { final_url: current, redirects, status: null, page_shows: "Too many redirects: the link keeps bouncing between addresses." };
}

async function readCapped(res, cap) {
  if (!res.body || !/text\/html|text\/plain/i.test(res.headers.get("content-type") || "")) { await res.body?.cancel().catch(() => {}); return ""; }
  const reader = res.body.getReader();
  const chunks = [];
  let size = 0;
  while (size < cap) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
    size += value.length;
  }
  await reader.cancel().catch(() => {});
  return Buffer.concat(chunks).toString("utf8");
}

export function describePage(html = "") {
  if (!html) return null;
  const title = (html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1] || "").replace(/\s+/g, " ").trim().slice(0, 120);
  const password = /<input[^>]+type=["']?password/i.test(html);
  const card = /(card.?number|cardnumber|cc-number|cvv|cvc|expir|numéro de carte|cryptogramme)/i.test(html);
  const parts = [];
  if (title) parts.push(`Page titled "${title}"`);
  if (password) parts.push("asks for a password on a login form");
  if (card) parts.push("asks for card details");
  return parts.join(", ") || null;
}

// --------------------------------------------------- per-message checks ---
// Builds the link_inspection map for one message. Link domains belonging
// to the claimed brand or already known from the user's real mail are not
// looked up at all.
export async function inspectMessageLinks(message, ctx = {}, { resolve = false, maxDomains = 8, fetchImpl = fetch } = {}) {
  const known = new Set(ctx.knownLinkDomains || []);
  const brandDomains = BRANDS.flatMap((b) => b.domains);
  const out = {};
  const ages = new Map();
  const links = (message.links || []).filter((l) => /^https?:\/\//i.test(l.href || ""));
  const domains = [...new Set(links.map((l) => registrableDomain(domainOf(l.href))))]
    .filter((d) => d && !known.has(d) && !brandDomains.some((b) => sameOrSub(d, b)))
    .slice(0, maxDomains);
  await Promise.all(domains.map(async (d) => ages.set(d, await domainAgeDays(d, { fetchImpl }))));
  for (const link of links) {
    const startDomain = domainOf(link.href);
    const entry = {};
    const age = ages.get(registrableDomain(startDomain));
    if (age !== undefined && age !== null) entry.domain_age_days = age;
    if (resolve || SHORTENERS.includes(startDomain)) {
      try {
        const r = await resolveLink(link.href, { fetchImpl });
        entry.final_url = r.final_url;
        entry.redirects = r.redirects;
        if (r.page_shows) entry.page_shows = r.page_shows;
        const finalAge = await domainAgeDays(domainOf(r.final_url), { fetchImpl });
        if (finalAge !== null) entry.domain_age_days = finalAge;
      } catch (e) {
        if (/ENOTFOUND|getaddrinfo/i.test(String(e.code || e.message))) entry.dns_status = "NXDOMAIN";
      }
    }
    if (Object.keys(entry).length) out[link.href] = entry;
  }
  return out;
}
