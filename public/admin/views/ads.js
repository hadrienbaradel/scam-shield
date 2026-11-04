// Ads: Prudence's own Facebook ads (_product/specs/ad-studio.md). Muse
// Spark writes each idea from the fact sheet, Muse Image makes its photo and
// Muse Spark checks it; an admin edits by prompt, then publishes with one
// click that carries the spend. The header asks for new ideas and says
// what is set up (the models, Facebook, today's photos and their cost);
// one card per idea, newest first. Every word a model wrote is escaped
// text here. While an idea is being written, edited or published the page
// reads the list again every 3 s; what an admin is typing survives it.

import { api, $, $$, esc, chipRaw, timeEl, num, toast, banner, busy, isBusy, plural, cap, words as wordsOf } from "../console.js";

export const label = "Ads";

const BUSY = ["drafting", "editing", "publishing"];
const POLL_MS = 3000;
const STATUS = {
  drafting: ["info", "↻", "Writing", true], editing: ["info", "↻", "Editing", true], publishing: ["info", "↻", "Publishing", true],
  draft: ["off", "○", "Draft"], published: ["ok", "●", "Published"], paused: ["warn", "‖", "Paused"],
  rejected: ["off", "–", "Rejected"], failed: ["fail", "✕", "Failed"],
};
const REVIEW = { in_review: ["warn", "◔", "In review"], active: ["ok", "●", "Active"], rejected: ["fail", "✕", "Rejected by Meta"], paused: ["warn", "‖", "Paused"] };
const CTA = { LEARN_MORE: "Learn more", SIGN_UP: "Sign up" };
const LIMITS = { brief: 500, instruction: 500, reason: 300 };

function statusChip(s) {
  const [tone, glyph, word, running] = STATUS[s] || ["off", "–", cap(wordsOf(s || "unknown"))];
  return chipRaw(tone, glyph, word, running ? "chip-running" : "");
}

// What an admin typed, kept across the 3-second redraws (by data-focus key).
const typed = new Map();
let timer = null;

export async function render(root, params, ctx) {
  clearTimeout(timer);
  const data = await api("/api/admin/ads");
  if (ctx.stale()) return;
  draw(root, data, ctx);
  if ((data.ads || []).some((a) => BUSY.includes(a.status))) poll(ctx);
}

// Read the list again in 3 s, unless the page changed; wait while a text box has the focus.
function poll(ctx) {
  timer = setTimeout(() => {
    if (!ctx.onPage() || ctx.stale()) return;
    const a = document.activeElement;
    const typing = a && $("#view")?.contains(a) && /^(textarea|input|select)$/i.test(a.tagName);
    if (document.visibilityState !== "visible" || typing) return poll(ctx);
    ctx.refresh();
  }, POLL_MS);
}

function draw(root, data, ctx) {
  const ads = data.ads || [];
  const net = data.network || {};
  const models = data.models || {};
  const today = data.today || {};
  const ideasOff = !models.configured
    ? !models.installed ? "The idea writer is not installed on this server yet." : models.missing?.length ? `New ideas needs ${models.missing.join(", ")}.` : "The models are not set up on this server."
    : "";
  const busyCount = ads.filter((a) => BUSY.includes(a.status)).length;

  root.innerHTML = `
    <p class="lead">Facebook ads for Prudence. Muse Spark writes each idea from the fact sheet, Muse Image makes its photo and Muse Spark checks the photo. Nothing reaches Facebook until you click Publish.</p>
    <section class="card ads-new" aria-labelledby="h-new">
      <h2 id="h-new">New ideas</h2>
      <div class="field ads-brief">
        <label for="ads-brief">Brief <span class="muted">(optional)</span></label>
        <textarea id="ads-brief" name="brief" rows="2" maxlength="${LIMITS.brief}" data-focus="ads-brief" placeholder="adult children worried about a parent's email"></textarea>
      </div>
      <div class="btn-row">
        <div class="field"><label for="ads-count">Ideas</label>
          <select id="ads-count" name="count" data-focus="ads-count">${[1, 2, 3, 4].map((n) => `<option value="${n}"${n === 3 ? " selected" : ""}>${n}</option>`).join("")}</select></div>
        <button type="button" class="btn" data-act="ideas" data-focus="ads-ideas"${ideasOff ? ` disabled aria-describedby="ads-ideas-off"` : ""}>New ideas</button>
        ${ideasOff ? `<span class="muted small" id="ads-ideas-off">${esc(ideasOff)}</span>` : ""}
      </div>
      <div class="ads-new-out"></div>
      <div class="ads-status" aria-label="Set-up">
        <span>${chipRaw("info", "▣", `${plural(today.photos ?? 0, "photo")} today · ${money(today.costUsd ?? 0)}`)}</span>
        <span>${models.configured ? chipRaw("ok", "●", "Models ready") : chipRaw("warn", "▲", "Models not set up")}
          <span class="small">${esc(models.words || "–")} writes and checks · ${esc(models.image || "the image model")} draws</span></span>
        <span>${net.configured ? chipRaw("ok", "●", `${net.label || "Facebook"} ready`) : chipRaw("warn", "▲", `${net.label || "Facebook"} not set up`)}
          <span class="small">${net.configured ? esc(net.budgetLabel ? `${net.budgetLabel} per ad` : "") : esc(networkOff(net))}</span></span>
      </div>
    </section>
    <section aria-labelledby="h-ideas">
      <div class="section-head">
        <h2 id="h-ideas" tabindex="-1">Ideas (${num(ads.length)})</h2>
        ${busyCount ? `<span class="note">${esc(plural(busyCount, "idea"))} in progress · this page updates every ${POLL_MS / 1000} s</span>` : ""}
      </div>
      <div class="ads-grid">${ads.map((a) => card(a, net)).join("") || `<p class="empty">No idea yet. Write a brief, or leave it empty, and ask for new ideas.</p>`}</div>
    </section>`;

  for (const el of $$("textarea[data-focus], input[data-focus]", root)) {
    if (typed.has(el.dataset.focus)) el.value = typed.get(el.dataset.focus);
    el.addEventListener("input", () => typed.set(el.dataset.focus, el.value));
  }
  const count = $("#ads-count", root);
  if (typed.has("ads-count")) count.value = typed.get("ads-count");
  count.addEventListener("change", () => typed.set("ads-count", count.value));
  for (const b of $$("[data-act]", root)) b.addEventListener("click", () => { if (!isBusy(b) && !b.disabled) act(b, ctx); });
}

const money = (usd) => `$${Number(usd || 0).toFixed(2)}`;
function networkOff(net) {
  if (net.installed === false) return "The publisher is not installed on this server yet.";
  return net.missing?.length ? `Needs ${net.missing.join(", ")}` : "Not set up on this server.";
}

// "Words by Muse Spark · photo by Muse Image 1.0 · checked by Muse Spark"
function madeBy(m) {
  if (!m) return "";
  const parts = [m.words && `Words by ${m.words}`, m.image && `photo by ${m.image}`, m.check && `checked by ${m.check}`].filter(Boolean);
  return parts.length ? `<p class="muted small">${esc(parts.join(" · "))}</p>` : "";
}

function checkLine(c) {
  if (!c) return "";
  const left = Array.isArray(c.problems) ? c.problems.length : 0;
  const summary = c.summary || (left ? `${plural(left, "problem")} left` : "Checked");
  return `<p class="ads-check">${c.pass && !left ? chipRaw("ok", "✓", "Photo checked") : chipRaw("warn", "▲", "Look at the photo")} ${esc(summary)}</p>`;
}

function photo(a) {
  const w = a.words || {};
  if (a.photoUrl) return `<a href="${esc(a.photoUrl)}" target="_blank" rel="noopener noreferrer" class="ads-photo-link"><img class="ads-photo" src="${esc(a.photoUrl)}" alt="${esc(w.photo_brief ? `Photo: ${w.photo_brief}` : "The ad's photo")}" width="240" height="300" loading="lazy"></a>`;
  if (a.status !== "drafting") return `<div class="ads-photo ads-photo-empty ads-photo-none"><span>No photo</span></div>`;
  return `<div class="ads-photo ads-photo-empty"><span>Muse Spark is writing, then Muse Image draws the photo…</span></div>`;
}

function wordsBlock(w) {
  if (!w) return "";
  return `<dl class="kv ads-words">
      <dt>Headline</dt><dd><strong>${esc(w.headline || "–")}</strong></dd>
      <dt>Main text</dt><dd>${esc(w.primary_text || "–")}</dd>
      <dt>Description</dt><dd>${esc(w.description || "–")}</dd>
      <dt>Button</dt><dd>${esc(CTA[w.cta] || w.cta || "–")}</dd>
    </dl>
    ${w.landing ? `<div class="ads-variant"><p class="muted small">Landing variant</p><p class="ads-variant-h">${esc(w.landing.headline || "–")}</p><p>${esc(w.landing.lead || "–")}</p></div>` : ""}`;
}

function reviewBlock(a) {
  const r = a.review || {};
  const [tone, glyph, word] = REVIEW[r.state] || ["off", "–", cap(wordsOf(r.effectiveStatus || "not checked yet"))];
  const ext = a.external || {};
  const manager = /^https:\/\//.test(ext.adsManagerUrl || "") ? ext.adsManagerUrl : "";
  const b = a.budget || {};
  return `<div class="ads-review">
      <p>${chipRaw(tone, glyph, word)} <span class="muted small">Meta's review${r.checkedAt ? `, read ${timeEl(r.checkedAt)}` : ""}</span></p>
      ${(r.reasons || []).length ? `<ul class="ads-reasons">${r.reasons.map((x) => `<li>${esc(x)}</li>`).join("")}</ul>` : ""}
      <p class="small">Ad <span class="mono">${esc(ext.adId || "–")}</span>${manager ? ` · <a href="${esc(manager)}" target="_blank" rel="noopener noreferrer">Open in Ads Manager</a>` : ""}${b.daily ? ` · ${esc(`${b.daily} ${b.currency || ""} a day · ${b.days} days`)}` : ""}${a.publishedAt ? ` · published ${timeEl(a.publishedAt)}` : ""}</p>
    </div>`;
}

function card(a, net) {
  const id = esc(a.id);
  const f = (name) => `ad-${id}-${name}`;
  const label = a.words?.headline ? `"${a.words.headline}"` : `idea ${a.code}`;
  const live = ["published", "paused"].includes(a.status);
  const publishOff = a.status !== "draft" ? "" : !net.configured ? networkOff(net) : "";
  const canReject = ["draft", "failed", "published", "paused"].includes(a.status);
  return `<article class="card ads-card" aria-label="Ad ${esc(label)}">
    <div class="ads-media">${photo(a)}</div>
    <div class="ads-body">
      <div class="ads-head">${statusChip(a.status)}
        <span class="mono small">${esc(a.code)}</span>
        ${a.version ? `<span class="muted small">version ${num(a.version)} of ${num(a.versions)}</span>` : ""}
        <span class="muted small">${timeEl(a.createdAt)}</span>
        ${a.brief ? `<span class="muted small ads-brief-line" title="${esc(a.brief)}">brief: ${esc(a.brief)}</span>` : ""}
      </div>
      ${a.error ? `<div class="banner" role="alert"><p>${esc(a.error)}</p></div>` : ""}
      ${a.status === "rejected" ? `<p><strong>Set aside:</strong> ${esc(a.rejectedReason || "–")}</p>` : ""}
      ${checkLine(a.check)}
      ${madeBy(a.models)}
      ${wordsBlock(a.words)}
      ${a.instruction ? `<p class="muted small">This version: "${esc(a.instruction)}"</p>` : ""}
      ${a.words ? `<p class="small"><a href="${esc(a.previewUrl)}" target="_blank" rel="noopener noreferrer">Preview the landing variant</a> <span class="muted">(opens in a new tab)</span></p>` : ""}
      ${live ? reviewBlock(a) : ""}
      ${live || a.counts?.visits || a.counts?.requests ? `<p class="ads-counts">${esc(`${plural(a.counts?.visits ?? 0, "visit")} · ${plural(a.counts?.requests ?? 0, "request")}`)}</p>` : ""}
      ${a.canEdit ? `<div class="ads-edit">
        <label for="${f("instruction")}">Change it with a prompt</label>
        <textarea id="${f("instruction")}" rows="2" maxlength="${LIMITS.instruction}" data-focus="${f("instruction")}" placeholder="make the mother smile, warmer light"></textarea>
        <div class="btn-row">
          <button type="button" class="btn btn-ghost" data-act="edit" data-id="${id}" data-focus="${f("apply")}" aria-label="Apply the change to ${esc(label)}">Apply</button>
          ${a.canUndo ? `<button type="button" class="btn btn-ghost" data-act="undo" data-id="${id}" data-focus="${f("undo")}" aria-label="Undo the last change to ${esc(label)}">Undo</button>` : ""}
        </div></div>` : ""}
      <div class="ads-out"></div>
      ${a.status === "draft" ? `<div class="btn-row">
        <button type="button" class="btn" data-act="publish" data-id="${id}" data-focus="${f("publish")}"${publishOff ? ` disabled aria-describedby="${f("publish-off")}"` : ""}>Publish on ${esc(net.label || "Facebook")}${net.budgetLabel ? ` · ${esc(net.budgetLabel)}` : ""}</button>
        ${publishOff ? `<span class="muted small" id="${f("publish-off")}">${esc(publishOff)}</span>` : ""}
      </div>` : ""}
      ${live ? `<div class="btn-row">
        ${a.status === "published"
          ? `<button type="button" class="btn btn-ghost" data-act="pause" data-id="${id}" data-focus="${f("pause")}">Pause</button>`
          : `<button type="button" class="btn btn-ghost" data-act="resume" data-id="${id}" data-focus="${f("resume")}">Resume</button>`}
        <button type="button" class="btn btn-ghost" data-act="refresh" data-id="${id}" data-focus="${f("refresh")}">Refresh the review</button>
      </div>` : ""}
      ${canReject ? `<div class="btn-row ads-reject">
        <div class="field"><label for="${f("reason")}">Reason</label><input id="${f("reason")}" maxlength="${LIMITS.reason}" size="28" data-focus="${f("reason")}"></div>
        <button type="button" class="btn btn-ghost" data-act="reject" data-id="${id}" data-focus="${f("reject")}" aria-label="Reject ${esc(label)}">${live ? "Stop and reject" : "Reject"}</button>
      </div>` : ""}
    </div>
  </article>`;
}

const DONE = {
  ideas: (n) => `${plural(n, "idea")} on the way: Muse Spark writes, then Muse Image draws each photo (about a minute).`,
  edit: () => "Editing: the card updates when Muse Spark and Muse Image are done.",
  undo: () => "Back to the version before.",
  publish: () => "Publishing on Facebook…",
  pause: () => "Paused on Facebook.",
  resume: () => "Running again on Facebook.",
  refresh: () => "Review read from Facebook.",
  reject: () => "Set aside.",
};

async function act(button, ctx) {
  const kind = button.dataset.act;
  const article = button.closest("article") || button.closest("section");
  const out = $(kind === "ideas" ? ".ads-new-out" : ".ads-out", article);
  if (out) out.innerHTML = "";
  const field = (sel) => $(sel, article);
  let body = {};
  let clear = null;
  if (kind === "ideas") {
    const brief = field("#ads-brief");
    body = { brief: brief.value.trim(), count: Number(field("#ads-count").value) };
    clear = brief;
  } else if (kind === "edit") {
    const box = field("textarea");
    if (!box.value.trim()) { out.innerHTML = banner("Write what to change first, for example: make the mother smile."); box.focus(); return; }
    body = { instruction: box.value.trim() };
    clear = box;
  } else if (kind === "reject") {
    const reason = field(".ads-reject input");
    if (!reason.value.trim()) { (out || article).insertAdjacentHTML("beforeend", banner("Give a reason first: it stays on the card.")); reason.focus(); return; }
    body = { reason: reason.value.trim() };
    clear = reason;
  }
  const buttons = $$("button", article);
  for (const b of buttons) busy(b);
  try {
    const url = kind === "ideas" ? "/api/admin/ads/ideas" : `/api/admin/ads/${encodeURIComponent(button.dataset.id)}/${kind}`;
    const res = await api(url, { method: "POST", body });
    if (clear) { clear.value = ""; typed.delete(clear.dataset.focus); }
    toast(DONE[kind](res.ids?.length ?? 0), "ok");
    if (ctx.onPage()) await ctx.refresh();
  } catch (e) {
    if (out) out.innerHTML = banner(e);
    else toast(e.message, "fail");
    for (const b of buttons) busy(b, false);
  }
}
