// The landing page's few behaviors (_product/specs/landing-page.md). The page
// itself is plain HTML in public/index.html (#landing, an English and a
// French block); js/main.js decides, from /api/status and the address, whether
// it or the app shows, and calls:
//
//   showLanding(status)  no one signed in and no #/demo route: the landing
//                        shows, in the app's language (getLang()); the first
//                        call wires the language buttons, the sign-in notes,
//                        the library count and the two forms.
//   hideLanding(signedIn) the app shows; a signed-in person's landing is
//                        removed from the page, a visitor's stays for the Back
//                        button (#/demo, then back to /).
//   landingAnchor()      true while the landing shows and the address is a
//                        place on it (#early-access), not a route (#/...):
//                        the router leaves those to the browser.
//
// The classes it keeps on <html> (js, in-app, l-fr) are the ones
// landing/hint.js set before the first paint; landing/landing.css reads them.

import { api } from "../js/api.js";
import { STRINGS, setLang, getLang, t } from "../js/i18n.js";

const html = document.documentElement;
const root = () => document.getElementById("landing");
const view = () => document.getElementById("view");
const isRoute = () => location.hash.startsWith("#/");
const SIGNIN_MESSAGES = { need_gmail: "signin_need_gmail", cancelled: "signin_cancelled", error: "signin_error", expired: "signin_expired" };
let wired = false;

export const landingAnchor = () => Boolean(root()) && !html.classList.contains("in-app") && !isRoute();

export function hideLanding(signedIn) {
  html.classList.add("in-app");
  view().hidden = false;
  if (signedIn) root()?.remove();
}

export function showLanding(status) {
  const el = root();
  if (!el) return;
  html.classList.remove("in-app");
  view().hidden = true;
  // No one is signed in: a hint left from an ended session would hide the
  // landing at the next visit for nothing.
  if (/(?:^|;\s*)prudence_in=/.test(document.cookie)) document.cookie = "prudence_in=; Max-Age=0; path=/; SameSite=Lax";
  showLanguage(getLang());
  if (!wired) { wired = true; wire(el, status); }
}

function showLanguage(l) {
  html.classList.toggle("l-fr", l === "fr");
  for (const b of root().querySelectorAll(".l-lang")) b.hidden = b.dataset.lang !== l;
}

const blocks = (el) => [...el.querySelectorAll(".l-lang")].map((b) => [b, STRINGS[b.dataset.lang === "fr" ? "fr" : "en"]]);

function wire(el, status) {
  // The header button and the footer pair switch the language the app keeps
  // (ss_lang, as the app's own button); focus stays on the same control.
  el.addEventListener("click", (e) => {
    const b = e.target.closest("[data-to]");
    if (!b) return;
    const l = b.dataset.to === "fr" ? "fr" : "en";
    try { localStorage.setItem("ss_lang", l); } catch { /* private mode */ }
    setLang(l);
    document.title = `Prudence — ${t("landing_title")}`;
    showLanguage(l);
    const block = el.querySelector(`.l-lang[data-lang="${l}"]`);
    (b.classList.contains("l-lang-btn") ? block.querySelector(".l-lang-btn") : block.querySelector(`.l-lang-pick[data-to="${l}"]`))?.focus();
  });

  // Back from Google without a session (/?signin=...), or an invitation that
  // no longer works (/?invite=...): one line at the top, in both blocks.
  const params = new URLSearchParams(location.search);
  const key = params.get("signin") ? SIGNIN_MESSAGES[params.get("signin")] || "signin_error" : params.get("invite") ? "invite_expired" : null;
  if (key) for (const [b, s] of blocks(el)) { const p = b.querySelector(".l-banner"); p.textContent = s[key]; p.hidden = false; }

  // Google sign-in not set up on this server: say so next to the one sign-in
  // link (on a developer's computer it opens the local sign-in instead).
  if (!status?.googleConfigured) {
    api("/auth/config").then((cfg) => {
      for (const [b, s] of blocks(el)) {
        const note = b.querySelector(".l-signin-note");
        note.textContent = s[cfg?.devSignin ? "local_signin_note" : "not_configured"];
        note.hidden = false;
        if (!cfg?.devSignin) { const a = b.querySelector(".l-signin-link"); a.removeAttribute("href"); a.setAttribute("aria-disabled", "true"); }
      }
    }).catch(() => {});
  }

  // The library's size, live (the HTML carries the count of the day it was written).
  api("/api/public/about").then(({ counts }) => {
    if (counts?.entries) for (const n of el.querySelectorAll(".l-lib-count")) n.textContent = String(counts.entries);
    if (counts?.families) for (const n of el.querySelectorAll(".l-lib-families")) n.textContent = String(counts.families);
  }).catch(() => {});

  // The lookup box opens the public database's lookup with the text typed.
  for (const f of el.querySelectorAll(".l-look")) {
    f.addEventListener("submit", (e) => {
      e.preventDefault();
      const q = f.elements.q.value.trim();
      location.href = q ? `/public/#/suspects?q=${encodeURIComponent(q)}` : "/public/#/suspects";
    });
  }

  for (const f of el.querySelectorAll(".l-form")) wireRequest(f);
}

// The early-access request (POST /api/early-access): the thank-you in place
// of the form, or the server's one plain line next to the field it names.
function wireRequest(f) {
  const thanks = f.closest(".l-ea-box").querySelector(".l-thanks");
  const email = f.elements.email;
  const clear = () => {
    for (const p of f.querySelectorAll(".l-err")) { p.hidden = true; p.textContent = ""; }
    email.removeAttribute("aria-invalid");
  };
  f.addEventListener("submit", async (e) => {
    e.preventDefault();
    clear();
    const send = f.querySelector(".l-send");
    send.disabled = true;
    try {
      const out = await api("/api/early-access", { method: "POST", body: Object.fromEntries(new FormData(f)) });
      thanks.querySelector(".l-sent").textContent = out.email;
      f.hidden = true;
      thanks.hidden = false;
      thanks.setAttribute("tabindex", "-1");
      thanks.focus();
    } catch (err) {
      const field = err?.status === 400 ? err.data?.field : null;
      const slot = (field && f.querySelector(`.l-err[data-field="${field}"]`)) || f.querySelector(".l-err-form");
      slot.textContent = err?.status === 400 && err.data?.error ? err.data.error : f.dataset.failed;
      slot.hidden = false;
      if (field === "email") { email.setAttribute("aria-invalid", "true"); email.focus(); }
    } finally {
      send.disabled = false;
    }
  });
  thanks.querySelector(".l-again").addEventListener("click", () => {
    f.reset();
    clear();
    thanks.hidden = true;
    f.hidden = false;
    email.focus();
  });
}
