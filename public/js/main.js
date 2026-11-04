// App shell: status, language, text size, the header and the tab bar, the
// routes and live events.

import { api, events } from "./api.js";
import { t, setLang, getLang } from "./i18n.js";
import { $, esc, focusHeading, icon, signOut } from "./ui.js";
import { TABS, screenFor } from "./protects.js";
import { renderMail, renderMessages, renderBlocked, onCheck, onAnswer, onSync, loadList } from "./views/mail.js";
import { renderOnboarding, renderGuardian, renderAdmin, renderDemo } from "./views/pages.js";
import { showLanding, hideLanding, landingAnchor } from "../landing/landing.js";
import { renderCheckScreen } from "./views/check.js";
import { renderToday, onTodayEvent } from "./views/today.js";
import { renderSettings as renderSettingsScreen, renderPeopleScreen, renderPhoneScreen, renderKnows, renderDid, renderDelete } from "./views/settings.js";
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
let stream = null;
const view = () => $("#view");

function applyPrefs() {
  const saved = (() => { try { return localStorage.getItem("ss_lang"); } catch { return null; } })();
  setLang(status?.user ? (status.user.locale.startsWith("fr") ? "fr" : "en") : saved || (navigator.language.startsWith("fr") ? "fr" : "en"));
  // Text sizes (styles.css, "Text sizes"): the body scales with the root font
  // size, 19 px x 1, 1.2 or 1.4 (rem; the canvas's --s); the header and the tab
  // bar grow half as much, --u = 1, 1.1 or 1.2, so they never wrap at Largest.
  const scale = Number(status?.user?.textScale) || 1;
  document.documentElement.style.fontSize = `${Math.round(19 * scale)}px`;
  document.body.style.setProperty("--s", String(scale));
  document.body.style.setProperty("--u", String(Math.round(Math.min(1.3, 1 + (scale - 1) / 2) * 100) / 100));
  document.title = `Prudence — ${t("landing_title")}`;
}

/*
 * The chrome every screen relies on (2026-11-04 redesign:
 * _product/specs/protection-menu.md, Screens; PrudenceHeader and
 * PrudenceTabs in _product/design/2026-11-04-redesign/claude-design/).
 *
 * Header, by audience:
 * - the signed-in senior (Gmail connected, welcome done): the brand and ONE
 *   button, "Settings" with the gear, gold with navy text and aria-current
 *   on #/settings* and #/people. On a computer (wider than 700 px, where the
 *   tab bar is hidden) the four tabs are top links before it.
 * - signed out, and the demo: the brand, the tagline, the language button.
 * - the welcome (first sign-in): the brand and Sign out.
 * - a trusted person without a mailbox, and everyone on #/guardian or
 *   #/admin: plain links (Today for a senior, Learn, People I protect,
 *   Settings, Scam reports for admins), the name, Sign out.
 *
 * Routes (draw(); the table is SCREENS in protects.js), the name put in
 * root.dataset.view while the screen is drawn, and the tab it lights:
 *   "", #/, #/today            "today"            Today
 *   #/messages                 "messages"         Today (My messages)
 *   #/check                    "check"            Check
 *   #/check/paste              "check-paste"      Check
 *   #/check/photo              "check-photo"      Check
 *   #/check/voice              "check-voice"      Check
 *   #/check/more               "check-more"       Check
 *   #/learn, #/learn/<lesson>  "learn"            Learn
 *   #/blocked                  "blocked"          Blocked
 *   #/settings                 "settings"         none: the Settings button is gold
 *   #/settings/people          "settings-people"  none
 *   #/settings/phone           "settings-phone"   none
 *   #/settings/knows           "settings-knows"   none
 *   #/settings/did             "settings-did"     none
 *   #/settings/delete          "settings-delete"  none
 *   #/people (old address)     "settings-people"  none
 * Wide pages without the tab bar: #/inbox, #/folder/scam, #/folder/careful
 * ("mail"), #/guardian ("guardian"), #/admin ("admin"), #/demo/all
 * ("demo-all"). The demo keeps its own two tabs: #/demo ("today") and
 * #/demo/learn ("learn"). Signed out: "landing", the landing page in
 * index.html (#landing, landing/landing.js) instead of #view, for any address
 * but the demo's; first sign-in: "onboarding".
 * Today, My messages and Blocked need a mailbox; without one the guardian
 * page is drawn instead.
 *
 * Every SCREENS route is a phone-width column, body.v2-app (max 560 px on a
 * computer). body.has-tabbar is on while the tab bar shows; the bar's
 * measured height is --tabbar-h on <body>, for anything docked above it.
 * To give a screen its new view, change only its line in DRAW below and add
 * one import line for the view (leave the shared pages.js import as it is, so
 * two builders never edit the same line); the header and the tab bar need
 * nothing from a view.
 */
function renderChrome() {
  const u = status.user;
  const hash = location.hash || "";
  const screen = screenFor(hash);
  $("#skipLink").textContent = t("skip");
  $("#footerText").textContent = t("footer");
  $("#privacyLink").textContent = t("privacy");
  $("#termsLink").textContent = t("terms");
  const senior = Boolean(u && status.gmail && u.onboarded);
  const welcome = Boolean(u && status.gmail && !u.onboarded);
  // The guardian and admin pages keep their plain links, for a senior too.
  const seniorChrome = senior && !/^#\/(guardian|admin)\b/.test(hash);
  const tagline = $("#tagline");
  tagline.textContent = t("tagline");
  tagline.hidden = seniorChrome || welcome;
  $("#who").textContent = u && !seniorChrome && !welcome ? (u.name || u.email) : "";
  const nav = $("#nav");
  nav.setAttribute("aria-label", t("nav_top_label"));
  const signOutBtn = `<button id="signOut" class="btn btn-light top-signout" type="button">${esc(t("sign_out"))}</button>`;
  if (!u) {
    nav.innerHTML = `<button id="langBtn" class="btn btn-light lang-btn" type="button" lang="${getLang() === "fr" ? "en" : "fr"}" aria-label="${esc(t("lang_switch"))}"><span class="lang-long">${esc(t("lang_switch"))}</span><span class="lang-short" aria-hidden="true">${getLang() === "fr" ? "EN" : "FR"}</span></button>`;
  } else if (seniorChrome) {
    const onSettings = Boolean(screen && screen.view.startsWith("settings"));
    // On a phone these links are hidden (styles.css .nav-tabbed): the tab bar does their job.
    const links = [
      ...TABS.map((tab) => [tab.href, tab.label, screen?.tab === tab.key]),
      ...(status.isGuardian ? [["#/guardian", "nav_guardian", false]] : []),
      ...(u.isAdmin ? [["#/admin", "nav_admin", false]] : []),
    ];
    nav.innerHTML = links.map(([href, key, on]) => `<a class="nav-link nav-tabbed${on ? " active" : ""}" href="${href}"${on ? ' aria-current="page"' : ""}>${esc(t(key))}</a>`).join("")
      + `<a class="top-settings${onSettings ? " is-active" : ""}" href="#/settings"${onSettings ? ' aria-current="page"' : ""}>${icon("gear", 28)}<span>${esc(t("nav_settings"))}</span></a>`;
  } else if (welcome) {
    nav.innerHTML = signOutBtn;
  } else {
    const here = hash && hash !== "#/" ? hash : status.gmail ? "#/today" : "#/guardian";
    const links = [
      ...(senior ? [["#/today", "v2_tab_today"]] : []),
      ["#/learn", "learn_tab"],
      ...(status.isGuardian || !status.gmail ? [["#/guardian", "nav_guardian"]] : []),
      ["#/settings", "nav_settings"],
      ...(u.isAdmin ? [["#/admin", "nav_admin"]] : []),
    ];
    nav.innerHTML = links.map(([href, key]) => `<a class="nav-link${here.startsWith(href) ? " active" : ""}" href="${href}"${here.startsWith(href) ? ' aria-current="page"' : ""}>${esc(t(key))}</a>`).join("") + signOutBtn;
  }
  // The senior's screens are a phone-width column with a bottom tab bar; the
  // inbox, guardian and admin pages stay wide (testing, family, us).
  const demoColumn = hash === "#/demo" || hash.startsWith("#/demo/learn");
  const narrow = Boolean(screen) || demoColumn;
  document.body.classList.toggle("v2-app", narrow && (senior || demoColumn || !u || screen?.view === "learn"));
  // The demo has its own two tabs (Linda's day and Learn), so the video can
  // show "Linda taps Learn"; the signed-in senior has four.
  const tabs = demoColumn ? [["#/demo", "v2_tab_today", "home", hash === "#/demo"], ["#/demo/learn", "learn_tab", "book", hash.startsWith("#/demo/learn")]]
    : senior ? TABS.map((tab) => [tab.href, tab.label, tab.icon, screen?.tab === tab.key]) : [];
  const bar = $("#tabbar");
  bar.hidden = !tabs.length || !narrow;
  bar.setAttribute("aria-label", t("nav_tabs_label"));
  document.body.classList.toggle("has-tabbar", !bar.hidden);
  bar.innerHTML = tabs.map(([href, key, ic, on]) => `<a href="${href}"${on ? ' aria-current="page"' : ""}>${icon(ic, 28)}<span>${esc(t(key))}</span></a>`).join("");
  fitHeader();
  fitTabbar();
  measureTabbar();
  $("#signOut")?.addEventListener("click", signOut);
  $("#langBtn")?.addEventListener("click", () => {
    try { localStorage.setItem("ss_lang", getLang() === "fr" ? "en" : "fr"); } catch { /* private mode */ }
    refresh();
  });
}

// Each tab is as wide as its word, on one line (styles.css .tabbar). Where
// the four words cannot fit at this text size and width (French at Largest
// on a narrow phone), the labels first drop to the Normal size (is-tight),
// then may break (is-wrap): a label is never cut or spills onto the next tab.
function fitTabbar() {
  const bar = $("#tabbar");
  bar.classList.remove("is-tight", "is-wrap");
  if (bar.hidden || !bar.offsetWidth) return;
  const spills = () => [...bar.children].some((a) => a.scrollWidth > a.clientWidth + 1);
  if (spills()) bar.classList.add("is-tight");
  if (spills()) bar.classList.add("is-wrap");
}
// The phone header keeps the brand and the Settings button on one line
// (frame 1c). Where both cannot fit (French at Largest, a narrow phone), the
// two labels drop to their Normal size (is-tight), then the word "Prudence"
// leaves the bar and the gold check stays (is-tighter; screen readers still
// hear the name).
function fitHeader() {
  const bar = $(".topbar");
  bar.classList.remove("is-tight", "is-tighter");
  if (!document.body.classList.contains("v2-app") || !bar.offsetWidth) return;
  const brand = $(".brand", bar);
  const actions = $(".top-actions", bar);
  const spills = () => {
    const cs = getComputedStyle(bar);
    const room = bar.clientWidth - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight) - (parseFloat(cs.columnGap) || 0);
    return brand.scrollWidth + actions.scrollWidth > room + 0.5;
  };
  if (spills()) bar.classList.add("is-tight");
  if (spills()) bar.classList.add("is-tighter");
}
const refit = () => { fitHeader(); fitTabbar(); measureTabbar(); };
window.addEventListener("resize", refit);
document.fonts?.ready.then(refit);
document.fonts?.addEventListener?.("loadingdone", refit);

// The answer bar sits on the tab bar, whose height is measured: 80 px, more
// when a label has to wrap (fitTabbar) or with the phone's home bar. Kept in
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

// How each screen of the senior column is drawn, by its root.dataset.view
// name (SCREENS in protects.js). One line per screen: a screen's builder
// changes only its own line, and adds the import of its view at the top.
const DRAW = {
  today: (root) => renderToday(root, status),
  messages: (root) => renderMessages(root, status),
  blocked: (root) => renderBlocked(root, status),
  check: (root) => renderCheckScreen(root, status, { step: "choices" }),
  "check-paste": (root) => renderCheckScreen(root, status, { step: "paste" }),
  "check-photo": (root) => renderCheckScreen(root, status, { step: "photo" }),
  "check-voice": (root) => renderCheckScreen(root, status, { step: "voice" }),
  "check-more": (root) => renderCheckScreen(root, status, { step: "more" }),
  learn: (root) => renderLearn(root, status),
  settings: (root) => renderSettingsScreen(root, status, refresh),
  "settings-people": (root) => renderPeopleScreen(root, status),
  "settings-phone": (root) => renderPhoneScreen(root, status),
  "settings-knows": (root) => renderKnows(root, status),
  "settings-did": (root) => renderDid(root, status),
  "settings-delete": (root) => renderDelete(root, status),
};

async function draw() {
  document.body.classList.remove("v2-docked"); // the answer bar belongs to a card only
  const hash = location.hash || "#/";
  const root = view();
  const u = status.user;
  // The screen being drawn, kept on the root: a late answer meant for another
  // screen sees it and is dropped (today.js, learn.js).
  const as = (name) => { root.dataset.view = name; return root; };
  // Signed out, anywhere but the demo: the landing page, never an app screen.
  // Otherwise the app, and a signed-in person's landing leaves the page.
  if (!u && !hash.startsWith("#/demo")) { as("landing"); return showLanding(status); }
  hideLanding(Boolean(u));
  try {
    if (hash.startsWith("#/demo/all")) return await renderDemo(as("demo-all"), status);
    if (hash.startsWith("#/demo/learn")) return await renderLearn(as("learn"), status, { demo: true });
    if (hash.startsWith("#/demo")) return await renderToday(as("today"), status, { demo: true });
    if (status.gmail && !u.onboarded) return await renderOnboarding(as("onboarding"), status, refresh);
    if (hash.startsWith("#/admin") && u.isAdmin) return await renderAdmin(as("admin"));
    const screen = screenFor(hash);
    // Check, Learn and Settings work without a mailbox; Today, My messages and Blocked do not.
    if (screen && !screen.mail) return await DRAW[screen.view](as(screen.view));
    if (hash.startsWith("#/guardian") || !status.gmail) return await renderGuardian(as("guardian"));
    if (screen) return await DRAW[screen.view](as(screen.view));
    if (hash.startsWith("#/folder/scam")) return await renderMail(as("mail"), status, "scam");
    if (hash.startsWith("#/folder/careful")) return await renderMail(as("mail"), status, "careful");
    if (hash.startsWith("#/inbox")) return await renderMail(as("mail"), status, "inbox");
    return await renderToday(as("today"), status);
  } catch (e) {
    root.innerHTML = `<p class="banner danger">${esc(e.status === 401 ? "" : t("error_generic"))}</p>`;
    if (e.status === 401) location.href = "/";
  }
}

async function refresh(reroute = true) {
  status = await api("/api/status");
  applyPrefs();
  renderChrome();
  // The session ended with the page open: no live events for no one.
  if (!status.user && stream) { stream.close(); stream = null; }
  if (status.user && !stream) {
    stream = events({
      check: () => refreshLists(),
      answer: onAnswer,
      sync: async () => { status = await api("/api/status"); onSync(status); if (status.gmail?.ready) refreshLists(); },
      context: () => {},
      alert: () => { if (location.hash.startsWith("#/guardian")) route(); },
      guardian: () => { if (screenFor(location.hash)?.view === "settings-people") route(); },
    }, async () => {
      status = await api("/api/status");
      onSync(status);
      loadList(true);
      if (location.hash.startsWith("#/guardian")) route();
    });
  }
  if (reroute) await route();
}

// Before the first status has arrived, start() draws the page itself. A
// place on the landing (#early-access) is no route: the browser scrolls to it.
window.addEventListener("hashchange", () => { if (!status || landingAnchor()) return; renderChrome(); route(); });

// Startup must never leave a blank page: say what happened and offer a retry.
async function start() {
  try { await refresh(); } catch {
    // The landing reads without the server: a visitor keeps it.
    if ($("#landing") && !document.documentElement.classList.contains("in-app")) return;
    $("#view").hidden = false;
    $("#view").innerHTML = `<section class="card narrow"><p class="banner danger">${esc(t("load_failed"))}</p><button id="retryStart" class="btn btn-navy btn-big">${esc(t("retry"))}</button></section>`;
    $("#retryStart").addEventListener("click", start);
  }
}
start();
