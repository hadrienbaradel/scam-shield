// My email: the inbox and the two Scam Shield folders, read live from
// Gmail, with the verdict, undo, link check and "Ask my trusted person".

import { api } from "../api.js";
import { t, ago, dateTime } from "../i18n.js";
import { $, $$, esc, pill, verdictCard, readAloud, toast, focusHeading, busy } from "../ui.js";

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
  if (!list) return;
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

// Live events from the server.
export function onCheck() { loadList(true); }
export function onAnswer(a) {
  toast(t(`answer_${a.answer}`, { name: a.guardianName }), a.answer === "scam" ? "danger" : "ok");
  if (state.current && state.detail?.check?.id === a.checkId) openMessage(state.current, { keepFocus: true });
}
export function onSync(status) {
  const el = $("#syncLine");
  if (el) el.innerHTML = syncLine(status);
  if (status.gmail?.syncStatus === "ok") loadList(true);
}
