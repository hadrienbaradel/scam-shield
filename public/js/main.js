// App shell: status, language, text size, navigation and live events.

import { api, events } from "./api.js";
import { t, setLang, getLang } from "./i18n.js";
import { $, esc, focusHeading } from "./ui.js";
import { renderMail, onCheck, onAnswer, onSync, loadList } from "./views/mail.js";
import { renderLanding, renderOnboarding, renderCheck, renderPeople, renderSettings, renderGuardian, renderAdmin, renderDemo } from "./views/pages.js";
import { renderToday, onTodayEvent } from "./views/today.js";

let status = null;
// Live events can arrive many times a second (the first pass checks 50
// emails in a row): refresh the lists at most once every 15 s, and not at
// all until the first pass is done (the "sync" event refreshes then).
function throttle(fn, ms) {
  let last = 0; let timer = null;
  return () => {
    const wait = last + ms - Date.now();
    if (wait <= 0) { last = Date.now(); fn(); return; }
    if (!timer) timer = setTimeout(() => { timer = null; last = Date.now(); fn(); }, wait);
  };
}
const refreshLists = throttle(() => {
  if (status?.gmail && !status.gmail.ready) return;
  onCheck();
  onTodayEvent();
}, 15000);
const TAB_ICONS = {
  home: '<svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 11l9-7 9 7"/><path d="M5 10v10h14V10"/></svg>',
  search: '<svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="11" cy="11" r="7"/><path d="M20 20l-3.5-3.5"/></svg>',
  people: '<svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="9" cy="8" r="3.5"/><path d="M2.5 20c.8-3.5 3.4-5.5 6.5-5.5s5.7 2 6.5 5.5"/><circle cx="17.5" cy="9" r="2.5"/><path d="M17 14.5c2.3.2 4 1.8 4.5 4.5"/></svg>',
};
let stream = null;
const view = () => $("#view");

function applyPrefs() {
  const saved = (() => { try { return localStorage.getItem("ss_lang"); } catch { return null; } })();
  setLang(status?.user ? (status.user.locale.startsWith("fr") ? "fr" : "en") : saved || (navigator.language.startsWith("fr") ? "fr" : "en"));
  document.documentElement.style.fontSize = `${Math.round(19 * (status?.user?.textScale || 1))}px`;
  document.title = `Prudence — ${t("landing_title")}`;
}

function renderChrome() {
  const u = status.user;
  $("#tagline").textContent = t("tagline");
  $("#skipLink").textContent = t("skip");
  $("#footerText").textContent = t("footer");
  $("#privacyLink").textContent = t("privacy");
  $("#termsLink").textContent = t("terms");
  const links = !u ? [] : [
    ...(status.gmail ? [["#/today", "v2_tab_today"], ["#/inbox", "nav_inbox"], ["#/check", "nav_check"], ["#/people", "nav_people"]] : []),
    ...(status.isGuardian || !status.gmail ? [["#/guardian", "nav_guardian"]] : []),
    ["#/settings", "nav_settings"],
    ...(u.isAdmin ? [["#/admin", "nav_admin"]] : []),
  ];
  const here = location.hash && location.hash !== "#/" ? location.hash : "#/today";
  // On a phone the bottom tab bar replaces the top links it duplicates.
  const tabbed = ["#/today", "#/inbox", "#/check", "#/people"];
  $("#nav").innerHTML = links.map(([href, key]) => `<a class="nav-link${here.startsWith(href) ? " active" : ""}${tabbed.includes(href) ? " nav-tabbed" : ""}" href="${href}">${t(key)}</a>`).join("")
    + (u ? `<button id="signOut" class="btn btn-light">${t("sign_out")}</button>` : `<button id="langBtn" class="btn btn-light">${t("lang_switch")}</button>`);
  $("#who").textContent = u ? (u.name || u.email) : "";
  // The senior's own screens are a phone-width column with a bottom tab bar;
  // the inbox, guardian and admin pages stay wide (testing, family, us).
  const senior = Boolean(u && status.gmail && u.onboarded);
  const narrow = /^#\/(today|check|people|settings)?$|^#\/(today|check|people|settings)\b|^#\/demo$|^$/.test(location.hash || "");
  document.body.classList.toggle("v2-app", narrow && (senior || location.hash.startsWith("#/demo") || !u));
  const bar = $("#tabbar");
  bar.hidden = !senior || !narrow;
  document.body.classList.toggle("has-tabbar", !bar.hidden);
  bar.innerHTML = senior ? [["#/today", "v2_tab_today", "home"], ["#/check", "v2_tab_check", "search"], ["#/people", "v2_tab_people", "people"]]
    .map(([href, key, ic]) => `<a href="${href}"${here.startsWith(href) ? ' aria-current="page"' : ""}>${TAB_ICONS[ic]}<span>${t(key)}</span></a>`).join("") : "";
  $("#signOut")?.addEventListener("click", async () => { await api("/auth/logout", { method: "POST", body: {} }); location.href = "/"; });
  $("#langBtn")?.addEventListener("click", () => {
    try { localStorage.setItem("ss_lang", getLang() === "fr" ? "en" : "fr"); } catch { /* private mode */ }
    refresh();
  });
}

async function route() {
  await draw();
  if (!location.hash.startsWith("#/inbox") && !location.hash.startsWith("#/folder")) focusHeading(view());
}

async function draw() {
  const hash = location.hash || "#/";
  const root = view();
  const u = status.user;
  try {
    if (hash.startsWith("#/demo/all")) return await renderDemo(root, status);
    if (hash.startsWith("#/demo")) return await renderToday(root, status, { demo: true });
    if (!u) return renderLanding(root, status);
    if (status.gmail && !u.onboarded) return await renderOnboarding(root, status, refresh);
    if (hash.startsWith("#/folder/scam")) return await renderMail(root, status, "scam");
    if (hash.startsWith("#/folder/careful")) return await renderMail(root, status, "careful");
    if (hash.startsWith("#/check")) return renderCheck(root, status);
    if (hash.startsWith("#/people")) return await renderPeople(root);
    if (hash.startsWith("#/settings")) return await renderSettings(root, status, refresh);
    if (hash.startsWith("#/admin") && u.isAdmin) return await renderAdmin(root);
    if (hash.startsWith("#/guardian") || !status.gmail) return await renderGuardian(root);
    if (hash.startsWith("#/inbox")) return await renderMail(root, status, "inbox");
    return await renderToday(root, status);
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
      check: () => refreshLists(),
      answer: onAnswer,
      sync: async () => { status = await api("/api/status"); onSync(status); if (status.gmail?.ready) refreshLists(); },
      context: () => {},
      alert: () => { if (location.hash.startsWith("#/guardian")) route(); },
      guardian: () => { if (location.hash.startsWith("#/people")) route(); },
    }, async () => {
      status = await api("/api/status");
      onSync(status);
      loadList(true);
      if (location.hash.startsWith("#/guardian")) route();
    });
  }
  if (reroute) await route();
}

window.addEventListener("hashchange", () => { renderChrome(); route(); });

// Startup must never leave a blank page: say what happened and offer a retry.
async function start() {
  try { await refresh(); } catch {
    $("#view").innerHTML = `<section class="card narrow"><p class="banner danger">${esc(t("load_failed"))}</p><button id="retryStart" class="btn btn-navy btn-big">${esc(t("retry"))}</button></section>`;
    $("#retryStart").addEventListener("click", start);
  }
}
start();
