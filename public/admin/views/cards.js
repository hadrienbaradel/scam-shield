// Scam reports: the threat-feed candidates waiting for a human. A card
// reaches "active" only through Approve here; the JSON can be edited first.

import { api, $, $$, esc, chipRaw, timeEl, num, toast, banner, clock, cap, words, busy, isBusy } from "../console.js";

export const label = "Scam reports";

const FETCH_LABEL = "Fetch new reports now";
let lastFetch = null;
// Source ids ("ic3-psa") to their names, from the cards answer.
let sourceNames = {};

export async function render(root, params, ctx) {
  const data = await api("/api/admin/cards");
  if (ctx.stale()) return;
  draw(root, data, ctx);
}

const STATUS = {
  candidate: ["warn", "○", "Candidate"], active: ["ok", "●", "Active"],
  rejected: ["off", "✕", "Rejected"], retired: ["off", "–", "Retired"],
};
function statusChip(s) {
  const [tone, glyph, word] = STATUS[s] || ["off", "–", cap(words(s || "unknown"))];
  return chipRaw(tone, glyph, word);
}

function draw(root, data, ctx) {
  const cards = data.cards || [];
  const candidates = cards.filter((c) => c.status === "candidate");
  const others = cards.filter((c) => c.status !== "candidate");
  const sources = data.sources || [];
  sourceNames = Object.fromEntries(sources.map((s) => [s.id, s.name]));
  root.innerHTML = `
    <p class="lead">Candidate cards come from the threat feed${sources.length ? ` (${sources.map((s) => esc(s.name)).join(", ")})` : ""}. Nothing changes a verdict to Scam until you approve it.</p>
    <div class="btn-row">
      <button type="button" class="btn" id="fetchFeed" data-focus="fetch-feed">${FETCH_LABEL}</button>
      <div class="small muted" id="feedOut" aria-live="polite">${lastFetch ? fetchLine(lastFetch) : ""}</div>
    </div>
    ${lastFetch?.report?.errors?.length ? `<ul class="lines">${lastFetch.report.errors.map((e) => `<li>${esc(e)}</li>`).join("")}</ul>` : ""}
    <section aria-labelledby="h-review">
      <h2 id="h-review" tabindex="-1">To review (${num(candidates.length)})</h2>
      ${candidates.map(review).join("") || `<p class="empty">No candidate card. Fetch new reports now, or wait for the daily feed.</p>`}
    </section>
    <section aria-labelledby="h-done">
      <h2 id="h-done">Reviewed (${num(others.length)})</h2>
      <div class="table-wrap"><table class="table">
        <thead><tr><th scope="col">Card</th><th scope="col">Status</th><th scope="col">Source</th><th scope="col">Updated</th><th scope="col">JSON</th></tr></thead>
        <tbody>${others.map(readOnlyRow).join("") || `<tr><td colspan="5" class="empty">No reviewed card yet.</td></tr>`}</tbody>
      </table></div>
    </section>`;

  $("#fetchFeed", root).addEventListener("click", async () => {
    const b = $("#fetchFeed", root);
    const out = $("#feedOut", root);
    if (isBusy(b)) return;
    busy(b);
    b.textContent = "Fetching…";
    out.textContent = "Fetching reports; this can take up to a minute.";
    try {
      const { report } = await api("/api/admin/feed/run", { method: "POST", body: {} });
      lastFetch = { report: report || {}, at: clock() };
      toast(fetchLine(lastFetch), report?.errors?.length ? "fail" : "ok");
      if (ctx.onPage()) ctx.refresh();
    } catch (e) {
      out.innerHTML = banner(e);
      busy(b, false);
      b.textContent = FETCH_LABEL;
    }
  });

  for (const b of $$("[data-approve], [data-reject]", root)) b.addEventListener("click", () => { if (!isBusy(b)) decide(b, ctx); });
}

function fetchLine({ report, at }) {
  const errors = report.errors?.length || 0;
  return `Fetched ${num(report.fetched)} reports at ${at}: ${num(report.newItems)} new, ${num(report.cards)} ${report.cards === 1 ? "card" : "cards"} made, ${num(errors)} ${errors === 1 ? "error" : "errors"}`;
}

function sourceLine(c) {
  if (!c.url && !c.source) return "";
  const link = c.url ? `<a href="${esc(c.url)}" target="_blank" rel="noopener noreferrer">${esc(c.title || c.url)}</a> <span class="muted">(opens in a new tab)</span>` : esc(c.title || "");
  return `<p class="small">${c.source ? `${esc(sourceNames[c.source] || c.source)}: ` : ""}${link}</p>`;
}

function review(c) {
  const name = c.card?.name || c.id;
  return `<article class="card review" aria-label="${esc(name)}">
    <div class="review-head">${statusChip(c.status)}<h3>${esc(name)}</h3><span class="muted small">updated ${timeEl(c.updated_at)}</span></div>
    ${sourceLine(c)}
    <label for="card-${esc(c.id)}" class="small muted">Card JSON (you can edit it before approving)</label>
    <textarea id="card-${esc(c.id)}" rows="12" data-card="${esc(c.id)}" data-focus="card-${esc(c.id)}" spellcheck="false">${esc(JSON.stringify(c.card, null, 2))}</textarea>
    <div class="review-out"></div>
    <div class="btn-row">
      <button type="button" class="btn" data-approve="${esc(c.id)}" data-focus="approve-${esc(c.id)}" aria-label="Approve: ${esc(name)}">Approve</button>
      <button type="button" class="btn btn-ghost" data-reject="${esc(c.id)}" data-focus="reject-${esc(c.id)}" aria-label="Reject: ${esc(name)}">Reject</button>
    </div>
  </article>`;
}

function readOnlyRow(c) {
  return `<tr>
    <th scope="row" class="wrap">${esc(c.card?.name || c.id)}<span class="sub mono">${esc(c.id)}</span></th>
    <td>${statusChip(c.status)}</td>
    <td class="wrap">${c.url ? `<a href="${esc(c.url)}" target="_blank" rel="noopener noreferrer">${esc(sourceNames[c.source] || c.source || c.title || "source")}</a>` : esc(sourceNames[c.source] || c.source || "–")}</td>
    <td class="nowrap">${timeEl(c.updated_at)}</td>
    <td><details><summary>View</summary><pre>${esc(JSON.stringify(c.card, null, 2))}</pre></details></td>
  </tr>`;
}

async function decide(button, ctx) {
  const article = button.closest("article");
  const out = $(".review-out", article);
  const id = button.dataset.approve || button.dataset.reject;
  const buttons = $$("button", article);
  out.innerHTML = "";
  for (const b of buttons) busy(b);
  try {
    if (button.dataset.approve !== undefined) {
      let card;
      try { card = JSON.parse($("textarea", article).value); } catch (e) {
        out.innerHTML = banner(`The card is not valid JSON: ${e.message}`);
        for (const b of buttons) busy(b, false);
        $("textarea", article).focus();
        return;
      }
      await api(`/api/admin/cards/${encodeURIComponent(id)}/approve`, { method: "POST", body: { card } });
      toast("Card approved: it is active now and can mark messages as Scam", "ok");
    } else {
      await api(`/api/admin/cards/${encodeURIComponent(id)}/reject`, { method: "POST", body: {} });
      toast("Card rejected");
    }
    if (ctx.onPage()) {
      await ctx.refresh();
      // The card has left the list: land on the list heading, not the page top.
      $("#h-review")?.focus({ preventScroll: true });
    }
  } catch (e) {
    out.innerHTML = banner(e);
    for (const b of buttons) busy(b, false);
  }
}
