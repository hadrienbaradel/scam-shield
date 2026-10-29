// The senior app, mobile first (V2 mockups): "Today" says whether anything
// needs the person, then one message at a time with two big buttons. A
// slide to the left is only a shortcut for "Throw it away", and every
// action can be undone on the next screen. The same screens run on the
// person's own Gmail and on the public demo (Linda or Françoise).

import { api } from "../api.js";
import { t, getLang } from "../i18n.js";
import { $, esc, verdictClass, readAloud, toast, busy } from "../ui.js";
import { syncLine } from "./mail.js";

let S = null; // the screen state: source, info, queue, index, details, last action
const demoDone = new Set(); // demo cards handled in this visit

const firstName = (s) => String(s || "").trim().split(/\s+/)[0] || "";
// The badge already says "Scam": the headline need not start with it again.
const headlineOf = (h) => String(h || "").replace(/^(scam|be careful|safe|arnaque|prudence|attention|sans danger|vigilance)\s*:\s*/i, "").replace(/^./, (c) => c.toUpperCase());
const enc = encodeURIComponent;

// Where the messages come from: the person's Gmail through the API.
function liveSource(status) {
  return {
    demo: false,
    async load() {
      const [inbox, scam, people] = await Promise.all([
        api("/api/inbox?box=inbox&fresh=1"),
        api("/api/inbox?box=scam").catch(() => ({ messages: [] })),
        api("/api/guardians").catch(() => ({ guardians: [] })),
      ]);
      const active = (people.guardians || []).filter((g) => g.status === "active");
      return {
        name: firstName(status.user?.name),
        guardian: active[0] || null,
        checked: inbox.messages.filter((m) => m.check).length,
        moved: scam.messages.filter((m) => m.check?.action === "moved" && !m.check.restored).length,
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
      return { name: data.name, guardian: data.guardian, checked: data.checked, moved: 0, queue: data.queue.filter((q) => !demoDone.has(q.id)) };
    },
    async open(item) {
      const { callBack, ...verdict } = await api("/api/demo/check", { method: "POST", body: { id: item.id } });
      return { verdict, message: item, callBack: callBack || null, checkId: null };
    },
    throwAway: async (item) => { demoDone.add(item.id); },
    undoThrow: async (item) => { demoDone.delete(item.id); },
    keep: async (item) => { demoDone.add(item.id); },
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

export async function renderToday(root, status, { demo = false } = {}) {
  S = { root, status, source: demo ? demoSource() : liveSource(status), index: 0, details: new Map(), open: { why: false, body: false } };
  root.innerHTML = `<div class="v2"><p class="v2-wait">${t("please_wait")}</p></div>`;
  try {
    S.info = await S.source.load();
  } catch (e) {
    root.innerHTML = `<div class="v2">${status.gmail ? syncLine(status) : ""}<p class="banner danger">${esc(e.status === 409 ? t("reconnect") : t("sync_error"))}</p></div>`;
    return;
  }
  S.queue = S.info.queue;
  drawToday();
}

const greeting = () => {
  const h = new Date().getHours();
  return t(h < 12 ? "v2_morning" : h < 18 ? "v2_afternoon" : "v2_evening", { name: S.info.name });
};

function drawToday() {
  const n = S.queue.length;
  const g = S.info.guardian;
  S.root.innerHTML = `
    <div class="v2">
      ${S.source.demo ? `<p class="v2-demo">${t("v2_demo_note")}</p>` : syncLine(S.status)}
      <h1 class="v2-hello">${esc(greeting())}</h1>
      ${n === 0 ? `
        <section class="v2-status ok" aria-label="${t("v2_status_label")}">
          ${icon("shieldCheck", 60)}
          <p class="v2-status-big">${t("v2_safe")}</p>
          <p>${t("v2_checked", { n: S.info.checked })}</p>
        </section>` : `
        <section class="v2-status" aria-label="${t("v2_status_label")}">
          <p class="v2-status-big">${esc(n === 1 ? t("v2_need_one") : t("v2_need_many", { n }))}</p>
          <p>${t("v2_checked", { n: S.info.checked })} ${t("v2_one_at_a_time")}</p>
          <button id="v2Look" class="btn btn-gold v2-big" type="button">${esc(n === 1 ? t("v2_look_one") : t("v2_look"))} ${icon("next", 26)}</button>
        </section>`}
      ${S.info.moved ? `<p class="v2-line">${icon("folder", 26)} ${esc(t("v2_moved", { n: S.info.moved }))}</p>` : ""}
      ${g ? `<p class="v2-line"><span class="v2-avatar" aria-hidden="true">${esc(firstName(g.name).charAt(0))}</span> ${esc(t("v2_trusted", { name: firstName(g.name) }))}</p>`
    : S.source.demo ? "" : `<p class="v2-line"><a href="#/people">${t("v2_no_trusted")}</a></p>`}
    </div>`;
  $("#v2Look")?.addEventListener("click", () => openCard(0));
}

async function openCard(i) {
  S.index = Math.max(0, Math.min(i, S.queue.length - 1));
  S.open = { why: false, body: false };
  const item = S.queue[S.index];
  if (!item) return drawToday();
  S.root.innerHTML = `<div class="v2">${cardHeader()}<div class="v2-card caution"><p class="v2-badge">${t("checking")}</p><p>${t("please_wait")}</p></div></div>`;
  try {
    if (!S.details.has(item.id)) S.details.set(item.id, await S.source.open(item));
  } catch (e) {
    S.root.innerHTML = `<div class="v2">${cardHeader()}<p class="banner danger">${esc(e.message)}</p></div>`;
    bindHeader();
    return;
  }
  drawCard();
}

function cardHeader() {
  return `<header class="v2-head">
      <a class="v2-back" href="${S.source.demo ? "#/demo" : "#/"}" id="v2Back">${icon("back", 24)} ${t("v2_today")}</a>
      <span class="v2-count">${esc(t("v2_of", { i: S.index + 1, n: S.queue.length }))}</span>
      <button id="v2Read" class="v2-round" type="button" aria-label="${t("v2_read")}">${icon("speaker", 26)}</button>
    </header>`;
}

function bindHeader() {
  $("#v2Back")?.addEventListener("click", (e) => { e.preventDefault(); drawToday(); });
}

function drawCard() {
  const item = S.queue[S.index];
  const d = S.details.get(item.id);
  const v = d.verdict || {};
  const scam = v.verdict === "scam";
  const g = S.info.guardian;
  const reasons = v.reasons || [];
  const m = d.message || {};
  const word = v.verdict === "scam" ? t("pill_scam") : v.verdict === "be_careful" ? t("pill_careful") : t("pill_safe");
  const primary = !scam && d.callBack
    ? `<a class="btn btn-navy v2-action" href="tel:${esc(String(d.callBack.phone).replace(/[^\d+]/g, ""))}">${icon("phone", 28)} ${esc(t("v2_call", { name: firstName(d.callBack.name) }))}</a>`
    : `<button id="v2Throw" class="btn btn-danger v2-action" type="button">${icon("trash", 28)} ${t("v2_throw")}</button>`;
  const second = g
    ? `<button id="v2Ask" class="btn btn-gold v2-action" type="button">${icon("ask", 28)} ${esc(t("v2_ask", { name: firstName(g.name) }))}</button>`
    : `<a class="btn btn-gold v2-action" href="#/people">${icon("ask", 28)} ${t("v2_add_trusted")}</a>`;
  S.root.innerHTML = `
    <div class="v2">
      ${cardHeader()}
      <div class="v2-stack">
        <article id="v2Card" class="v2-card ${verdictClass(v.verdict)}" aria-labelledby="v2Headline">
          <p class="v2-badge"><span class="v2-badge-dot" aria-hidden="true">${icon(scam ? "alert" : v.verdict === "be_careful" ? "careful" : "check", 34)}</span>${esc(word)}</p>
          <h1 id="v2Headline" class="v2-headline">${esc(headlineOf(v.headline))}</h1>
          ${reasons[0] ? `<p class="v2-fact">${esc(reasons[0].text)}</p>` : ""}
          ${reasons[1] ? `<p class="v2-fact v2-fact-box">${esc(reasons[1].text)}</p>` : ""}
          ${v.action_text ? `<p class="v2-next">${esc(v.action_text)}</p>` : ""}
          <div class="v2-more">
            <button id="v2Why" class="btn btn-light-dark" type="button" aria-expanded="${S.open.why}">${t("v2_why")}</button>
            <button id="v2Body" class="btn btn-light-dark" type="button" aria-expanded="${S.open.body}">${S.open.body ? t("v2_hide") : t("v2_show")}</button>
          </div>
          <div id="v2WhyBox" ${S.open.why ? "" : "hidden"}>
            <ul class="why-list">${reasons.map((r) => `<li>${esc(r.text)}</li>`).join("")}</ul>
            ${v.real_company_says ? `<p class="note">${esc(v.real_company_says)}</p>` : ""}
            <p class="small">${esc(t("checked_by", { source: v.source || "Prudence" }))}</p>
          </div>
          <div id="v2BodyBox" ${S.open.body ? "" : "hidden"}>
            <p class="mail-meta">${esc(m.fromName || "")} &lt;${esc(m.from || "")}&gt;</p>
            ${m.subject ? `<p><strong>${esc(m.subject)}</strong></p>` : ""}
            <pre class="mail-body">${esc(m.body || "")}</pre>
          </div>
        </article>
      </div>
      <div class="v2-actions">${primary}${second}</div>
      ${!scam && d.callBack ? `<p class="v2-hint">${esc(t("v2_call_note", { name: firstName(d.callBack.name) }))}</p>` : ""}
      ${!scam && d.callBack ? `<button id="v2Throw" class="btn btn-light-dark v2-quiet" type="button">${t("v2_throw")}</button>` : ""}
      ${scam ? `<p class="v2-hint">${icon("left", 20)} ${t("v2_swipe_hint")}</p>` : ""}
      <button id="v2Keep" class="v2-link" type="button">${t("v2_keep")}</button>
    </div>`;
  bindHeader();
  $("#v2Read").addEventListener("click", () => readAloud(v));
  $("#v2Why").addEventListener("click", () => { S.open.why = !S.open.why; drawCard(); });
  $("#v2Body").addEventListener("click", () => { S.open.body = !S.open.body; drawCard(); });
  $("#v2Throw")?.addEventListener("click", (e) => busy(e.currentTarget, doThrow));
  $("#v2Ask")?.addEventListener("click", () => drawAsk());
  $("#v2Keep").addEventListener("click", (e) => busy(e.currentTarget, doKeep));
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
  const end = () => {
    if (x0 === null) return;
    x0 = null;
    if (dx < -card.offsetWidth * 0.4) return doThrow();
    card.style.transform = "";
  };
  card.addEventListener("pointerup", end);
  card.addEventListener("pointercancel", end);
}

async function doThrow() {
  const item = S.queue[S.index];
  await S.source.throwAway(item);
  S.queue.splice(S.index, 1);
  drawDone({ kind: "thrown", item, at: S.index });
}

async function doKeep() {
  const item = S.queue[S.index];
  await S.source.keep(item);
  S.queue.splice(S.index, 1);
  drawDone({ kind: "kept", item, at: S.index });
}

function drawDone(last) {
  const more = S.queue.length > 0;
  S.root.innerHTML = `
    <div class="v2">
      <section class="v2-done-note" role="status">
        <p class="v2-done-title">${icon("check", 26)} ${last.kind === "thrown" ? t("v2_thrown") : t("v2_kept")}</p>
        <p>${last.kind === "thrown" ? t("v2_thrown_note") : t("v2_kept_note")}</p>
        ${last.kind === "thrown" ? `<button id="v2Undo" class="btn v2-undo" type="button">${icon("undo", 22)} ${t("v2_undo")}</button>` : ""}
      </section>
      ${more ? `
        <button id="v2Next" class="btn btn-gold v2-big" type="button">${t("v2_next")} ${icon("next", 26)}</button>` : `
        <section class="v2-all-done" aria-label="${t("v2_all_done")}">
          <span class="v2-big-check" aria-hidden="true">${icon("check", 64)}</span>
          <h1>${t("v2_all_done")}</h1>
          <p>${t("v2_all_done_note")}</p>
        </section>`}
      <button id="v2Today" class="btn btn-navy v2-big" type="button">${t("v2_back_to_today")}</button>
    </div>`;
  $("#v2Undo")?.addEventListener("click", (e) => busy(e.currentTarget, async () => {
    await S.source.undoThrow(last.item);
    S.queue.splice(last.at, 0, last.item);
    openCard(last.at);
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
  S.root.innerHTML = `
    <div class="v2">
      <header class="v2-head"><button id="v2AskBack" class="v2-back" type="button">${icon("back", 24)} ${t("v2_back_message")}</button></header>
      <h1 class="v2-hello">${esc(t("v2_ask", { name }))}</h1>
      <p>${esc(t("v2_ask_preview", { name }))}</p>
      <div class="shared-card">
        <p class="mail-meta">${esc(item.fromName || item.from || "")}</p>
        <p><strong>${esc(d.verdict.headline || "")}</strong></p>
        <ul>${(d.verdict.reasons || []).map((r) => `<li>${esc(r.text)}</li>`).join("")}</ul>
      </div>
      <label class="check"><input type="checkbox" id="v2IncludeText"> ${t("ask_include_text")}</label>
      <div id="v2AskOut" aria-live="polite"></div>
      <button id="v2Text" class="btn btn-gold v2-big" type="button">${icon("message", 26)} ${esc(t("v2_ask_text", { name }))}</button>
      <button id="v2Email" class="btn btn-light-dark v2-big" type="button">${esc(t("v2_ask_email"))}</button>
    </div>`;
  $("#v2AskBack").addEventListener("click", () => drawCard());
  const send = (via) => async () => {
    const out = await S.source.ask(item, d, { via, includeText: $("#v2IncludeText").checked });
    const box = $("#v2AskOut");
    if (out.alreadyAsked) { box.innerHTML = `<p class="answer info">${esc(t("ask_already"))}</p>`; return; }
    if (via === "email") { box.innerHTML = `<p class="answer info">${esc(t(S.source.demo ? "v2_demo_email" : "v2_emailed", { name }))}</p>`; return; }
    const msg = out.texts[0];
    const digits = String(msg.phone || "").replace(/[^\d+]/g, "");
    const sms = `sms:${digits}?&body=${enc(msg.body)}`;
    const wa = digits ? `https://wa.me/${digits.replace(/^\+/, "")}?text=${enc(msg.body)}` : null;
    box.innerHTML = `
      <div class="v2-text-ready">
        <p><strong>${esc(t("v2_text_ready", { name }))}</strong></p>
        <pre class="mail-body">${esc(msg.body)}</pre>
        ${S.source.demo ? `<p class="small">${t("v2_demo_text")}</p>` : `
          <a class="btn btn-gold v2-big" href="${esc(sms)}">${icon("message", 26)} ${t("v2_open_messages")}</a>
          ${wa ? `<a class="btn btn-light-dark v2-big" href="${esc(wa)}" target="_blank" rel="noopener">${t("v2_open_whatsapp")}</a>` : ""}
          ${digits ? "" : `<p class="small">${esc(t("v2_no_phone", { name }))}</p>`}`}
        <button id="v2Copy" class="btn btn-light-dark" type="button">${t("v2_copy")}</button>
      </div>`;
    $("#v2Text").hidden = true;
    $("#v2Copy").addEventListener("click", async () => {
      try { await navigator.clipboard.writeText(msg.body); toast(t("v2_copied"), "ok"); } catch { toast(t("v2_copy_failed"), "danger"); }
    });
  };
  $("#v2Text").addEventListener("click", (e) => busy(e.currentTarget, send("text")));
  $("#v2Email").addEventListener("click", (e) => busy(e.currentTarget, send("email")));
}

// Live updates: a new check or an answer refreshes "Today" when it is on screen.
export function onTodayEvent() {
  if (S && !S.source.demo && S.root.isConnected && $("#v2Look, .v2-status", S.root)) renderToday(S.root, S.status);
}

// Inline stroke icons (no emoji, no icon font); decorative, hidden from screen readers.
const PATHS = {
  shieldCheck: '<path d="M12 3l8 3v6c0 4.5-3.4 8.3-8 9-4.6-.7-8-4.5-8-9V6l8-3z"/><path d="M8.5 12l2.5 2.5 4.5-5"/>',
  next: '<path d="M9 6l6 6-6 6"/>', back: '<path d="M15 18l-6-6 6-6"/>', left: '<path d="M19 12H5"/><path d="M11 6l-6 6 6 6"/>',
  speaker: '<path d="M4 9v6h4l5 4V5L8 9H4z"/><path d="M16.5 8.5a5 5 0 0 1 0 7"/><path d="M19 6a8.5 8.5 0 0 1 0 12"/>',
  alert: '<path d="M12 3l9.5 16.5h-19L12 3z"/><path d="M12 10v4"/><path d="M12 17.5v.01"/>',
  careful: '<circle cx="12" cy="12" r="9"/><path d="M12 7.5v5.5"/><path d="M12 16.5v.01"/>',
  check: '<path d="M5 12.5l4.5 4.5L19 7.5"/>',
  trash: '<path d="M4 7h16"/><path d="M9 7V4h6v3"/><path d="M6 7l1 13h10l1-13"/>',
  ask: '<circle cx="9" cy="8" r="3.5"/><path d="M2.5 20c.8-3.5 3.4-5.5 6.5-5.5s5.7 2 6.5 5.5"/><path d="M17 8h5"/><path d="M19.5 5.5v5"/>',
  phone: '<path d="M5 4h4l2 5-2.5 1.5a11 11 0 0 0 5 5L15 13l5 2v4a2 2 0 0 1-2 2A16 16 0 0 1 3 6a2 2 0 0 1 2-2"/>',
  undo: '<path d="M9 14L4 9l5-5"/><path d="M4 9h10.5a5.5 5.5 0 0 1 0 11H11"/>',
  folder: '<path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/>',
  message: '<path d="M4 5h16v11H8l-4 4z"/>',
};
function icon(name, size = 24) {
  return `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${PATHS[name] || ""}</svg>`;
}
