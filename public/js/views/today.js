// The senior app, mobile first: "Today" (2026-11-04 redesign, frames 1a to
// 1d of _product/design/2026-11-04-redesign/claude-design/) says whether
// anything needs the person, then one message at a time with the verdict
// card of frames 1l to 1n (js/views/card.js). A slide to the left is only a
// shortcut for "Throw it away", and every action can be undone on the next
// screen. The same screens run on the person's own Gmail and on the public
// demo (Linda or Françoise).
//
// Today, top to bottom: the greeting; the white card "1 message needs you"
// with the gold "Look at it now", or the green all-clear followed by the
// three Check choices (the all-clear only when the mailbox was checked
// within the last day; otherwise a banner with Reconnect or Try again
// stands in for it: mailboxProblem); the "3 scams moved away this week" card (live only);
// "What Prudence protects" (live only: the demo has no mailbox or phone).
// The status line of the old Today now lives in the email row of the list.

import { api } from "../api.js";
import { t, getLang, ago } from "../i18n.js";
import { $, esc, icon, readAloud, toast, busy, focusHeading } from "../ui.js";
import { syncLine } from "./mail.js";
import { protectRows, renderProtects } from "../protects.js";
import { verdictCardHtml, unsureRowHtml, bindVerdictCard } from "./card.js";

let S = null; // the screen state: source, info, queue, index, details, last action
const demoDone = new Set(); // demo cards handled in this visit

const firstName = (s) => String(s || "").trim().split(/\s+/)[0] || "";
const enc = encodeURIComponent;
const DAY = 24 * 3600 * 1000;
const WEEK = 7 * DAY;

// The scams Prudence moved out of the inbox, for the "moved away this week"
// card: messages is the Scam folder's list (/api/inbox?box=scam), each with
// its date (when it arrived) and its check. Put back by the person: not
// counted. When every moved message has a date, only the last seven days
// count (week: true); otherwise all of them (week: false), and the card
// must not say "this week".
export function movedThisWeek(messages, now = Date.now()) {
  const moved = (messages || []).filter((m) => m?.check?.action === "moved" && !m.check.restored);
  const when = (m) => Date.parse(m.date || m.check?.at || "");
  if (!moved.every((m) => Number.isFinite(when(m)))) return { n: moved.length, week: false };
  return { n: moved.filter((m) => now - when(m) < WEEK).length, week: true };
}

// Why Today cannot say "Nothing in your email needs you" right now, or null
// when it can: a false all-clear is the one thing this screen must never
// say. status: /api/status (its gmail block: connected, needsReconnect,
// syncStatus, lastSyncAt, ready); statusOk: false when reading it again
// failed. Kinds: "error" (the status could not be read, the last pass
// failed, or there is no last check), "reconnect" (no Gmail, or Google wants
// a new sign-in), "first" (the first pass is still running), "stale" (the
// last check is more than a day old; at: its date).
export function mailboxProblem(status, { statusOk = true, now = Date.now() } = {}) {
  if (!statusOk) return { kind: "error" };
  const g = status?.gmail;
  if (!g || g.needsReconnect || g.connected === false) return { kind: "reconnect" };
  if (!g.ready) return { kind: "first" };
  if (g.syncStatus === "error") return { kind: "error" };
  const at = Date.parse(g.lastSyncAt || "");
  if (!Number.isFinite(at)) return { kind: "error" };
  if (now - at > DAY) return { kind: "stale", at: g.lastSyncAt };
  return null;
}

// Where the messages come from: the person's Gmail through the API.
function liveSource(status) {
  return {
    demo: false,
    async load() {
      const [inbox, scam, people, devices, fresh] = await Promise.all([
        api("/api/inbox?box=inbox&fresh=1"),
        api("/api/inbox?box=scam").catch(() => ({ messages: [] })),
        api("/api/guardians").catch(() => ({ guardians: [] })),
        api("/api/devices").catch(() => ({ devices: [] })),
        // The status the page was drawn with grows old (lastSyncAt): a live
        // refresh reads it again for "Checked 2 minutes ago" and the list.
        api("/api/status").catch(() => null),
      ]);
      const active = (people.guardians || []).filter((g) => g.status === "active");
      const moved = movedThisWeek(scam.messages);
      return {
        name: firstName(status.user?.name),
        guardian: active[0] || null,
        status: fresh?.user ? fresh : status,
        statusOk: Boolean(fresh?.user),
        devices: devices.devices || [],
        checked: inbox.messages.filter((m) => m.check).length,
        moved: moved.n,
        movedWeek: moved.week,
        queue: inbox.messages
          .filter((m) => m.check && m.check.verdict !== "safe" && !m.check.restored && m.check.feedback !== "not_scam")
          .map((m) => ({ id: m.id, fromName: m.fromName, from: m.from, subject: m.subject })),
      };
    },
    async open(item) {
      const d = await api(`/api/messages/${enc(item.id)}`);
      return { verdict: d.check?.verdict, message: d.message, callBack: d.callBack || null, checkId: d.check?.id };
    },
    throwAway: (item) => api(`/api/messages/${enc(item.id)}/file-as-scam`, { method: "POST", body: {} }),
    undoThrow: (item) => api(`/api/messages/${enc(item.id)}/undo-throw`, { method: "POST", body: {} }),
    keep: (item) => api(`/api/messages/${enc(item.id)}/put-back`, { method: "POST", body: {} }),
    undoKeep: (item) => api(`/api/messages/${enc(item.id)}/undo-keep`, { method: "POST", body: {} }),
    ask: (item, detail, opts) => api("/api/ask", { method: "POST", body: { checkId: detail.checkId, via: opts.via, includeText: opts.includeText } }),
  };
}

// The public demo: a few example messages, judged live when a card opens;
// what the person does with them stays on this page.
function demoSource() {
  let data = null;
  return {
    demo: true,
    async load() {
      data = data || await api(`/api/demo/today?lang=${getLang()}`);
      return { name: data.name, guardian: data.guardian, checked: data.checked, moved: 0, queue: data.queue.filter((q) => !demoDone.has(q.id)),
        voicemail: data.voicemail && !demoDone.has(`voicemail-${getLang()}`) };
    },
    async open(item) {
      const { callBack, ...verdict } = await api("/api/demo/check", { method: "POST", body: { id: item.id } });
      return { verdict, message: item, callBack: callBack || null, checkId: null };
    },
    throwAway: async (item) => { demoDone.add(item.id); },
    undoThrow: async (item) => { demoDone.delete(item.id); },
    keep: async (item) => { demoDone.add(item.id); },
    undoKeep: async (item) => { demoDone.delete(item.id); },
    async ask(item, detail, opts) {
      const g = data.guardian;
      if (opts.via === "email") return { sentTo: [g.name], texts: [] };
      const sender = item.fromName || item.from;
      const clip = (s, n) => (s.length > n ? `${s.slice(0, s.lastIndexOf(" ", n - 1) > 20 ? s.lastIndexOf(" ", n - 1) : n - 1)}…` : s);
      const about = clip(String(item.subject || item.body || ""), 60);
      const body = getLang() === "fr"
        ? `Bonjour ${g.name}, peux-tu vérifier ceci pour moi ? ${sender} m'a écrit « ${about} ». Prudence dit : ${detail.verdict.headline} Réponds en un geste : ${location.origin}/answer/…`
        : `Hi ${g.name}, can you check this for me? ${sender} sent me "${about}". Prudence says: ${detail.verdict.headline} Tap to answer: ${location.origin}/answer/…`;
      return { sentTo: [g.name], texts: [{ name: g.name, phone: g.phone, body }] };
    },
  };
}

// Every screen goes through paint(): it counts screens, so an answer that
// arrives after the person has moved on is dropped instead of drawn over
// the new screen, and it moves focus to the new heading so a screen reader
// says where they are (a verdict, "Thrown away", "Ask Thomas").
let painted = 0;
function paint(html, { focus = true } = {}) {
  S.root.innerHTML = html;
  const dock = S.root.querySelector(".v2-actions");
  document.body.classList.toggle("v2-docked", Boolean(dock));
  if (dock) document.body.style.setProperty("--dock-h", `${dock.offsetHeight}px`);
  if (focus) focusHeading(S.root);
  return ++painted;
}
// Another screen on the root (main.js sets root.dataset.view) makes it stale too.
const stale = (n) => n !== painted || !S.root.isConnected || S.root.dataset.view !== "today";

export async function renderToday(root, status, { demo = false, quiet = false } = {}) {
  S = { root, status, source: demo ? demoSource() : liveSource(status), index: 0, details: new Map(), open: { body: false } };
  const n = paint(`<div class="v2 screen"><p class="v2-wait">${t("please_wait")}</p></div>`, { focus: false });
  try {
    S.info = await S.source.load();
  } catch (e) {
    if (stale(n)) return;
    paint(`<div class="v2 screen">${status.gmail ? syncLine(status) : ""}<p class="banner danger">${esc(e.status === 409 ? t("reconnect") : t("sync_error"))}</p>
      <button id="v2Retry" class="btn btn-navy btn-big" type="button">${t("retry")}</button></div>`, { focus: false });
    $("#v2Retry", root)?.addEventListener("click", () => renderToday(root, status, { demo }));
    return;
  }
  if (stale(n)) return;
  if (S.info.status) S.status = S.info.status;
  S.queue = S.info.queue;
  S.total = S.queue.length;
  drawToday({ focus: !quiet });
}

const greeting = () => {
  const h = new Date().getHours();
  return t(h < 12 ? "v2_morning" : h < 18 ? "v2_afternoon" : "v2_evening", { name: S.info.name });
};

// What stands in for the all-clear when the mailbox could not be checked
// (mailboxProblem): the words and the one way out, Reconnect or Try again.
// The everyday "checked 2 minutes ago" is said once, in the email row of
// "What Prudence protects", and on the all-clear.
const since = (iso) => new Date(iso).toLocaleString(getLang() === "fr" ? "fr-FR" : "en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
function problemBanner(p) {
  if (!p) return "";
  if (p.kind === "first") return `<div class="banner caution"><p>${esc(t("sync_first"))}</p></div>`;
  if (p.kind === "reconnect") {
    return `<div class="banner danger"><p>${esc(t("reconnect"))}</p><a class="btn btn-gold btn-big" href="/auth/google?mode=gmail">${esc(t("reconnect_btn"))}</a></div>`;
  }
  const words = p.kind === "stale" ? t("td_stale", { when: since(p.at) }) : t("sync_error");
  return `<div class="banner caution"><p>${esc(words)}</p><button id="tdRetry" class="btn btn-navy btn-big" type="button">${esc(t("retry"))}</button></div>`;
}

// The card on top: what needs her (frame 1a) or the green all-clear (1b).
function topCard(n) {
  if (n > 0) {
    const others = Math.max(0, (Number(S.info.checked) || 0) - n);
    return `
      <section class="hero-card" aria-labelledby="tdNeed">
        <h2 id="tdNeed" class="hero-title">${esc(n === 1 ? t("v2_need_one") : t("v2_need_many", { n }))}</h2>
        ${others ? `<p class="hero-text">${esc(others === 1 ? t("td_others_one") : t("td_others", { n: others }))}</p>` : ""}
        <button id="v2Look" class="btn btn-gold btn-big" type="button">${esc(n === 1 ? t("v2_look_one") : t("v2_look"))} ${icon("chevron-right", 26, 2.5)}</button>
      </section>`;
  }
  const g = S.status?.gmail;
  // The mailbox could not be checked: the banner above says so instead.
  if (S.problem) return "";
  const when = !S.source.demo && g?.lastSyncAt ? t("td_checked", { when: ago(g.lastSyncAt) })
    : S.info.checked ? t("v2_checked", { n: S.info.checked }) : "";
  return `
      <section class="allclear" aria-labelledby="tdClear">
        <div class="allclear-head">
          <span class="allclear-mark" aria-hidden="true">${icon("check", 32, 3)}</span>
          <h2 id="tdClear" class="allclear-title">${esc(t("td_allclear"))}</h2>
        </div>
        ${when ? `<p class="allclear-text">${esc(when)}</p>` : ""}
      </section>`;
}

// "Check something yourself" (frame 1b): the three Check choices, the
// screenshot in gold. Links: the Check screens own what happens next.
function choices() {
  return `
      <section class="td-choices" aria-labelledby="tdCheck">
        <h2 id="tdCheck" class="section-title">${esc(t("td_check_yourself"))}</h2>
        <a class="btn btn-choice is-compact btn-gold" href="#/check/photo">${icon("camera", 32)}<span>${esc(t("ck_photo"))}</span></a>
        <a class="btn btn-choice is-compact" href="#/check/paste">${icon("clipboard", 28)}<span>${esc(t("ck_paste"))}</span></a>
        <a class="btn btn-choice is-compact" href="#/check/voice">${icon("mic", 28)}<span>${esc(t("ck_voice"))}</span></a>
      </section>`;
}

// What Prudence moved out of the way: "this week" only when the count is
// the last seven days (movedThisWeek), the older words otherwise.
function movedCard() {
  const n = S.info.moved;
  if (!n) return "";
  const one = n === 1;
  const title = S.info.movedWeek ? (one ? t("td_moved_one") : t("td_moved", { n })) : t("v2_moved", { n });
  return `
      <section class="row-card" aria-labelledby="tdMoved">
        <div class="row-head">
          <span class="row-icon is-danger">${icon("circle-slash", 24, 2.5)}</span>
          <div class="row-text">
            <span id="tdMoved" class="row-name">${esc(title)}</span>
            ${S.info.movedWeek ? `<span class="row-state">${esc(one ? t("td_moved_note_one") : t("td_moved_note"))}</span>` : ""}
          </div>
        </div>
        <a class="btn btn-outline" href="#/blocked">${esc(one ? t("td_see_it") : t("td_see_them"))}</a>
      </section>`;
}

// focus: false for a live refresh, so new mail never pulls focus away.
function drawToday({ focus = true } = {}) {
  const n = S.queue.length;
  const demo = S.source.demo;
  S.problem = demo ? null : mailboxProblem(S.status, { statusOk: S.info.statusOk !== false });
  paint(`
    <div id="tdHome" class="v2 screen">
      ${demo ? `<p class="v2-demo">${t("v2_demo_note")}</p>` : ""}
      <h1 class="screen-title">${esc(greeting())}</h1>
      ${problemBanner(S.problem)}
      ${topCard(n)}
      ${n === 0 && !demo ? choices() : ""}
      ${demo ? "" : movedCard()}
      ${S.info.voicemail ? `
        <section class="v2-voice" aria-labelledby="v2VoiceTitle">
          <h2 id="v2VoiceTitle" class="v2-voice-title">${icon("speaker", 26)} ${t("v2_voicemail_title")}</h2>
          <audio controls preload="none" src="${VOICEMAIL_URL()}"></audio>
          <button id="v2Voice" class="btn btn-navy v2-big" type="button">${t("v2_voicemail_check")}</button>
        </section>` : ""}
      ${demo ? "" : renderProtects(protectRows(S.status, { devices: S.info.devices }))}
    </div>`, { focus });
  $("#v2Look")?.addEventListener("click", () => openCard(0));
  $("#tdRetry")?.addEventListener("click", () => renderToday(S.root, S.status));
  $("#v2Voice")?.addEventListener("click", (e) => busy(e.currentTarget, openVoicemail, t("checking")));
}

// The demo voicemail: Muse Voice Transcribe writes it down, the same
// check judges it, and it opens as one more card (recording + words under
// "Show me the message").
const VOICEMAIL_URL = () => `/api/demo/voicemail?lang=${getLang()}`;
async function openVoicemail() {
  const out = await api("/api/demo/voicemail", { method: "POST", body: { lang: getLang() } });
  const item = { id: `voicemail-${getLang()}`, fromName: t("v2_voicemail_from"), from: out.message.from, subject: "", channel: "voice" };
  S.details.set(item.id, { verdict: out.verdict, message: { ...out.message, fromName: item.fromName, audio: VOICEMAIL_URL() }, callBack: out.callBack || null, checkId: null });
  S.queue = [item, ...S.queue.filter((q) => q.id !== item.id)];
  S.total = (S.total || 0) + 1;
  openCard(0);
}

async function openCard(i) {
  S.index = Math.max(0, Math.min(i, S.queue.length - 1));
  S.open = { body: false };
  const item = S.queue[S.index];
  if (!item) return drawToday();
  const n = paint(`<div class="v2 screen is-snug">${cardHeader()}<div class="v2-card vcard caution"><p class="vcard-word">${t("checking")}</p><p class="vcard-small">${t("please_wait")}</p></div></div>`, { focus: false });
  bindHeader();
  try {
    if (!S.details.has(item.id)) S.details.set(item.id, await S.source.open(item));
  } catch (e) {
    if (stale(n)) return;
    paint(`<div class="v2 screen is-snug">${cardHeader()}<p class="banner danger">${esc(e.message)}</p>
      <button id="v2Retry" class="btn btn-navy btn-big" type="button">${t("retry")}</button></div>`, { focus: false });
    bindHeader();
    $("#v2Retry").addEventListener("click", () => openCard(S.index));
    return;
  }
  if (stale(n)) return;
  drawCard();
}

// "2 of 3" stays "2 of 3" after the first one is handled: the total is
// fixed when the person starts (new mail arriving can only raise it).
function position() {
  S.total = Math.max(S.total || 0, S.queue.length);
  return { i: S.total - S.queue.length + S.index + 1, n: S.total };
}

// Back, the count and Listen on one row (frame 1l); at the larger sizes
// Listen moves to its own line on the right instead of spilling.
function cardHeader() {
  return `<div class="screen-head td-head">
      <a class="btn-back" href="${S.source.demo ? "#/demo" : "#/today"}" id="v2Back">${icon("chevron-left", 28, 2.5)}${t("v2_today")}</a>
      <span class="td-count" aria-label="${esc(t("v2_of_label", position()))}">${esc(t("v2_of", position()))}</span>
      <button id="v2Read" class="btn-listen" type="button" aria-label="${t("v2_read")}">${icon("speaker", 26)}<span aria-hidden="true">${t("v2_read_short")}</span></button>
    </div>`;
}

function bindHeader() {
  $("#v2Back")?.addEventListener("click", (e) => { e.preventDefault(); drawToday(); });
}

function drawCard() {
  const item = S.queue[S.index];
  const d = S.details.get(item.id);
  const v = d.verdict || {};
  // No verdict (a check still running or a broken answer) is never shown
  // as Safe: card.js draws "We could not check this message yet"; the
  // links stay out of reach and the person can try again.
  if (!["safe", "be_careful", "scam"].includes(v.verdict)) {
    paint(`<div class="v2 screen is-snug">${cardHeader()}
      ${verdictCardHtml({ verdict: v })}
      <button id="v2Retry" class="btn btn-navy btn-big" type="button">${t("retry")}</button></div>`);
    bindHeader();
    $("#v2Read")?.remove();
    $("#v2Retry").addEventListener("click", () => { S.details.delete(item.id); openCard(S.index); });
    return;
  }
  const scam = v.verdict === "scam";
  const safe = v.verdict === "safe";
  const g = S.info.guardian;
  // The one verb in the answer bar. A message using a family member's name:
  // calling them on the number already saved is the safest step, whatever
  // the verdict. A Safe message (the demo judges live, a voicemail): keeping
  // it, never a red "Throw it away" under a green card. Otherwise: throw it.
  const primary = d.callBack
    ? `<a class="btn btn-navy v2-action" href="tel:${esc(String(d.callBack.phone).replace(/[^\d+]/g, ""))}">${icon("phone", 28)} ${esc(t("v2_call", { name: firstName(d.callBack.name) }))}</a>`
    : safe ? `<button id="v2Keep" class="btn btn-gold v2-action" type="button">${icon("check", 28, 3)} ${t("v2_keep")}</button>`
    : `<button id="v2Throw" class="btn btn-danger v2-action" type="button">${icon("trash", 28)} ${t("v2_throw")}</button>`;
  const quietThrow = d.callBack || safe;
  const quietKeep = d.callBack || !safe;
  paint(`
    <div class="v2 screen is-snug">
      ${cardHeader()}
      ${verdictCardHtml({ verdict: v, message: d.message || null, callBack: d.callBack, open: S.open, ids: "v2" })}
      <div class="v2-actions td-dock">${primary}</div>
      ${d.callBack ? `<p class="v2-hint">${esc(t("v2_call_note", { name: firstName(d.callBack.name) }))}</p>` : ""}
      ${quietThrow ? `<button id="v2Throw" class="btn btn-outline btn-big" type="button">${t("v2_throw")}</button>` : ""}
      ${quietKeep ? `<button id="v2Keep" class="btn btn-outline btn-big" type="button">${t("v2_keep")}</button>` : ""}
      ${unsureRowHtml({ verdict: v.verdict, guardianName: g ? firstName(g.name) : "", folded: v.verdict === "safe", ids: "v2" })}
    </div>`);
  bindHeader();
  bindVerdictCard(S.root, { ids: "v2", onBody: (open) => { S.open.body = open; }, onAsk: () => drawAsk() });
  $("#v2Read").addEventListener("click", () => readAloud(v));
  $("#v2Throw")?.addEventListener("click", (e) => busy(e.currentTarget, doThrow));
  $("#v2Keep")?.addEventListener("click", (e) => busy(e.currentTarget, doKeep));
  if (scam) enableSlide($("#v2Card"));
}

// Slide left to throw away: a shortcut only, with a clear threshold so a
// shaky finger does not trigger it; the card springs back otherwise.
function enableSlide(card) {
  const reduce = matchMedia("(prefers-reduced-motion: reduce)").matches;
  let x0 = null; let dx = 0;
  card.addEventListener("pointerdown", (e) => { if (e.pointerType === "mouse" || e.target.closest("button, a")) return; x0 = e.clientX; dx = 0; });
  card.addEventListener("pointermove", (e) => {
    if (x0 === null) return;
    dx = Math.min(0, e.clientX - x0);
    if (!reduce) card.style.transform = `translateX(${dx}px) rotate(${dx / 40}deg)`;
  });
  const reset = () => { x0 = null; card.style.transform = ""; };
  card.addEventListener("pointerup", () => {
    if (x0 === null) return;
    const far = dx < -card.offsetWidth * 0.4;
    reset();
    if (far) busy(null, doThrow);
  });
  // The browser took the gesture over (a scroll, a call): never a throw.
  card.addEventListener("pointercancel", reset);
}

// One action at a time, however it was started (a button or a slide). The
// card is taken out of the queue by its id when the answer comes back, so
// a slow answer can never remove the next message instead.
async function act(kind) {
  const s = S;
  const item = s.queue[s.index];
  if (s.acting || !item) return;
  s.acting = true;
  try {
    await (kind === "thrown" ? s.source.throwAway(item) : s.source.keep(item));
    const at = s.queue.findIndex((q) => q.id === item.id);
    if (at >= 0) s.queue.splice(at, 1);
    if (s === S && S.root.isConnected && S.root.dataset.view === "today") drawDone({ kind, item, at: Math.max(0, at) });
  } finally {
    s.acting = false;
  }
}
const doThrow = () => act("thrown");
const doKeep = () => act("kept");

function drawDone(last) {
  const more = S.queue.length > 0;
  paint(`
    <div class="v2 screen">
      <section class="v2-done-note" role="status">
        <h1 class="v2-done-title">${icon("check", 26, 3)} ${last.kind === "thrown" ? t("v2_thrown") : t("v2_kept")}</h1>
        <p>${last.kind === "thrown" ? t("v2_thrown_note") : t("v2_kept_note")}</p>
        <button id="v2Undo" class="btn v2-undo" type="button">${UNDO} ${t("v2_undo")}</button>
      </section>
      ${more ? `
        <button id="v2Next" class="btn btn-gold btn-big" type="button">${t("v2_next")} ${icon("chevron-right", 26, 2.5)}</button>` : `
        <section class="v2-all-done" aria-label="${t("v2_all_done")}">
          <span class="v2-big-check" aria-hidden="true">${icon("check", 64, 3)}</span>
          <h2>${t("v2_all_done")}</h2>
          <p>${t("v2_all_done_note")}</p>
        </section>`}
      <button id="v2Today" class="btn btn-navy btn-big" type="button">${t("v2_back_to_today")}</button>
    </div>`);
  const n = painted;
  $("#v2Undo")?.addEventListener("click", (e) => busy(e.currentTarget, async () => {
    await (last.kind === "thrown" ? S.source.undoThrow(last.item) : S.source.undoKeep(last.item));
    if (!S.queue.some((q) => q.id === last.item.id)) S.queue.splice(last.at, 0, last.item);
    if (!stale(n)) openCard(last.at);
  }));
  $("#v2Next")?.addEventListener("click", () => openCard(last.at));
  $("#v2Today").addEventListener("click", () => drawToday());
}

// Ask the trusted person: by a text from the person's own phone (the
// Messages app opens with the words ready; they press Send), or by email.
function drawAsk() {
  const item = S.queue[S.index];
  const d = S.details.get(item.id);
  const g = S.info.guardian;
  const name = firstName(g.name);
  paint(`
    <div class="v2 screen is-snug">
      <div class="screen-head"><button id="v2AskBack" class="btn-back" type="button">${icon("chevron-left", 28, 2.5)}${t("v2_back_message")}</button></div>
      <h1 class="screen-title">${esc(t("v2_ask", { name }))}</h1>
      <p class="screen-lead">${esc(t("v2_ask_preview", { name }))}</p>
      <div class="shared-card">
        <p class="mail-meta">${esc(item.fromName || item.from || "")}</p>
        <p><strong>${esc(d.verdict.headline || "")}</strong></p>
        <ul>${(d.verdict.reasons || []).map((r) => `<li>${esc(r.text)}</li>`).join("")}</ul>
      </div>
      <label class="check"><input type="checkbox" id="v2IncludeText"> ${t("ask_include_text")}</label>
      <div id="v2AskOut" aria-live="polite"></div>
      <button id="v2Text" class="btn btn-gold btn-big" type="button">${icon("chat", 26)} ${esc(t("v2_ask_text", { name }))}</button>
      <button id="v2Email" class="btn btn-outline btn-big" type="button">${esc(t("v2_ask_email"))}</button>
    </div>`);
  $("#v2AskBack").addEventListener("click", () => drawCard());
  const n = painted;
  let sending = false; // text and email never run together
  const send = (via) => async () => {
    const includeText = $("#v2IncludeText").checked;
    const out = await S.source.ask(item, d, { via, includeText });
    if (stale(n)) return;
    const box = $("#v2AskOut");
    if (out?.alreadyAsked) { box.innerHTML = `<p class="answer info">${esc(t("ask_already"))}</p>`; return; }
    if (via === "email") { box.innerHTML = `<p class="answer info">${esc(t(S.source.demo ? "v2_demo_email" : "v2_emailed", { name }))}</p>`; return; }
    const msg = out?.texts?.[0];
    if (!msg?.body) { box.innerHTML = `<p class="answer info">${esc(t("v2_text_failed", { name }))}</p>`; return; }
    const digits = String(msg.phone || "").replace(/[^\d+]/g, "");
    const sms = `sms:${digits}?&body=${enc(msg.body)}`;
    const wa = digits ? `https://wa.me/${digits.replace(/^\+/, "")}?text=${enc(msg.body)}` : null;
    box.innerHTML = `
      <div class="v2-text-ready">
        <p><strong>${esc(t("v2_text_ready", { name }))}</strong></p>
        <pre class="mail-body">${esc(msg.body)}</pre>
        ${S.source.demo ? `
          <button id="v2DemoOpen" class="btn btn-gold btn-big" type="button">${icon("chat", 26)} ${t("v2_open_messages")}</button>
          <p id="v2DemoNote" class="small" hidden>${t("v2_demo_text")}</p>` : `
          <a class="btn btn-gold btn-big" href="${esc(sms)}">${icon("chat", 26)} ${t("v2_open_messages")}</a>
          ${wa ? `<a class="btn btn-outline btn-big" href="${esc(wa)}" target="_blank" rel="noopener">${t("v2_open_whatsapp")}</a>` : ""}
          ${digits ? "" : `<p class="small">${esc(t("v2_no_phone", { name }))}</p>`}`}
        <button id="v2Copy" class="btn btn-outline btn-big" type="button">${t("v2_copy")}</button>
      </div>`;
    $("#v2Text").hidden = true;
    $("#v2DemoOpen")?.addEventListener("click", () => { $("#v2DemoNote").hidden = false; $("#v2DemoNote").focus?.(); });
    $("#v2Copy").addEventListener("click", async () => {
      try { await navigator.clipboard.writeText(msg.body); toast(t("v2_copied"), "ok"); } catch { toast(t("v2_copy_failed"), "danger"); }
    });
  };
  const once = (via) => async (e) => {
    if (sending) return;
    sending = true;
    try { await busy(e.currentTarget, send(via)); } finally { sending = false; }
  };
  $("#v2Text").addEventListener("click", once("text"));
  $("#v2Email").addEventListener("click", once("email"));
}

// Live updates: a new check or an answer refreshes "Today" when its home
// screen is up (never a card or the Ask screen the person is reading).
export function onTodayEvent() {
  if (S && !S.source.demo && S.root.isConnected && S.root.dataset.view === "today" && $("#tdHome", S.root)) renderToday(S.root, S.status, { quiet: true });
}

// "Undo" has no icon in ui.js yet: its arrow is drawn here, as before.
const UNDO = '<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false"><path d="M9 14L4 9l5-5"/><path d="M4 9h10.5a5.5 5.5 0 0 1 0 11H11"/></svg>';
