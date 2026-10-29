// Small DOM helpers and the shared verdict card. Every value from a
// message is escaped: email content is shown as text, never as HTML.

import { t } from "./i18n.js";

export const $ = (s, root = document) => root.querySelector(s);
export const $$ = (s, root = document) => [...root.querySelectorAll(s)];
export const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

export const verdictClass = (v) => (v === "scam" ? "danger" : v === "be_careful" ? "caution" : "ok");
export function pill(check) {
  if (!check) return `<span class="pill">${t("pill_unchecked")}</span>`;
  if (check.restored) return `<span class="pill">${t("pill_back")}</span>`;
  const v = check.verdict;
  return `<span class="pill ${verdictClass(v)}">${t(v === "scam" ? "pill_scam" : v === "be_careful" ? "pill_careful" : "pill_safe")}</span>`;
}

// One next step, said once; certainty in words, not a precise-looking
// percentage the model cannot back up.
export function verdictCard(v) {
  const sure = v.confidence >= 0.9 ? "sure_high" : v.confidence >= 0.75 ? "sure_mid" : "sure_low";
  return `
    <div class="verdict ${verdictClass(v.verdict)}" role="alert">
      <h3>${esc(v.headline)}</h3>
      <p class="next-step">${esc(v.action_text)}</p>
      <p class="score">${t(sure)}</p>
    </div>
    <h3>${t("why")}</h3>
    <ul class="why-list">${(v.reasons || []).map((r) => `<li>${esc(r.text)}</li>`).join("")}</ul>
    ${v.real_company_says ? `<p class="note">${esc(v.real_company_says)}</p>` : ""}
    <p class="small">${esc(t("checked_by", { source: v.source || "Prudence" }))}</p>`;
}

// Moves keyboard and screen-reader focus to a freshly drawn heading.
export function focusHeading(root = document) {
  const h = root.querySelector("h1, h2");
  if (!h) return;
  h.setAttribute("tabindex", "-1");
  h.focus({ preventScroll: false });
}

// Disables a button while its action runs; shows errors instead of
// leaving the screen pretending something was saved.
export async function busy(button, fn, label) {
  const before = button?.textContent;
  if (button) { button.disabled = true; if (label) button.textContent = label; }
  try { return await fn(); } catch (e) { toast(e.message, "danger"); return undefined; } finally {
    if (button) { button.disabled = false; if (label) button.textContent = before; }
  }
}

// Reads text aloud in French ("fr", "fr-FR") or English (anything else), a
// little slower than the default; a new reading stops the one before. Does
// nothing where the browser cannot speak.
export function speak(text, lang) {
  if (!text || !("speechSynthesis" in window)) return;
  speechSynthesis.cancel();
  const u = new SpeechSynthesisUtterance(String(text));
  u.rate = 0.92;
  u.lang = String(lang || "").startsWith("fr") ? "fr-FR" : "en-US";
  speechSynthesis.speak(u);
}

export function readAloud(v) {
  if (!v) return;
  speak(`${v.headline}. ${(v.reasons || []).map((r) => r.text).join(". ")}. ${v.action_text}`, v.language);
}

let toastTimer;
export function toast(text, kind = "info") {
  let el = $("#toast");
  if (!el) { el = document.createElement("div"); el.id = "toast"; el.setAttribute("role", "status"); document.body.append(el); }
  el.className = `toast ${kind}`;
  el.textContent = text;
  el.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => (el.hidden = true), 7000);
}
