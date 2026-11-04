// The other screens: first-time setup, guardian answers, scam-report
// review, and the public examples. Check something lives in check.js,
// Settings and the people and phone screens in settings.js (2026-11-04
// redesign). The signed-out welcome is the landing page in index.html
// (landing/landing.js), since Nov 4.

import { api } from "../api.js";
import { t, ago, getLang, leakWords } from "../i18n.js";
import { $, $$, esc, verdictCard, readAloud, toast, pill, busy } from "../ui.js";

// Without Google keys, the developer's own computer still signs in: the
// buttons open the local sign-in page (_product/specs/developer-sign-in.md).
const localSignin = async (status) => !status.googleConfigured && Boolean((await api("/auth/config").catch(() => null))?.devSignin);

export async function renderOnboarding(root, status, refresh) {
  const { breachOptions } = await api("/api/context");
  const country = getLang() === "fr" ? "FR" : "US";
  let lookup = null, found = [], ticked = new Set();
  const glasses = status.user.glasses;
  const steps = [
    () => `<h2>${t("onb_name_q")}</h2><label>${t("onb_name_q")}<input id="obName" value="${esc(status.user.name || "")}" autocomplete="given-name"></label>
           <h2>${t("onb_lang_q")}</h2><div class="choice-row"><button class="btn btn-light-dark btn-big lang-btn${getLang() === "en" ? " chosen" : ""}" data-l="en-US">English</button><button class="btn btn-light-dark btn-big lang-btn${getLang() === "fr" ? " chosen" : ""}" data-l="fr-FR">Français</button></div>`,
    () => `<h2>${t("onb_mode_q")}</h2>
           <label class="choice"><input type="radio" name="mode" value="move" ${status.user.actMode !== "label" ? "checked" : ""}><span><strong>${t("mode_move")}</strong><br>${t("mode_move_sub")}</span></label>
           <label class="choice"><input type="radio" name="mode" value="label" ${status.user.actMode === "label" ? "checked" : ""}><span><strong>${t("mode_label")}</strong><br>${t("mode_label_sub")}</span></label>
           <p class="reassure">${t("onb_mode_note")}</p>`,
    () => `<h2>${t("onb_people_q")}</h2><p>${t("onb_people_sub")}</p>${inviteForm()}<div id="inviteResult"></div>`,
    () => `<h2>${t("onb_breach_q")}</h2><p>${t("onb_breach_sub")}</p>
           ${breachChecks([...found, ...breachOptions.filter((b) => !b.country || b.country === country)], ticked)}
           ${breachLookupBlock(lookup)}`,
    // Meta glasses (check-glasses.md, line 17): nothing ticked, so Next without a choice saves nothing.
    () => `<h2>${t("onb_glasses_q")}</h2>
           <label class="choice"><input type="radio" name="glasses" value="have"${glasses === "have" ? " checked" : ""}><span><strong>${t("onb_glasses_yes")}</strong></span></label>
           <label class="choice"><input type="radio" name="glasses" value="none"${glasses === "none" ? " checked" : ""}><span><strong>${t("onb_glasses_no")}</strong></span></label>`,
  ];
  let i = 0;
  const draw = () => {
    root.innerHTML = `<section class="card narrow"><p class="small">${t("onb_title")} · ${i + 1}/${steps.length}</p>${steps[i]()}
      <div class="action-row">${i > 0 ? `<button class="btn btn-light-dark btn-big" id="obBack">${t("onb_back")}</button>` : ""}
      <button class="btn btn-navy btn-big" id="obNext">${i === steps.length - 1 ? t("onb_done") : t("onb_next")}</button></div></section>`;
    $$(".lang-btn", root).forEach((b) => b.addEventListener("click", async () => { await api("/api/me", { method: "PATCH", body: { locale: b.dataset.l } }); await refresh(); }));
    if (i === 2) bindInviteForm(root);
    $("#breachLookup")?.addEventListener("click", async (e) => {
      ticked = new Set($$("input[name=breach]:checked", root).map((x) => x.value));
      const out = await runBreachLookup(e.currentTarget);
      if (out) { lookup = out.lookup; found = lookedUpBreaches(out.breaches); found.forEach((b) => ticked.add(b.id)); }
      draw();
    });
    $("#obBack")?.addEventListener("click", () => { i--; draw(); });
    $("#obNext").addEventListener("click", async () => {
      if (i === 0 && $("#obName").value.trim()) await api("/api/me", { method: "PATCH", body: { name: $("#obName").value.trim() } });
      if (i === 1) await api("/api/me", { method: "PATCH", body: { actMode: $("input[name=mode]:checked").value } });
      if (i === 3) {
        ticked = new Set($$("input[name=breach]:checked", root).map((x) => x.value));
        await api("/api/context/breaches", { method: "PUT", body: { ids: [...ticked] } });
      }
      if (i === 4) {
        const chosen = $("input[name=glasses]:checked", root)?.value;
        // A pair already tested stays tested; Yes makes the score offer the test.
        if (chosen && !(chosen === "have" && glasses === "ready")) await api("/api/me", { method: "PATCH", body: { glasses: chosen } });
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

// The breach lookup (_product/specs/breach-exposure.md): looked-up
// breaches (ids "xon-…" and "hibp-…") are listed ticked with the curated
// ones and unticked like them; the state line and the one button are the
// same in Settings and in the welcome's breach step; nothing is sent before the tap.
const lookedUpBreaches = (breaches) => (breaches || []).filter((b) => /^(hibp|xon)-/.test(String(b.id || "")));
const breachLookupState = (lookup) => {
  if (!lookup) return t("k_breach_not_looked_up");
  const when = ago(lookup.at);
  return lookup.found === 0 ? t("k_breach_looked_up_none", { when }) : lookup.found === 1 ? t("k_breach_looked_up_one", { when }) : t("k_breach_looked_up", { when, n: lookup.found });
};
// What each breach leaked, in the person's words ("bank account number", not "IBAN"), and what it means (line 8):
// one .choice per breach, the mode step's shape, the name and what leaked under it, never beside it.
const breachChecks = (options, chosen) => options.map((b) => `<label class="choice"><input type="checkbox" name="breach" value="${esc(b.id)}"${chosen.has(b.id) ? " checked" : ""}>
    <span class="choice-text"><span class="choice-name">${esc(breachLabel(b))}</span>${b.leaked?.length ? `<span class="choice-sub">${esc(t("k_breach_leaked", { what: leakWords(b.leaked) }))}</span>` : ""}</span></label>`).join("")
  + (options.length ? `<p class="small">${t("k_breach_meaning")}</p>` : "");
const breachLookupBlock = (lookup) => `<p class="small">${esc(breachLookupState(lookup))}</p><p class="small">${t("k_breach_lookup_sub")}</p>
  <button id="breachLookup" class="btn btn-light-dark btn-big" type="button">${lookup ? t("k_breach_lookup_again") : t("k_breach_lookup")}</button>`;
async function runBreachLookup(button) {
  return busy(button, async () => {
    try {
      const out = await api("/api/context/lookup-breaches", { method: "POST" });
      toast(out.lookup.found === 1 ? t("k_breach_found_one") : out.lookup.found ? t("k_breach_found", { n: out.lookup.found }) : t("k_breach_found_none"), "ok");
      return out;
    } catch (e) {
      toast(t(e.data?.error === "lookup_wait" ? "k_breach_lookup_wait" : "k_breach_lookup_failed"), "danger");
      return null;
    }
  }, t("k_breach_looking"));
}

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
  const [{ emails }, local] = await Promise.all([api(`/api/demo/inbox?lang=${getLang()}`), localSignin(status)]);
  root.innerHTML = `
    <section class="card"><h1>${t("demo_title")}</h1><p class="lead">${t("demo_lead")}</p>
      ${status.googleConfigured || local ? `<a class="btn btn-gold" href="/auth/google?mode=gmail">${t("demo_signin")}</a>` : ""}</section>
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
