// Small DOM helpers and the shared verdict card. Every value from a
// message is escaped: email content is shown as text, never as HTML.

import { t } from "./i18n.js";
import { api } from "./api.js";

export const $ = (s, root = document) => root.querySelector(s);
export const $$ = (s, root = document) => [...root.querySelectorAll(s)];
export const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

export const verdictClass = (v) => (v === "scam" ? "danger" : v === "be_careful" ? "caution" : "ok");

// The redesign's inline stroke icons (2026-11-04 Claude Design canvas,
// _product/design/2026-11-04-redesign/claude-design/): the paths are copied
// from the canvas so the shapes match. Decorative: aria-hidden, the word is
// always next to the icon. They draw in currentColor, so a class sets the
// colour. icon("gear", 28) is the header's 28 px gear; icon("check", 24, 3)
// the chosen chip's tick; an unknown name gives an empty 24 px box.
// Names: gear, check, check-circle, careful, circle-slash, mail, chat, mic,
// whatsapp, messenger, phone, camera, clipboard, image, home, search, book,
// chevron-left, chevron-right, chevron-down, arrow-right, person, send,
// speaker, trash, sign-out, star, folder, bell, globe, list, clock, lock, stop.
const ICONS = {
  gear: '<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z"/>',
  check: '<path d="M5 12.5l4.5 4.5L19 7"/>',
  "check-circle": '<circle cx="12" cy="12" r="10"/><path d="M7.5 12.5l3 3 6-6.5"/>',
  careful: '<circle cx="12" cy="12" r="9"/><path d="M12 7.5v5.5"/><path d="M12 16.5v.01"/>',
  "circle-slash": '<circle cx="12" cy="12" r="9"/><path d="M5.6 5.6l12.8 12.8"/>',
  mail: '<rect x="3" y="5" width="18" height="14" rx="2"/><path d="M3 7l9 6 9-6"/>',
  chat: '<path d="M4 5h16v11H9l-5 4z"/>',
  mic: '<rect x="9" y="3" width="6" height="11" rx="3"/><path d="M5 11a7 7 0 0 0 14 0"/><path d="M12 18v3"/>',
  whatsapp: '<path d="M12 3a9 9 0 0 0-7.7 13.6L3 21l4.5-1.2A9 9 0 1 0 12 3z"/>',
  messenger: '<path d="M4 4h13v10H9l-5 4z"/><path d="M17 9h3v10l-3-2h-7v-3"/>',
  phone: '<path d="M5 4h4l2 5-2.5 1.5a11 11 0 0 0 5 5L15 13l5 2v4a2 2 0 0 1-2 2A16 16 0 0 1 3 6a2 2 0 0 1 2-2z"/>',
  camera: '<path d="M4 8h3l2-3h6l2 3h3v11H4z"/><circle cx="12" cy="13" r="3.5"/>',
  clipboard: '<rect x="5" y="4" width="14" height="17" rx="2"/><path d="M9 4V2h6v2"/><path d="M8 10h8M8 14h6"/>',
  image: '<rect x="3" y="4" width="18" height="16" rx="2"/><circle cx="8.5" cy="9" r="1.5"/><path d="M21 16l-5-5-9 9"/>',
  home: '<path d="M3 11l9-7 9 7"/><path d="M5 10v10h14V10"/>',
  search: '<circle cx="11" cy="11" r="7"/><path d="M20 20l-3.5-3.5"/>',
  book: '<path d="M3 4.5c3.5 0 6.5.8 9 2.5 2.5-1.7 5.5-2.5 9-2.5v13c-3.5 0-6.5.8-9 2.5-2.5-1.7-5.5-2.5-9-2.5z"/><path d="M12 7v13"/>',
  "chevron-left": '<path d="M15 18l-6-6 6-6"/>',
  "chevron-right": '<path d="M9 6l6 6-6 6"/>',
  "chevron-down": '<path d="M6 9l6 6 6-6"/>',
  "arrow-right": '<path d="M5 12h14"/><path d="M13 6l6 6-6 6"/>',
  person: '<circle cx="12" cy="8" r="4"/><path d="M4 21c1-4 4-6 8-6s7 2 8 6"/>',
  send: '<path d="M22 2L11 13"/><path d="M22 2l-7 20-4-9-9-4z"/>',
  speaker: '<path d="M4 9v6h4l5 4V5L8 9H4z"/><path d="M16.5 8.5a5 5 0 0 1 0 7"/><path d="M19 6a8.5 8.5 0 0 1 0 12"/>',
  trash: '<path d="M4 7h16"/><path d="M9 7V4h6v3"/><path d="M6 7l1 13h10l1-13"/>',
  "sign-out": '<path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><path d="M16 17l5-5-5-5"/><path d="M21 12H9"/>',
  // The lesson star: an outline here; .learn-star-icon (styles.css) fills it white or gold.
  star: '<path d="M12 2.9l2.35 6.76 7.16.15-5.71 4.33 2.08 6.85L12 16.9l-5.88 4.09 2.08-6.85-5.71-4.33 7.16-.15z"/>',
  folder: '<path d="M3 7h6l2 2h10v10H3z"/>',
  bell: '<path d="M6 16V11a6 6 0 0 1 12 0v5l2 2H4z"/><path d="M10 21h4"/>',
  globe: '<circle cx="12" cy="12" r="9"/><path d="M3 12h18"/><path d="M12 3a14 14 0 0 1 0 18"/><path d="M12 3a14 14 0 0 0 0 18"/>',
  list: '<path d="M8 6h13M8 12h13M8 18h13"/><path d="M3 6h.01M3 12h.01M3 18h.01"/>',
  clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
  lock: '<rect x="4" y="11" width="16" height="10" rx="2"/><path d="M8 11V7a4 4 0 0 1 8 0v4"/>',
  // "Stop" on the reading screen (frame 1k): a filled square.
  stop: '<rect x="6" y="6" width="12" height="12" rx="2" fill="currentColor" stroke="none"/>',
};
export const ICON_NAMES = Object.freeze(Object.keys(ICONS));
export function icon(name, size = 24, width = 2) {
  return `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="${width}" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">${ICONS[name] || ""}</svg>`;
}

// The verdict as a pill with its icon and its word (frames 1e and 1f):
// colour is never alone. verdict: "scam", "be_careful" or "safe".
export function verdictPill(verdict) {
  const [cls, ic, key] = verdict === "scam" ? ["is-scam", "circle-slash", "pill_scam"]
    : verdict === "be_careful" ? ["is-careful", "careful", "pill_careful"] : ["is-safe", "check", "pill_safe"];
  return `<span class="pill-verdict ${cls}">${icon(ic, 20, 2.5)}${esc(t(key))}</span>`;
}
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

// Signs the person out and goes back to the welcome page (the last button
// of Settings in the redesign, frame 1q).
export async function signOut() {
  await api("/auth/logout", { method: "POST", body: {} }).catch(() => {});
  location.href = "/";
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
