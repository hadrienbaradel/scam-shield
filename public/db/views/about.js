// About: who runs the database and how to reach them, the licence and the
// repository, the counts, what each of the three parts is and promises,
// how to get something removed or contest a listing, and the sources with
// their licences (#/about).

import { api, esc, num, kv, plural } from "../db.js";

export const label = "About";

export async function render(root, params, ctx) {
  const [about, lib] = await Promise.all([
    api("/api/public/about"),
    api("/api/public/library.json").catch(() => null),
  ]);
  if (ctx.stale()) return;
  const counts = about.counts || {};
  const sources = lib?.sources || [];
  root.innerHTML = `
    <div class="tiles">
      <div class="tile"><span class="n">${esc(num(counts.entries))}</span> <span class="l">examples</span></div>
      <div class="tile"><span class="n">${esc(num(counts.families))}</span> <span class="l">families</span></div>
      <div class="tile"><span class="n">${esc(num(sources.length))}</span> <span class="l">sources</span></div>
    </div>
    <section class="card" aria-labelledby="h-who">
      <h2 id="h-who">Who runs it</h2>
      ${kv([
        ["Operator", esc(about.operator || "")],
        ["Contact", contactLink(about.contact)],
        ["Licence", `${esc(about.licence || "CC BY 4.0")} <span class="muted">(use it, share it, change it; say where it came from)</span>`],
        ["Repository", about.repo ? `<a href="${esc(about.repo)}" rel="noopener noreferrer">${esc(about.repo)}</a>` : ""],
        ["Download", `<a href="/api/public/library.json">the whole library as one JSON file</a>`],
      ])}
    </section>
    <div class="prose">
      <h2>What this is</h2>
      <p><strong>The library.</strong> Scam examples (emails, texts, chat messages, what a caller said, web pages, letters), redacted and sorted by family (what the message pretends to be), channel, country and language. Each entry carries the brand impersonated, the lure, the ask, when and where it was first seen, its source and licence, and, when Prudence judged it, the verdict with its reasons. Anyone can <a href="#/submit">submit an example</a>; it is redacted again, classified, checked against duplicates and read by a reviewer before it appears. Every entry is published under CC BY 4.0 as JSON in the public repository, and the whole library downloads as one file.</p>
      <p><strong>The suspect list.</strong> Looking up a website, a sender address or a phone number shows how many library entries used it and when it was last seen. That is all it promises: a count with evidence behind it, which decays with time. A listing never says "scam" without an entry you can read, and a private person's number is never listed on its own.</p>
      <p><strong>The watch.</strong> Once a day a job reads public feeds (data breaches, official alerts, security news) and classifies each item as a breach (who, how many people, which data, verified or claimed) or a new technique (channel, family, brand, lure, ask). Nothing becomes public on its own: a reviewer approves each item, and the watch page shows the week's approved items with the one thing a senior should do about each, in English and in French.</p>
      <h2>Removal and contests</h2>
      <p><strong>Removal.</strong> If an entry holds personal data that the redaction missed, or a message of yours was published without your consent, write to the contact above with the entry id. The entry is hidden while we look, and the decision with its reason follows within 7 days.</p>
      <p><strong>Contesting a listing.</strong> If your website, address or number appears in the suspect list, contest it from its own page with the four elements of a notice: your name, a way to reach you, the address in question and why the listing is wrong, plus a statement that the notice is made in good faith. The listing shows "contested" at once, and a decision with its reason follows within 7 days. The operator named above answers for it.</p>
    </div>
    <section aria-labelledby="h-sources">
      <div class="section-head"><h2 id="h-sources">Sources</h2><span class="small muted">${plural(sources.length, "source")}, each with its licence; the raw corpora never enter the repository.</span></div>
      <div class="table-wrap"><table class="table">
        <thead><tr><th scope="col">Source</th><th scope="col">Licence</th><th scope="col">Attribution</th><th scope="col">Link</th></tr></thead>
        <tbody>${sources.map(sourceRow).join("") || `<tr><td colspan="4" class="empty">${lib ? "No source listed yet." : "The source list could not be loaded."}</td></tr>`}</tbody>
      </table></div>
    </section>`;
}

function contactLink(c) {
  const s = String(c || "").trim();
  if (!s) return "";
  if (/^https?:\/\//i.test(s)) return `<a href="${esc(s)}" rel="noopener noreferrer">${esc(s)}</a>`;
  if (/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s)) return `<a href="mailto:${esc(s)}">${esc(s)}</a>`;
  return esc(s);
}

function sourceRow(s) {
  return `<tr>
    <th scope="row" class="wrap">${esc(s.name || s.id || "")}<span class="sub mono">${esc(s.id || "")}</span></th>
    <td class="nowrap">${esc(s.licence || "–")}</td>
    <td class="wrap">${esc(s.attribution || "–")}</td>
    <td class="wrap">${s.url && /^https?:\/\//i.test(s.url) ? `<a href="${esc(s.url)}" rel="noopener noreferrer">${esc(s.url)}</a>` : "–"}</td>
  </tr>`;
}
