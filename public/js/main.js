// App shell: status, language, text size, navigation and live events.

import { api, events } from "./api.js";
import { t, setLang, getLang } from "./i18n.js";
import { $, esc } from "./ui.js";
import { renderMail, onCheck, onAnswer, onSync } from "./views/mail.js";
import { renderLanding, renderOnboarding, renderCheck, renderPeople, renderSettings, renderGuardian, renderAdmin, renderDemo } from "./views/pages.js";

let status = null;
let stream = null;
const view = () => $("#view");

function applyPrefs() {
  const saved = (() => { try { return localStorage.getItem("ss_lang"); } catch { return null; } })();
  setLang(status?.user ? (status.user.locale.startsWith("fr") ? "fr" : "en") : saved || (navigator.language.startsWith("fr") ? "fr" : "en"));
  document.documentElement.style.fontSize = `${Math.round(19 * (status?.user?.textScale || 1))}px`;
  document.title = `Scam Shield — ${t("landing_title")}`;
}

function renderChrome() {
  const u = status.user;
  $("#tagline").textContent = t("tagline");
  $("#footerText").textContent = t("footer");
  $("#privacyLink").textContent = t("privacy");
  $("#termsLink").textContent = t("terms");
  const links = !u ? [] : [
    ...(status.gmail ? [["#/inbox", "nav_inbox"], ["#/check", "nav_check"], ["#/people", "nav_people"]] : []),
    ...(status.isGuardian || !status.gmail ? [["#/guardian", "nav_guardian"]] : []),
    ["#/settings", "nav_settings"],
    ...(u.isAdmin ? [["#/admin", "nav_admin"]] : []),
  ];
  $("#nav").innerHTML = links.map(([href, key]) => `<a class="nav-link${location.hash.startsWith(href) ? " active" : ""}" href="${href}">${t(key)}</a>`).join("")
    + (u ? `<button id="signOut" class="btn btn-light">${t("sign_out")}</button>` : `<button id="langBtn" class="btn btn-light">${t("lang_switch")}</button>`);
  $("#who").textContent = u ? (u.name || u.email) : "";
  $("#signOut")?.addEventListener("click", async () => { await api("/auth/logout", { method: "POST", body: {} }); location.href = "/"; });
  $("#langBtn")?.addEventListener("click", () => {
    try { localStorage.setItem("ss_lang", getLang() === "fr" ? "en" : "fr"); } catch { /* private mode */ }
    refresh();
  });
}

async function route() {
  const hash = location.hash || "#/";
  const root = view();
  const u = status.user;
  try {
    if (hash.startsWith("#/demo")) return await renderDemo(root, status);
    if (!u) return renderLanding(root, status);
    if (status.gmail && !u.onboarded) return await renderOnboarding(root, status, refresh);
    if (hash.startsWith("#/folder/scam")) return await renderMail(root, status, "scam");
    if (hash.startsWith("#/folder/careful")) return await renderMail(root, status, "careful");
    if (hash.startsWith("#/check")) return renderCheck(root, status);
    if (hash.startsWith("#/people")) return await renderPeople(root);
    if (hash.startsWith("#/settings")) return await renderSettings(root, status, refresh);
    if (hash.startsWith("#/admin") && u.isAdmin) return await renderAdmin(root);
    if (hash.startsWith("#/guardian") || !status.gmail) return await renderGuardian(root);
    return await renderMail(root, status, "inbox");
  } catch (e) {
    root.innerHTML = `<p class="banner danger">${esc(e.status === 401 ? "" : t("error_generic"))}</p>`;
    if (e.status === 401) location.href = "/";
  }
}

async function refresh(reroute = true) {
  status = await api("/api/status");
  applyPrefs();
  renderChrome();
  if (status.user && !stream) {
    stream = events({
      check: onCheck,
      answer: onAnswer,
      sync: async () => { status = await api("/api/status"); onSync(status); },
      context: () => {},
      alert: () => { if (location.hash.startsWith("#/guardian")) route(); },
      guardian: () => { if (location.hash.startsWith("#/people")) route(); },
    });
  }
  if (reroute) await route();
}

window.addEventListener("hashchange", () => { renderChrome(); route(); });
refresh();
