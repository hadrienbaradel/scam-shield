// Prudence scam database: the hash router, the nav, the header search and
// the helpers every page shares (API calls, escaping, dates, chips, toasts).
// Another interface of heyprudence.com, served at /public/ with no session:
// vanilla ES modules, no build step, nothing imported from the senior app
// (public/js/) or the admin console (public/admin/), so the three never
// couple. Every path in here is relative to /public/ (agent A mounts the
// folder there), except the API under /api/public/.
//
// A view module exports `label` and `async render(root, params, ctx)`:
// `params` are the path segments after the route (#/library/<id> gives
// ["<id>"]), `ctx.query` is the URLSearchParams of the hash
// (#/suspects?q=x gives q), `ctx.stale()` says a newer render started,
// `ctx.onPage()` that the person is still on this page, `ctx.refresh()`
// draws it again. Every value from the server goes through `esc` before it
// lands in HTML; a link inside a scam message is printed as text, never
// made clickable.

import * as library from "./views/library.js";
import * as suspects from "./views/suspects.js";
import * as watch from "./views/watch.js";
import * as submit from "./views/submit.js";
import * as about from "./views/about.js";

export const $ = (s, root = document) => root.querySelector(s);
export const $$ = (s, root = document) => [...root.querySelectorAll(s)];
export const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

// ---- API ----------------------------------------------------------------

export class ApiError extends Error {
  constructor(status, data) {
    super(data?.error || data?.message || (status ? `Request failed (${status})` : "No answer from the server"));
    this.status = status;
    this.data = data;
  }
}

export async function api(path, { method = "GET", body } = {}) {
  let res;
  try {
    res = await fetch(path, {
      method, credentials: "same-origin",
      headers: body !== undefined ? { "content-type": "application/json" } : {},
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
  } catch (e) { throw new ApiError(0, { error: `No answer from the server (${e.message})` }); }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new ApiError(res.status, data);
  return data;
}

// ---- Numbers and dates ----------------------------------------------------

const numFmt = new Intl.NumberFormat("en-US");
export const num = (n) => (n == null || n === "" || Number.isNaN(Number(n)) ? "–" : numFmt.format(Number(n)));
export const plural = (n, one, many = `${one}s`) => `${num(n)} ${Number(n) === 1 ? one : many}`;
export const cap = (s) => (s ? s.charAt(0).toUpperCase() + s.slice(1) : s);

const pad = (n) => String(n).padStart(2, "0");
const dateOf = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

// A date (YYYY-MM-DD) stays as written; a timestamp shows its local date and
// time; the machine time sits in the datetime attribute.
export function timeEl(iso) {
  if (!iso) return "–";
  const s = String(iso);
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return `<time datetime="${esc(s)}">${esc(s)}</time>`;
  const t = Date.parse(s);
  if (Number.isNaN(t)) return esc(s);
  const d = new Date(t);
  return `<time datetime="${esc(d.toISOString())}">${esc(`${dateOf(d)} ${pad(d.getHours())}:${pad(d.getMinutes())}`)}</time>`;
}

// ---- Words for the codes the API uses -------------------------------------

export const CHANNELS = { email: "Email", sms: "Text message", chat: "Chat", voice: "Phone call", web: "Web page", letter: "Letter" };
export const channelWord = (c) => CHANNELS[c] || cap(String(c || "")) || "–";
export const VERDICTS = { scam: ["fail", "Scam"], be_careful: ["warn", "Be careful"], safe: ["ok", "Safe"] };

const regionNames = typeof Intl.DisplayNames === "function" ? new Intl.DisplayNames(["en"], { type: "region" }) : null;
const languageNames = typeof Intl.DisplayNames === "function" ? new Intl.DisplayNames(["en"], { type: "language" }) : null;
const safeName = (names, code) => { try { return names?.of(code) || code; } catch { return code; } };
export const countryWord = (c) => (c ? safeName(regionNames, String(c).toUpperCase()) : "–");
export const languageWord = (l) => (l ? safeName(languageNames, String(l).toLowerCase()) : "–");

// ---- Chips, blocks ----------------------------------------------------------

// tone: family, channel, country, ok, warn, fail, off, info.
export const chip = (tone, word) => `<span class="chip chip-${esc(tone)}">${esc(word)}</span>`;
export const verdictChip = (v) => { const [tone, word] = VERDICTS[v] || ["off", cap(String(v || "no verdict").replace(/_/g, " "))]; return chip(tone, word); };

// Values are HTML already escaped by the caller; keys are plain text.
export const kv = (pairs) => `<dl class="kv">${pairs.map(([k, v]) => `<dt>${esc(k)}</dt><dd>${v == null || v === "" ? "–" : v}</dd>`).join("")}</dl>`;

export function banner(err, { retry = false } = {}) {
  const text = typeof err === "string" ? err : err?.message || "Something went wrong.";
  return `<div class="banner" role="alert"><p>${esc(text)}</p>${retry ? `<button type="button" class="btn btn-ghost" data-retry>Retry</button>` : ""}</div>`;
}

let toastTimer;
export function toast(text, kind = "info") {
  const el = $("#toast");
  el.className = `toast toast-${kind}`;
  el.textContent = text;
  el.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { el.hidden = true; }, 6000);
}

// A busy button stays focusable (aria-disabled, not disabled): a keyboard
// user keeps their place while the request runs. Click handlers check isBusy.
export const isBusy = (b) => b?.getAttribute("aria-disabled") === "true";
export function busy(b, on = true) {
  if (!b) return;
  if (on) b.setAttribute("aria-disabled", "true");
  else b.removeAttribute("aria-disabled");
}

// ---- Routes ------------------------------------------------------------------

export const VIEWS = [
  { path: "", label: "Library", view: library },
  { path: "library", label: "Library", view: library },
  { path: "suspects", label: "Suspects", view: suspects },
  { path: "watch", label: "Watch", view: watch },
  { path: "submit", label: "Submit", view: submit },
  { path: "about", label: "About", view: about },
];

// "#/library?family=bank&page=2" from a path and an object; empty values are dropped.
export function hashFor(path, query = {}) {
  const qs = new URLSearchParams();
  for (const [k, v] of Object.entries(query)) if (v != null && v !== "" && v !== false) qs.set(k, String(v));
  const s = qs.toString();
  return `#/${path}${s ? `?${s}` : ""}`;
}

// Change the page. `replace` keeps the history clean while someone types a
// filter: the address changes, the Back button does not fill up.
export function go(hash, { replace = false } = {}) {
  if (!replace) { location.hash = hash; return; }
  if (location.hash === hash) return;
  history.replaceState(null, "", hash);
  render();
}

let current = null;
let seq = 0;

function parse() {
  const raw = location.hash.replace(/^#\/?/, "");
  const at = raw.indexOf("?");
  const pathPart = at === -1 ? raw : raw.slice(0, at);
  const query = new URLSearchParams(at === -1 ? "" : raw.slice(at + 1));
  const [first, ...rest] = pathPart.split("/");
  const route = VIEWS.find((v) => v.path === first) || VIEWS[0];
  const params = rest.filter(Boolean).map((p) => { try { return decodeURIComponent(p); } catch { return p; } });
  return { route, params, query, key: `${route.path}/${params.join("/")}` };
}

// One line for screen readers after a redraw that keeps the page (a filter,
// a family, a page of results): the live region stays, only its text changes.
export function announce(text) {
  const el = $("#announce");
  el.textContent = "";
  setTimeout(() => { el.textContent = text; }, 50);
}

export function setTitle(text) {
  const h = $("#pageTitle");
  h.textContent = text;
  document.title = `${text} – Prudence scam database`;
}

function markNav() {
  for (const a of $$("#nav a")) {
    if (a.dataset.path === (current.route.path || "library")) a.setAttribute("aria-current", "page");
    else a.removeAttribute("aria-current");
  }
}

const focusKey = () => {
  const a = document.activeElement;
  return a && $("#view").contains(a) ? a.dataset.focus || null : null;
};
// After a redraw the focus goes back to the same control; a text field being
// typed in keeps its caret at the end.
function restoreFocus(key) {
  if (!key) return;
  const el = $(`[data-focus="${CSS.escape(key)}"]`, $("#view"));
  if (!el || el.disabled) return;
  el.focus({ preventScroll: true });
  if (typeof el.setSelectionRange === "function" && /^(text|search|url|tel|email)$/.test(el.type || "")) {
    const n = el.value.length;
    try { el.setSelectionRange(n, n); } catch { /* a type without a caret */ }
  }
}

export async function render({ focus = false } = {}) {
  const { route, params, query, key } = parse();
  const id = ++seq;
  const changed = !current || current.key !== key;
  current = { route, params, key };
  const root = $("#view");
  markNav();
  if (changed) {
    setTitle(route.view.title ? route.view.title(params) : route.label);
    root.innerHTML = `<p class="loading">Loading…</p>`;
    if (focus) $("#pageTitle").focus();
    window.scrollTo(0, 0);
  }
  const keep = focusKey();
  const ctx = {
    query,
    stale: () => id !== seq,
    onPage: () => current?.key === key,
    refresh: () => render(),
  };
  try {
    await route.view.render(root, params, ctx);
    if (ctx.stale()) return;
    restoreFocus(keep);
  } catch (e) {
    if (ctx.stale()) return;
    root.innerHTML = banner(e, { retry: true });
    $("[data-retry]", root)?.addEventListener("click", () => render());
  }
}

// ---- Theme ---------------------------------------------------------------------

// Light and dark follow the system; the button pins one (kept in this
// browser only, and the page works when storage is blocked).
const THEMES = ["auto", "light", "dark"];
const THEME_WORDS = { auto: "Theme: system", light: "Theme: light", dark: "Theme: dark" };
function readTheme() { try { return THEMES.includes(localStorage.getItem("theme")) ? localStorage.getItem("theme") : "auto"; } catch { return "auto"; } }
function applyTheme(theme) {
  if (theme === "auto") delete document.documentElement.dataset.theme;
  else document.documentElement.dataset.theme = theme;
  const b = $("#theme");
  b.textContent = THEME_WORDS[theme];
  b.setAttribute("aria-label", `${THEME_WORDS[theme]}. Change the theme`);
  try { if (theme === "auto") localStorage.removeItem("theme"); else localStorage.setItem("theme", theme); } catch { /* no storage: the choice lasts for this page */ }
}

// ---- Start ---------------------------------------------------------------------

function start() {
  $("#nav").innerHTML = VIEWS.filter((v) => v.path).map((v) => `<a href="#/${v.path}" data-path="${v.path}">${v.label}</a>`).join("");
  $(".skip-link").addEventListener("click", (e) => { e.preventDefault(); $("#main").focus(); });
  $("#search").addEventListener("submit", (e) => {
    e.preventDefault();
    const q = $("#q").value.trim();
    go(hashFor("suspects", { q }));
  });
  let theme = readTheme();
  applyTheme(theme);
  $("#theme").addEventListener("click", () => {
    theme = THEMES[(THEMES.indexOf(theme) + 1) % THEMES.length];
    applyTheme(theme);
  });
  window.addEventListener("hashchange", () => render({ focus: true }));
  render();
}

start();
