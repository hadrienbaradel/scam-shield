// The verdict card and the "Still unsure?" row, shared by Today, Check and
// My messages (2026-11-04 redesign, frames 1l, 1m and 1n of
// _product/design/2026-11-04-redesign/claude-design/Prudence Redesign.dc.html).
// Pure HTML renderers plus one binder: the caller paints the strings where it
// wants and calls bindVerdictCard() once they are in the page. Every value
// from a message or a verdict is escaped.
//
// API (signatures are fixed; new fields are optional only):
//
//   verdictCardHtml({ verdict, message, callBack, open, ids }) -> string
//     verdict   the check: { verdict: "scam" | "be_careful" | "safe",
//               headline, action_text, reasons: [{ text, evidence }],
//               real_company_says, source }. Anything else in .verdict (a
//               check still running, a broken answer) draws the amber
//               "We could not check this message yet" card, never Safe.
//     message   optional { fromName, from, subject, body, audio }: fills the
//               "Show me the message" fold (an <audio> player first when
//               .audio is a URL). No message: no fold.
//     callBack  optional { name, phone }; accepted for the callers' sake, the
//               card does not draw it (the "Call <name>" verb is the caller's).
//     open      optional { body: true } to draw the fold already open.
//     ids       element id prefix, default "v2" (two cards on one page must
//               use two prefixes).
//     Draws <article id="{ids}Card" class="v2-card vcard {danger|caution|ok}">:
//     the 60 px icon circle and the verdict word (36 px), the headline
//     (h1#{ids}Headline, 26 px), the next step (22 px bold), every reason as
//     a 22 px fact box in the verdict wash with its "Checked: ..." chip, then
//     real_company_says and the checked_by line, small; then the fold button
//     button#{ids}Body (aria-controls {ids}BodyBox) and div#{ids}BodyBox.
//     There is no "Why we think so": the reasons are already on the card.
//
//   unsureRowHtml({ verdict, guardianName, folded = false, ids, lookCloser = false, closer = null }) -> string
//     verdict       "scam" | "be_careful" | "safe" (only for the caller's
//                   choice of folded; the row is the same for all three).
//     guardianName  the trusted person's first name, or empty for none.
//     folded        true on a Safe card (frame 1n): one outline button
//                   "I still have a doubt" (button#{ids}Doubt, with the
//                   chevron) shows, and the full row waits hidden after it.
//     lookCloser    true where the page holds the whole message and the
//                   server can look closer (_product/specs/investigate.md):
//                   button#{ids}Closer "Look closer" after Ask, and the empty
//                   live section#{ids}Checks under it.
//     closer        a look already made for this card (the answer of
//                   /api/check/investigate): drawn in #{ids}Checks, no button.
//     Draws <section id="{ids}Unsure" class="vcard-unsure">:
//       h2#{ids}UnsureTitle "Still unsure?" (.section-title)
//       button#{ids}Ask, gold, "Ask <name>" with the person icon; with no
//         guardian: a#{ids}AddTrusted, gold, "Add a trusted person" to
//         #/settings/people
//       button#{ids}Closer and div#{ids}Checks (only with lookCloser or closer)
//       button#{ids}Send, the grey "Send it to Prudence" with the Coming
//         soon tag (.soon-button, aria-disabled="true", nothing happens on tap)
//       p.vcard-note, the 19 px grey line saying who answers and where.
//     Folded, the section holds button#{ids}Doubt and div#{ids}UnsureRow
//     (hidden) with the parts above.
//
//   lookCloserHtml(state, ids) -> the inside of #{ids}Checks for one state:
//     { busy: true }   "Prudence is looking closer. About ten seconds."
//     { failed: true } the plain sentence and button#{ids}CloserRetry "Try again"
//     { result }       with result.verdict: "Prudence checked:" (h3#{ids}ChecksTitle)
//                      and one numbered line per check (its .found words), then
//                      "After looking closer: <verdict>" with its icon, the
//                      headline, what to do, each reason with a "Check n" chip,
//                      and the source line ("Looked closer by Muse Spark
//                      (muse-spark-1.3): 4 checks in 7 s"); with verdict null:
//                      "Prudence could not look closer this time. The verdict
//                      above stands."
//
//   bindVerdictCard(root, { ids, onBody, onAsk, onDoubt, onLookCloser }) -> void
//     Wires what is in root (missing parts are skipped):
//     - #{ids}Body opens and closes the message fold in place (aria-expanded
//       and the label follow), then calls onBody(isOpen) if given;
//     - #{ids}Ask calls onAsk(event);
//     - #{ids}Doubt unfolds the row in place (the button goes, the row shows,
//       focus moves to "Still unsure?"), then calls onDoubt(event) if given;
//     - #{ids}Closer calls onLookCloser(event).
//
//   runLookCloser(root, { ids, send, onResult }) -> Promise
//     The tap on Look closer: the button is disabled, #{ids}Checks says it is
//     looking, send() (the caller's API call) answers, and the section shows
//     the look (then the button goes and onResult(result) keeps it for a
//     redraw) or the failure with Try again, which runs it again. A late
//     answer for a card no longer on screen is dropped; focus moves to the
//     answer so a screen reader says it.
//
//   verdictWord(verdict) -> "Scam" | "Be careful" | "Safe" (translated)
//   verdictIcon(verdict, size = 34) -> the icon's <svg> for that verdict
//   headlineOf(text) -> the headline without a leading "Scam:" (the word is
//     already on the card) and with a capital first letter
//
// Styles: "redesign: today (today.js, card.js)" at the end of styles.css
// (.vcard, .vcard-*, .vcard-unsure), on top of the shared components.

import { t, evidenceWords } from "../i18n.js";
import { $, esc, icon, verdictClass } from "../ui.js";

const VERDICTS = ["scam", "be_careful", "safe"];

export function verdictWord(verdict) {
  return t(verdict === "scam" ? "pill_scam" : verdict === "be_careful" ? "pill_careful" : "pill_safe");
}

export function verdictIcon(verdict, size = 34) {
  if (verdict === "scam") return icon("circle-slash", size, 2.5);
  if (verdict === "be_careful") return icon("careful", size, 2);
  return icon("check", size, 3);
}

// The word is on the card already: the headline need not start with it again.
export function headlineOf(h) {
  return String(h || "")
    .replace(/^(scam|be careful|safe|arnaque|prudence|attention|sans danger|rassurant|vigilance)\s*:\s*/i, "")
    .replace(/^./, (c) => c.toUpperCase());
}

// Under a reason, what it was checked against ("Checked: who sent it");
// nothing when the evidence kind is unknown or missing.
const chip = (r) => { const w = evidenceWords(r?.evidence); return w ? `<span class="v2-chip">${esc(w)}</span>` : ""; };

function bodyFold(message, open, p) {
  if (!message) return "";
  const m = message;
  const shown = Boolean(open?.body);
  return `
      <button id="${p}Body" class="btn-link vcard-fold" type="button" aria-expanded="${shown}" aria-controls="${p}BodyBox"
        data-show="${esc(t("v2_show"))}" data-hide="${esc(t("v2_hide"))}">${esc(shown ? t("v2_hide") : t("v2_show"))}</button>
      <div id="${p}BodyBox" class="vcard-body" ${shown ? "" : "hidden"}>
        ${m.audio ? `<audio controls preload="none" src="${esc(m.audio)}"></audio>` : ""}
        ${m.fromName || m.from ? `<p class="mail-meta">${esc(m.fromName || "")}${m.from ? ` &lt;${esc(m.from)}&gt;` : ""}</p>` : ""}
        ${m.subject ? `<p><strong>${esc(m.subject)}</strong></p>` : ""}
        <pre class="mail-body">${esc(m.body || "")}</pre>
      </div>`;
}

export function verdictCardHtml({ verdict, message = null, callBack = null, open = {}, ids = "v2" } = {}) {
  const p = ids || "v2";
  const v = verdict || {};
  if (!VERDICTS.includes(v.verdict)) {
    return `
    <article id="${p}Card" class="v2-card vcard caution" aria-labelledby="${p}Headline">
      <p class="vcard-word"><span class="vcard-mark" aria-hidden="true">${verdictIcon("be_careful")}</span>${esc(t("checking"))}</p>
      <h1 id="${p}Headline" class="vcard-headline">${esc(t("v2_unknown_title"))}</h1>
      <p class="vcard-fact">${esc(t("v2_unknown_note"))}</p>
    </article>`;
  }
  const reasons = Array.isArray(v.reasons) ? v.reasons : [];
  return `
    <article id="${p}Card" class="v2-card vcard ${verdictClass(v.verdict)}" aria-labelledby="${p}Headline">
      <p class="vcard-word"><span class="vcard-mark" aria-hidden="true">${verdictIcon(v.verdict)}</span>${esc(verdictWord(v.verdict))}</p>
      <h1 id="${p}Headline" class="vcard-headline">${esc(headlineOf(v.headline))}</h1>
      ${v.action_text ? `<p class="vcard-next">${esc(v.action_text)}</p>` : ""}
      ${reasons.map((r) => `<p class="vcard-fact">${esc(r?.text)}${chip(r)}</p>`).join("")}
      ${v.real_company_says ? `<p class="vcard-small">${esc(v.real_company_says)}</p>` : ""}
      <p class="vcard-small">${esc(t("checked_by", { source: v.source || "Prudence" }))}</p>
      ${bodyFold(message, open, p)}
    </article>`;
}

export function unsureRowHtml({ verdict, guardianName = "", folded = false, ids = "v2", lookCloser = false, closer = null } = {}) {
  const p = ids || "v2";
  const name = String(guardianName || "").trim();
  const ask = name
    ? `<button id="${p}Ask" class="btn btn-gold btn-big" type="button">${icon("person", 28)}${esc(t("v2_ask", { name }))}</button>`
    : `<a id="${p}AddTrusted" class="btn btn-gold btn-big" href="#/settings/people">${icon("person", 28)}${esc(t("v2_add_trusted"))}</a>`;
  // Look closer (_product/specs/investigate.md): the button, then the live section its answer fills.
  const look = closer
    ? `<div id="${p}Checks" class="vcard-checks" aria-live="polite">${lookCloserHtml({ result: closer }, p)}</div>`
    : lookCloser ? `<button id="${p}Closer" class="btn btn-outline btn-big" type="button">${icon("search", 28)}${esc(t("ck_look_closer"))}</button>
      <div id="${p}Checks" class="vcard-checks" aria-live="polite" hidden></div>` : "";
  const row = `
      <h2 id="${p}UnsureTitle" class="section-title">${esc(t("ck_unsure"))}</h2>
      ${ask}
      ${look}
      <button id="${p}Send" class="soon-button" type="button" aria-disabled="true"><span>${icon("send", 26)}${esc(t("ck_send_prudence"))}</span><span class="pill-soon">${esc(t("protect_soon"))}</span></button>
      <p class="vcard-note">${esc(t("ck_send_note"))}</p>`;
  if (!folded) return `<section id="${p}Unsure" class="vcard-unsure" aria-labelledby="${p}UnsureTitle">${row}</section>`;
  return `
    <section id="${p}Unsure" class="vcard-unsure">
      <button id="${p}Doubt" class="btn btn-outline btn-big vcard-doubt" type="button" aria-expanded="false" aria-controls="${p}UnsureRow">${esc(t("ck_doubt"))}${icon("chevron-down", 26, 2.5)}</button>
      <div id="${p}UnsureRow" class="vcard-unsure-row" hidden>${row}</div>
    </section>`;
}

// The inside of #{ids}Checks: looking, the look, nothing usable, or a failure.
export function lookCloserHtml(state = {}, ids = "v2") {
  const p = ids || "v2";
  if (state.busy) return `<p class="vcard-checks-busy" role="status">${icon("search", 26)}<span>${esc(t("inv_busy"))}</span></p>`;
  if (state.failed || !state.result) {
    return `<p id="${p}ChecksTitle" class="banner caution vcard-checks-note" tabindex="-1">${esc(t("inv_failed"))}</p>
      <button id="${p}CloserRetry" class="btn btn-gold btn-big" type="button">${esc(t("inv_try_again"))}</button>`;
  }
  const r = state.result;
  if (!VERDICTS.includes(r.verdict)) return `<p id="${p}ChecksTitle" class="vcard-checks-note" tabindex="-1">${esc(t("inv_none"))}</p>`;
  const checks = Array.isArray(r.checks) ? r.checks : [];
  const n = checks.length;
  const seconds = Math.max(1, Math.round((Number(r.ms) || 0) / 1000));
  return `
      <h3 id="${p}ChecksTitle" class="section-title" tabindex="-1">${esc(t("inv_checked"))}</h3>
      <ol class="vcard-check-list">${checks.map((c) => `<li>${esc(c?.found)}</li>`).join("")}</ol>
      <div class="vcard vcard-closer ${verdictClass(r.verdict)}">
        <p class="vcard-word"><span class="vcard-mark" aria-hidden="true">${verdictIcon(r.verdict, 28)}</span>${esc(t("inv_after", { verdict: verdictWord(r.verdict) }))}</p>
        ${r.headline ? `<p class="vcard-next">${esc(headlineOf(r.headline))}</p>` : ""}
        ${r.what_to_do ? `<p class="vcard-closer-do">${esc(r.what_to_do)}</p>` : ""}
        ${(Array.isArray(r.reasons) ? r.reasons : []).map((x) => `<p class="vcard-fact">${esc(x?.text)}<span class="v2-chip">${esc(t("inv_check_n", { n: x?.check }))}</span></p>`).join("")}
      </div>
      <p class="vcard-small">${esc(t(n === 1 ? "inv_source_one" : "inv_source", { source: r.source || "Prudence", n, s: seconds }))}</p>`;
}

// The tap on Look closer, shared by Check, Today and the demo.
export async function runLookCloser(root, { ids = "v2", send, onResult } = {}) {
  const p = ids || "v2";
  const box = $(`#${p}Checks`, root);
  const button = $(`#${p}Closer`, root);
  if (!box || typeof send !== "function") return;
  if (button) { button.disabled = true; button.setAttribute("aria-disabled", "true"); }
  box.hidden = false;
  box.innerHTML = lookCloserHtml({ busy: true }, p);
  let state;
  try { state = { result: await send() }; } catch (e) {
    if (e?.name === "AbortError") return;
    state = { failed: true };
  }
  if (!box.isConnected) return; // the card is gone: a late answer is dropped
  box.innerHTML = lookCloserHtml(state, p);
  if (state.failed) {
    if (button) button.hidden = true;
    $(`#${p}CloserRetry`, box)?.addEventListener("click", () => runLookCloser(root, { ids: p, send, onResult }));
  } else {
    button?.remove();
    onResult?.(state.result);
  }
  $(`#${p}ChecksTitle`, box)?.focus();
}

export function bindVerdictCard(root, { ids = "v2", onBody, onAsk, onDoubt, onLookCloser } = {}) {
  const p = ids || "v2";
  $(`#${p}Closer`, root)?.addEventListener("click", (e) => onLookCloser?.(e));
  const body = $(`#${p}Body`, root);
  const box = $(`#${p}BodyBox`, root);
  body?.addEventListener("click", () => {
    const open = box ? box.hidden : false;
    if (box) box.hidden = !open;
    body.setAttribute("aria-expanded", String(open));
    body.textContent = open ? body.dataset.hide : body.dataset.show;
    onBody?.(open);
  });
  $(`#${p}Ask`, root)?.addEventListener("click", (e) => onAsk?.(e));
  const doubt = $(`#${p}Doubt`, root);
  doubt?.addEventListener("click", (e) => {
    const row = $(`#${p}UnsureRow`, root);
    if (row) {
      row.hidden = false;
      const section = $(`#${p}Unsure`, root);
      section?.setAttribute("aria-labelledby", `${p}UnsureTitle`);
      doubt.remove();
      const h = $(`#${p}UnsureTitle`, root);
      if (h) { h.setAttribute("tabindex", "-1"); h.focus(); }
    }
    onDoubt?.(e);
  });
}
