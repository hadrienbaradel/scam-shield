// Prudence admin console: the hash router, the nav, auto-refresh and the
// helpers every page shares (API calls, escaping, times, chips, toasts).
// Vanilla ES modules, no build step, nothing imported from the senior app
// (public/js/) so the two interfaces never couple.

import * as overview from "./views/overview.js";
import * as jobs from "./views/jobs.js";
import * as users from "./views/users.js";
import * as cards from "./views/cards.js";
import * as outbox from "./views/outbox.js";

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

// ---- Numbers and times ----------------------------------------------------

const numFmt = new Intl.NumberFormat("en-US");
export const num = (n) => (n == null || n === "" || Number.isNaN(Number(n)) ? "–" : numFmt.format(Number(n)));
export const mb = (n) => (n == null ? "–" : `${num(Math.round(n))} MB`);
export const yesNo = (b) => (b ? "yes" : "no");
export const onOff = (b) => (b ? "on" : "off");
export const words = (k) => String(k).replace(/([a-z0-9])([A-Z])/g, "$1 $2").replace(/_/g, " ").toLowerCase();
export const cap = (s) => (s ? s.charAt(0).toUpperCase() + s.slice(1) : s);
// "1 guardian", "2 guardians".
export const plural = (n, one, many = `${one}s`) => `${num(n)} ${Number(n) === 1 ? one : many}`;

export function duration(ms) {
  if (ms == null || Number.isNaN(Number(ms))) return "–";
  ms = Number(ms);
  if (ms < 1000) return `${Math.round(ms)} ms`;
  if (ms < 60000) return `${(ms / 1000).toFixed(1)} s`;
  const m = Math.floor(ms / 60000);
  const s = Math.round((ms % 60000) / 1000);
  return s ? `${m} min ${s} s` : `${m} min`;
}

export function uptime(seconds) {
  if (seconds == null) return "–";
  const s = Math.round(Number(seconds));
  if (s < 60) return `${s} s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m} min`;
  const h = Math.floor(m / 60);
  if (h < 48) return m % 60 ? `${h} h ${m % 60} min` : `${h} h`;
  const d = Math.floor(h / 24);
  return h % 24 ? `${d} d ${h % 24} h` : `${d} d`;
}

const pad = (n) => String(n).padStart(2, "0");
export const clock = (d = new Date()) => `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;

export function fullTime(iso) {
  const d = new Date(iso);
  if (!iso || Number.isNaN(d.getTime())) return "–";
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${clock(d)}`;
}

function span(ms) {
  const s = Math.round(ms / 1000);
  if (s < 60) return `${s} s`;
  const m = Math.round(s / 60);
  if (m < 60) return `${m} min`;
  const h = Math.round(m / 60);
  if (h < 48) return `${h} h`;
  return `${Math.round(h / 24)} d`;
}

export function relTime(iso, now = Date.now()) {
  const t = Date.parse(iso);
  if (!iso || Number.isNaN(t)) return "–";
  const diff = t - now;
  if (Math.abs(diff) < 5000) return "just now";
  return diff < 0 ? `${span(-diff)} ago` : `in ${span(diff)}`;
}

// A relative word on the page, the full local time in the title and the
// machine time in the datetime attribute.
export function timeEl(iso) {
  if (!iso) return "–";
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return esc(iso);
  return `<time datetime="${esc(new Date(t).toISOString())}" title="${esc(fullTime(iso))}">${esc(relTime(iso))}</time>`;
}

// ---- Chips, tags, blocks ---------------------------------------------------

const CHIPS = {
  ok: ["ok", "●", "OK"], warn: ["warn", "▲", "Warning"], fail: ["fail", "✕", "Failing"], off: ["off", "–", "Off"],
  stale: ["warn", "◔", "Stale"], failing: ["fail", "✕", "Failing"], pending: ["off", "○", "Pending"], running: ["info", "↻", "Running"],
};

export function chipRaw(tone, glyph, word, extra = "") {
  return `<span class="chip chip-${esc(tone)}${extra ? ` ${esc(extra)}` : ""}"><span class="glyph" aria-hidden="true">${glyph}</span>${esc(word)}</span>`;
}

// Dependency status (ok, warn, fail, off) and job health (ok, stale,
// failing, off, pending, running): the glyph carries the state next to the word.
export function chip(status, label) {
  const [tone, glyph, word] = CHIPS[status] || ["off", "–", cap(words(status || "unknown"))];
  return chipRaw(tone, glyph, label ?? word, status === "running" ? "chip-running" : "");
}

export const toneOf = (status) => (CHIPS[status] || ["off"])[0];
export const tag = (text, tone = "") => `<span class="tag${tone ? ` tag-${esc(tone)}` : ""}">${esc(text)}</span>`;

// Values are HTML already escaped by the caller; keys are plain text.
export const kv = (pairs) => `<dl class="kv">${pairs.map(([k, v]) => `<dt>${esc(k)}</dt><dd>${v == null || v === "" ? "–" : v}</dd>`).join("")}</dl>`;
export const json = (v) => `<code class="json">${esc(JSON.stringify(v))}</code>`;

// A job result ({ users: 2 }) as "users 2"; arrays by their length.
export function summary(result) {
  if (result == null) return "";
  if (typeof result !== "object") return String(result);
  return Object.entries(result)
    .map(([k, v]) => `${words(k)} ${Array.isArray(v) ? v.length : v !== null && typeof v === "object" ? JSON.stringify(v) : v}`)
    .join(", ");
}

export function banner(err, { retry = false } = {}) {
  if (err?.status === 401 || err?.status === 403) {
    return `<div class="banner banner-info"><p>Admins only. Sign in with a Google account listed in ADMIN_EMAILS.</p><a class="btn" href="/auth/google?mode=basic">Sign in with Google</a></div>`;
  }
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

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// A busy button stays focusable (aria-disabled, not disabled): a keyboard
// user keeps their place while the request runs. Click handlers check isBusy.
export const isBusy = (b) => b?.getAttribute("aria-disabled") === "true";
export function busy(b, on = true) {
  if (!b) return;
  if (on) b.setAttribute("aria-disabled", "true");
  else b.removeAttribute("aria-disabled");
}

// ---- Router, nav, refresh --------------------------------------------------

const VIEWS = [
  { path: "", label: "Overview", view: overview, auto: true },
  { path: "jobs", label: "Jobs", view: jobs, auto: true },
  { path: "users", label: "Users", view: users },
  { path: "cards", label: "Scam reports", view: cards },
  { path: "outbox", label: "Outbox", view: outbox },
];
const EVERY_MS = 30000;

let current = null;
let seq = 0;
let lastUpdate = 0;

function parse() {
  const [first, ...rest] = location.hash.replace(/^#\/?/, "").split("/");
  const route = VIEWS.find((v) => v.path === first) || VIEWS[0];
  return { route, params: rest.filter(Boolean).map((p) => { try { return decodeURIComponent(p); } catch { return p; } }) };
}

export function setTitle(html) {
  const h = $("#pageTitle");
  h.innerHTML = html;
  const plain = h.cloneNode(true);
  for (const c of plain.querySelectorAll(".chip")) c.remove();
  document.title = `${plain.textContent.trim()} – Prudence admin`;
}

export function setUpdated() {
  lastUpdate = Date.now();
  $("#updated").textContent = `Updated ${clock()}${current?.route.auto ? ` · refreshes every ${EVERY_MS / 1000} s` : ""}`;
}

function markNav() {
  for (const a of $$("#nav a")) {
    if (a.dataset.path === current.route.path) a.setAttribute("aria-current", "page");
    else a.removeAttribute("aria-current");
  }
}

// Under 820 px the nav is a row that scrolls sideways: keep the current page
// and the focused link inside it, never half hidden past the edge.
function revealInNav(a) {
  const nav = $("#nav");
  if (!a || nav.scrollWidth <= nav.clientWidth) return;
  const left = a.offsetLeft - 16;
  const right = a.offsetLeft + a.offsetWidth + 16;
  if (left < nav.scrollLeft) nav.scrollLeft = left;
  else if (right > nav.scrollLeft + nav.clientWidth) nav.scrollLeft = right - nav.clientWidth;
}

const focusKey = () => {
  const a = document.activeElement;
  return a && $("#view").contains(a) ? a.dataset.focus || null : null;
};
function restoreFocus(key) {
  if (!key) return;
  const el = $(`[data-focus="${CSS.escape(key)}"]`, $("#view"));
  if (el && !el.disabled) el.focus({ preventScroll: true });
}

export async function render({ focus = false } = {}) {
  const { route, params } = parse();
  const id = ++seq;
  const key = params.join("/");
  const changed = !current || current.route !== route || current.key !== key;
  current = { route, params, key };
  const root = $("#view");
  markNav();
  if (changed) {
    revealInNav($("#nav a[aria-current]"));
    setTitle(esc(route.view.title ? route.view.title(params) : route.label));
    $("#updated").textContent = "";
    root.innerHTML = `<p class="loading">Loading…</p>`;
  }
  if (focus) $("#pageTitle").focus();
  const keep = focusKey();
  const ctx = {
    stale: () => id !== seq,
    onPage: () => current?.route === route && current?.key === key,
    refresh: () => render(),
  };
  try {
    await route.view.render(root, params, ctx);
    if (ctx.stale()) return;
    setUpdated();
    restoreFocus(keep);
  } catch (e) {
    if (ctx.stale()) return;
    root.innerHTML = banner(e, { retry: true });
    $("[data-retry]", root)?.addEventListener("click", () => render());
  }
}

function tick() {
  if (document.visibilityState !== "visible" || !current?.route.auto) return;
  const a = document.activeElement;
  if (a && $("#view").contains(a) && /^(select|textarea|input)$/i.test(a.tagName)) return;
  render();
}

function start() {
  $("#nav").innerHTML = VIEWS.map((v) => `<a href="#/${v.path}" data-path="${v.path}">${v.label}</a>`).join("");
  $("#nav").addEventListener("focusin", (e) => revealInNav(e.target.closest("a")));
  $("#refresh").addEventListener("click", () => render());
  // The skip link moves focus without touching the hash (the hash is the route).
  $(".skip-link").addEventListener("click", (e) => { e.preventDefault(); $("#main").focus(); });
  window.addEventListener("hashchange", () => render({ focus: true }));
  setInterval(tick, EVERY_MS);
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible" && current?.route.auto && Date.now() - lastUpdate > EVERY_MS) tick();
  });
  api("/api/status")
    .then((s) => { $("#who").textContent = s.user?.email || "Not signed in"; })
    .catch(() => { $("#who").textContent = ""; });
  render();
}

start();
