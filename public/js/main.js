// App shell: status, language, text size, navigation and live events.

import { api, events } from "./api.js";
import { t, setLang, getLang } from "./i18n.js";
import { $, esc, focusHeading } from "./ui.js";
import { renderMail, onCheck, onAnswer, onSync, loadList } from "./views/mail.js";
import { renderLanding, renderOnboarding, renderCheck, renderPeople, renderSettings, renderGuardian, renderAdmin, renderDemo } from "./views/pages.js";
import { renderToday, onTodayEvent } from "./views/today.js";
import { renderLearn } from "./views/learn.js";

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
  learn: '<svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 4.5c3.5 0 6.5.8 9 2.5 2.5-1.7 5.5-2.5 9-2.5v13c-3.5 0-6.5.8-9 2.5-2.5-1.7-5.5-2.5-9-2.5z"/><path d="M12 7v13"/></svg>',
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
  // The senior's own screens are a phone-width column with a bottom tab bar;
  // the inbox, guardian and admin pages stay wide (testing, family, us).
  const senior = Boolean(u && status.gmail && u.onboarded);
  // Learn is for every signed-in person, between Check and the people.
  const links = !u ? [] : [
    ...(status.gmail ? [["#/today", "v2_tab_today"], ["#/inbox", "nav_inbox"], ["#/check", "nav_check"]] : []),
    ["#/learn", "learn_tab"],
    ...(status.gmail ? [["#/people", "nav_people"]] : []),
    ...(status.isGuardian || !status.gmail ? [["#/guardian", "nav_guardian"]] : []),
    ["#/settings", "nav_settings"],
    ...(u.isAdmin ? [["#/admin", "nav_admin"]] : []),
  ];
  const here = location.hash && location.hash !== "#/" ? location.hash : "#/today";
  // On a phone the bottom tab bar replaces the top links it duplicates.
  const tabbed = ["#/today", "#/inbox", "#/check", "#/people", ...(senior ? ["#/learn"] : [])];
  $("#nav").innerHTML = links.map(([href, key]) => `<a class="nav-link${here.startsWith(href) ? " active" : ""}${tabbed.includes(href) ? " nav-tabbed" : ""}" href="${href}">${t(key)}</a>`).join("")
    + (u ? `<button id="signOut" class="btn btn-light">${t("sign_out")}</button>` : `<button id="langBtn" class="btn btn-light lang-btn" lang="${getLang() === "fr" ? "en" : "fr"}" aria-label="${t("lang_switch")}"><span class="lang-long">${t("lang_switch")}</span><span class="lang-short" aria-hidden="true">${getLang() === "fr" ? "EN" : "FR"}</span></button>`);
  $("#who").textContent = u ? (u.name || u.email) : "";
  const hash = location.hash || "";
  const narrow = /^#\/(today|check|people|settings|learn)?$|^#\/(today|check|people|settings|learn)\b|^#\/demo$|^#\/demo\/learn\b|^$/.test(hash);
  const learn = /^#\/(demo\/)?learn\b/.test(hash);
  document.body.classList.toggle("v2-app", narrow && (senior || hash.startsWith("#/demo") || !u || learn));
  // The demo has its own two tabs (Linda's day and Learn), so the video can
  // show "Linda taps Learn"; the signed-in senior has four.
  const demoTabs = hash === "#/demo" || hash.startsWith("#/demo/learn");
  const tabs = demoTabs ? [["#/demo", "v2_tab_today", "home"], ["#/demo/learn", "learn_tab", "learn"]]
    : senior ? [["#/today", "v2_tab_today", "home"], ["#/check", "v2_tab_check", "search"], ["#/learn", "learn_tab", "learn"], ["#/people", "v2_tab_people", "people"]] : [];
  const current = (href) => (href === "#/demo" ? hash === "#/demo" : here.startsWith(href));
  const bar = $("#tabbar");
  bar.hidden = !tabs.length || !narrow;
  document.body.classList.toggle("has-tabbar", !bar.hidden);
  // A quarter of a phone is narrow: French "Aujourd'hui" may break after its
  // apostrophe (no hyphen) rather than mid-word.
  bar.innerHTML = tabs.map(([href, key, ic]) => `<a href="${href}"${current(href) ? ' aria-current="page"' : ""}>${TAB_ICONS[ic]}<span>${esc(t(key)).replace(/(&#39;|’)/g, "$1<wbr>")}</span></a>`).join("");
  measureTabbar();
  $("#signOut")?.addEventListener("click", async () => { await api("/auth/logout", { method: "POST", body: {} }); location.href = "/"; });
  $("#langBtn")?.addEventListener("click", () => {
    try { localStorage.setItem("ss_lang", getLang() === "fr" ? "en" : "fr"); } catch { /* private mode */ }
    refresh();
  });
}

// The answer bar sits on the tab bar, whose height is measured: at the larger
// text sizes a label wraps to two lines and the bar grows past 72 px. Kept in
// --tabbar-h next to --dock-h on <body>; re-measured whenever the bar resizes
// (text size, the font arriving, a phone turned sideways).
function measureTabbar() {
  const bar = $("#tabbar");
  document.body.style.setProperty("--tabbar-h", `${bar.hidden ? 0 : bar.offsetHeight}px`);
}
if ("ResizeObserver" in window) new ResizeObserver(measureTabbar).observe($("#tabbar"), { box: "border-box" });

async function route() {
  await draw();
  if (!location.hash.startsWith("#/inbox") && !location.hash.startsWith("#/folder")) focusHeading(view());
}

async function draw() {
  document.body.classList.remove("v2-docked"); // the answer bar belongs to a card only
  const hash = location.hash || "#/";
  const root = view();
  const u = status.user;
  try {
    if (hash.startsWith("#/demo/all")) return await renderDemo(root, status);
    if (hash.startsWith("#/demo/learn")) return await renderLearn(root, status, { demo: true });
    if (hash.startsWith("#/demo")) return await renderToday(root, status, { demo: true });
    if (!u) return renderLanding(root, status);
    if (status.gmail && !u.onboarded) return await renderOnboarding(root, status, refresh);
    if (hash.startsWith("#/learn")) return await renderLearn(root, status);
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
