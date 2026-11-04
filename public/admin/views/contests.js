// Contests: the notices against a listing of the public suspect list, open
// ones first. A notice carries the four elements (who, how to reach them,
// the exact address of the listing, why it is wrong) and the good-faith
// statement; the reviewer reads it whole, because deciding it is the
// point. Uphold removes the listing (the library entries stay), Dismiss
// keeps it; the decision text is what the person who contested reads.

import { api, $, $$, esc, chipRaw, tag, timeEl, num, toast, banner, busy, isBusy, cap, words, kv } from "../console.js";

export const label = "Contests";

const KINDS = { domain: "Website", email: "Sender address", phone: "Phone number" };
const STATUS = { open: ["warn", "○", "Open"], upheld: ["ok", "●", "Upheld"], dismissed: ["off", "✕", "Dismissed"] };
function statusChip(s) {
  const [tone, glyph, word] = STATUS[s] || ["off", "–", cap(words(s || "unknown"))];
  return chipRaw(tone, glyph, word);
}
// Rows come as the table's columns (created_at); a camelCase answer reads the same.
const pick = (o, key) => o?.[key] ?? o?.[key.replace(/_([a-z])/g, (_, c) => c.toUpperCase())];
const kindWord = (c) => KINDS[pick(c, "indicator_kind")] || cap(pick(c, "indicator_kind") || "listing");

export async function render(root, params, ctx) {
  const data = await api("/api/admin/db/contests");
  if (ctx.stale()) return;
  draw(root, data, ctx);
}

function draw(root, data, ctx) {
  const all = data.contests || [];
  const counts = data.counts || {};
  const open = all.filter((c) => c.status === "open");
  const others = all.filter((c) => c.status !== "open");
  root.innerHTML = `
    <p class="lead">Notices against a listing of the public suspect list, with the four elements a notice carries and the good-faith statement. The listing shows "contested" until you decide; the site promises a decision with its reason within 7 days. Uphold removes the listing (the library entries stay), Dismiss keeps it; your decision text is what the person reads.</p>
    <div class="btn-row" aria-label="Counts">
      ${chipRaw("warn", "○", `${num(counts.open ?? open.length)} open`)}
      ${chipRaw("ok", "●", `${num(counts.upheld)} upheld`)}
      ${chipRaw("off", "✕", `${num(counts.dismissed)} dismissed`)}
      <a class="small" href="/public/#/suspects" target="_blank" rel="noopener noreferrer">Open the public lookup</a> <span class="muted small">(opens in a new tab)</span>
    </div>
    <section aria-labelledby="h-review">
      <h2 id="h-review" tabindex="-1">To decide (${num(open.length)})</h2>
      ${open.map(review).join("") || `<p class="empty">No open notice. The form is on the public site, under a listing.</p>`}
    </section>
    <section aria-labelledby="h-done">
      <h2 id="h-done">Decided (${num(others.length)})</h2>
      <div class="table-wrap"><table class="table">
        <thead><tr><th scope="col">Received</th><th scope="col">Status</th><th scope="col">Listing</th><th scope="col">From</th><th scope="col">Decision</th><th scope="col">Decided</th></tr></thead>
        <tbody>${others.map(readOnlyRow).join("") || `<tr><td colspan="6" class="empty">No decided notice yet.</td></tr>`}</tbody>
      </table></div>
    </section>`;

  for (const b of $$("[data-uphold], [data-dismiss]", root)) b.addEventListener("click", () => { if (!isBusy(b)) decide(b, ctx); });
}

const lookupLink = (c) => `<a href="${esc(`/public/#/suspects?q=${encodeURIComponent(c.indicator || "")}`)}" target="_blank" rel="noopener noreferrer">look it up</a> <span class="muted">(opens in a new tab)</span>`;

function review(c) {
  const id = String(c.id);
  const f = (name) => `contest-${esc(id)}-${name}`;
  return `<article class="card review" aria-label="Notice ${esc(id)}">
    <div class="review-head">${statusChip(c.status)}<h3>${esc(kindWord(c))} <span class="mono">${esc(c.indicator || "")}</span></h3><span class="muted small">received ${timeEl(pick(c, "created_at"))}</span><span class="muted small mono">${esc(id)}</span></div>
    ${kv([
      ["Listing", `<span class="mono">${esc(c.indicator || "")}</span> · ${lookupLink(c)}`],
      ["Name", esc(c.name || "")],
      ["Email", c.email ? `<a href="mailto:${esc(c.email)}">${esc(c.email)}</a>` : ""],
      ["URL given", `<span class="mono">${esc(c.url || "")}</span> <span class="muted">(as text, never clickable)</span>`],
      ["Good faith", pick(c, "good_faith") ? tag("stated") : tag("not stated", "warn")],
    ])}
    <details open><summary>Why the listing is wrong, in their words</summary><pre>${esc(c.reason || "")}</pre></details>
    <label for="${f("decision")}" class="small muted">Decision and its reason (the person reads it)</label>
    <textarea id="${f("decision")}" name="decision" rows="3" data-focus="${f("decision")}"></textarea>
    <div class="review-out"></div>
    <div class="btn-row">
      <button type="button" class="btn" data-uphold="${esc(id)}" data-focus="${f("uphold")}" aria-label="Uphold notice ${esc(id)}: remove the listing">Uphold: remove the listing</button>
      <button type="button" class="btn btn-ghost" data-dismiss="${esc(id)}" data-focus="${f("dismiss")}" aria-label="Dismiss notice ${esc(id)}: keep the listing">Dismiss: keep the listing</button>
    </div>
  </article>`;
}

function readOnlyRow(c) {
  return `<tr>
    <td class="nowrap">${timeEl(pick(c, "created_at"))}</td>
    <td>${statusChip(c.status)}</td>
    <td class="wrap"><span class="mono">${esc(c.indicator || "")}</span><span class="sub">${esc(kindWord(c))}</span></td>
    <td class="wrap">${esc(c.name || "–")}</td>
    <td class="wrap">${esc(c.decision || "–")}</td>
    <td class="nowrap">${timeEl(pick(c, "decided_at"))}</td>
  </tr>`;
}

async function decide(button, ctx) {
  const article = button.closest("article");
  const out = $(".review-out", article);
  const field = $('[name="decision"]', article);
  const id = button.dataset.uphold || button.dataset.dismiss;
  const status = button.dataset.uphold !== undefined ? "upheld" : "dismissed";
  const buttons = $$("button", article);
  const decision = field.value.trim();
  out.innerHTML = "";
  if (!decision) {
    out.innerHTML = banner("Write the decision and its reason: the person who contested reads it.");
    field.focus();
    return;
  }
  for (const b of buttons) busy(b);
  try {
    await api(`/api/admin/db/contests/${encodeURIComponent(id)}/decide`, { method: "POST", body: { status, decision } });
    toast(status === "upheld" ? "Upheld: the listing is removed" : "Dismissed: the listing stays", "ok");
    if (ctx.onPage()) {
      await ctx.refresh();
      $("#h-review")?.focus({ preventScroll: true });
    }
  } catch (e) {
    out.innerHTML = banner(e);
    for (const b of buttons) busy(b, false);
  }
}
