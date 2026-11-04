// Library: the scam examples by family, channel, country, language and
// words (#/library?family=&channel=&country=&language=&q=&page=), and one
// entry (#/library/<id>): the redacted message with its links printed as
// text, the family and its definition, the verdict with its reasons, the
// source and licence, the related pattern cards, and a Look up button for
// each indicator (sender, domains, phones) that opens the suspect lookup.

import { api, $, esc, chip, verdictChip, timeEl, num, plural, kv, hashFor, go, setTitle, announce, channelWord, countryWord, languageWord, CHANNELS } from "../db.js";

export const label = "Library";
export const title = (params) => (params[0] ? "Entry" : "Library");

export async function render(root, params, ctx) {
  if (params[0]) return entry(root, params[0], ctx);
  return list(root, ctx);
}

// ---- Shared ---------------------------------------------------------------------

const COUNTRIES = ["FR", "US", "GB", "CA", "BE", "CH", "DE", "ES", "IT", "NL", "PT", "IE", "AU"];
const LANGUAGES = ["en", "fr", "es", "de", "it", "nl", "pt"];

const familyName = (families, id) => families.find((f) => f.id === id)?.name?.en || id || "–";
const familyChip = (families, id) => `<a class="chip chip-family" href="${esc(hashFor("library", { family: id }))}">${esc(familyName(families, id))}</a>`;
const countryChip = (c) => (c ? `<span class="chip chip-country" title="${esc(countryWord(c))}">${esc(String(c).toUpperCase())}</span>` : `<span class="muted">–</span>`);
const languageChip = (l) => (l ? `<span class="chip chip-off" title="${esc(languageWord(l))}">${esc(String(l).toLowerCase())}</span>` : `<span class="muted">–</span>`);

// ---- The list ---------------------------------------------------------------------

function filtersFrom(query) {
  const f = {};
  for (const k of ["family", "channel", "country", "language", "q"]) { const v = (query.get(k) || "").trim(); if (v) f[k] = v; }
  const page = Number(query.get("page"));
  if (Number.isInteger(page) && page > 1) f.page = page;
  return f;
}

async function list(root, ctx) {
  const filters = filtersFrom(ctx.query);
  const [{ families = [] }, data] = await Promise.all([
    api("/api/public/families"),
    api(`/api/public/library?${new URLSearchParams(filters)}`),
  ]);
  if (ctx.stale()) return;
  const entries = data.entries || [];
  const total = Number(data.total) || 0;
  const pageSize = Number(data.pageSize) || 50;
  const page = Number(data.page) || 1;
  const pages = Math.max(1, Math.ceil(total / pageSize));
  const all = families.reduce((n, f) => n + (Number(f.count) || 0), 0);
  const selected = families.find((f) => f.id === filters.family);
  const railLink = (id, name, count, current) =>
    `<a href="${esc(hashFor("library", { ...filters, family: id, page: undefined }))}" data-focus="family-${esc(id || "all")}"${current ? ' aria-current="true"' : ""}>${esc(name)}<span class="n">${esc(num(count))}</span></a>`;
  announce(`${plural(total, "example")}${pages > 1 ? `, page ${num(page)} of ${num(pages)}` : ""}${selected ? ` in ${selected.name?.en || selected.id}` : ""}`);

  root.innerHTML = `
    <div class="library">
      <nav class="rail" aria-label="Families">
        <h2>Families</h2>
        ${railLink("", "All families", all, !filters.family)}
        ${families.map((f) => railLink(f.id, f.name?.en || f.id, f.count, f.id === filters.family)).join("")}
      </nav>
      <div class="content view">
        ${selected ? `<p class="family-def"><strong>${esc(selected.name?.en || selected.id)}.</strong> ${esc(selected.definition?.en || "")}</p>`
          : `<p class="lead">Redacted scam examples with the family, the brand impersonated, the lure and the ask. Open one for the message, the verdict and the sites, addresses and numbers it used.</p>`}
        <form class="filters" id="filters" aria-label="Filters">
          <div class="field"><label for="f-channel">Channel</label>
            <select id="f-channel" name="channel" data-focus="filter-channel">
              <option value="">All</option>
              ${Object.entries(CHANNELS).map(([v, w]) => `<option value="${v}"${filters.channel === v ? " selected" : ""}>${esc(w)}</option>`).join("")}
            </select></div>
          <div class="field"><label for="f-country">Country</label>
            <input id="f-country" name="country" list="countries" maxlength="2" size="4" autocomplete="off" value="${esc(filters.country || "")}" data-focus="filter-country">
            <datalist id="countries">${COUNTRIES.map((c) => `<option value="${c}">${esc(countryWord(c))}</option>`).join("")}</datalist></div>
          <div class="field"><label for="f-language">Language</label>
            <input id="f-language" name="language" list="languages" maxlength="2" size="4" autocomplete="off" value="${esc(filters.language || "")}" data-focus="filter-language">
            <datalist id="languages">${LANGUAGES.map((l) => `<option value="${l}">${esc(languageWord(l))}</option>`).join("")}</datalist></div>
          <div class="field field-q"><label for="f-q">Words (brand, lure, ask, message)</label>
            <input id="f-q" name="q" type="search" autocomplete="off" value="${esc(filters.q || "")}" data-focus="filter-q"></div>
          <div class="btn-row">
            <button type="submit" class="btn btn-ghost">Apply</button>
            ${Object.keys(filters).length ? `<a class="btn btn-ghost" href="#/library">Clear</a>` : ""}
          </div>
        </form>
        <div class="result-line" aria-live="polite">
          <span>${plural(total, "example")}${pages > 1 ? ` · page ${num(page)} of ${num(pages)}` : ""}</span>
          <a href="/api/public/library.json">Download the whole library (JSON)</a>
        </div>
        <div class="table-wrap"><table class="table">
          <thead><tr>
            <th scope="col">First seen</th><th scope="col">Family</th><th scope="col" class="col-channel">Channel</th><th scope="col">Country</th>
            <th scope="col">Brand</th><th scope="col">Lure</th><th scope="col" class="col-ask">Ask</th>
          </tr></thead>
          <tbody>${entries.map((e) => row(e, families)).join("") || `<tr><td colspan="7" class="empty">No example matches. Loosen a filter, or <a href="#/submit">submit one</a>.</td></tr>`}</tbody>
        </table></div>
        ${pages > 1 ? paging(filters, page, pages) : ""}
      </div>
    </div>`;

  const form = $("#filters", root);
  const apply = () => {
    const next = {
      family: filters.family,
      channel: form.channel.value,
      country: form.country.value.trim().toUpperCase(),
      language: form.language.value.trim().toLowerCase(),
      q: form.q.value.trim(),
    };
    go(hashFor("library", next), { replace: true });
  };
  form.addEventListener("submit", (e) => { e.preventDefault(); apply(); });
  for (const name of ["channel", "country", "language"]) form[name].addEventListener("change", apply);
  let timer;
  form.q.addEventListener("input", () => { clearTimeout(timer); timer = setTimeout(apply, 350); });

  // The whole row opens the entry; the link in the first cell is the keyboard path.
  $("tbody", root).addEventListener("click", (e) => {
    const tr = e.target.closest("tr.row-link");
    if (!tr || e.target.closest("a") || window.getSelection()?.toString()) return;
    location.hash = tr.dataset.href;
  });
}

function row(e, families) {
  const href = `#/library/${encodeURIComponent(e.id)}`;
  return `<tr class="row-link" data-href="${esc(href)}">
    <td class="nowrap"><a class="row-open" href="${esc(href)}" data-focus="entry-${esc(e.id)}" aria-label="Open: ${esc(e.brand || familyName(families, e.family))}, ${esc(e.lure || "")}">${timeEl(e.first_seen)}</a></td>
    <td>${familyChip(families, e.family)}</td>
    <td class="col-channel">${chip("channel", channelWord(e.channel))}</td>
    <td>${countryChip(e.country)}</td>
    <td class="wrap">${esc(e.brand || "–")}</td>
    <td class="wrap cell-lure">${esc(e.lure || "–")}</td>
    <td class="wrap cell-ask col-ask">${esc(e.ask || "–")}</td>
  </tr>`;
}

function paging(filters, page, pages) {
  const link = (p, text) => (p < 1 || p > pages || p === page
    ? `<span class="btn btn-ghost btn-small" aria-disabled="true">${esc(text)}</span>`
    : `<a class="btn btn-ghost btn-small" href="${esc(hashFor("library", { ...filters, page: p > 1 ? p : undefined }))}" data-focus="page-${p < page ? "previous" : "next"}">${esc(text)}</a>`);
  return `<nav class="paging" aria-label="Pages">
    ${link(page - 1, "Previous")}<span class="small muted">Page ${num(page)} of ${num(pages)}</span>${link(page + 1, "Next")}
  </nav>`;
}

// ---- One entry -----------------------------------------------------------------------

async function entry(root, id, ctx) {
  const [data, fam] = await Promise.all([
    api(`/api/public/library/${encodeURIComponent(id)}`).catch((e) => { if (e.status === 404) return null; throw e; }),
    familiesCache(),
  ]);
  if (ctx.stale()) return;
  if (!data) {
    setTitle("No such entry");
    root.innerHTML = `<p class="empty">No entry with the id <code>${esc(id)}</code>. <a href="#/library">Back to the library</a>.</p>`;
    return;
  }
  const families = fam.families || [];
  const e = data.entry || {};
  const cards = data.cards || [];
  const m = e.message || {};
  const family = families.find((f) => f.id === e.family);
  const fname = family?.name?.en || e.family || "Scam";
  setTitle(e.brand ? `${e.brand}: ${e.lure || fname}` : `${fname}: ${e.lure || e.id}`);
  const v = e.verdict || null;
  // The server's one rule (lib/library.js indicatorsOf) says what is worth a lookup; the page lists it.
  const ind = { domains: [], senders: [], phones: [], ...(data.indicators || {}) };
  const lookup = (kind, value) => `<li><span class="kind">${esc(kind)}</span><span class="value">${esc(value)}</span><a class="btn btn-ghost btn-small" href="${esc(hashFor("suspects", { q: value }))}" aria-label="Look up ${esc(value)}">Look up</a></li>`;
  const indicators = [
    ...ind.senders.map((s) => lookup("sender", s)),
    ...ind.domains.map((d) => lookup("site", d)),
    ...ind.phones.map((p) => lookup("phone", p)),
  ];

  root.innerHTML = `
    <div class="entry-head">
      <div class="chip-row">
        ${familyChip(families, e.family)}${chip("channel", channelWord(e.channel))}${countryChip(e.country)}${languageChip(e.language)}${v ? verdictChip(v.verdict) : ""}
      </div>
      <p class="muted">${e.brand ? `Impersonates <strong>${esc(e.brand)}</strong> · ` : ""}first seen ${timeEl(e.first_seen)}${e.last_seen && e.last_seen !== e.first_seen ? ` · last seen ${timeEl(e.last_seen)}` : ""} · <a href="#/library">Back to the library</a></p>
    </div>
    <div class="entry">
      <div class="side">
        <section class="card" aria-labelledby="h-msg">
          <h2 id="h-msg">The message, redacted</h2>
          <div class="message">
            <dl class="meta">
              <dt>From</dt><dd>${esc(m.from || "–")}</dd>
              ${m.subject ? `<dt>Subject</dt><dd>${esc(m.subject)}</dd>` : ""}
            </dl>
            <pre>${esc(m.body || "")}</pre>
          </div>
          ${(m.links || []).length ? `<h3 class="small muted">Links in the message, printed as text (never click them)</h3>
            <ul class="links">${m.links.map((l) => `<li>${esc(l?.text || "")}${l?.text && l?.href && l.text !== l.href ? ` <span class="arrow">→</span> ${esc(l.href)}` : l?.href && !l?.text ? esc(l.href) : ""}</li>`).join("")}</ul>` : ""}
        </section>
        <section class="card" aria-labelledby="h-verdict">
          <h2 id="h-verdict">Prudence's verdict</h2>
          ${v ? `<p>${verdictChip(v.verdict)} <strong>${esc(v.headline || "")}</strong></p>
            ${(v.reasons || []).length ? `<ul class="reasons">${v.reasons.map((r) => `<li>${esc(r)}</li>`).join("")}</ul>` : ""}`
            : `<p class="muted">No verdict recorded for this entry: it comes from a corpus, classified but not judged.</p>`}
        </section>
      </div>
      <div class="side">
        <section class="card" aria-labelledby="h-facts">
          <h2 id="h-facts">Facts</h2>
          ${kv([
            ["Family", familyChip(families, e.family)],
            ["Brand", esc(e.brand || "")],
            ["Lure", esc(e.lure || "")],
            ["Ask", esc(e.ask || "")],
            ["Channel", esc(channelWord(e.channel))],
            ["Country", e.country ? `${countryChip(e.country)} ${esc(countryWord(e.country))}` : ""],
            ["Language", e.language ? esc(languageWord(e.language)) : ""],
            ["First seen", timeEl(e.first_seen)],
            ["Last seen", timeEl(e.last_seen)],
            ["Id", `<code>${esc(e.id)}</code>`],
          ])}
          ${family ? `<p class="family-def small"><strong>${esc(fname)}.</strong> ${esc(family.definition?.en || "")}</p>` : ""}
        </section>
        <section class="card" aria-labelledby="h-ind">
          <h2 id="h-ind">Sites, addresses and numbers it used</h2>
          ${indicators.length ? `<ul class="indicators">${indicators.join("")}</ul>` : `<p class="muted">No site, address or number to look up in this entry.</p>`}
        </section>
        ${cards.length ? `<section class="card" aria-labelledby="h-cards">
          <h2 id="h-cards">Related scam reports</h2>
          <div class="related">${cards.map(cardBlock).join("")}</div>
        </section>` : ""}
        <section class="card" aria-labelledby="h-src">
          <h2 id="h-src">Source and licence</h2>
          <p>${esc(e.source?.attribution || e.source?.id || "Unknown source")}${e.source?.licence ? ` · ${esc(e.source.licence)}` : ""}${e.source?.url && /^https?:\/\//i.test(e.source.url) ? ` · <a href="${esc(e.source.url)}" rel="noopener noreferrer">source page</a>` : ""}</p>
          <p class="small muted">This entry as <a href="/api/public/library/${encodeURIComponent(e.id)}">JSON</a> · <a href="/api/public/library.json">Download the whole library (JSON)</a> · CC BY 4.0</p>
        </section>
      </div>
    </div>`;
}

function cardBlock(c) {
  const card = c.card || c;
  return `<article>
    <strong>${esc(card.name || c.id || "")}</strong>
    ${card.lure ? `<span class="small"><span class="muted">Lure:</span> ${esc(card.lure)}</span>` : ""}
    ${card.ask ? `<span class="small"><span class="muted">Ask:</span> ${esc(card.ask)}</span>` : ""}
    ${card.safe_action ? `<span class="small"><span class="muted">Safe move:</span> ${esc(card.safe_action)}</span>` : ""}
  </article>`;
}

let familiesPromise = null;
function familiesCache() {
  if (!familiesPromise) familiesPromise = api("/api/public/families").catch((e) => { familiesPromise = null; throw e; });
  return familiesPromise;
}
