// Live link checks, built so that checking a link never helps a scammer.
// - Domain age comes from RDAP (the registry's public data): no visit to the link.
// - The redirect chain is followed only for URL shorteners or when the user
//   asks "where does this link really go?", because opening a scammer's
//   tracking link tells them the address is live.
// - Fetches refuse private, loopback and link-local addresses (SSRF), send
//   no cookies, stop after 5 redirects, 5 seconds and 256 KB, and never
//   submit anything.
// - Known malware and phishing sites come from abuse.ch URLhaus (with the
//   Spamhaus DBL status it reports). Only the host name is sent, never the
//   full link, which can carry the reader's address or a personal token;
//   the full link is compared here against the links the answer lists.
//   The answers only feed the verdict at check time: abuse.ch's terms do
//   not allow using them to train or tune anything.
// Output uses the same shape as the seed manifests' mockLinkInspection, so
// lib/linkInspector.js and the detector need no change.

import dns from "node:dns";
import { lookup } from "node:dns/promises";
import { BlockList, isIP } from "node:net";
import { Agent, fetch as undiciFetch } from "undici";
import { domainOf, sameOrSub, BRANDS, FREE_HOSTING_SUFFIXES } from "../../lib/brands.js";
import { config } from "../config.js";

const SHORTENERS = ["bit.ly", "tinyurl.com", "t.co", "goo.gl", "rb.gy", "cutt.ly", "is.gd", "ow.ly", "buff.ly", "shorturl.at", "tiny.cc"];
// Links that do something when opened (a one-click unsubscribe, a delete,
// a cancellation, accepting an invitation) are never opened for a check.
const ACTION_LINK = /unsubscrib|opt[-_ ]?out|d[ée]sinscri|d[ée]sabonn|preferences|pr[ée]f[ée]rences|manage[-_ ]?(subscription|email)|delete|supprim|cancel|annul|r[ée]sili|one[-_ ]?click|approve|accept|decline|rsvp|confirm[-_ ]?unsub/i;
const TWO_PART_SUFFIXES = ["co.uk", "com.br", "com.au", "co.jp", "gouv.fr", "gov.uk", "com.mx", "co.nz", "org.uk", "ac.uk"];
const DAY = 86400000;

export function registrableDomain(host = "") {
  const parts = String(host).toLowerCase().replace(/\.$/, "").split(".").filter(Boolean);
  if (parts.length <= 2) return parts.join(".");
  const lastTwo = parts.slice(-2).join(".");
  return TWO_PART_SUFFIXES.includes(lastTwo) ? parts.slice(-3).join(".") : lastTwo;
}

// Every non-public range (RFC 6890 special-purpose registries), checked
// with Node's BlockList. IPv6 addresses that embed an IPv4 one (::ffff:,
// incl. the hex form ::ffff:7f00:1) are judged by the IPv4 they carry.
const BLOCKED = new BlockList();
for (const [net, prefix] of [["0.0.0.0", 8], ["10.0.0.0", 8], ["100.64.0.0", 10], ["127.0.0.0", 8], ["169.254.0.0", 16],
  ["172.16.0.0", 12], ["192.0.0.0", 24], ["192.0.2.0", 24], ["192.88.99.0", 24], ["192.168.0.0", 16], ["198.18.0.0", 15],
  ["198.51.100.0", 24], ["203.0.113.0", 24], ["224.0.0.0", 4], ["240.0.0.0", 4]]) BLOCKED.addSubnet(net, prefix, "ipv4");
for (const [net, prefix] of [["::", 127], ["64:ff9b::", 96], ["64:ff9b:1::", 48], ["100::", 64], ["2001::", 23], ["2001:db8::", 32],
  ["2002::", 16], ["fc00::", 7], ["fe80::", 10], ["fec0::", 10], ["ff00::", 8]]) BLOCKED.addSubnet(net, prefix, "ipv6");

function embeddedIPv4(ip) {
  const v = ip.toLowerCase().replace(/^\[|\]$/g, "");
  const m = v.match(/^(?:0{0,4}:){0,5}(?:0{0,4}:)?ffff:(.+)$/) || (v.startsWith("::ffff:") ? [null, v.slice(7)] : null);
  if (!m) return null;
  if (isIP(m[1]) === 4) return m[1];
  const hex = m[1].split(":");
  if (hex.length !== 2 || !hex.every((h) => /^[0-9a-f]{1,4}$/.test(h))) return null;
  const n = (parseInt(hex[0], 16) << 16 >>> 0) + parseInt(hex[1], 16);
  return [n >>> 24, (n >>> 16) & 255, (n >>> 8) & 255, n & 255].join(".");
}

export function isPrivateAddress(ip) {
  const v4 = isIP(ip) === 4 ? ip : embeddedIPv4(ip);
  if (v4) return BLOCKED.check(v4, "ipv4");
  return isIP(ip) === 6 ? BLOCKED.check(ip, "ipv6") : true;
}

// DNS-rebinding defense: the connection is made to the very address that
// passed the check (the lookup itself refuses private answers), so a second
// resolution can never swap in an internal address.
function safeLookup(hostname, options, callback) {
  dns.lookup(hostname, { all: true, family: options?.family || 0 }, (err, addresses) => {
    if (err) return callback(err);
    if (!addresses.length || addresses.some((a) => isPrivateAddress(a.address))) {
      return callback(Object.assign(new Error("refusing private network address"), { code: "EPRIVATE" }));
    }
    if (options?.all) return callback(null, addresses);
    return callback(null, addresses[0].address, addresses[0].family);
  });
}
const pinnedAgent = new Agent({ connect: { lookup: safeLookup, timeout: 5000 }, maxRedirections: 0 });
const pinnedFetch = (url, init) => undiciFetch(url, { ...init, dispatcher: pinnedAgent });

async function assertPublicHost(url) {
  const u = new URL(url);
  if (!["http:", "https:"].includes(u.protocol)) throw new Error(`refusing ${u.protocol} link`);
  if (u.port && !["80", "443"].includes(u.port)) throw new Error("refusing unusual port");
  const host = u.hostname.replace(/^\[|\]$/g, "");
  const addrs = isIP(host) ? [{ address: host }] : await lookup(host, { all: true });
  if (!addrs.length || addrs.some((a) => isPrivateAddress(a.address))) throw new Error("refusing private network address");
}

// ---------------------------------------------------------------- RDAP ---
// Registration date straight from the domain's registry, found through
// IANA's RDAP bootstrap file (RFC 9224). No third-party proxy.
const UA = { "user-agent": "ScamShield/1.0 (domain age check)" };
let bootstrap = { at: 0, services: null };
async function rdapBase(tld, fetchImpl) {
  if (!bootstrap.services || bootstrap.at < Date.now() - DAY) {
    const res = await fetchImpl("https://data.iana.org/rdap/dns.json", { headers: UA, signal: AbortSignal.timeout(5000) });
    if (!res.ok) throw new Error(`IANA bootstrap ${res.status}`);
    bootstrap = { at: Date.now(), services: (await res.json()).services || [] };
  }
  const svc = bootstrap.services.find(([tlds]) => tlds.includes(tld));
  return svc ? svc[1][0].replace(/\/?$/, "/") : null;
}

const ageCache = new Map();
// Age in days at `asOf` (the message's date, so an old email is judged as
// it was when it arrived: a domain registered the day it was sent).
export async function domainAgeDays(domain, { fetchImpl = fetch, asOf = Date.now() } = {}) {
  const reg = await registrationDate(domain, { fetchImpl });
  return reg ? Math.max(0, Math.floor((new Date(asOf).getTime() - reg.getTime()) / DAY)) : null;
}

export async function registrationDate(domain, { fetchImpl = fetch } = {}) {
  const d = registrableDomain(domain);
  if (!d || !d.includes(".") || d.endsWith(".test") || isIP(d) || FREE_HOSTING_SUFFIXES.some((x) => `.${d}`.endsWith(x))) return null;
  const hit = ageCache.get(d);
  if (hit && hit.at > Date.now() - DAY) return hit.reg;
  let reg = null;
  try {
    const base = await rdapBase(d.split(".").pop(), fetchImpl);
    if (base) {
      const res = await fetchImpl(`${base}domain/${encodeURIComponent(d)}`, {
        headers: { ...UA, accept: "application/rdap+json" }, signal: AbortSignal.timeout(4000), redirect: "follow",
      });
      if (res.ok) {
        const data = await res.json();
        const when = (data.events || []).find((e) => e.eventAction === "registration")?.eventDate;
        if (when && !Number.isNaN(Date.parse(when))) reg = new Date(when);
      }
    }
  } catch { reg = null; }
  ageCache.set(d, { reg, at: Date.now() });
  return reg;
}

// ------------------------------------------------------- redirect chain ---
export async function resolveLink(url, { maxHops = 5, timeoutMs = 5000, fetchImpl = pinnedFetch, checkHost = assertPublicHost } = {}) {
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
  // Card fields, not card words: a quiz's script mentioning "cvc" or a
  // "session expired" notice is not a page asking for a card (Oct 29, a
  // Typeform quiz was described that way).
  const card = /<input[^>]+(autocomplete=["']?cc-(number|csc|exp)|(name|id)=["'][^"']*(card.?num|cc.?num|cvv|cvc|csc|cryptogramme|numero.?carte)[^"']*["'])/i.test(html);
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
// ------------------------------------------------------ abuse.ch URLhaus ---
const URLHAUS_HOST = "https://urlhaus-api.abuse.ch/v1/host/";
// Shared services where one user's malware says nothing about the next
// link: only the exact listed link counts there, never the host.
const SHARED_HOSTS = ["github.com", "raw.githubusercontent.com", "objects.githubusercontent.com", "gitlab.com", "bitbucket.org",
  "cdn.discordapp.com", "media.discordapp.net", "dropbox.com", "www.dropbox.com", "dl.dropboxusercontent.com", "mediafire.com",
  "www.mediafire.com", "pastebin.com", "transfer.sh", "drive.google.com", "docs.google.com", "storage.googleapis.com",
  "firebasestorage.googleapis.com", "1drv.ms", "onedrive.live.com", "s3.amazonaws.com", "archive.org", "bitbucket.io"];
const BAD_DBL = ["phishing_domain", "spammer_domain", "botnet_cc_domain"];
const urlhausCache = new Map();
const urlhausCalls = [];
export const urlhausState = { off: null };

// What URLhaus knows about a host: null when unknown (no key, refused,
// timed out, too many lookups this minute), { listed: false } or the listing.
export async function urlhausHost(host, { key = config.abusechKey, fetchImpl = fetch, perMinute = 60 } = {}) {
  const h = String(host || "").toLowerCase();
  if (!key || urlhausState.off || !h.includes(".") || h.endsWith(".test") || (isIP(h) && isPrivateAddress(h))) return null;
  const hit = urlhausCache.get(h);
  if (hit && hit.at > Date.now() - 6 * 3600000) return hit.data;
  while (urlhausCalls.length && urlhausCalls[0] < Date.now() - 60000) urlhausCalls.shift();
  if (urlhausCalls.length >= perMinute) return null;
  urlhausCalls.push(Date.now());
  let data = null;
  try {
    const res = await fetchImpl(URLHAUS_HOST, {
      method: "POST", body: new URLSearchParams({ host: h }), signal: AbortSignal.timeout(4000),
      headers: { "user-agent": "ScamShield/1.0 (link check, abuse.ch fair use)", "Auth-Key": key, "content-type": "application/x-www-form-urlencoded" },
    });
    const j = await res.json().catch(() => ({}));
    const status = j.query_status || j.query_staus;
    if (status === "unknown_auth_key" || res.status === 401) {
      // Loud and lasting: a refused key must not look like "no threats found".
      urlhausState.off = "abuse.ch refused ABUSECH_AUTH_KEY (unknown_auth_key)";
      console.warn(`URLhaus lookups stopped: ${urlhausState.off}`);
      return null;
    }
    if (status === "no_results") data = { listed: false };
    else if (status === "ok") {
      data = { listed: true, dbl: j.blacklists?.spamhaus_dbl || null,
        urls: (j.urls || []).map((u) => ({ url: u.url, online: u.url_status === "online", threat: u.threat || null, tags: u.tags || [] })) };
    }
  } catch { data = null; }
  if (data) {
    urlhausCache.set(h, { data, at: Date.now() });
    if (urlhausCache.size > 5000) urlhausCache.delete(urlhausCache.keys().next().value);
  }
  return data;
}

const sameUrl = (a, b) => {
  const n = (u) => { try { const x = new URL(u); return `${x.hostname.toLowerCase()}${x.pathname.replace(/\/$/, "")}${x.search}`; } catch { return String(u); } };
  return n(a) === n(b);
};

// Turns a host listing into what the detector needs about one link.
export function urlhausVerdict(data, href) {
  if (!data?.listed) return null;
  const host = domainOf(href);
  const exact = data.urls.find((u) => sameUrl(u.url, href));
  const dblBad = BAD_DBL.includes(data.dbl);
  const hostBad = dblBad || (!SHARED_HOSTS.includes(host) && !String(data.dbl || "").startsWith("abused_") && data.urls.some((u) => u.online));
  if (!exact && !hostBad) return null;
  const tags = [...new Set((exact ? [exact] : data.urls).flatMap((u) => u.tags || []))].slice(0, 5);
  return { exact: Boolean(exact), hostBad, online: exact ? exact.online : data.urls.some((u) => u.online), dbl: data.dbl, phishing: /phishing/.test(data.dbl || ""), tags };
}

// ------------------------------------------------------ message links ---
export async function inspectMessageLinks(message, ctx = {}, { resolve = false, maxDomains = 8, maxResolved = 5, fetchImpl, checkHost, urlhausFetch } = {}) {
  const rdapFetch = fetchImpl || fetch;
  const resolved = new Set();
  const known = new Set(ctx.knownLinkDomains || []);
  const brandDomains = BRANDS.flatMap((b) => b.domains);
  const out = {};
  const ages = new Map();
  const links = (message.links || []).filter((l) => /^https?:\/\//i.test(l.href || ""));
  const domains = [...new Set(links.map((l) => registrableDomain(domainOf(l.href))))]
    .filter((d) => d && !known.has(d) && !brandDomains.some((b) => sameOrSub(d, b)))
    .slice(0, maxDomains);
  const asOf = Date.parse(message.date) || Date.now();
  await Promise.all(domains.map(async (d) => ages.set(d, await domainAgeDays(d, { fetchImpl: rdapFetch, asOf }))));
  // URLhaus by exact host (malware sits on one subdomain of a free host).
  const hosts = [...new Set(links.map((l) => domainOf(l.href)))]
    .filter((h) => h && !known.has(registrableDomain(h)) && (SHARED_HOSTS.includes(h) || !brandDomains.some((b) => sameOrSub(h, b))))
    .slice(0, maxDomains);
  const listings = new Map();
  await Promise.all(hosts.map(async (h) => listings.set(h, await urlhausHost(h, urlhausFetch ? { fetchImpl: urlhausFetch } : {}))));
  for (const link of links) {
    const startDomain = domainOf(link.href);
    const entry = {};
    const age = ages.get(registrableDomain(startDomain));
    if (age !== undefined && age !== null) entry.domain_age_days = age;
    const listed = urlhausVerdict(listings.get(startDomain), link.href);
    if (listed) entry.urlhaus = listed;
    // At most a few distinct sites are visited per check, however many links.
    const action = ACTION_LINK.test(`${link.text || ""} ${link.href}`);
    if ((SHORTENERS.includes(startDomain) || (resolve && !action)) && (resolved.has(startDomain) || resolved.size < maxResolved)) {
      resolved.add(startDomain);
      try {
        const r = await resolveLink(link.href, { ...(fetchImpl ? { fetchImpl } : {}), ...(checkHost ? { checkHost } : {}) });
        entry.final_url = r.final_url;
        entry.redirects = r.redirects;
        if (r.page_shows) entry.page_shows = r.page_shows;
        const finalAge = await domainAgeDays(domainOf(r.final_url), { fetchImpl: rdapFetch, asOf });
        if (finalAge !== null) entry.domain_age_days = finalAge;
        if (!entry.urlhaus && domainOf(r.final_url) !== startDomain) {
          const finalListed = urlhausVerdict(await urlhausHost(domainOf(r.final_url), urlhausFetch ? { fetchImpl: urlhausFetch } : {}), r.final_url);
          if (finalListed) entry.urlhaus = finalListed;
        }
      } catch (e) {
        if (/ENOTFOUND|getaddrinfo/i.test(String(e.code || e.cause?.code || e.message))) entry.dns_status = "NXDOMAIN";
      }
    }
    if (Object.keys(entry).length) out[link.href] = entry;
  }
  return out;
}
