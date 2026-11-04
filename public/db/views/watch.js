// Watch: the breaches and new techniques a reviewer approved in the last
// 7, 30 or 90 days (#/watch?days=7), from GET /api/public/watch. Two
// sections, each item with its kind, the title linking to the source (news
// sources: external links are fine here, rel="noopener"), the source and
// date, the fields in plain words (people affected, data leaked, verified
// or claimed; channel, family, brand, lure, ask), the one action in English
// with the French line under it, and an Important chip when the spec's rule
// says so (_product/specs/public-database.md, lines 9 and 10). Every value
// from the server goes through esc.

import { api, esc, chip, kv, timeEl, num, plural, cap, hashFor, announce, channelWord, countryWord, languageWord } from "../db.js";

export const label = "Watch";

const WINDOWS = [7, 30, 90];

export async function render(root, params, ctx) {
  const asked = Number(ctx.query.get("days"));
  const days = WINDOWS.includes(asked) ? asked : 7;
  const [data, fam] = await Promise.all([
    api(`/api/public/watch?days=${days}`),
    api("/api/public/families").catch(() => ({ families: [] })),
  ]);
  if (ctx.stale()) return;
  const items = data.items || [];
  const families = fam.families || [];
  const breaches = items.filter((i) => i.kind === "breach");
  const techniques = items.filter((i) => i.kind === "technique");
  const others = items.filter((i) => i.kind !== "breach" && i.kind !== "technique");
  const important = items.filter((i) => i.important).length;
  announce(`${plural(items.length, "item")} in the last ${days} days: ${plural(breaches.length, "breach", "breaches")}, ${plural(techniques.length, "new technique")}`);
  // Every window is a link (the current one says so), so the focus comes
  // back to the control a keyboard user activated after the redraw.
  const window = (w) => `<a class="btn ${w === days ? "" : "btn-ghost "}btn-small" href="${esc(hashFor("watch", { days: w }))}" data-focus="days-${w}"${w === days ? ' aria-current="true"' : ""}>${w} days</a>`;

  root.innerHTML = `
    <p class="lead">What a reviewer approved in the last ${num(days)} days: data breaches that matter to ordinary people, and new ways of scamming them. Each item says the one thing to do about it, in English and in French. Nothing here is published on its own: a person read it first.</p>
    <div class="result-line">
      <span>${plural(items.length, "item")} · ${plural(breaches.length, "breach", "breaches")} · ${plural(techniques.length, "new technique")}${important ? ` · ${num(important)} important` : ""}</span>
      <nav class="paging" aria-label="Period">${WINDOWS.map(window).join("")}</nav>
    </div>
    <section aria-labelledby="h-breaches">
      <div class="section-head"><h2 id="h-breaches">Breaches (${num(breaches.length)})</h2><span class="small muted">who, how many people, what leaked, verified or claimed</span></div>
      ${breaches.map((i) => item(i, families)).join("") || `<p class="empty">No breach approved in the last ${num(days)} days.</p>`}
    </section>
    <section aria-labelledby="h-techniques">
      <div class="section-head"><h2 id="h-techniques">New techniques (${num(techniques.length)})</h2><span class="small muted">channel, family, brand, lure, ask</span></div>
      ${techniques.map((i) => item(i, families)).join("") || `<p class="empty">No new technique approved in the last ${num(days)} days.</p>`}
    </section>
    ${others.length ? `<section aria-labelledby="h-others">
      <div class="section-head"><h2 id="h-others">Also approved (${num(others.length)})</h2><span class="small muted">read by a reviewer, neither a breach nor a technique</span></div>
      ${others.map((i) => item(i, families)).join("")}
    </section>` : ""}
    <p class="small muted">Sources: Have I Been Pwned (CC BY 4.0), IC3, CISA, NCSC, Europol, cybermalveillance.gouv.fr, the security press, Which? and Mastodon: a headline, a link and our own words, never a copy of the article. "Important" is a fixed rule: a verified breach of a million people or of passwords, bank, card, identity or health data, made public in the last 30 days; or a technique not seen before. How the watch works is on <a href="#/about">About</a>.</p>`;
}

const KINDS = { breach: ["fail", "Breach"], technique: ["warn", "New technique"], other: ["off", "Other"] };

function item(i, families) {
  const f = i.fields || {};
  const [tone, word] = KINDS[i.kind] || ["off", "Not classified"];
  const chips = [
    chip(tone, word),
    i.important ? chip("info", "Important") : "",
    i.kind === "breach" ? chip(f.verified ? "ok" : "off", f.verified ? "Verified" : "Claimed, not confirmed") : "",
    i.kind === "technique" && f.novelty ? chip("off", f.novelty === "new" ? "Not seen before" : "A known family, with a twist") : "",
  ].join("");
  const title = esc(i.title || i.url || "Untitled");
  const link = /^https?:\/\//i.test(String(i.url || "")) ? `<a href="${esc(i.url)}" rel="noopener noreferrer">${title}</a>` : title;
  const facts = i.kind === "breach" ? breachFacts(f) : i.kind === "technique" ? techniqueFacts(f, families) : [];
  const a = i.one_action || {};
  return `<article class="card" aria-label="${title}">
    <div class="prose">
      <div class="chip-row">${chips}</div>
      <h3>${link}</h3>
      <p class="small muted">${esc(i.source_name || i.source || "Unknown source")}${i.published_at ? ` · published ${timeEl(i.published_at)}` : ""} · approved ${timeEl(i.decided_at)}</p>
      ${facts.length ? kv(facts) : ""}
      ${a.en || a.fr ? `<div class="notice notice-ok">
        <p><strong>What to do:</strong> ${esc(a.en || "")}</p>
        <p lang="fr"><strong>Que faire :</strong> ${esc(a.fr || "")}</p>
      </div>` : ""}
    </div>
  </article>`;
}

function breachFacts(f) {
  const classes = Array.isArray(f.dataClasses) ? f.dataClasses.filter(Boolean) : [];
  return [
    ["Organisation", `${esc(f.org || "–")}${f.domain ? ` <span class="muted">(${esc(f.domain)})</span>` : ""}`],
    ["People affected", f.people != null ? esc(num(f.people)) : `<span class="muted">not said</span>`],
    ["Data leaked", classes.length ? esc(classes.join(", ")) : `<span class="muted">not said</span>`],
    ["Status", f.verified ? "Verified by the source" : "Claimed, not confirmed by the organisation"],
    ["Happened", f.breachDate ? timeEl(f.breachDate) : ""],
    ["Made public", f.addedDate ? timeEl(f.addedDate) : ""],
    ["Country", f.country ? esc(countryWord(f.country)) : `<span class="muted">not said</span>`],
  ];
}

function techniqueFacts(f, families) {
  const family = families.find((x) => x.id === f.family);
  return [
    ["Channel", f.channel ? esc(channelWord(f.channel)) : ""],
    ["Family", f.family ? `<a class="chip chip-family" href="${esc(hashFor("library", { family: f.family }))}">${esc(family?.name?.en || cap(String(f.family).replace(/-/g, " ")))}</a>` : ""],
    ["Brand impersonated", esc(f.brand || "")],
    ["Lure", esc(f.lure || "")],
    ["Ask", esc(f.ask || "")],
    ["First seen", f.firstSeen ? timeEl(f.firstSeen) : ""],
    ["Country", f.country ? esc(countryWord(f.country)) : "Everywhere"],
    ["Language", f.language ? esc(languageWord(f.language)) : ""],
  ];
}
