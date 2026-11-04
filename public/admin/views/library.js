// Library: the examples people sent to the public scam library, pending
// first. The one place the console shows a message's text: the reviewer
// reads the redacted message because publishing it is the point. The
// proposed family, brand, lure, ask, country and language can be fixed
// before Approve; Reject asks a reason the submitter will read.

import { api, $, $$, esc, chipRaw, tag, timeEl, num, toast, banner, busy, isBusy, cap, words } from "../console.js";

export const label = "Library";

const CHANNELS = { email: "Email", sms: "Text message", chat: "Chat", voice: "Phone call", web: "Web page", letter: "Letter" };
const STATUS = {
  pending: ["warn", "○", "Pending"], approved: ["ok", "●", "Approved"],
  rejected: ["fail", "✕", "Rejected"], withdrawn: ["off", "–", "Withdrawn"],
};
function statusChip(s) {
  const [tone, glyph, word] = STATUS[s] || ["off", "–", cap(words(s || "unknown"))];
  return chipRaw(tone, glyph, word);
}
// Rows come as the table's columns (created_at); a camelCase answer reads the same.
const pick = (o, key) => o?.[key] ?? o?.[key.replace(/_([a-z])/g, (_, c) => c.toUpperCase())];

let familiesPromise = null;
function families() {
  if (!familiesPromise) familiesPromise = api("/api/public/families").catch((e) => { familiesPromise = null; throw e; });
  return familiesPromise;
}

export async function render(root, params, ctx) {
  const [data, fam] = await Promise.all([api("/api/admin/db/submissions"), families()]);
  if (ctx.stale()) return;
  draw(root, data, fam.families || [], ctx);
}

function draw(root, data, fams, ctx) {
  const all = data.submissions || [];
  const counts = data.counts || {};
  const pending = all.filter((s) => s.status === "pending");
  const others = all.filter((s) => s.status !== "pending");
  root.innerHTML = `
    <p class="lead">Examples sent to the public library from the site and from the app, redacted before they got here. Nothing is published until you approve it; the submitter reads the outcome and your reason.</p>
    <div class="btn-row" aria-label="Counts">
      ${chipRaw("warn", "○", `${num(counts.pending ?? pending.length)} pending`)}
      ${chipRaw("ok", "●", `${num(counts.approved)} approved`)}
      ${chipRaw("off", "✕", `${num(counts.rejected)} rejected`)}
      <a class="small" href="/public/#/library" target="_blank" rel="noopener noreferrer">Open the public library</a> <span class="muted small">(opens in a new tab)</span>
    </div>
    <section aria-labelledby="h-review">
      <h2 id="h-review" tabindex="-1">To review (${num(pending.length)})</h2>
      ${pending.map((s) => review(s, fams)).join("") || `<p class="empty">No submission waiting. The form is on the public site, under Submit.</p>`}
    </section>
    <section aria-labelledby="h-done">
      <h2 id="h-done">Reviewed (${num(others.length)})</h2>
      <div class="table-wrap"><table class="table">
        <thead><tr><th scope="col">Received</th><th scope="col">Status</th><th scope="col">Channel</th><th scope="col">From</th><th scope="col">Entry or reason</th><th scope="col">Decided</th></tr></thead>
        <tbody>${others.map(readOnlyRow).join("") || `<tr><td colspan="6" class="empty">No reviewed submission yet.</td></tr>`}</tbody>
      </table></div>
    </section>`;

  for (const b of $$("[data-approve], [data-reject]", root)) b.addEventListener("click", () => { if (!isBusy(b)) decide(b, ctx); });
}

const fromWhere = (s) => (pick(s, "from_app") ? tag("from the app", "warn") : tag("from the site"));

// No rule proves a first name absent: the server flags a capitalised word
// after a greeting or before a comma (proposed.may_carry_name, and the
// words in warnings); the reviewer reads the message before approving.
function nameWarning(s) {
  const words = (s.warnings || []).map((w) => String(w).replace(/^may carry a name:\s*/i, "")).filter(Boolean);
  if (!s.proposed?.may_carry_name && !words.length) return "";
  return `<p class="review-warning">${tag("May carry a name", "warn")} Read the message before approving${words.length ? `: ${esc(words.join(", "))}` : ""}.</p>`;
}

function review(s, fams) {
  const id = String(s.id);
  const m = s.message || {};
  const p = s.proposed || {};
  const country = p.country || s.country || "";
  const language = p.language || s.language || "";
  const f = (name) => `sub-${esc(id)}-${name}`;
  return `<article class="card review" aria-label="Submission ${esc(id)}">
    <div class="review-head">${statusChip(s.status)}<h3>${esc(CHANNELS[s.channel] || cap(s.channel || "message"))}${country ? ` · ${esc(country)}` : ""}${language ? ` · ${esc(language)}` : ""}</h3>${fromWhere(s)}<span class="muted small">received ${timeEl(pick(s, "created_at"))}</span><span class="muted small mono">${esc(id)}</span></div>
    <dl class="kv">
      <dt>From</dt><dd class="mono">${esc(m.from || "–")}</dd>
      ${m.subject ? `<dt>Subject</dt><dd>${esc(m.subject)}</dd>` : ""}
      ${(m.links || []).length ? `<dt>Links</dt><dd class="small">${m.links.map((l) => `<span class="mono">${esc(l?.href || l?.text || "")}</span>`).join(", ")} <span class="muted">(as text, never clickable)</span></dd>` : ""}
      ${s.note ? `<dt>Note</dt><dd>${esc(s.note)}</dd>` : ""}
    </dl>
    ${nameWarning(s)}
    <details open><summary>The message, redacted</summary><pre>${esc(m.body || "")}</pre></details>
    <div class="btn-row">
      <div class="field"><label for="${f("family")}">Family</label>
        <select id="${f("family")}" name="family" data-focus="${f("family")}">
          <option value="">Choose…</option>
          ${fams.map((x) => `<option value="${esc(x.id)}"${x.id === p.family ? " selected" : ""}>${esc(x.name?.en || x.id)}</option>`).join("")}
        </select></div>
      <div class="field"><label for="${f("brand")}">Brand</label><input id="${f("brand")}" name="brand" value="${esc(p.brand || "")}" size="18" data-focus="${f("brand")}"></div>
      <div class="field"><label for="${f("country")}">Country</label><input id="${f("country")}" name="country" value="${esc(country)}" maxlength="2" size="3" data-focus="${f("country")}"></div>
      <div class="field"><label for="${f("language")}">Language</label><input id="${f("language")}" name="language" value="${esc(language)}" maxlength="2" size="3" data-focus="${f("language")}"></div>
    </div>
    <div class="btn-row">
      <div class="field"><label for="${f("lure")}">Lure</label><input id="${f("lure")}" name="lure" value="${esc(p.lure || "")}" size="40" data-focus="${f("lure")}"></div>
      <div class="field"><label for="${f("ask")}">Ask</label><input id="${f("ask")}" name="ask" value="${esc(p.ask || "")}" size="40" data-focus="${f("ask")}"></div>
    </div>
    <div class="review-out"></div>
    <div class="btn-row">
      <button type="button" class="btn" data-approve="${esc(id)}" data-focus="${f("approve")}" aria-label="Approve submission ${esc(id)}">Approve and publish</button>
      <div class="field"><label for="${f("reason")}">Reason (for Reject)</label><input id="${f("reason")}" name="reason" size="36" data-focus="${f("reason")}"></div>
      <button type="button" class="btn btn-ghost" data-reject="${esc(id)}" data-focus="${f("reject")}" aria-label="Reject submission ${esc(id)}">Reject</button>
    </div>
  </article>`;
}

function readOnlyRow(s) {
  const entryId = pick(s, "entry_id");
  return `<tr>
    <td class="nowrap">${timeEl(pick(s, "created_at"))}</td>
    <td>${statusChip(s.status)}</td>
    <td>${esc(CHANNELS[s.channel] || s.channel || "–")}</td>
    <td>${fromWhere(s)}</td>
    <td class="wrap">${s.status === "approved" && entryId
      ? `<a href="/public/#/library/${encodeURIComponent(entryId)}" target="_blank" rel="noopener noreferrer">${esc(entryId)}</a>`
      : esc(s.reason || "–")}</td>
    <td class="nowrap">${timeEl(pick(s, "decided_at"))}</td>
  </tr>`;
}

async function decide(button, ctx) {
  const article = button.closest("article");
  const out = $(".review-out", article);
  const id = button.dataset.approve || button.dataset.reject;
  const buttons = $$("button", article);
  out.innerHTML = "";
  const value = (name) => $(`[name="${name}"]`, article)?.value.trim() || "";
  if (button.dataset.approve !== undefined && !value("family")) {
    out.innerHTML = banner("Choose a family before approving.");
    $('[name="family"]', article).focus();
    return;
  }
  if (button.dataset.reject !== undefined && !value("reason")) {
    out.innerHTML = banner("Give a reason: the submitter reads it.");
    $('[name="reason"]', article).focus();
    return;
  }
  for (const b of buttons) busy(b);
  try {
    if (button.dataset.approve !== undefined) {
      const body = {};
      for (const k of ["family", "brand", "lure", "ask"]) if (value(k)) body[k] = value(k);
      if (value("country")) body.country = value("country").toUpperCase();
      if (value("language")) body.language = value("language").toLowerCase();
      const { entry } = await api(`/api/admin/db/submissions/${encodeURIComponent(id)}/approve`, { method: "POST", body });
      toast(`Published as ${entry?.id || "a library entry"}`, "ok");
    } else {
      await api(`/api/admin/db/submissions/${encodeURIComponent(id)}/reject`, { method: "POST", body: { reason: value("reason") } });
      toast("Submission rejected");
    }
    if (ctx.onPage()) {
      await ctx.refresh();
      $("#h-review")?.focus({ preventScroll: true });
    }
  } catch (e) {
    out.innerHTML = banner(e);
    for (const b of buttons) busy(b, false);
  }
}
