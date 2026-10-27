// My email: the inbox and the two Scam Shield folders, read live from
// Gmail, with the verdict, undo, link check and "Ask my trusted person".

import { api } from "../api.js";
import { t, ago } from "../i18n.js";
import { $, $$, esc, pill, verdictCard, readAloud, toast } from "../ui.js";

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
        <nav class="box-tabs" aria-label="Folders">
          ${["inbox", "scam", "careful"].map((b) => `<a class="tab${b === box ? " active" : ""}" href="#/${b === "inbox" ? "inbox" : `folder/${b}`}">${t(`box_${b}`)}</a>`).join("")}
        </nav>
        <div id="emailList" class="email-list" role="listbox" aria-label="${t("nav_inbox")}"><p>${t("please_wait")}</p></div>
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
    <button class="email-item${m.unread ? " unread" : ""}" role="option" data-i="${i}" aria-selected="${state.current === m.id}">
      <p class="email-from">${esc(m.fromName || m.from)}</p>
      <p class="email-subject">${esc(m.subject || "(no subject)")}</p>
      <p class="email-date">${esc(new Date(m.date).toLocaleString())}</p>
      ${pill(m.check)}
    </button>`).join("");
  $$(".email-item", list).forEach((b) => b.addEventListener("click", () => openMessage(state.messages[Number(b.dataset.i)].id)));
}

export async function openMessage(id) {
  state.current = id;
  renderList();
  $("#emptyState").hidden = true;
  const reader = $("#reader");
  reader.hidden = false;
  reader.innerHTML = `<div class="verdict caution"><h3>${t("checking")}</h3><p>${t("please_wait")}</p></div>`;
  try {
    state.detail = await api(`/api/messages/${encodeURIComponent(id)}`);
    renderReader();
  } catch (e) {
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
  const v = check?.verdict;
  const actionNote = check?.restored ? "" : check?.action === "moved" ? `<p class="note">${t("moved_note")}</p>` : check?.action === "labeled" ? `<p class="note">${t("labeled_note")}</p>` : "";
  reader.innerHTML = `
    <p class="mail-meta">${esc(m.fromName)} &lt;${esc(m.from)}&gt; · ${esc(new Date(m.date).toLocaleString())}</p>
    <h2 id="mailSubject">${esc(m.subject || "(no subject)")}</h2>
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
  $("#checkNow")?.addEventListener("click", () => recheck(false));
  $("#readAloudBtn")?.addEventListener("click", () => readAloud(v));
  $("#askBtn")?.addEventListener("click", () => openAsk({ checkId: check.id, verdict: v, message: m, target: $("#askPanel") }));
  $("#putBackBtn")?.addEventListener("click", () => act("put-back", t("put_back_done")));
  $("#fileScamBtn")?.addEventListener("click", () => act("file-as-scam", t("file_scam_done")));
  $("#linksBtn")?.addEventListener("click", () => recheck(true));
}

async function recheck(links) {
  const target = links ? $("#linkResult") : $("#reader");
  if (links) target.innerHTML = `<p>${t("links_checking")}</p>`;
  try {
    const out = await api(`/api/messages/${encodeURIComponent(state.current)}/check`, { method: "POST", body: { links } });
    if (links) {
      const rows = Object.entries(out.linkInspection || {}).filter(([, i]) => i.final_url);
      target.innerHTML = rows.length ? `<ul class="link-list">${rows.map(([href, i]) => `<li>${esc(new URL(href).hostname)} ${t("link_goes")} <strong>${esc(new URL(i.final_url).hostname)}</strong>${i.domain_age_days != null ? ` · ${i.domain_age_days} d` : ""}${i.page_shows ? `<br><span class="small">${esc(i.page_shows)}</span>` : ""}</li>`).join("")}</ul>` : "";
    }
    await openMessage(state.current);
    loadList(true);
  } catch (e) { toast(e.message, "danger"); }
}

async function act(path, done) {
  try {
    await api(`/api/messages/${encodeURIComponent(state.current)}/${path}`, { method: "POST", body: {} });
    toast(done, "ok");
    await loadList(true);
    await openMessage(state.current);
  } catch (e) { toast(e.message, "danger"); }
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
  $("#sendAsk", target).addEventListener("click", async () => {
    const ids = $$("input[name=g]:checked", target).map((i) => i.value);
    try {
      const out = await api("/api/ask", { method: "POST", body: { checkId, guardianshipIds: ids, includeText: $("#includeText", target).checked, message: provided ? message : undefined } });
      target.innerHTML = `<p class="answer info">${esc(t("ask_sent", { names: out.sentTo.join(", ") }))}</p>`;
    } catch (e) { toast(e.message, "danger"); }
  });
}

// Live events from the server.
export function onCheck() { loadList(true); }
export function onAnswer(a) {
  toast(t(`answer_${a.answer}`, { name: a.guardianName }), a.answer === "scam" ? "danger" : "ok");
  if (state.current && state.detail?.check?.id === a.checkId) openMessage(state.current);
}
export function onSync(status) {
  const el = $("#syncLine");
  if (el) el.innerHTML = syncLine(status);
  if (status.gmail?.syncStatus === "ok") loadList(true);
}
