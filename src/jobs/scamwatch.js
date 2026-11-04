// Scam watch (_product/specs/public-database.md, lines 8 to 10): once a
// day, the breach and scam-news feeds are read into watch_items for a
// reviewer; nothing becomes public on its own. Have I Been Pwned rows are
// breaches by construction (lib/watch.js breachFromHibp); every other item
// goes through the classifier (Muse Spark, lib/watchMuse.js) when a model is
// configured, else it waits unclassified for a human. "Important" and the
// one action come from lib/watch.js. The feed parser is the threat feed's;
// an approved technique becomes a candidate pattern card through the same
// cardFromAlert path, so it can at most push a verdict to Be careful until
// a human activates it. Social platforms: Mastodon's public #scam timeline
// only (X, LinkedIn and Reddit are off limits,
// _product/research/public-database/watch-sources.md); Bluesky search needs
// an app password and is a follow-up. The two IC3 PSA and cybermalveillance
// alert feeds stay with the threat feed and are not read twice.

import { cardFromAlert } from "../../lib/threatfeed.js";
import { museConfigured } from "../../lib/muse.js";
import { breachFromHibp, importanceOf, oneActionFor } from "../../lib/watch.js";
import { classifyWatchItem } from "../../lib/watchMuse.js";
import { many, one, q } from "../db/pool.js";
import { htmlToText } from "../google/gmail.js";
import { parseFeed } from "./threatfeed.js";

export const WATCH_SOURCES = [
  { id: "hibp", name: "Have I Been Pwned", url: "https://haveibeenpwned.com/api/v3/breaches", kind: "hibp", country: null, licence: "CC BY 4.0" },
  { id: "hibp-latest", name: "Have I Been Pwned latest breaches", url: "https://feeds.feedburner.com/HaveIBeenPwnedLatestBreaches", kind: "rss", country: null, licence: "CC BY 4.0" },
  { id: "ransomware-live", name: "ransomware.live", url: "https://www.ransomware.live/rss.xml", kind: "rss", country: null, licence: "not stated (claims from leak sites)" },
  { id: "ic3-csa", name: "FBI IC3 industry alerts", url: "https://www.ic3.gov/CSA/rss", kind: "rss", country: "US", licence: "US public domain" },
  { id: "cisa-news", name: "CISA news", url: "https://www.cisa.gov/news.xml", kind: "rss", country: "US", licence: "US public domain" },
  { id: "ncsc-news", name: "NCSC UK news", url: "https://www.ncsc.gov.uk/api/1/services/v1/news-rss-feed.xml", kind: "rss", country: "GB", licence: "OGL v3" },
  { id: "europol-news", name: "Europol news", url: "https://www.europol.europa.eu/cms/api/rss/news", kind: "rss", country: null, licence: "Europol legal notice (headline and link)" },
  { id: "cybermalveillance-fiches", name: "cybermalveillance.gouv.fr fiches réflexes", url: "https://www.cybermalveillance.gouv.fr/feed/atom-flux-fiches-reflexes", kind: "rss", country: "FR", licence: "Licence Ouverte 2.0" },
  { id: "krebs", name: "Krebs on Security", url: "https://krebsonsecurity.com/feed/", kind: "rss", country: null, licence: "fair use (headline and link)" },
  { id: "bleepingcomputer", name: "BleepingComputer", url: "https://www.bleepingcomputer.com/feed/", kind: "rss", country: null, licence: "fair use (headline and link)" },
  { id: "therecord", name: "The Record", url: "https://therecord.media/feed", kind: "rss", country: null, licence: "fair use (headline and link)" },
  { id: "malwarebytes", name: "Malwarebytes Labs", url: "https://www.malwarebytes.com/blog/feed/index.xml", kind: "rss", country: null, licence: "fair use (headline and link)" },
  { id: "google-ti", name: "Google Threat Intelligence", url: "https://cloudblog.withgoogle.com/topics/threat-intelligence/rss/", kind: "rss", country: null, licence: "fair use (headline and link)" },
  // Which? writes about everything; only the scam stories are kept.
  { id: "which", name: "Which? news", url: "https://www.which.co.uk/news/feed", kind: "rss", country: "GB", licence: "fair use (headline and link)", keyword: "scam" },
  { id: "mastodon-scam", name: "Mastodon #scam", url: "https://mastodon.social/api/v1/timelines/tag/scam?limit=20", kind: "mastodon", country: null, licence: "mastodon.social rules (public timeline)" },
];

// The family ids of data/library/families.json; the classifier picks one
// for a technique and the one action falls back to the family's line.
export const WATCH_FAMILIES = ["delivery", "bank", "government", "tech-support", "family-emergency", "new-number", "romance", "investment", "prize", "charity",
  "job", "rental", "renewal", "toll-fine", "utility", "account", "sextortion", "invoice", "marketplace", "health", "recovery"];

const USER_AGENT = "ScamShield/1.0 (scam watch)";
const PER_SOURCE = 20;
const RECENT_DAYS = 30;
const DAY = 86400000;
const slug = (s) => String(s).toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 60);
const dayOf = (s) => (Number.isNaN(Date.parse(s)) ? null : new Date(s).toISOString().slice(0, 10));
const dateOrNull = (s) => (Number.isNaN(Date.parse(s)) ? null : new Date(s));
// A technique's channel as the pattern cards say it; a web or paper scam is
// matched on its words alone (lib/patterns.js), so "email" is only the default.
const CARD_CHANNELS = { email: "email", sms: "sms", chat: "whatsapp", voice: "phone" };
const bothLines = (a) => (a && typeof a.en === "string" && a.en.trim() && typeof a.fr === "string" && a.fr.trim() ? { en: a.en.trim(), fr: a.fr.trim() } : null);
const sourceOf = (id) => WATCH_SOURCES.find((s) => s.id === id);

async function fetchBody(fetchImpl, url) {
  const res = await fetchImpl(url, { headers: { "user-agent": USER_AGENT, accept: "application/json, application/rss+xml, application/atom+xml, text/xml;q=0.9, */*;q=0.8" },
    signal: AbortSignal.timeout(15000) });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.text();
}

// One source's body as items { title, url, summary, published, breach? }.
// HIBP: the breaches added in the last 30 days, already judged. Mastodon:
// the posts with a link, their HTML stripped. Anything else: RSS or Atom.
function itemsOf(source, body, now) {
  if (source.kind === "hibp") {
    const list = JSON.parse(body);
    if (!Array.isArray(list)) throw new Error("not a list of breaches");
    return list.filter((b) => now - Date.parse(b.AddedDate) <= RECENT_DAYS * DAY).map((b) => {
      const breach = breachFromHibp(b);
      return { title: breach.title, url: breach.url, summary: htmlToText(b.Description || "").slice(0, 4000), published: b.AddedDate, breach };
    });
  }
  if (source.kind === "mastodon") {
    const posts = JSON.parse(body);
    if (!Array.isArray(posts)) throw new Error("not a list of posts");
    return posts.filter((p) => /^https?:\/\//.test(String(p.url))).map((p) => {
      const text = htmlToText(p.content || "");
      return { title: text.split("\n")[0].slice(0, 140), url: p.url, summary: text.slice(0, 4000), published: p.created_at };
    });
  }
  if (!/<(rss|feed|rdf:RDF)\b/i.test(body)) throw new Error("not a feed");
  return parseFeed(body).slice(0, PER_SOURCE);
}

// The classifier's answer as the row's kind and fields: a technique carries
// its one action in the fields (the public page shows both), a breach read
// from the news is dated by the item when the model gives no date and says
// where it was read (never "verified" by itself).
function judgedFrom(c, item, source) {
  const fields = { ...(c.fields || {}) };
  if (c.kind === "technique") fields.one_action = c.one_action ?? null;
  if (c.kind === "breach") {
    fields.addedDate = fields.addedDate || dayOf(item.published);
    fields.sourceKind = source.kind === "mastodon" ? "social" : "press";
  }
  return { kind: c.kind, fields };
}

export async function runScamWatch({ fetchImpl = fetch, classify = museConfigured() ? classifyWatchItem : null, now = new Date() } = {}) {
  const report = { fetched: 0, newItems: 0, breaches: 0, techniques: 0, errors: [] };
  for (const source of WATCH_SOURCES) {
    let items = [];
    try {
      items = itemsOf(source, await fetchBody(fetchImpl, source.url), now);
    } catch (e) { report.errors.push(`${source.id}: ${e.message}`); continue; }
    report.fetched += items.length;
    for (const item of items) {
      if (!item.title || (source.keyword && !item.title.toLowerCase().includes(source.keyword))) continue;
      const row = await one(`INSERT INTO watch_items (source, url, title, summary, published_at) VALUES ($1, $2, $3, $4, $5)
                             ON CONFLICT (url) DO NOTHING RETURNING id`, [source.id, item.url, item.title, item.summary, dateOrNull(item.published)]);
      if (!row) continue;
      report.newItems++;
      let judged = item.breach ? { kind: "breach", fields: item.breach.fields } : null;
      if (!judged && classify) {
        try {
          judged = judgedFrom(await classify({ title: item.title, summary: item.summary, url: item.url, source: source.name, families: WATCH_FAMILIES }), item, source);
        } catch (e) {
          await q("UPDATE watch_items SET status = 'error', error = $2 WHERE id = $1", [row.id, String(e.message).slice(0, 300)]);
          continue;
        }
      }
      // No model: the row keeps kind null and waits, a candidate a human reads.
      if (!judged) continue;
      const { important, reasons } = importanceOf(judged, { now });
      const action = judged.kind === "other" ? null : oneActionFor(judged);
      await q("UPDATE watch_items SET kind = $2, fields = $3, important = $4, importance_reasons = $5, one_action = $6 WHERE id = $1",
        [row.id, judged.kind, judged.fields, important, JSON.stringify(reasons), action]);
      if (judged.kind === "breach") report.breaches++;
      if (judged.kind === "technique") report.techniques++;
    }
  }
  return report;
}

export const watchQueue = () => many(`SELECT * FROM watch_items
                                      ORDER BY (status = 'candidate') DESC, important DESC, fetched_at DESC, title LIMIT 300`);

// An approved technique becomes a candidate card (never active here) named
// after the item, with the source and the link as its sources; a card with
// the same name is not inserted twice but is still the one named.
async function cardForTechnique(row) {
  const f = row.fields || {};
  const source = sourceOf(row.source);
  const { ok, card } = await cardFromAlert({ source: source?.name || row.source, card: {
    id: `watch-${slug(row.title)}`,
    name: row.title.slice(0, 120),
    channels: [CARD_CHANNELS[f.channel] || "email"],
    countries: [f.country || source?.country].filter(Boolean),
    impersonated_brands: [f.brand].filter(Boolean),
    lure: f.lure || row.title.slice(0, 200),
    ask: f.ask || "",
    red_flags: [f.lure, f.ask].filter(Boolean).length ? [f.lure, f.ask].filter(Boolean) : [row.title.slice(0, 200)],
    red_flag_domains: [],
    safe_action: row.one_action?.en || "",
  } });
  if (!ok) return null;
  card.status = "candidate";
  card.sources = [source?.name || row.source, row.url];
  await q("INSERT INTO pattern_cards (id, card, status) VALUES ($1, $2, 'candidate') ON CONFLICT (id) DO NOTHING", [card.id, card]);
  return card.id;
}

// The reviewer's one action wins when it has both languages; a technique
// gets its card unless the threat feed already carded that link. Null when
// the item is unknown.
export async function approveWatchItem(id, { one_action } = {}) {
  const row = await one("SELECT * FROM watch_items WHERE id = $1", [id]);
  if (!row) return null;
  const action = bothLines(one_action) || row.one_action;
  let cardId = null;
  if (row.kind === "technique") {
    const carded = await one("SELECT 1 FROM feed_items WHERE url = $1 AND status = 'carded'", [row.url]);
    if (!carded) cardId = await cardForTechnique({ ...row, one_action: action });
  }
  await q("UPDATE watch_items SET status = 'approved', decided_at = now(), one_action = $2, card_id = $3 WHERE id = $1", [id, action, cardId]);
  return { cardId };
}

export async function rejectWatchItem(id, reason) {
  const res = await q("UPDATE watch_items SET status = 'rejected', reason = $2, decided_at = now() WHERE id = $1", [id, String(reason || "").slice(0, 500) || null]);
  return res.rowCount > 0;
}

// What the public page shows: the approved items decided within `days`,
// newest decision first, without the queue's columns (summary, status,
// error): a headline, a link and our own words, never a mirrored article.
export async function publicWatch({ days = 7 } = {}) {
  const rows = await many(`SELECT id, kind, title, url, source, published_at, fields, important, one_action, decided_at FROM watch_items
                           WHERE status = 'approved' AND decided_at >= now() - make_interval(days => $1) ORDER BY decided_at DESC LIMIT 200`, [days]);
  return rows.map((r) => ({ ...r, source_name: sourceOf(r.source)?.name ?? r.source }));
}
