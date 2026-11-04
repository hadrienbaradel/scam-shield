// Scam watch: what the daily watch job read from the feeds, candidates
// first (an item the classifier failed on is still a candidate: a human can
// read what the feed said). Each shows its classification (breach or
// technique, the fields), the importance rule's verdict with its reasons,
// the one action in both languages to edit before Approve, and Reject with
// a reason. Fetch now is a manual run of the Scam watch job (202, then the
// page waits for the run to end); the sources and the last run sit below.
// An approved technique becomes a candidate card on Scam reports.

import { api, $, $$, esc, chipRaw, tag, timeEl, num, plural, toast, banner, busy, isBusy, cap, words, duration, sleep } from "../console.js";

export const label = "Scam watch";

const FETCH_LABEL = "Fetch the feeds now";
const STATUS = {
  candidate: ["warn", "○", "Candidate"], approved: ["ok", "●", "Approved"],
  rejected: ["off", "✕", "Rejected"], error: ["fail", "✕", "Classifier failed"],
};
const KIND = { breach: ["fail", "◆", "Breach"], technique: ["warn", "◆", "Technique"], other: ["off", "◆", "Other"] };
const CHANNELS = { email: "Email", sms: "Text message", chat: "Chat", voice: "Phone call", web: "Web page", letter: "Letter" };
const WAIT_MS = 2000;
const WAIT_ROUNDS = 90;

function statusChip(s) {
  const [tone, glyph, word] = STATUS[s] || ["off", "–", cap(words(s || "unknown"))];
  return chipRaw(tone, glyph, word);
}
function kindChip(k) {
  const [tone, glyph, word] = KIND[k] || ["off", "◇", "Not classified"];
  return chipRaw(tone, glyph, word);
}
const pick = (o, key) => o?.[key] ?? o?.[key.replace(/_([a-z])/g, (_, c) => c.toUpperCase())];
const link = (url, text) => (/^https?:\/\//i.test(String(url || ""))
  ? `<a href="${esc(url)}" target="_blank" rel="noopener noreferrer">${esc(text || url)}</a>`
  : esc(text || url || ""));

export async function render(root, params, ctx) {
  const data = await api("/api/admin/db/watch");
  if (ctx.stale()) return;
  draw(root, data, ctx);
}

function draw(root, data, ctx) {
  const items = data.items || [];
  const sources = data.sources || [];
  const names = Object.fromEntries(sources.map((s) => [s.id, s.name]));
  const toReview = items.filter((i) => i.status === "candidate" || i.status === "error");
  const done = items.filter((i) => i.status !== "candidate" && i.status !== "error");
  const count = (status) => items.filter((i) => i.status === status).length;
  const important = toReview.filter((i) => i.important).length;
  root.innerHTML = `
    <p class="lead">Breaches and new techniques the daily job read from ${plural(sources.length, "public feed")}, classified by the model. Nothing is public until you approve it; an approved technique also becomes a candidate card on Scam reports. The one action is what the public page tells a senior: fix the wording before you approve.</p>
    <div class="btn-row" aria-label="Counts">
      ${chipRaw("warn", "○", `${num(toReview.length)} to review`)}
      ${important ? chipRaw("info", "!", `${num(important)} important`) : ""}
      ${chipRaw("ok", "●", `${num(count("approved"))} approved`)}
      ${chipRaw("off", "✕", `${num(count("rejected"))} rejected`)}
      ${count("error") ? chipRaw("fail", "✕", `${num(count("error"))} classifier failed`) : ""}
      <a class="small" href="/public/#/watch" target="_blank" rel="noopener noreferrer">Open the public watch page</a> <span class="muted small">(opens in a new tab)</span>
    </div>
    <div class="btn-row">
      <button type="button" class="btn" id="fetchWatch" data-focus="fetch-watch">${FETCH_LABEL}</button>
      <div class="small muted" id="watchOut" aria-live="polite">${data.lastRun ? runLine(data.lastRun) : "No run recorded yet."}</div>
    </div>
    ${data.lastRun?.result?.errors?.length ? `<ul class="lines">${data.lastRun.result.errors.map((e) => `<li>${esc(e)}</li>`).join("")}</ul>` : ""}
    <section aria-labelledby="h-review">
      <h2 id="h-review" tabindex="-1">To review (${num(toReview.length)})</h2>
      ${toReview.map((i) => review(i, names)).join("") || `<p class="empty">Nothing to review. Fetch the feeds now, or wait for the daily run.</p>`}
    </section>
    <section aria-labelledby="h-done">
      <h2 id="h-done">Decided (${num(done.length)})</h2>
      <div class="table-wrap"><table class="table">
        <thead><tr><th scope="col">Item</th><th scope="col">Kind</th><th scope="col">Status</th><th scope="col">Source</th><th scope="col">Decided</th><th scope="col">Card or reason</th></tr></thead>
        <tbody>${done.map((i) => doneRow(i, names)).join("") || `<tr><td colspan="6" class="empty">No decision yet.</td></tr>`}</tbody>
      </table></div>
    </section>
    <section aria-labelledby="h-sources">
      <h2 id="h-sources">Sources (${num(sources.length)})</h2>
      <div class="table-wrap"><table class="table">
        <thead><tr><th scope="col">Source</th><th scope="col">Kind</th><th scope="col">Country</th><th scope="col">Licence</th><th scope="col">Feed</th></tr></thead>
        <tbody>${sources.map(sourceRow).join("") || `<tr><td colspan="5" class="empty">No source listed.</td></tr>`}</tbody>
      </table></div>
    </section>`;

  $("#fetchWatch", root).addEventListener("click", () => fetchNow(root, data.lastRun, ctx));
  for (const b of $$("[data-approve], [data-reject]", root)) b.addEventListener("click", () => { if (!isBusy(b)) decide(b, ctx); });
}

function runLine(run) {
  const r = run.result || {};
  const when = `${timeEl(run.finishedAt || run.startedAt)}${run.trigger ? ` (${esc(run.trigger)})` : ""}`;
  if (run.ok === false) return `Last run ${when} failed: ${esc(run.error || "every source failed")}`;
  const errors = r.errors?.length || 0;
  return `Last run ${when}, ${esc(duration(run.durationMs))}: fetched ${num(r.fetched)}, ${num(r.newItems)} new, ${num(r.breaches)} ${r.breaches === 1 ? "breach" : "breaches"}, ${num(r.techniques)} ${r.techniques === 1 ? "technique" : "techniques"}, ${num(errors)} ${errors === 1 ? "source error" : "source errors"}`;
}

// Fetch now answers 202 at once (fifteen feeds take longer than a request);
// the page then asks for the last run every 2 s until a new one has ended.
async function fetchNow(root, lastRun, ctx) {
  const b = $("#fetchWatch", root);
  const out = $("#watchOut", root);
  if (isBusy(b)) return;
  busy(b);
  b.textContent = "Fetching…";
  out.textContent = "Reading the feeds; this can take a minute or two with the model on.";
  const before = lastRun?.finishedAt || null;
  try {
    await api("/api/admin/db/watch/run", { method: "POST", body: {} });
    let run = null;
    for (let i = 0; i < WAIT_ROUNDS && ctx.onPage(); i++) {
      await sleep(WAIT_MS);
      const now = await api("/api/admin/db/watch");
      if (now.lastRun?.finishedAt && now.lastRun.finishedAt !== before) { run = now.lastRun; break; }
    }
    if (!ctx.onPage()) return;
    if (run) toast(run.ok ? `Fetched: ${num(run.result?.newItems)} new ${run.result?.newItems === 1 ? "item" : "items"}` : `The run failed: ${run.error || "every source failed"}`, run.ok ? "ok" : "fail");
    else toast("Still fetching; the page shows the run when it ends.");
    ctx.refresh();
  } catch (e) {
    out.innerHTML = banner(e);
    busy(b, false);
    b.textContent = FETCH_LABEL;
  }
}

function sourceRow(s) {
  return `<tr>
    <th scope="row" class="wrap">${esc(s.name || s.id)}<span class="sub mono">${esc(s.id)}${s.keyword ? ` · titles with "${esc(s.keyword)}"` : ""}</span></th>
    <td>${esc(s.kind || "–")}</td>
    <td>${esc(s.country || "–")}</td>
    <td class="wrap">${esc(s.licence || "–")}</td>
    <td class="wrap">${link(s.url)}</td>
  </tr>`;
}

function facts(i) {
  const f = i.fields || {};
  if (i.kind === "breach") {
    const classes = Array.isArray(f.dataClasses) ? f.dataClasses.filter(Boolean) : [];
    return [
      ["Organisation", `${esc(f.org || "–")}${f.domain ? ` <span class="muted">(${esc(f.domain)})</span>` : ""}`],
      ["People", f.people != null ? esc(num(f.people)) : ""],
      ["Data", classes.length ? esc(classes.join(", ")) : ""],
      ["Verified", f.verified ? "yes" : `no (claimed)${f.sourceKind ? `, read in the ${esc(f.sourceKind)}` : ""}`],
      ["Happened", esc(f.breachDate || "")],
      ["Made public", esc(f.addedDate || "")],
      ["Country", esc(f.country || "")],
    ];
  }
  if (i.kind === "technique") {
    return [
      ["Channel", esc(CHANNELS[f.channel] || f.channel || "")],
      ["Family", esc(f.family || "")],
      ["Brand", esc(f.brand || "")],
      ["Lure", esc(f.lure || "")],
      ["Ask", esc(f.ask || "")],
      ["First seen", esc(f.firstSeen || "")],
      ["Novelty", esc(f.novelty || "")],
      ["Country", esc(f.country || "everywhere")],
      ["Language", esc(f.language || "")],
    ];
  }
  return [];
}

function review(i, names) {
  const id = String(i.id);
  const f = (name) => `watch-${esc(id)}-${name}`;
  const a = pick(i, "one_action") || {};
  const reasons = Array.isArray(pick(i, "importance_reasons")) ? pick(i, "importance_reasons") : [];
  const kvPairs = facts(i);
  return `<article class="card review" aria-label="${esc(i.title)}">
    <div class="review-head">${statusChip(i.status)}${kindChip(i.kind)}${i.important ? tag("important", "warn") : ""}<h3>${link(i.url, i.title)}</h3><span class="muted small">${esc(names[i.source] || i.source)}${pick(i, "published_at") ? ` · published ${timeEl(pick(i, "published_at"))}` : ""} · fetched ${timeEl(pick(i, "fetched_at"))}</span></div>
    ${i.status === "error" ? `<p class="small err">The classifier failed: ${esc(i.error || "no reason recorded")}. Read what the feed said and decide yourself.</p>` : ""}
    ${!i.kind && i.status !== "error" ? `<p class="small muted">Not classified: no model was configured when it was read. Read what the feed said and decide yourself.</p>` : ""}
    ${kvPairs.length ? `<dl class="kv">${kvPairs.map(([k, v]) => `<dt>${esc(k)}</dt><dd>${v || "–"}</dd>`).join("")}</dl>` : ""}
    ${reasons.length ? `<p class="small"><span class="muted">${i.important ? "Important because" : "Noted"}:</span> ${reasons.map(esc).join("; ")}</p>` : ""}
    <details><summary>What the feed said</summary><pre>${esc(i.summary || "(no text)")}</pre></details>
    <div class="btn-row">
      <div class="field"><label for="${f("en")}">One action (English)</label><input id="${f("en")}" name="en" value="${esc(a.en || "")}" size="40" data-focus="${f("en")}"></div>
      <div class="field"><label for="${f("fr")}">One action (French)</label><input id="${f("fr")}" name="fr" value="${esc(a.fr || "")}" size="40" data-focus="${f("fr")}" lang="fr"></div>
    </div>
    <div class="review-out"></div>
    <div class="btn-row">
      <button type="button" class="btn" data-approve="${esc(id)}" data-focus="${f("approve")}" aria-label="Approve: ${esc(i.title)}">Approve</button>
      <div class="field"><label for="${f("reason")}">Reason (for Reject)</label><input id="${f("reason")}" name="reason" size="36" data-focus="${f("reason")}"></div>
      <button type="button" class="btn btn-ghost" data-reject="${esc(id)}" data-focus="${f("reject")}" aria-label="Reject: ${esc(i.title)}">Reject</button>
    </div>
  </article>`;
}

function doneRow(i, names) {
  const cardId = pick(i, "card_id");
  return `<tr>
    <th scope="row" class="wrap">${link(i.url, i.title)}</th>
    <td>${kindChip(i.kind)}</td>
    <td>${statusChip(i.status)}${i.important ? ` ${tag("important", "warn")}` : ""}</td>
    <td class="wrap">${esc(names[i.source] || i.source || "–")}</td>
    <td class="nowrap">${timeEl(pick(i, "decided_at"))}</td>
    <td class="wrap">${i.status === "approved" ? (cardId ? `<a href="#/cards">${esc(cardId)}</a>` : `<span class="muted">no card</span>`) : esc(i.reason || "–")}</td>
  </tr>`;
}

async function decide(button, ctx) {
  const article = button.closest("article");
  const out = $(".review-out", article);
  const id = button.dataset.approve || button.dataset.reject;
  const buttons = $$("button", article);
  out.innerHTML = "";
  const value = (name) => $(`[name="${name}"]`, article)?.value.trim() || "";
  if (button.dataset.approve !== undefined && (value("en") || value("fr")) && !(value("en") && value("fr"))) {
    out.innerHTML = banner("Give the one action in both languages, or leave both as they are.");
    $(value("en") ? '[name="fr"]' : '[name="en"]', article).focus();
    return;
  }
  if (button.dataset.reject !== undefined && !value("reason")) {
    out.innerHTML = banner("Give a reason: it stays with the item.");
    $('[name="reason"]', article).focus();
    return;
  }
  for (const b of buttons) busy(b);
  try {
    if (button.dataset.approve !== undefined) {
      const body = value("en") && value("fr") ? { one_action: { en: value("en"), fr: value("fr") } } : {};
      const { cardId } = await api(`/api/admin/db/watch/${encodeURIComponent(id)}/approve`, { method: "POST", body });
      toast(cardId ? `Approved: public on the watch page; candidate card ${cardId} waits on Scam reports` : "Approved: public on the watch page", "ok");
    } else {
      await api(`/api/admin/db/watch/${encodeURIComponent(id)}/reject`, { method: "POST", body: { reason: value("reason") } });
      toast("Item rejected");
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
