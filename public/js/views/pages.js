// The other screens: welcome, first-time setup, check something, trusted
// people and phone, settings (incl. what we know, history, delete),
// guardian answers, scam-report review, and the public examples.

import { api } from "../api.js";
import { t, ago, getLang, dateTime } from "../i18n.js";
import { $, $$, esc, verdictCard, readAloud, toast, pill, busy } from "../ui.js";
import { openAsk } from "./mail.js";
import { toWav16k } from "../audio.js";

const SIGNIN_MESSAGES = { need_gmail: "signin_need_gmail", cancelled: "signin_cancelled", error: "signin_error", expired: "signin_expired" };

export function renderLanding(root, status) {
  const params = new URLSearchParams(location.search);
  const note = params.get("signin") ? t(SIGNIN_MESSAGES[params.get("signin")] || "signin_error") : params.get("invite") ? t("invite_expired") : "";
  const off = !status.googleConfigured;
  root.innerHTML = `
    <section class="hero">
      ${note ? `<p class="banner caution">${esc(note)}</p>` : ""}
      <h1>${t("landing_title")}</h1>
      <p class="lead">${t("landing_lead")}</p>
      ${off ? `<p class="banner caution">${t("not_configured")}</p>` : ""}
      <div class="hero-actions">
        <a class="btn btn-gold btn-big${off ? " disabled" : ""}" href="${off ? "#/" : "/auth/google?mode=gmail"}">${t("protect_me")}<span class="btn-sub">${t("protect_me_sub")}</span></a>
        <a class="btn btn-light-dark btn-big${off ? " disabled" : ""}" href="${off ? "#/" : "/auth/google?mode=basic"}">${t("im_guardian")}</a>
        <a class="btn btn-navy btn-big" href="#/demo">${t("try_demo")}</a>
      </div>
      <ul class="promises"><li>${t("promise_1")}</li><li>${t("promise_2")}</li><li>${t("promise_3")}</li></ul>
    </section>`;
}

export async function renderOnboarding(root, status, refresh) {
  const { breachOptions } = await api("/api/context");
  const country = getLang() === "fr" ? "FR" : "US";
  const steps = [
    () => `<h2>${t("onb_name_q")}</h2><label>${t("onb_name_q")}<input id="obName" value="${esc(status.user.name || "")}" autocomplete="given-name"></label>
           <h2>${t("onb_lang_q")}</h2><div class="choice-row"><button class="btn btn-light-dark btn-big lang-btn${getLang() === "en" ? " chosen" : ""}" data-l="en-US">English</button><button class="btn btn-light-dark btn-big lang-btn${getLang() === "fr" ? " chosen" : ""}" data-l="fr-FR">Français</button></div>`,
    () => `<h2>${t("onb_mode_q")}</h2>
           <label class="choice"><input type="radio" name="mode" value="move" ${status.user.actMode !== "label" ? "checked" : ""}><span><strong>${t("mode_move")}</strong><br>${t("mode_move_sub")}</span></label>
           <label class="choice"><input type="radio" name="mode" value="label" ${status.user.actMode === "label" ? "checked" : ""}><span><strong>${t("mode_label")}</strong><br>${t("mode_label_sub")}</span></label>
           <p class="reassure">${t("onb_mode_note")}</p>`,
    () => `<h2>${t("onb_people_q")}</h2><p>${t("onb_people_sub")}</p>${inviteForm()}<div id="inviteResult"></div>`,
    () => `<h2>${t("onb_breach_q")}</h2><p>${t("onb_breach_sub")}</p>
           ${breachOptions.filter((b) => !b.country || b.country === country).map((b) => `<label class="check"><input type="checkbox" name="breach" value="${esc(b.id)}"> ${esc(breachLabel(b))}</label>`).join("")}`,
  ];
  let i = 0;
  const draw = () => {
    root.innerHTML = `<section class="card narrow"><p class="small">${t("onb_title")} · ${i + 1}/${steps.length}</p>${steps[i]()}
      <div class="action-row">${i > 0 ? `<button class="btn btn-light-dark btn-big" id="obBack">${t("onb_back")}</button>` : ""}
      <button class="btn btn-navy btn-big" id="obNext">${i === steps.length - 1 ? t("onb_done") : t("onb_next")}</button></div></section>`;
    $$(".lang-btn", root).forEach((b) => b.addEventListener("click", async () => { await api("/api/me", { method: "PATCH", body: { locale: b.dataset.l } }); await refresh(); }));
    if (i === 2) bindInviteForm(root);
    $("#obBack")?.addEventListener("click", () => { i--; draw(); });
    $("#obNext").addEventListener("click", async () => {
      if (i === 0 && $("#obName").value.trim()) await api("/api/me", { method: "PATCH", body: { name: $("#obName").value.trim() } });
      if (i === 1) await api("/api/me", { method: "PATCH", body: { actMode: $("input[name=mode]:checked").value } });
      if (i === 3) {
        await api("/api/context/breaches", { method: "PUT", body: { ids: $$("input[name=breach]:checked", root).map((x) => x.value) } });
        await api("/api/me", { method: "PATCH", body: { onboarded: true } });
        location.hash = "#/inbox";
        return refresh();
      }
      i++; draw();
    });
  };
  draw();
}

// Breach names come from the server in English; the one without a company
// or a date is said in the person's language.
const breachLabel = (b) => (b.id === "old-password" ? t("breach_old_password") : `${b.source} (${b.date})`);

function inviteForm() {
  return `<form id="inviteForm" class="stack">
    <label>${t("invite_name")}<input name="name" required autocomplete="off"></label>
    <label>${t("invite_email")}<input name="email" type="email" required autocomplete="off"></label>
    <label>${t("invite_relation")}<input name="relation" autocomplete="off"></label>
    <label>${t("invite_phone")}<input name="phone" type="tel" inputmode="tel" autocomplete="off"></label>
    <button class="btn btn-gold btn-big" type="submit">${t("invite_btn")}</button></form>`;
}

function bindInviteForm(root, after) {
  $("#inviteForm", root).addEventListener("submit", async (ev) => {
    ev.preventDefault();
    const f = Object.fromEntries(new FormData(ev.target));
    try {
      await api("/api/guardians", { method: "POST", body: f });
      ev.target.reset();
      toast(t("invite_sent", { email: f.email }), "ok");
      after?.();
    } catch (e) { toast(e.message, "danger"); }
  });
}

export function renderCheck(root, status) {
  root.innerHTML = `
    <section class="card"><h1>${t("check_title")}</h1><p class="lead">${t("check_lead")}</p>
      <div class="two-col">
        <form id="pasteForm" class="stack">
          <h2>${t("paste_title")}</h2>
          <label>${t("channel_q")}<select name="channel"><option value="sms">${t("ch_sms")}</option><option value="whatsapp">${t("ch_whatsapp")}</option><option value="email">${t("ch_email")}</option></select></label>
          <label>${t("from_q")}<input name="from" autocomplete="off"></label>
          <label>${t("subject_q")}<input name="subject" autocomplete="off"></label>
          <label>${t("body_q")}<textarea name="body" rows="7" required></textarea></label>
          <button class="btn btn-navy btn-big" type="submit">${t("check_btn")}</button>
        </form>
        <div class="stack">
          <h2>${t("photo_title")}</h2><p>${t("photo_lead")}</p>
          ${status.museConfigured ? `<button id="photoBtn" class="btn btn-gold btn-big" type="button">${t("photo_btn")}</button><input id="photoInput" type="file" accept="image/png,image/jpeg,image/webp" hidden>` : `<p class="banner caution">${t("photo_needs_muse")}</p>`}
          <h2>${t("voice_title")}</h2><p>${t("voice_lead")}</p>
          ${status.voiceConfigured ? `<button id="voiceBtn" class="btn btn-gold btn-big" type="button">${t("voice_btn")}</button><input id="voiceInput" type="file" accept="audio/*" hidden>` : `<p class="banner caution">${t("voice_needs_muse")}</p>`}
          <h2>${t("eml_title")}</h2><p>${t("eml_lead")}</p>
          <button id="emlBtn" class="btn btn-light-dark btn-big" type="button">${t("eml_btn")}</button><input id="emlInput" type="file" accept=".eml,message/rfc822" hidden>
        </div>
      </div>
      <div id="checkResult" aria-live="polite"></div>
    </section>`;
  const show = (out) => {
    const r = $("#checkResult");
    r.innerHTML = `${verdictCard(out.verdict)}${out.transcript ? `<h3>${t("voice_heard")}</h3><pre class="mail-body">${esc(out.transcript)}</pre>` : ""}<div class="action-row"><button class="btn btn-navy btn-big" id="ra">${t("read_aloud")}</button>
      ${out.verdict.verdict !== "safe" ? `<button class="btn btn-gold btn-big" id="ask">${t("ask_trusted")}</button>` : ""}</div><div id="askPanel"></div>`;
    $("#ra").addEventListener("click", () => readAloud(out.verdict));
    $("#ask")?.addEventListener("click", () => openAsk({ checkId: out.checkId, verdict: out.verdict, message: out.message, target: $("#askPanel"), provided: true }));
    r.scrollIntoView({ behavior: "smooth" });
  };
  $("#pasteForm").addEventListener("submit", async (ev) => {
    ev.preventDefault();
    $("#checkResult").innerHTML = `<div class="verdict caution"><h3>${t("checking")}</h3></div>`;
    try { show(await api("/api/check/text", { method: "POST", body: Object.fromEntries(new FormData(ev.target)) })); } catch (e) { $("#checkResult").innerHTML = `<p class="banner danger">${esc(e.message)}</p>`; }
  });
  // Real, focusable buttons open the hidden file pickers.
  $("#photoBtn")?.addEventListener("click", () => $("#photoInput").click());
  $("#emlBtn").addEventListener("click", () => $("#emlInput").click());
  $("#voiceBtn")?.addEventListener("click", () => $("#voiceInput").click());
  $("#voiceInput")?.addEventListener("change", async (ev) => {
    const file = ev.target.files[0];
    if (!file) return;
    $("#checkResult").innerHTML = `<div class="verdict caution"><h3>${t("checking")}</h3><p>${t("please_wait")}</p></div>`;
    let wav;
    try { wav = await toWav16k(file); } catch {
      $("#checkResult").innerHTML = `<p class="banner danger">${t("voice_unreadable")}</p>`;
      ev.target.value = "";
      return;
    }
    const form = new FormData();
    form.append("audio", wav, "voice.wav");
    try { show(await api("/api/check/voice", { method: "POST", form })); } catch (e) {
      $("#checkResult").innerHTML = `<p class="banner danger">${esc(e.data?.error === "no_speech" ? t("voice_none") : e.message)}</p>`;
    }
    ev.target.value = "";
  });
  $("#emlInput").addEventListener("change", async (ev) => {
    const file = ev.target.files[0];
    if (!file) return;
    $("#checkResult").innerHTML = `<div class="verdict caution"><h3>${t("checking")}</h3><p>${t("please_wait")}</p></div>`;
    const form = new FormData();
    form.append("email", file);
    try { show(await api("/api/check/eml", { method: "POST", form })); } catch (e) { $("#checkResult").innerHTML = `<p class="banner danger">${esc(e.message)}</p>`; }
    ev.target.value = "";
  });
  $("#photoInput")?.addEventListener("change", async (ev) => {
    const file = ev.target.files[0];
    if (!file) return;
    $("#checkResult").innerHTML = `<div class="verdict caution"><h3>${t("checking")}</h3><p>${t("please_wait")}</p></div>`;
    const form = new FormData();
    form.append("image", file);
    try { show(await api("/api/check/image", { method: "POST", form })); } catch (e) {
      $("#checkResult").innerHTML = `<p class="banner danger">${esc(e.data?.error === "no_message" ? t("photo_none") : e.message)}</p>`;
    }
    ev.target.value = "";
  });
}

export async function renderPeople(root) {
  const [{ guardians }, { devices }] = await Promise.all([api("/api/guardians"), api("/api/devices")]);
  root.innerHTML = `
    <section class="card"><h1>${t("people_title")}</h1><p class="lead">${t("people_lead")}</p>
      <ul class="people">${guardians.map((g) => `<li><strong>${esc(g.name)}</strong> ${g.relation ? `(${esc(g.relation)})` : ""} · ${esc(g.email)}${g.phone ? ` · ${esc(g.phone)}` : ""}
        <span class="pill ${g.status === "active" ? "ok" : ""}">${t(`status_${g.status}`)}</span>
        <button class="btn btn-light-dark small-btn" data-remove="${esc(g.id)}">${t("remove")}</button>
        <form class="phone-form stack" data-id="${esc(g.id)}"><label>${g.phone ? t("people_phone_change") : t("people_phone_add")}<input name="phone" type="tel" inputmode="tel" autocomplete="off" value="${esc(g.phone || "")}"></label>
          <button class="btn btn-light-dark small-btn" type="submit">${t("save")}</button></form></li>`).join("")}</ul>
      ${inviteForm()}
    </section>
    <section class="card"><h2>${t("phone_title")}</h2><p>${t("phone_lead")}</p>
      <ul class="people">${devices.map((d) => `<li>${esc(d.name || "Phone")} · ${esc(t("phone_last", { when: ago(d.last_seen_at) }))}
        <button class="btn btn-light-dark small-btn" data-device="${esc(d.id)}">${t("remove")}</button></li>`).join("") || `<li>${t("phones_none")}</li>`}</ul>
      <label>${t("phone_server")}<input id="serverUrl" value="http://10.0.2.2:${location.port || 80}"></label>
      <button id="pairBtn" class="btn btn-navy btn-big">${t("phone_add")}</button><div id="pairResult"></div>
    </section>`;
  bindInviteForm(root, () => renderPeople(root));
  $$("[data-remove]", root).forEach((b) => b.addEventListener("click", async () => { await api(`/api/guardians/${b.dataset.remove}`, { method: "DELETE" }); renderPeople(root); }));
  $$(".phone-form", root).forEach((f) => f.addEventListener("submit", async (ev) => {
    ev.preventDefault();
    try {
      await api(`/api/guardians/${f.dataset.id}`, { method: "PATCH", body: { phone: new FormData(f).get("phone") } });
      toast(t("people_phone_saved"), "ok");
      renderPeople(root);
    } catch (e) { toast(e.message, "danger"); }
  }));
  $$("[data-device]", root).forEach((b) => b.addEventListener("click", async () => { await api(`/api/devices/${b.dataset.device}`, { method: "DELETE" }); renderPeople(root); }));
  $("#pairBtn").addEventListener("click", async () => {
    const out = await api("/api/devices/pair-code", { method: "POST", body: { serverUrl: $("#serverUrl").value.trim() } });
    $("#pairResult").innerHTML = `<div class="pair"><div class="qr">${out.qrSvg}</div><div><p>${t("phone_code")}</p><p class="code">${esc(out.code)}</p>
      <p>${t("phone_server")} <strong>${esc(out.serverUrl)}</strong></p><p class="small">${t("phone_expires")}</p></div></div>`;
  });
}

export async function renderSettings(root, status, refresh) {
  const [{ context, breachOptions, builtAt }, { events }] = await Promise.all([api("/api/context"), api("/api/audit")]);
  const u = status.user;
  const list = (kind, items, label) => (items?.length ? `<ul class="known">${items.map((x, i) => `<li>${label(x)} <button class="btn btn-light-dark small-btn" data-forget="${kind}" data-i="${i}">${t("remove")}</button></li>`).join("")}</ul>` : `<p class="small">${t("k_empty")}</p>`);
  const chosen = new Set((context.breaches || []).map((b) => b.id));
  root.innerHTML = `
    <section class="card"><h1>${t("settings_title")}</h1>
      <h2>${t("lang_q")}</h2><div class="choice-row"><button class="btn btn-light-dark btn-big set-lang${u.locale === "en-US" ? " chosen" : ""}" data-l="en-US">English</button><button class="btn btn-light-dark btn-big set-lang${u.locale === "fr-FR" ? " chosen" : ""}" data-l="fr-FR">Français</button></div>
      <h2>${t("size_q")}</h2><div class="choice-row">${[[1, "size_1"], [1.2, "size_2"], [1.4, "size_3"]].map(([s, k]) => `<button class="btn btn-light-dark btn-big set-size${Math.abs(u.textScale - s) < 0.01 ? " chosen" : ""}" data-s="${s}">${t(k)}</button>`).join("")}</div>
      <h2>${t("onb_mode_q")}</h2>
      <label class="choice"><input type="radio" name="mode" value="move" ${u.actMode === "move" ? "checked" : ""}><span><strong>${t("mode_move")}</strong><br>${t("mode_move_sub")}</span></label>
      <label class="choice"><input type="radio" name="mode" value="label" ${u.actMode === "label" ? "checked" : ""}><span><strong>${t("mode_label")}</strong><br>${t("mode_label_sub")}</span></label>
      <label class="check"><input type="checkbox" id="autoAlert" ${u.autoAlert ? "checked" : ""}> ${t("auto_alert_q")}</label><p class="small">${t("auto_alert_sub")}</p>
    </section>
    <section class="card"><h2>${t("knows_title")}</h2><p>${t("knows_lead")}</p>${builtAt ? `<p class="small">${esc(t("k_built", { when: ago(builtAt) }))}</p>` : ""}
      <h3>${t("k_providers")}</h3>${list("provider", context.providers, (p) => `${esc(p.name)} <span class="small">${esc((p.realDomains || []).join(", "))}</span>`)}
      <h3>${t("k_orders")}</h3>${list("order", context.orders, (o) => `${esc(o.merchant)} · ${esc(o.carrier)} ${o.tracking ? `· ${esc(o.tracking)}` : ""} <span class="small">${esc(o.date)}</span>`)}
      <h3>${t("k_contacts")}</h3>${list("contact", context.trustedContacts, (c) => `${esc(c.name)} <span class="small">${esc(c.email)} · ${esc(c.relation || "")}</span>`)}
      <h3>${t("k_subs")}</h3>${list("subscription", context.subscriptions, (s) => esc(s))}
      <h3>${t("k_senders")}</h3>${list("sender", (context.knownSenders || []).slice(-40), (s) => `${esc(s.name)} <span class="small">${esc(s.email)}</span>`)}
      <h3>${t("k_breaches")}</h3>${breachOptions.map((b) => `<label class="check"><input type="checkbox" name="breach" value="${esc(b.id)}" ${chosen.has(b.id) ? "checked" : ""}> ${esc(breachLabel(b))}</label>`).join("")}
      <button id="rebuild" class="btn btn-light-dark btn-big">${t("k_rebuild")}</button>
    </section>
    <section class="card"><h2>${t("history_title")}</h2><p class="small">${t("history_lead")}</p>
      <ul class="history">${events.slice(0, 30).map((e) => `<li><span class="small">${esc(dateTime(e.at))}</span> ${esc(e.event.replaceAll("_", " "))}</li>`).join("")}</ul></section>
    <section class="card danger-zone"><h2>${t("delete_title")}</h2><p>${t("delete_lead")}</p><div id="deleteArea"><button id="deleteBtn" class="btn btn-danger btn-big">${t("delete_btn")}</button></div></section>`;
  // Saves re-draw the whole screen from the server, so what is shown is
  // what was saved (or the error), never a stale choice.
  const save = (body, button) => busy(button, async () => {
    await api("/api/me", { method: "PATCH", body });
    toast(t("saved"), "ok");
    await refresh(true);
  }, t("saving"));
  $$(".set-lang", root).forEach((b) => b.addEventListener("click", () => save({ locale: b.dataset.l }, b)));
  $$(".set-size", root).forEach((b) => b.addEventListener("click", () => save({ textScale: Number(b.dataset.s) }, b)));
  $$("input[name=mode]", root).forEach((r) => r.addEventListener("change", () => save({ actMode: r.value })));
  $("#autoAlert").addEventListener("change", (e) => save({ autoAlert: e.target.checked }));
  $$("input[name=breach]", root).forEach((c) => c.addEventListener("change", async () => {
    await api("/api/context/breaches", { method: "PUT", body: { ids: $$("input[name=breach]:checked", root).map((x) => x.value) } });
    toast(t("saved"), "ok");
  }));
  const fields = { provider: "providers", order: "orders", contact: "trustedContacts", subscription: "subscriptions", sender: "knownSenders" };
  $$("[data-forget]", root).forEach((b) => b.addEventListener("click", async () => {
    const kind = b.dataset.forget;
    const items = kind === "sender" ? (context.knownSenders || []).slice(-40) : context[fields[kind]];
    await api("/api/context/forget", { method: "POST", body: { kind, item: items[Number(b.dataset.i)] } });
    renderSettings(root, status, refresh);
  }));
  $("#rebuild").addEventListener("click", async () => { await api("/api/context/rebuild", { method: "POST", body: {} }); toast(t("k_rebuild_started"), "ok"); });
  $("#deleteBtn").addEventListener("click", () => {
    $("#deleteArea").innerHTML = `<div class="action-row"><button id="delYes" class="btn btn-danger btn-big">${t("delete_confirm")}</button><button id="delNo" class="btn btn-light-dark btn-big">${t("delete_cancel")}</button></div>`;
    $("#delNo").addEventListener("click", () => renderSettings(root, status, refresh));
    $("#delYes").addEventListener("click", async () => {
      await api("/api/account", { method: "DELETE" });
      root.innerHTML = `<section class="card narrow"><h1>${t("delete_done")}</h1></section>`;
      setTimeout(() => (location.href = "/"), 4000);
    });
  });
}

export async function renderGuardian(root) {
  const { alerts, protecting } = await api("/api/guardian/alerts");
  const accepted = location.hash.includes("accepted=1");
  const label = { scam: t("g_scam"), real: t("g_real"), call_me: t("g_call") };
  root.innerHTML = `
    <section class="card"><h1>${t("guardian_title")}</h1><p class="lead">${t("guardian_lead")}</p>
      ${accepted ? `<p class="reassure">${t("guardian_accepted")}</p>` : ""}
      ${protecting.length ? `<p>${t("guardian_protecting")} ${protecting.map((p) => `<strong>${esc(p.name || p.email)}</strong>`).join(", ")}</p>` : ""}
      ${alerts.length ? alerts.map((a) => `
        <article class="shared-card alert-card">
          <p class="mail-meta">${esc(a.senior_name || a.senior_email)} · ${esc(ago(a.created_at))}${a.shared.auto ? " · auto" : ""}</p>
          <p class="mail-meta">${esc(a.shared.fromName)} &lt;${esc(a.shared.from)}&gt;</p>
          ${a.shared.subject ? `<p><strong>${esc(a.shared.subject)}</strong></p>` : ""}
          <p>${pill({ verdict: a.shared.verdict })} ${esc(a.shared.headline)}</p>
          <ul>${(a.shared.reasons || []).map((r) => `<li>${esc(r)}</li>`).join("")}</ul>
          ${a.shared.text ? `<pre class="mail-body">${esc(a.shared.text)}</pre>` : ""}
          ${a.answer ? `<p class="answer info">${esc(t("guardian_answered", { answer: label[a.answer] }))}</p>`
            : `<div class="action-row">${Object.entries(label).map(([k, l]) => `<button class="btn btn-big ${k === "scam" ? "btn-danger" : k === "real" ? "btn-ok" : "btn-navy"}" data-alert="${esc(a.id)}" data-answer="${k}">${l}</button>`).join("")}</div>`}
        </article>`).join("") : `<p>${t("guardian_none")}</p>`}
    </section>`;
  $$("[data-alert]", root).forEach((b) => b.addEventListener("click", async () => {
    await api(`/api/guardian/alerts/${b.dataset.alert}/answer`, { method: "POST", body: { answer: b.dataset.answer } });
    renderGuardian(root);
  }));
}

export async function renderAdmin(root) {
  const { cards, jobs } = await api("/api/admin/cards");
  root.innerHTML = `
    <section class="card"><h1>${t("admin_title")}</h1><p class="lead">${t("admin_lead")}</p>
      <p class="small">Feed: ${esc(JSON.stringify(jobs.lastFeed || "not run yet"))} · Push: ${esc(jobs.pubsub)}</p>
      ${jobs.errors?.length ? `<details><summary>Recent job errors (${jobs.errors.length})</summary><pre class="mail-body">${esc(jobs.errors.join("\n"))}</pre></details>` : ""}
      <button id="runFeed" class="btn btn-navy">${t("admin_run")}</button><div id="feedOut"></div>
      ${cards.map((c) => `<article class="shared-card">
        <p><span class="pill ${c.status === "active" ? "danger" : c.status === "candidate" ? "caution" : ""}">${esc(c.status)}</span> <strong>${esc(c.card.name)}</strong></p>
        ${c.url ? `<p class="small">${esc(c.source)} · <a href="${esc(c.url)}" rel="noopener noreferrer" target="_blank">${esc(c.title)}</a></p>` : ""}
        <textarea rows="8" data-card="${esc(c.id)}">${esc(JSON.stringify(c.card, null, 2))}</textarea>
        ${c.status === "candidate" ? `<div class="action-row"><button class="btn btn-danger" data-approve="${esc(c.id)}">${t("admin_approve")}</button><button class="btn btn-light-dark" data-reject="${esc(c.id)}">${t("admin_reject")}</button></div>` : ""}
      </article>`).join("")}
    </section>`;
  $("#runFeed").addEventListener("click", async () => {
    $("#feedOut").textContent = "…";
    const { report } = await api("/api/admin/feed/run", { method: "POST", body: {} });
    $("#feedOut").textContent = JSON.stringify(report);
    renderAdmin(root);
  });
  $$("[data-approve]", root).forEach((b) => b.addEventListener("click", async () => {
    try {
      const card = JSON.parse($(`textarea[data-card="${CSS.escape(b.dataset.approve)}"]`, root).value);
      await api(`/api/admin/cards/${encodeURIComponent(b.dataset.approve)}/approve`, { method: "POST", body: { card } });
      renderAdmin(root);
    } catch (e) { toast(e.message, "danger"); }
  }));
  $$("[data-reject]", root).forEach((b) => b.addEventListener("click", async () => {
    await api(`/api/admin/cards/${encodeURIComponent(b.dataset.reject)}/reject`, { method: "POST", body: {} });
    renderAdmin(root);
  }));
}

export async function renderDemo(root, status) {
  const { emails } = await api(`/api/demo/inbox?lang=${getLang()}`);
  root.innerHTML = `
    <section class="card"><h1>${t("demo_title")}</h1><p class="lead">${t("demo_lead")}</p>
      ${status.googleConfigured ? `<a class="btn btn-gold" href="/auth/google?mode=gmail">${t("demo_signin")}</a>` : ""}</section>
    <div class="layout">
      <section class="inbox-pane"><div class="email-list">${emails.map((e, i) => `<button class="email-item" data-i="${i}">
        <p class="email-from">${esc(e.fromName || e.from)} ${e.channel !== "email" ? `<span class="pill">${esc(e.channel)}</span>` : ""}</p>
        <p class="email-subject">${esc(e.subject || e.body.slice(0, 60))}</p><p class="email-date">${esc(e.date)}</p></button>`).join("")}</div></section>
      <section class="reader-pane"><div id="demoReader" class="empty"><p class="empty-big">${t("empty_choose")}</p></div></section>
    </div>`;
  $$(".email-item", root).forEach((b) => b.addEventListener("click", async () => {
    const e = emails[Number(b.dataset.i)];
    $$(".email-item", root).forEach((x) => x.setAttribute("aria-selected", String(x === b)));
    const r = $("#demoReader");
    r.innerHTML = `<div class="verdict caution"><h3>${t("checking")}</h3></div>`;
    const v = await api("/api/demo/check", { method: "POST", body: { id: e.id } });
    r.className = "";
    r.innerHTML = `<p class="mail-meta">${esc(e.fromName)} &lt;${esc(e.from)}&gt;</p><h2>${esc(e.subject || "")}</h2>${verdictCard(v)}
      <button class="btn btn-navy btn-big" id="ra">${t("read_aloud")}</button><h3>${t("the_message")}</h3><pre class="mail-body">${esc(e.body)}</pre>`;
    $("#ra").addEventListener("click", () => readAloud(v));
  }));
}
