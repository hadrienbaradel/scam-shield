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

export function verdictCard(v) {
  const steps = [v.action_text, v.real_company_says].filter(Boolean);
  return `
    <div class="verdict ${verdictClass(v.verdict)}" role="alert">
      <h3>${esc(v.headline)}</h3>
      <p>${esc(v.action_text)}</p>
      <p class="score">${t("confidence", { n: Math.round((v.confidence || 0) * 100) })}</p>
    </div>
    <h3>${t("why")}</h3>
    <ul class="why-list">${(v.reasons || []).map((r) => `<li>${esc(r.text)}</li>`).join("")}</ul>
    <h3>${t("what_now")}</h3>
    <ol class="steps-list">${steps.map((s) => `<li>${esc(s)}</li>`).join("")}</ol>
    <p class="small">${esc(t("checked_by", { source: v.source || "Scam Shield" }))}</p>`;
}

export function readAloud(v) {
  if (!v || !("speechSynthesis" in window)) return;
  speechSynthesis.cancel();
  const u = new SpeechSynthesisUtterance(`${v.headline}. ${(v.reasons || []).map((r) => r.text).join(". ")}. ${v.action_text}`);
  u.rate = 0.92;
  u.lang = v.language === "fr" ? "fr-FR" : "en-US";
  speechSynthesis.speak(u);
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
