// My email: the inbox and the two Prudence folders, read live from
// Gmail, with the verdict, undo, link check and "Ask my trusted person".
// renderMail draws the wide page (#/inbox, #/folder/*: testing and the
// family); renderMessages and renderBlocked the senior's column (below).

import { api } from "../api.js";
import { t, ago, dateTime, getLang } from "../i18n.js";
import { $, $$, esc, pill, verdictCard, verdictPill, icon, readAloud, toast, focusHeading, busy } from "../ui.js";
import { verdictCardHtml, unsureRowHtml, bindVerdictCard } from "./card.js";

let state = { box: "inbox", messages: [], current: null, detail: null };

export function syncLine(status) {
  const g = status.gmail;
  if (!g) return "";
  if (g.needsReconnect) return `<div class="banner danger"><p>${t("reconnect")}</p><a class="btn btn-gold" href="/auth/google?mode=gmail">${t("reconnect_btn")}</a></div>`;
  if (!g.ready) return `<div class="banner caution"><p>${t("sync_first")}</p></div>`;
  const when = g.lastSyncAt ? ` · ${t("checked_ago", { when: ago(g.lastSyncAt) })}` : "";
  if (g.syncStatus === "error") return `<p class="sync-line">${t("sync_error")}</p>`;
  return `<p class="sync-line">${g.syncStatus === "syncing" ? t("sync_syncing") : t("sync_ok")}${when}${g.push ? ` · ${t("instant_on")}` : ""}</p>`;
}

export async function renderMail(root, status, box = "inbox") {
  state.box = box;
  root.innerHTML = `
    <div id="syncLine">${syncLine(status)}</div>
    <div class="layout">
      <section class="inbox-pane" aria-label="${t("nav_inbox")}">
        <nav class="box-tabs" aria-label="${t("folders")}">
          ${["inbox", "scam", "careful"].map((b) => `<a class="tab${b === box ? " active" : ""}" href="#/${b === "inbox" ? "inbox" : `folder/${b}`}">${t(`box_${b}`)}</a>`).join("")}
        </nav>
        <ul id="emailList" class="email-list" aria-label="${t(`box_${box}`)}"><li>${t("please_wait")}</li></ul>
      </section>
      <section class="reader-pane" aria-live="polite">
        <div id="emptyState" class="empty">
          <p class="empty-big">${t("empty_choose")}</p><p>${t("empty_tell")}</p>
          <ul><li>${t("empty_1")}</li><li>${t("empty_2")}</li><li>${t("empty_3")}</li></ul>
          <p class="reassure">${t("promise_1")}</p>
        </div>
        <article id="reader" hidden></article>
      </section>
    </div>`;
  await loadList();
}

export async function loadList(fresh = false) {
  const list = $("#emailList");
  if (!list) return refreshNarrow(); // My messages or Blocked, when one is on screen
  try {
    const data = await api(`/api/inbox?box=${state.box}${fresh ? "&fresh=1" : ""}`);
    state.messages = data.messages;
    renderList();
  } catch (e) {
    list.innerHTML = `<p class="banner danger">${esc(e.status === 409 ? t("reconnect") : t("sync_error"))}</p>`;
  }
}

function renderList() {
  const list = $("#emailList");
  if (!state.messages.length) { list.innerHTML = `<p class="reassure">${t("empty_box")}</p>`; return; }
  list.innerHTML = state.messages.map((m, i) => `
    <li><button class="email-item${m.unread ? " unread" : ""}" data-i="${i}"${state.current === m.id ? ' aria-current="true"' : ""}>
      <span class="email-from">${esc(m.fromName || m.from)}</span>
      <span class="email-subject">${esc(m.subject || t("no_subject"))}</span>
      <span class="email-date">${esc(dateTime(m.date))}</span>
      ${pill(m.check)}
    </button></li>`).join("");
  $$(".email-item", list).forEach((b) => b.addEventListener("click", () => openMessage(state.messages[Number(b.dataset.i)].id)));
}

const narrow = () => window.matchMedia("(max-width: 900px)").matches;

export async function openMessage(id, { keepFocus = false } = {}) {
  state.current = id;
  renderList();
  $("#emptyState").hidden = true;
  const reader = $("#reader");
  reader.hidden = false;
  reader.innerHTML = `<div class="verdict caution"><h3>${t("checking")}</h3><p>${t("please_wait")}</p></div>`;
  if (narrow()) reader.scrollIntoView({ behavior: "smooth", block: "start" });
  try {
    const detail = await api(`/api/messages/${encodeURIComponent(id)}`);
    // The person may have opened another email meanwhile: never show (or
    // act on) a late answer for a message that is no longer on screen.
    if (state.current !== id) return;
    state.detail = detail;
    renderReader();
    if (!keepFocus) focusHeading(reader);
  } catch (e) {
    if (state.current !== id) return;
    reader.innerHTML = `<div class="verdict caution"><h3>${t("check_failed")}</h3><p>${esc(e.message)} ${t("check_failed_tip")}</p></div>`;
  }
}

function answerLine(a) {
  if (!a.answer) return `<p class="answer waiting">${esc(t("answer_waiting", { name: a.guardian_name }))}</p>`;
  return `<p class="answer ${a.answer === "scam" ? "danger" : a.answer === "real" ? "ok" : "info"}">${esc(t(`answer_${a.answer}`, { name: a.guardian_name }))}</p>`;
}

function renderReader() {
  const { message: m, check, answers } = state.detail;
  const reader = $("#reader");
  const id = m.id;
  const v = check?.verdict;
  const actionNote = check?.restored ? "" : check?.action === "moved" ? `<p class="note">${t("moved_note")}</p>` : check?.action === "labeled" ? `<p class="note">${t("labeled_note")}</p>` : "";
  reader.innerHTML = `
    ${narrow() ? `<button id="backToList" class="btn btn-light-dark" type="button">${t("back_to_list")}</button>` : ""}
    <p class="mail-meta">${esc(m.fromName)} &lt;${esc(m.from)}&gt; · ${esc(dateTime(m.date))}</p>
    <h2 id="mailSubject">${esc(m.subject || t("no_subject"))}</h2>
    <div id="answers">${(answers || []).map(answerLine).join("")}</div>
    ${v ? verdictCard(v) : `<div class="verdict caution"><h3>${t("not_checked")}</h3><button class="btn btn-navy btn-big" id="checkNow">${t("check_now")}</button></div>`}
    ${actionNote}
    <div class="action-row">
      ${v ? `<button id="readAloudBtn" class="btn btn-navy btn-big" type="button">${t("read_aloud")}</button>` : ""}
      ${v && v.verdict !== "safe" ? `<button id="askBtn" class="btn btn-gold btn-big" type="button">${t("ask_trusted")}</button>` : ""}
    </div>
    <div id="askPanel"></div>
    <div class="action-row">
      ${check && !check.restored && check.action !== "none" ? `<button id="putBackBtn" class="btn btn-light-dark btn-big" type="button">${t("put_back")}</button>` : ""}
      ${check && v?.verdict === "be_careful" && check.action !== "moved" ? `<button id="fileScamBtn" class="btn btn-danger btn-big" type="button">${t("file_scam")}</button>` : ""}
    </div>
    ${m.links.length ? `<h3>${t("links_in_message")}</h3><ul class="link-list">${m.links.slice(0, 12).map((l) => `<li><span class="small">${t("link_shows")}</span> “${esc(l.text || l.href)}” → <strong>${esc(new URL(l.href).hostname)}</strong></li>`).join("")}</ul>
      <button id="linksBtn" class="btn btn-light-dark" type="button">${t("where_links")}</button><div id="linkResult"></div>` : ""}
    <h3>${t("the_message")}</h3>
    <pre class="mail-body">${esc(m.body)}</pre>`;
  // Every action is bound to THIS message's id, never to "the current one".
  $("#backToList")?.addEventListener("click", () => $("#emailList button[aria-current]")?.focus() || $("#emailList")?.scrollIntoView());
  $("#checkNow")?.addEventListener("click", (e) => busy(e.currentTarget, () => recheck(id, false)));
  $("#readAloudBtn")?.addEventListener("click", () => readAloud(v));
  $("#askBtn")?.addEventListener("click", () => openAsk({ checkId: check.id, verdict: v, message: m, target: $("#askPanel") }));
  $("#putBackBtn")?.addEventListener("click", (e) => busy(e.currentTarget, () => act(id, "put-back", t("put_back_done"))));
  $("#fileScamBtn")?.addEventListener("click", (e) => busy(e.currentTarget, () => act(id, "file-as-scam", t("file_scam_done"))));
  $("#linksBtn")?.addEventListener("click", (e) => busy(e.currentTarget, () => recheck(id, true)));
}

async function recheck(id, links) {
  const target = links ? $("#linkResult") : $("#reader");
  if (links) target.innerHTML = `<p>${t("links_checking")}</p>`;
  try {
    const out = await api(`/api/messages/${encodeURIComponent(id)}/check`, { method: "POST", body: { links } });
    if (state.current !== id) return;
    if (links) {
      const rows = Object.entries(out.linkInspection || {}).filter(([, i]) => i.final_url);
      target.innerHTML = rows.length ? `<ul class="link-list">${rows.map(([href, i]) => `<li>${esc(new URL(href).hostname)} ${t("link_goes")} <strong>${esc(new URL(i.final_url).hostname)}</strong>${i.domain_age_days != null ? ` · ${i.domain_age_days} d` : ""}${i.page_shows ? `<br><span class="small">${esc(i.page_shows)}</span>` : ""}</li>`).join("")}</ul>` : "";
    }
    await openMessage(id, { keepFocus: true });
    loadList(true);
  } catch (e) { toast(e.message, "danger"); }
}

async function act(id, path, done) {
  await api(`/api/messages/${encodeURIComponent(id)}/${path}`, { method: "POST", body: {} });
  toast(done, "ok");
  await loadList(true);
  if (state.current === id) await openMessage(id, { keepFocus: true });
}

// Shared with "Check something": preview exactly what will be shared.
export async function openAsk({ checkId, verdict, message, target, provided = false }) {
  const { guardians } = await api("/api/guardians");
  const active = guardians.filter((g) => g.status === "active");
  if (!active.length) { target.innerHTML = `<div class="trusted"><p>${t("ask_none")}</p><a class="btn btn-navy" href="#/people">${t("nav_people")}</a></div>`; return; }
  target.innerHTML = `
    <div class="trusted">
      <h3>${t("ask_title")}</h3>
      <fieldset><legend>${t("ask_to")}</legend>${active.map((g) => `<label class="check"><input type="checkbox" name="g" value="${esc(g.id)}" checked> ${esc(g.name)}${g.relation ? ` (${esc(g.relation)})` : ""}</label>`).join("")}</fieldset>
      <p>${t("ask_preview")}</p>
      <div class="shared-card"><p class="mail-meta">${esc(message.fromName)} &lt;${esc(message.from)}&gt;</p>${message.subject ? `<p><strong>${esc(message.subject)}</strong></p>` : ""}
        <p>${esc(verdict.headline)}</p><ul>${(verdict.reasons || []).map((r) => `<li>${esc(r.text)}</li>`).join("")}</ul></div>
      <label class="check"><input type="checkbox" id="includeText"> ${t("ask_include_text")}</label>
      <button id="sendAsk" class="btn btn-gold btn-big" type="button">${esc(t("ask_send", { names: active.map((g) => g.name).join(", ") }))}</button>
    </div>`;
  $("#sendAsk", target).addEventListener("click", (ev) => busy(ev.currentTarget, async () => {
    const ids = $$("input[name=g]:checked", target).map((i) => i.value);
    const out = await api("/api/ask", { method: "POST", body: { checkId, guardianshipIds: ids, includeText: $("#includeText", target).checked, message: provided ? message : undefined } });
    target.innerHTML = `<p class="answer info">${esc(out.alreadyAsked ? t("ask_already") : t("ask_sent", { names: out.sentTo.join(", ") }))}</p>`;
  }));
}

// Live events from the server, for the wide page and the senior's column.
export function onCheck() { loadList(true); }
export async function onAnswer(a) {
  toast(t(`answer_${a.answer}`, { name: a.guardianName }), a.answer === "scam" ? "danger" : "ok");
  if ($("#reader") && state.current && state.detail?.check?.id === a.checkId) openMessage(state.current, { keepFocus: true });
  // The open message of My messages or Blocked: its answer lines only, focus stays.
  const s = N;
  if (!s?.open || s.detail?.check?.id !== a.checkId || !onScreen()) return;
  const id = s.open;
  const d = await api(`/api/messages/${encodeURIComponent(id)}`).catch(() => null);
  if (!d || s !== N || s.open !== id || !onScreen()) return;
  s.detail = d;
  patch("#msgAnswers", (d.answers || []).map(answerLine).join(""));
}
export function onSync(status) {
  if (N) N.status = status;
  const el = $("#syncLine");
  if (el) el.innerHTML = syncLine(status);
  if (status.gmail?.syncStatus === "ok") loadList(true);
  else if (onScreen() && !N.open) patch("#msgBanner", bannerLine(status));
}

// ---------------------------------------------------------------------------
// The senior's column (2026-11-04 redesign, _product/specs/protection-menu.md,
// Screens; frames 1e and 1f of
// _product/design/2026-11-04-redesign/claude-design/Prudence Redesign.dc.html).
//
//   renderMessages(root, status)  #/messages, "My messages" (frame 1e): the
//     back link to Today, two chips (My inbox, Check first), one white card
//     with a row per message: the sender, the subject and the date, the
//     verdict pill with its icon and word, a chevron. What needs her first
//     (Be careful or Scam, still in the inbox) sits on top.
//   renderBlocked(root, status)   #/blocked, the fourth tab (frame 1f): the
//     count sentence, one card per message Prudence moved out of the inbox
//     with the red Scam pill and "Put it back"; what she put back earlier
//     follows under "You put these back", with "Move it away again".
//
// Tapping a row (or a Blocked card's words) opens the message on the same
// screen as the shared verdict card (card.js, frames 1l to 1n) with Listen,
// the one move the message allows (Put it back, Move it away, Move it away
// again) and "Still unsure?". Every move shows "Put back." or "Moved away."
// with Undo in its place, on the same screen. The open message is module
// state, not a route: the back link draws the list again.
//
// The moves and their undo (src/routes/mail.js, src/sync/actions.js):
//   Put it back         POST put-back      undo: POST undo-keep
//   Move it away        POST file-as-scam  undo: POST undo-throw
//   Move it away again  POST undo-keep     undo: POST put-back
// Live events (main.js calls onCheck, onSync, loadList, onAnswer) refresh the
// list in place when one of these screens is on the root, never moving focus.
// Styles: "redesign: messages and blocked (mail.js)" at the end of styles.css.

const DAY = 86400000;
const enc = encodeURIComponent;
const firstName = (s) => String(s || "").trim().split(/\s+/)[0] || "";
const flagged = (c) => Boolean(c && !c.restored && c.feedback !== "not_scam" && (c.verdict === "scam" || c.verdict === "be_careful"));
const byDate = (a, b) => new Date(b.date) - new Date(a.date);
const thisWeek = (m) => Date.now() - new Date(m.date) < 7 * DAY;

// "Nov 3, 8:43 PM" for the last seven days, "Oct 27" before, the year when
// it is not this one; time: false for the date alone (Blocked, frame 1f).
function shortDate(iso, { time = true } = {}) {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const opts = { month: "short", day: "numeric" };
  if (d.getFullYear() !== new Date().getFullYear()) opts.year = "numeric";
  if (time && Date.now() - d < 7 * DAY) Object.assign(opts, { hour: "numeric", minute: "2-digit" });
  // One piece: "1 nov." never breaks after the day.
  return d.toLocaleString(getLang() === "fr" ? "fr-FR" : "en-US", opts).replace(/\s/g, "\u00a0");
}
const quoted = (s) => (getLang() === "fr" ? `« ${s} »` : `“${s}”`);
const greyPill = (ic, key) => `<span class="pill-verdict is-grey">${icon(ic, 20, 2.5)}${esc(t(key))}</span>`;
// The pill of a row: a message put back is grey "Put back by you", one not
// checked yet is grey "Not checked yet" (never Safe), the rest their verdict.
function rowPill(m) {
  const c = m.check;
  if (c?.restored) return greyPill("mail", "pill_back");
  if (!c || !["scam", "be_careful", "safe"].includes(c.verdict)) return greyPill("clock", "pill_unchecked");
  return verdictPill(c.verdict);
}

// One screen on the root at a time. paint() counts the drawings, so a late
// answer meant for an older drawing (or another screen) is dropped.
let N = null;
let painted = 0;
const live = (n) => N && n === painted && N.root.isConnected && N.root.dataset.view === N.kind;
const onScreen = () => N && N.root.isConnected && N.root.dataset.view === N.kind;

function newScreen(root, status, kind) {
  N = { root, status, kind, filter: "inbox", inbox: [], scam: [], loaded: false, error: null, guardian: null,
    done: new Map(), keep: new Map(), open: null, detail: null, links: null };
  return N;
}

async function loadNarrow({ fresh = false } = {}) {
  const s = N;
  const people = s.guardian === null ? api("/api/guardians").catch(() => ({ guardians: [] })) : null;
  const inbox = api(`/api/inbox?box=inbox${fresh || !s.loaded ? "&fresh=1" : ""}`);
  const scam = s.kind === "blocked" ? api(`/api/inbox?box=scam${fresh || !s.loaded ? "&fresh=1" : ""}`) : null;
  try {
    // Blocked reads the inbox too: what she put back sits there now, and a
    // message that still is in the inbox was labelled, not moved.
    const [a, b] = await Promise.all([inbox, scam]);
    s.inbox = a.messages || [];
    if (b) s.scam = b.messages || [];
    s.error = null;
  } catch (e) {
    if (!s.loaded) s.error = e;
  }
  s.loaded = true;
  if (people) {
    const g = ((await people).guardians || []).find((x) => x.status === "active");
    s.guardian = g ? firstName(g.name) : "";
  }
}

function errorHtml(e) {
  if (e?.status === 409) return `<div class="banner danger"><p>${esc(t("reconnect"))}</p><a class="btn btn-gold" href="/auth/google?mode=gmail">${esc(t("reconnect_btn"))}</a></div>`;
  return `<p class="banner danger">${esc(t("sync_error"))}</p><button id="msgRetry" class="btn btn-outline btn-big" type="button">${esc(t("retry"))}</button>`;
}
// The status banners only (reconnect, first pass): "all is well" is Today's to say.
const bannerLine = (status) => (status?.gmail?.needsReconnect || (status?.gmail && !status.gmail.ready) ? syncLine(status) : "");

function paint(html, { focus = true } = {}) {
  N.root.innerHTML = html;
  if (focus) focusHeading(N.root);
  return ++painted;
}

// Redraws one part of the screen; focus stays on the row or button it was on.
function patch(where, html) {
  const box = $(where, N.root);
  if (!box) return;
  const el = box.contains(document.activeElement) ? document.activeElement : null;
  const sel = el?.dataset.id ? `[data-id="${CSS.escape(el.dataset.id)}"]` : el?.dataset.open ? `[data-open="${CSS.escape(el.dataset.open)}"]` : "";
  box.innerHTML = html;
  if (sel) $(sel, box)?.focus();
}

// ---- My messages (frame 1e) ----

export async function renderMessages(root, status) {
  newScreen(root, status, "messages");
  const n = drawMessages({ focus: false });
  await loadNarrow({ fresh: true });
  if (!live(n)) return;
  fillMessages();
}

function drawMessages({ focus = true } = {}) {
  const chip = (key, label) => `<button class="chip chip-small" type="button" data-filter="${key}" aria-pressed="${N.filter === key}">${esc(t(label))}</button>`;
  const n = paint(`
    <div class="screen is-snug msg-screen">
      <a class="btn-back" href="#/today">${icon("chevron-left", 28, 2.5)}${esc(t("v2_tab_today"))}</a>
      <h1 class="screen-title">${esc(t("msg_title"))}</h1>
      <div id="msgBanner">${bannerLine(N.status)}</div>
      <div class="chip-row is-small" role="group" aria-label="${esc(t("msg_filters"))}">${chip("inbox", "msg_chip_inbox")}${chip("first", "msg_chip_first")}</div>
      <div id="msgList" aria-live="polite">${N.loaded ? "" : `<p class="msg-wait">${esc(t("please_wait"))}</p>`}</div>
    </div>`, { focus });
  N.root.querySelectorAll("[data-filter]").forEach((b) => b.addEventListener("click", () => {
    N.filter = b.dataset.filter;
    N.root.querySelectorAll("[data-filter]").forEach((x) => x.setAttribute("aria-pressed", String(x === b)));
    fillMessages();
  }));
  if (N.loaded) fillMessages();
  return n;
}

function shownMessages() {
  const all = N.inbox.slice();
  const list = N.filter === "first" ? all.filter((m) => flagged(m.check)) : all;
  return list.sort((a, b) => (flagged(b.check) - flagged(a.check)) || byDate(a, b));
}

function fillMessages() {
  if (!$("#msgList", N.root)) return;
  if (N.error) { patch("#msgList", errorHtml(N.error)); $("#msgRetry", N.root)?.addEventListener("click", () => renderMessages(N.root, N.status)); return; }
  const list = shownMessages();
  if (!list.length) { patch("#msgList", `<p class="reassure">${esc(t(N.filter === "first" ? "msg_none_first" : "empty_box"))}</p>`); return; }
  patch("#msgList", `<ul class="msg-list" aria-label="${esc(t(N.filter === "first" ? "msg_chip_first" : "msg_chip_inbox"))}">${list.map((m) => `
    <li><button class="msg-row" type="button" data-id="${esc(m.id)}">
      <span class="msg-words">
        <span class="msg-from">${esc(m.fromName || m.from)}</span>
        <span class="msg-line">${esc(m.subject || t("no_subject"))} · ${esc(shortDate(m.date))}</span>
        ${rowPill(m)}
      </span>
      ${icon("chevron-right", 28, 2.5)}
    </button></li>`).join("")}</ul>`);
  N.root.querySelectorAll("#msgList .msg-row").forEach((b) => b.addEventListener("click", () => openNarrow(b.dataset.id)));
}

// ---- Blocked (frame 1f) ----

export async function renderBlocked(root, status) {
  newScreen(root, status, "blocked");
  const n = drawBlocked({ focus: false });
  await loadNarrow({ fresh: true });
  if (!live(n)) return;
  fillBlocked();
}

function drawBlocked({ focus = true } = {}) {
  const n = paint(`
    <div class="screen is-snug blk-screen">
      <h1 class="screen-title blk-title">${esc(t("blk_title"))}</h1>
      <div id="msgBanner">${bannerLine(N.status)}</div>
      <div id="blkList" aria-live="polite">${N.loaded ? "" : `<p class="msg-wait">${esc(t("please_wait"))}</p>`}</div>
    </div>`, { focus });
  if (N.loaded) fillBlocked();
  return n;
}

// The rows of Blocked: what sits in the Prudence folder now, and below what
// she put back. A row she has just moved keeps its place (N.keep) while its
// "Put back." or "Moved away." line shows, even once the folder has changed.
function blockedRows() {
  const inInbox = new Set(N.inbox.map((m) => m.id));
  const now = new Map();
  for (const m of N.scam) {
    if (m.check?.restored) now.set(m.id, { m, put: true });
    else if (!inInbox.has(m.id) && m.check?.action !== "labeled") now.set(m.id, { m, put: false });
  }
  for (const m of N.inbox) if (m.check?.restored && m.check.action === "moved" && !now.has(m.id)) now.set(m.id, { m, put: true });
  for (const [id, row] of N.keep) {
    if (!N.done.has(id)) { N.keep.delete(id); continue; }
    now.set(id, { ...row, m: now.get(id)?.m || row.m });
  }
  const rows = [...now.values()];
  return { moved: rows.filter((r) => !r.put).sort((a, b) => byDate(a.m, b.m)), put: rows.filter((r) => r.put).sort((a, b) => byDate(a.m, b.m)) };
}

function blockedLead(moved) {
  // Counts what is in the folder now: a row just put back no longer is.
  const inFolder = moved.filter((r) => N.done.get(r.m.id)?.kind !== "back").map((r) => r.m);
  const n = inFolder.length;
  if (!n) return `<p class="blk-none">${icon("check-circle", 28, 2.5)}<span>${esc(t("blk_none"))}</span></p>`;
  const week = inFolder.every(thisWeek);
  const key = week ? (n === 1 ? "blk_lead_one" : "blk_lead") : (n === 1 ? "blk_lead_all_one" : "blk_lead_all");
  return `<p class="screen-lead">${esc(t(key, { n }))}</p>`;
}

function blockedCard(r) {
  const m = r.m;
  const done = N.done.get(m.id);
  const words = `
      <button class="blk-words" type="button" data-open="${esc(m.id)}">
        <span class="msg-from">${esc(quoted(m.fromName || m.from))}</span>
        <span class="msg-line">${esc(m.subject || t("no_subject"))} · ${esc(shortDate(m.date, { time: false }))}</span>
        ${r.put ? greyPill("mail", "pill_back") : verdictPill("scam")}
      </button>`;
  return `<li class="row-card blk-row" data-row="${esc(m.id)}">${words}${doneOr(m, done, r.put
    ? `<button class="btn btn-outline btn-big" type="button" data-id="${esc(m.id)}" data-act="again">${esc(t("blk_move_again"))}</button>`
    : `<button class="btn btn-outline btn-big" type="button" data-id="${esc(m.id)}" data-act="back">${esc(t("blk_put_back"))}</button>`)}</li>`;
}

function fillBlocked() {
  if (!$("#blkList", N.root)) return;
  if (N.error) { patch("#blkList", errorHtml(N.error)); $("#msgRetry", N.root)?.addEventListener("click", () => renderBlocked(N.root, N.status)); return; }
  const { moved, put } = blockedRows();
  patch("#blkList", `
    ${blockedLead(moved)}
    ${moved.length ? `<ul class="blk-list">${moved.map(blockedCard).join("")}</ul>` : ""}
    ${put.length ? `<h2 class="section-title blk-put-title">${esc(t("blk_restored_title"))}</h2><ul class="blk-list">${put.map(blockedCard).join("")}</ul>` : ""}`);
  bindMoves($("#blkList", N.root), (m) => fillBlocked());
  N.root.querySelectorAll("#blkList [data-open]").forEach((b) => b.addEventListener("click", () => openNarrow(b.dataset.open)));
}

// ---- The moves and their undo, shared by Blocked's cards and the open message ----

const MOVES = {
  back: { path: "put-back", undo: "undo-keep", line: "blk_back_done", note: "put_back_done" },
  away: { path: "file-as-scam", undo: "undo-throw", line: "msg_moved", note: "td_moved_note_one" },
  again: { path: "undo-keep", undo: "put-back", line: "msg_moved", note: "td_moved_note_one" },
};
const post = (id, path) => api(`/api/messages/${enc(id)}/${path}`, { method: "POST", body: {} });

// After a move: its line and Undo instead of the button; otherwise the button.
function doneOr(m, done, button) {
  if (!done) return button;
  const mv = MOVES[done.kind];
  return `
      <div class="msg-done" role="status">
        <p class="msg-done-line">${icon("check-circle", 26, 2.5)}<span>${esc(t(mv.line))}</span></p>
        <p class="msg-done-note">${esc(t(mv.note))}</p>
      </div>
      <button class="btn btn-outline btn-big" type="button" data-id="${esc(m.id)}" data-act="undo">${esc(t("v2_undo"))}</button>`;
}


// Put back a message that has no check yet (it was moved before the checks
// were kept): the server needs one first, so check it, then put it back.
async function putBack(id) {
  try { await post(id, "put-back"); } catch (e) {
    if (e.status !== 404) throw e;
    await api(`/api/messages/${enc(id)}/check`, { method: "POST", body: { links: false } });
    await post(id, "put-back");
  }
}

async function runMove(id, act) {
  const done = N.done.get(id);
  if (act === "undo") {
    if (!done) return;
    const undo = MOVES[done.kind].undo;
    await (undo === "put-back" ? putBack(id) : post(id, undo));
    N.done.delete(id);
  } else {
    if (act === "back") await putBack(id);
    else await post(id, MOVES[act].path);
    N.done.set(id, { kind: act });
  }
}

// Wires the move buttons in box; redraw() paints the part again afterwards.
function bindMoves(box, redraw) {
  box?.querySelectorAll("[data-act]").forEach((b) => b.addEventListener("click", (ev) => busy(ev.currentTarget, async () => {
    const s = N;
    const id = b.dataset.id;
    const act = b.dataset.act;
    if (act !== "undo" && s.kind === "blocked") {
      const rows = blockedRows();
      const row = [...rows.moved, ...rows.put].find((r) => r.m.id === id);
      if (row) s.keep.set(id, row);
    }
    await runMove(id, act);
    if (s !== N) return;
    await loadNarrow({ fresh: true });
    if (s !== N || !onScreen()) return;
    await redraw();
    // Focus goes to what replaced the button: Undo after a move, the move after Undo.
    const next = $(`[data-id="${CSS.escape(id)}"][data-act]`, N.root);
    next?.focus();
  })));
}

// ---- One message, opened in place (frames 1l to 1n) ----

async function openNarrow(id) {
  const s = N;
  s.open = id;
  s.detail = null;
  s.links = null;
  const back = s.kind === "blocked" ? "blk_title" : "msg_title";
  const n = paint(`
    <div class="screen is-snug msg-open">
      <div class="screen-head"><button id="msgBack" class="btn-back" type="button">${icon("chevron-left", 28, 2.5)}${esc(t(back))}</button></div>
      <p class="msg-wait">${esc(t("please_wait"))}</p>
    </div>`, { focus: false });
  $("#msgBack", s.root).addEventListener("click", closeNarrow);
  $("#msgBack", s.root).focus();
  try {
    const d = await api(`/api/messages/${enc(id)}`);
    if (!live(n) || s.open !== id) return;
    s.detail = d;
    drawOpen();
  } catch (e) {
    if (!live(n) || s.open !== id) return;
    s.root.querySelector(".msg-wait").outerHTML = `<p class="banner danger">${esc(e.status === 409 ? t("reconnect") : e.status === 404 ? e.message : t("sync_error"))}</p>`;
  }
}

function closeNarrow() {
  const id = N.open;
  N.open = null;
  N.detail = null;
  if (N.kind === "blocked") drawBlocked({ focus: false }); else drawMessages({ focus: false });
  const row = $(`[data-id="${CSS.escape(id || "")}"].msg-row, [data-open="${CSS.escape(id || "")}"]`, N.root);
  if (row) row.focus(); else focusHeading(N.root);
  loadNarrow().then(() => { if (onScreen() && !N.open) (N.kind === "blocked" ? fillBlocked : fillMessages)(); });
}

// The one move this message allows today, as on the wide reader: Put it
// back when Prudence moved it, Move it away when a Be careful or a Scam
// still sits in the inbox, Move it away again when she put it back.
function moveFor(c, inInbox) {
  if (!c) return inInbox ? null : "back"; // in the Prudence folder, not checked yet
  if (c.restored) return c.action === "moved" && c.feedback === "not_scam" ? "again" : null;
  if (c.action === "moved") return "back";
  const v = c.verdict?.verdict;
  return v === "be_careful" || v === "scam" ? "away" : null;
}
const MOVE_LABEL = { back: "blk_put_back", away: "msg_move_away", again: "blk_move_again" };

function drawOpen({ focus = true } = {}) {
  const s = N;
  const { message: m, check: c, answers } = s.detail;
  const v = c?.verdict && ["scam", "be_careful", "safe"].includes(c.verdict.verdict) ? c.verdict : null;
  const back = s.kind === "blocked" ? "blk_title" : "msg_title";
  const kind = s.done.get(m.id) ? null : moveFor(c, (m.labelIds || ["INBOX"]).includes("INBOX"));
  const move = kind ? `<button class="btn btn-outline btn-big" type="button" data-id="${esc(m.id)}" data-act="${kind}">${esc(t(MOVE_LABEL[kind]))}</button>` : "";
  const acts = doneOr(m, s.done.get(m.id), move);
  paint(`
    <div class="screen is-snug msg-open">
      <div class="screen-head">
        <button id="msgBack" class="btn-back" type="button">${icon("chevron-left", 28, 2.5)}${esc(t(back))}</button>
        ${v ? `<button id="msgListen" class="btn-listen" type="button">${icon("speaker", 26)}${esc(t("v2_read_short"))}</button>` : ""}
      </div>
      <div class="msg-which">
        <p class="msg-from">${esc(m.fromName || m.from)}</p>
        <p class="msg-line">${esc(m.subject || t("no_subject"))} · ${esc(shortDate(m.date))}</p>
      </div>
      <div id="msgAnswers">${(answers || []).map(answerLine).join("")}</div>
      ${verdictCardHtml({ verdict: v, message: { fromName: m.fromName, from: m.from, subject: m.subject, body: m.body }, ids: "msg" })}
      ${v ? "" : `<button id="msgCheckNow" class="btn btn-gold btn-big" type="button">${esc(t("check_now"))}</button>`}
      ${acts ? `<div id="msgMoves" class="msg-moves">${acts}</div>` : ""}
      ${v && m.links?.length ? `<button id="msgLinks" class="btn btn-outline btn-big" type="button">${esc(t("msg_links"))}</button>` : ""}
      <div id="msgLinkOut">${s.links || ""}</div>
      ${v && c?.id ? unsureRowHtml({ verdict: v.verdict, guardianName: s.guardian || "", folded: v.verdict === "safe", ids: "msg" }) : ""}
      <div id="msgAsk"></div>
    </div>`, { focus });
  const id = m.id;
  $("#msgBack", s.root).addEventListener("click", closeNarrow);
  $("#msgListen", s.root)?.addEventListener("click", () => readAloud(v));
  $("#msgCheckNow", s.root)?.addEventListener("click", (e) => busy(e.currentTarget, () => recheckNarrow(id, false), t("checking")));
  $("#msgLinks", s.root)?.addEventListener("click", (e) => busy(e.currentTarget, () => recheckNarrow(id, true), t("links_checking")));
  bindVerdictCard(s.root, { ids: "msg", onAsk: () => openAsk({ checkId: c.id, verdict: v, message: m, target: $("#msgAsk", s.root) }) });
  bindMoves($("#msgMoves", s.root), async () => {
    if (s.open !== id) return;
    try { s.detail = await api(`/api/messages/${enc(id)}`); } catch { /* keep the last one */ }
    if (s === N && s.open === id && onScreen()) drawOpen({ focus: false });
  });
}

// "Check it now" (no verdict yet) and "Check the links": the message is
// checked again and the card drawn with the new answer.
async function recheckNarrow(id, links) {
  const s = N;
  const out = await api(`/api/messages/${enc(id)}/check`, { method: "POST", body: { links } });
  if (s !== N || s.open !== id) return;
  if (links) {
    const rows = Object.entries(out.linkInspection || {}).filter(([, i]) => i.final_url);
    const host = (u) => { try { return new URL(u).hostname; } catch { return String(u); } };
    s.links = `<div class="msg-links" role="status"><p>${esc(t("msg_links_done"))}</p>${rows.length ? `<ul class="link-list">${rows.map(([href, i]) => `<li>${esc(host(href))} ${esc(t("link_goes"))} <strong>${esc(host(i.final_url))}</strong></li>`).join("")}</ul>` : ""}</div>`;
  }
  s.detail = await api(`/api/messages/${enc(id)}`);
  if (s !== N || s.open !== id || !onScreen()) return;
  drawOpen({ focus: false });
  if (links) $("#msgLinks", s.root)?.focus();
  else focusHeading($("#msgCard", s.root) || s.root);
  loadNarrow({ fresh: true });
}

// A live event: new data for the list on screen, drawn in place.
async function refreshNarrow() {
  if (!onScreen() || !N.loaded) return;
  const s = N;
  await loadNarrow({ fresh: true });
  if (s !== N || !onScreen() || s.open) return;
  patch("#msgBanner", bannerLine(s.status));
  (s.kind === "blocked" ? fillBlocked : fillMessages)();
}
