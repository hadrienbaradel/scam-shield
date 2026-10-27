// Daily threat feed (PRD): trusted public alerts -> Muse Spark extraction
// (JSON only, no tools) -> candidate pattern card -> human review at
// /admin before it can push any verdict to Scam. No Reddit, no scraping:
// only official RSS feeds. Without Muse Spark, items are stored for review
// with a skeleton card built from the brands they name.

import { claimedBrands } from "../../lib/brands.js";
import { cardFromAlert } from "../../lib/threatfeed.js";
import { extractPatternCard, museConfigured } from "../../lib/muse.js";
import { many, one, q } from "../db/pool.js";
import { decodeEntities, htmlToText } from "../google/gmail.js";

export const SOURCES = [
  { id: "ic3-psa", name: "FBI IC3 public service announcements", url: "https://www.ic3.gov/PSA/RSS", country: "US" },
  { id: "cybermalveillance-alertes", name: "cybermalveillance.gouv.fr alertes", url: "https://www.cybermalveillance.gouv.fr/feed/atom-flux-alertes", country: "FR" },
  { id: "cybermalveillance-actualites", name: "cybermalveillance.gouv.fr actualités", url: "https://www.cybermalveillance.gouv.fr/feed/atom-flux-actualites", country: "FR" },
];

export function parseFeed(xml = "") {
  const blocks = [...xml.matchAll(/<(item|entry)\b[\s\S]*?<\/\1>/gi)].map((m) => m[0]);
  const field = (b, tag) => {
    const m = b.match(new RegExp(`<${tag}\\b[^>]*>([\\s\\S]*?)<\\/${tag}>`, "i"));
    return m ? decodeEntities(m[1].replace(/^<!\[CDATA\[|\]\]>$/g, "")).trim() : "";
  };
  return blocks.map((b) => ({
    title: htmlToText(field(b, "title")),
    url: field(b, "link") || b.match(/<link[^>]+href=["']([^"']+)["']/i)?.[1] || field(b, "guid"),
    summary: htmlToText(field(b, "description") || field(b, "summary") || field(b, "content")).slice(0, 4000),
    published: field(b, "pubDate") || field(b, "published") || field(b, "updated"),
  })).filter((i) => i.title && /^https?:\/\//.test(i.url));
}

const slug = (s) => String(s).toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 60);

function skeletonCard(item, source) {
  const text = `${item.title} ${item.summary}`;
  return {
    id: `feed-${slug(item.title)}`,
    name: item.title.slice(0, 120),
    channels: [/\b(sms|text message|texto)\b/i.test(text) ? "sms" : "email"],
    countries: [source.country],
    impersonated_brands: claimedBrands(text).map((b) => b.name),
    lure: item.title.slice(0, 200),
    ask: "",
    red_flags: [item.title.split(/[:—-]/)[0].trim().toLowerCase()].filter(Boolean),
    red_flag_domains: [],
    safe_action: "",
  };
}

export async function runThreatFeed({ fetchImpl = fetch, extract = museConfigured() ? extractPatternCard : null } = {}) {
  const report = { fetched: 0, newItems: 0, cards: 0, errors: [] };
  for (const source of SOURCES) {
    let items = [];
    try {
      const res = await fetchImpl(source.url, { headers: { "user-agent": "ScamShield/1.0 (threat feed reader)" }, signal: AbortSignal.timeout(15000) });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      items = parseFeed(await res.text()).slice(0, 20);
    } catch (e) { report.errors.push(`${source.id}: ${e.message}`); continue; }
    report.fetched += items.length;
    for (const item of items) {
      const row = await one(`INSERT INTO feed_items (source, url, title, summary, published_at)
                             VALUES ($1, $2, $3, $4, $5) ON CONFLICT (url) DO NOTHING RETURNING id`,
      [source.id, item.url, item.title, item.summary, Number.isNaN(Date.parse(item.published)) ? null : new Date(item.published)]);
      if (!row) continue;
      report.newItems++;
      try {
        const raw = extract ? await extract({ source: source.name, url: item.url, title: item.title, text: item.summary }) : skeletonCard(item, source);
        if (!raw?.id) { await q("UPDATE feed_items SET status = 'no_card' WHERE id = $1", [row.id]); continue; }
        const { ok, card, errors } = await cardFromAlert({ source: source.name, card: { ...raw, id: `feed-${slug(raw.id)}` } });
        if (!ok) { await q("UPDATE feed_items SET status = 'error', error = $2 WHERE id = $1", [row.id, errors.join("; ")]); continue; }
        // Whatever the extractor says, a new card starts as a candidate.
        card.status = "candidate";
        card.sources = [source.name, item.url];
        await q(`INSERT INTO pattern_cards (id, card, status, feed_item_id) VALUES ($1, $2, 'candidate', $3) ON CONFLICT (id) DO NOTHING`, [card.id, card, row.id]);
        await q("UPDATE feed_items SET status = 'carded', card_id = $2 WHERE id = $1", [row.id, card.id]);
        report.cards++;
      } catch (e) {
        await q("UPDATE feed_items SET status = 'error', error = $2 WHERE id = $1", [row.id, String(e.message).slice(0, 300)]);
      }
    }
  }
  return report;
}

export const reviewQueue = () => many(`SELECT p.id, p.card, p.status, p.updated_at, f.title, f.url, f.source
                                        FROM pattern_cards p LEFT JOIN feed_items f ON f.id = p.feed_item_id
                                        ORDER BY (p.status = 'candidate') DESC, p.updated_at DESC LIMIT 200`);
