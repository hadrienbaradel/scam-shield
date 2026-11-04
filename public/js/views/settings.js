// Settings and every screen under it (2026-11-04 redesign: frames 1q, 1r and
// 1s of _product/design/2026-11-04-redesign/claude-design/; the rows of
// _product/specs/settings-and-onboarding.md, the Screens of
// _product/specs/protection-menu.md).
//
//   #/settings           "What Prudence protects", then one white card per
//                        setting (a 44 px icon, the name, the state in
//                        words, one 64 px verb), then Sign out
//   #/settings/people    My people: each trusted person, the invitation form
//                        (#/people, the old address, draws it too)
//   #/settings/phone     the paired Android phones and the pairing code
//   #/settings/knows     What Prudence knows about you, with Remove
//   #/settings/did       What Prudence did, in plain words
//   #/settings/delete    Delete your account? (frame 1s): Keep first, gold
//
// Every save goes to the server, then the screen is drawn again from what
// the server says: what shows is what was saved, never a stale choice. The
// API calls are those of the screens this replaces (renderPeople and
// renderSettings in pages.js). No DOM access at import time:
// tests/settings-view.test.js imports the pure helpers under Node.

import { api } from "../api.js";
import { t, ago, getLang, dateTime } from "../i18n.js";
import { $, $$, esc, icon, toast, signOut, focusHeading } from "../ui.js";
import { protectRows, renderProtects } from "../protects.js";

// ------------------------------------------------------------ the words --

const firstName = (s) => String(s || "").trim().split(/\s+/)[0] || "";

// The relation as the person typed it, ready for "your {relation}": no
// leading "my" (or "mon", "ma", "mes"), lower case ("My Son" -> "son").
export function relationWords(relation) {
  return String(relation || "").trim().replace(/^(my|mon|ma|mes)\s+/i, "").toLowerCase();
}

// The people who said yes first, then the invited ones, each group in the
// order they were added (/api/guardians gives the order they were added).
export function sortPeople(guardians) {
  return [...(Array.isArray(guardians) ? guardians : [])].sort((a, b) => (b.status === "active") - (a.status === "active"));
}

// One person in words: "Thomas, your son", or "Thomas, your trusted person"
// when no relation was given.
export function personWords(g) {
  const name = String(g?.name || "").trim();
  const relation = relationWords(g?.relation);
  return relation ? t("set_person", { name, relation }) : t("set_person_plain", { name });
}

// The My people row's state: the first person, then how many more; "No one
// yet" for nobody; null when the list could not be loaded (the row then
// says nothing rather than something wrong).
export function peopleState(guardians) {
  if (!Array.isArray(guardians)) return null;
  if (!guardians.length) return t("set_people_none");
  const people = sortPeople(guardians);
  const first = personWords(people[0]);
  const more = people.length - 1;
  return more ? t(more === 1 ? "set_people_more_one" : "set_people_more", { first, n: more }) : first;
}

// "Tell Thomas automatically": only a person who said yes is ever told
// (src/guardians.js alertGuardians), so the row names the first of them, by
// first name as Today's "Ask Thomas" does; with nobody, the plain words.
export function tellRow(guardians, on) {
  const active = (Array.isArray(guardians) ? guardians : []).find((g) => g.status === "active");
  const name = active ? firstName(active.name) : "";
  const state = on ? (name ? t("set_tell_on", { name }) : t("set_tell_on_plain")) : (name ? t("set_tell_off", { name }) : t("set_tell_off_plain"));
  return { name: name ? t("set_tell", { name }) : t("set_tell_plain"), state, verb: t(on ? "set_turn_off" : "set_turn_on") };
}

// Text size: the state, and the one step the button takes (frame 1q):
// Normal -> Larger -> Largest -> back to Normal. Keys of i18n.js.
export function sizeStep(textScale) {
  const s = Number(textScale) || 1;
  if (s < 1.1) return { state: "size_1", verb: "set_larger", next: 1.2 };
  if (s < 1.3) return { state: "size_2", verb: "set_larger", next: 1.4 };
  return { state: "size_3", verb: "set_normal", next: 1 };
}

// One event of /api/audit in plain words (set_ev_*), from its name and, for
// a label or a change of mode, its detail. An event with no words here keeps
// its name, spaced, rather than disappearing from the list.
export function eventWords(e) {
  const name = String(e?.event || "");
  const d = e?.detail || {};
  const key = name === "labeled" ? (d.verdict === "scam" ? "set_ev_labeled_scam" : d.verdict === "be_careful" ? "set_ev_labeled_careful" : "set_ev_labeled")
    : name === "act_mode_changed" ? (d.actMode === "label" ? "set_ev_mode_label" : "set_ev_mode_move")
    : `set_ev_${name}`;
  const words = t(key);
  return words === key ? name.replaceAll("_", " ").replace(/^./, (c) => c.toUpperCase()) : words;
}

// ------------------------------------------------------------ the parts --

// An email or website address, escaped, that may break after "@" and before
// a dot rather than in the middle of a word on a narrow phone.
const breakable = (s) => esc(s).replace(/@/g, "@<wbr>").replace(/\./g, "<wbr>.");

const back = () => `<a class="btn-back" href="#/settings">${icon("chevron-left", 28, 2.5)}<span>${esc(t("nav_settings"))}</span></a>`;
const link = (href, words, cls = "btn btn-outline") => `<a class="${cls}" href="${href}">${words}</a>`;
const button = (act, words, extra = "") => `<button class="btn btn-outline" type="button" data-act="${act}"${extra}>${words}</button>`;

// One setting as the canvas draws it: icon, name, state in words, one verb.
function row({ id, ic, text = false, name, state, verb }) {
  return `<div class="row-card" data-row="${id}">
      <div class="row-head">
        ${text ? '<span class="row-icon is-text" aria-hidden="true">Aa</span>' : `<span class="row-icon">${icon(ic)}</span>`}
        <div class="row-text">
          <span class="row-name">${esc(name)}</span>
          ${state ? `<span class="row-state"><span>${esc(state)}</span></span>` : ""}
        </div>
      </div>
      ${verb}
    </div>`;
}

// "When a message is a scam": the two radio cards of the welcome's step 1.
function modeRow(actMode) {
  const choice = (value, name, sub) => `<label class="choice"><input type="radio" name="actMode" value="${value}"${actMode === value ? " checked" : ""}>
      <span class="choice-text"><span class="choice-name">${esc(t(name))}</span><span class="choice-sub">${esc(t(sub))}</span></span></label>`;
  return `<div class="row-card" data-row="mode" role="radiogroup" aria-labelledby="setModeName">
      <div class="row-head is-centered"><span class="row-icon">${icon("folder")}</span><span class="row-name" id="setModeName">${esc(t("set_scam_mode"))}</span></div>
      ${choice("move", "mode_move", "mode_move_sub")}
      ${choice("label", "mode_label", "mode_label_sub")}
    </div>`;
}

// A card with only an icon and a sentence (an empty list).
const emptyCard = (ic, words) => `<div class="row-card"><div class="row-head is-centered"><span class="row-icon is-grey">${icon(ic)}</span><span class="row-name">${esc(words)}</span></div></div>`;

// Taking a person or a phone away is never one tap (design.md, Reversible;
// settings-and-onboarding.md line 4): the row asks first, the button that
// keeps it comes first and is gold, the red one second.
function askFirst(area, { question, keep, remove, onRemove }) {
  const before = area.innerHTML;
  area.innerHTML = `<div class="set-confirm" role="group" aria-label="${esc(question)}">
      <p class="set-confirm-q">${esc(question)}</p>
      <button class="btn btn-gold btn-big" type="button" data-keep>${esc(keep)}</button>
      <button class="btn btn-danger-outline btn-big" type="button" data-yes>${icon("trash", 26)}<span>${esc(remove)}</span></button>
    </div>`;
  const keepBtn = $("[data-keep]", area);
  area.scrollIntoView({ block: "center" });
  keepBtn.focus({ preventScroll: true });
  keepBtn.addEventListener("click", () => {
    area.innerHTML = before;
    bindAgain(area);
    $("button", area)?.focus();
  });
  $("[data-yes]", area).addEventListener("click", async (ev) => {
    ev.currentTarget.disabled = true;
    try { await onRemove(); } catch (e) { toast(e.message, "danger"); ev.currentTarget.disabled = false; }
  });
}
// The Remove buttons are bound by their screen; putting one back after
// "Keep" binds it again through the handler kept on the area.
function bindAgain(area) { area._bind?.(); }

// Draws a screen again from the server, then gives the focus back where the
// person was: the first of the selectors that finds something (a button, a
// field, a list's title), or the screen's title when none does.
async function redraw(root, draw, selectors = []) {
  await draw();
  const el = [selectors].flat().filter(Boolean).map((s) => $(s, root)).find(Boolean);
  if (!el) { focusHeading(root); return; }
  el.scrollIntoView({ block: "center" });
  el.focus({ preventScroll: true });
}

// ------------------------------------------------------------- Settings --

// #/settings (frames 1q and 1r). refresh: main.js's, which reloads
// /api/status, the text size, the language and the header, then draws this
// screen again.
export async function renderSettings(root, status, refresh) {
  const view = root.dataset.view;
  const u = status.user;
  const mail = Boolean(status.gmail);
  // One list failing never blanks the screen: no phones reads as none, no
  // people list leaves the row without a state.
  const [devices, guardians] = await Promise.all([
    mail ? api("/api/devices").then((r) => r.devices).catch(() => []) : [],
    mail ? api("/api/guardians").then((r) => r.guardians).catch(() => null) : [],
  ]);
  if (root.dataset.view !== view) return; // another screen was drawn meanwhile
  const people = Array.isArray(guardians) ? sortPeople(guardians) : null;
  const size = sizeStep(u.textScale);
  const tell = tellRow(people, u.autoAlert);
  const fr = getLang() === "fr";
  const rows = [];
  // A trusted person without a mailbox sees the reading rows, What Prudence
  // keeps and Sign out (settings-and-onboarding.md line 2).
  if (mail) {
    rows.push(row({ id: "people", ic: "person", name: t("v2_tab_people"), state: peopleState(people),
      verb: people && !people.length ? link("#/settings/people", esc(t("set_people_add")), "btn btn-gold btn-big") : link("#/settings/people", esc(t("set_change"))) }));
    rows.push(modeRow(u.actMode));
    rows.push(row({ id: "tell", ic: "bell", name: tell.name, state: tell.state, verb: button("tell", esc(tell.verb)) }));
  }
  rows.push(row({ id: "size", text: true, name: t("size_q"), state: t(size.state), verb: button("size", esc(t(size.verb))) }));
  // The button is in the other language, and says so to a screen reader.
  rows.push(row({ id: "lang", ic: "globe", name: t("lang_q"), state: t("set_lang_now"), verb: button("lang", esc(t("set_lang_switch")), ` lang="${fr ? "en" : "fr"}"`) }));
  // Read aloud (frame 1q) is not drawn: nothing in the app reads a verdict by
  // itself yet (Listen is on every card), so a Turn on / Turn off here would
  // change nothing (design.md: no dead button).
  if (mail) {
    rows.push(row({ id: "knows", ic: "list", name: t("knows_title"), state: t("set_knows_sub"), verb: link("#/settings/knows", esc(t("set_look"))) }));
    rows.push(row({ id: "did", ic: "clock", name: t("history_title"), state: t("set_did_sub"), verb: link("#/settings/did", esc(t("set_look"))) }));
  }
  // The phone has no top links: the family and admin pages open from here.
  if (status.isGuardian || !mail) rows.push(row({ id: "guardian", ic: "person", name: t("nav_guardian"), state: t("set_guardian_sub"), verb: link("#/guardian", esc(t("set_open"))) }));
  if (u.isAdmin) rows.push(row({ id: "admin", ic: "clipboard", name: t("nav_admin"), state: t("set_admin_sub"), verb: link("#/admin", esc(t("set_open"))) }));
  rows.push(row({ id: "keeps", ic: "lock", name: t("set_keeps"), state: t("set_keeps_sub"),
    verb: `<a class="btn btn-danger-outline" href="#/settings/delete">${icon("trash", 26)}<span>${esc(t("delete_btn"))}</span></a>` }));

  root.innerHTML = `<div class="screen settings">
      <h1 class="screen-title">${esc(t("settings_title"))}</h1>
      ${mail ? renderProtects(protectRows(status, { devices })) : ""}
      <div class="set-list">
        ${rows.join("")}
        <button class="btn btn-outline btn-big set-signout" type="button" data-act="signout">${icon("sign-out", 26)}<span>${esc(t("sign_out"))}</span></button>
      </div>
    </div>`;

  const save = (body, rowId) => (ev) => saveMe(body, rowId, ev.currentTarget, refresh);
  $('[data-act="tell"]', root)?.addEventListener("click", save({ autoAlert: !u.autoAlert }, "tell"));
  $('[data-act="size"]', root).addEventListener("click", save({ textScale: size.next }, "size"));
  $('[data-act="lang"]', root).addEventListener("click", save({ locale: fr ? "en-US" : "fr-FR" }, "lang"));
  $$('input[name="actMode"]', root).forEach((r) => r.addEventListener("change", () => saveMe({ actMode: r.value }, "mode", null, refresh)));
  $('[data-act="signout"]', root).addEventListener("click", (ev) => { ev.currentTarget.disabled = true; signOut(); });
}

// Saves one setting, then draws the whole app again from the server (a new
// text size or language changes the header and every screen), and puts the
// person back on the row she changed, its control focused. A refused save
// is said in a message and the screen shows what the server kept.
async function saveMe(body, rowId, control, refresh) {
  const before = control?.textContent;
  if (control) { control.disabled = true; control.textContent = t("saving"); }
  let saved = false;
  try {
    await api("/api/me", { method: "PATCH", body });
    saved = true;
  } catch (e) { toast(e.message, "danger"); }
  try { await refresh(true); } catch { /* the screen keeps what it had */ }
  if (control?.isConnected) { control.disabled = false; control.textContent = before; }
  const r = document.querySelector(`#view [data-row="${rowId}"]`);
  if (r) {
    r.scrollIntoView({ block: "center" });
    ($("input:checked", r) || $(".btn", r) || r).focus({ preventScroll: true });
  }
  if (saved) toast(t("saved"), "ok");
}

// ------------------------------------------------------------ My people --

function personCard(g) {
  const relation = relationWords(g.relation);
  const ready = g.status === "active";
  const reach = [t("set_by_email", { email: g.email }), g.phone ? t("set_by_text", { phone: g.phone }) : ""].filter(Boolean).map(breakable);
  return `<div class="row-card" data-person="${esc(g.id)}">
      <div class="row-head">
        <span class="row-icon">${icon("person")}</span>
        <div class="row-text">
          <span class="row-name">${esc(g.name)}</span>
          ${relation ? `<span class="row-state"><span>${esc(t("set_relation", { relation }))}</span></span>` : ""}
          <span class="row-state${ready ? "" : " is-waiting"}">${ready ? icon("check-circle", 20, 2.5) : icon("clock", 20)}<span>${esc(t(`status_${g.status}`))}</span></span>
        </div>
      </div>
      <ul class="set-reach">${reach.map((r) => `<li>${r}</li>`).join("")}</ul>
      <form class="set-form" data-phone="${esc(g.id)}">
        <label class="set-field"><span>${esc(t(g.phone ? "people_phone_change" : "people_phone_add"))}</span>
          <input name="phone" type="tel" inputmode="tel" autocomplete="off" value="${esc(g.phone || "")}"></label>
        <button class="btn btn-outline" type="submit">${esc(t("save"))}</button>
      </form>
      <div class="set-remove" data-area="${esc(g.id)}"><button class="btn btn-outline" type="button" data-remove="${esc(g.id)}">${esc(t("remove"))}</button></div>
    </div>`;
}

const field = (name, key, attrs = "") => `<label class="set-field"><span>${esc(t(key))}</span><input name="${name}" autocomplete="off"${attrs}></label>`;

// #/settings/people (and #/people): each trusted person (name and relation,
// how they are reached, ready or invited, their mobile number, Remove), then
// the invitation form.
export async function renderPeopleScreen(root) {
  const view = root.dataset.view;
  const { guardians } = await api("/api/guardians");
  if (root.dataset.view !== view) return;
  const people = sortPeople(guardians);
  const again = (selector) => redraw(root, () => renderPeopleScreen(root), selector);
  root.innerHTML = `<div class="screen is-snug settings">
      ${back()}
      <h1 class="screen-title">${esc(t("v2_tab_people"))}</h1>
      <p class="screen-lead">${esc(t("people_lead"))}</p>
      ${people.length ? people.map(personCard).join("") : emptyCard("person", t("set_people_none"))}
      <h2 class="section-title set-gap" id="setInviteTitle">${esc(t("set_people_add"))}</h2>
      <form class="row-card set-form" id="setInvite" aria-labelledby="setInviteTitle">
        ${field("name", "invite_name", " required")}
        ${field("email", "invite_email", ' type="email" required')}
        ${field("relation", "invite_relation")}
        ${field("phone", "invite_phone", ' type="tel" inputmode="tel"')}
        <button class="btn btn-gold btn-big" type="submit">${esc(t("invite_btn"))}</button>
      </form>
    </div>`;

  $("#setInvite", root).addEventListener("submit", async (ev) => {
    ev.preventDefault();
    const form = ev.currentTarget;
    const send = $("button[type=submit]", form);
    const f = Object.fromEntries(new FormData(form));
    send.disabled = true;
    try {
      const { id } = await api("/api/guardians", { method: "POST", body: f });
      toast(t("invite_sent", { email: f.email }), "ok");
      await again(id ? `[data-remove="${CSS.escape(id)}"]` : null);
    } catch (e) { toast(e.message, "danger"); send.disabled = false; }
  });
  $$("form[data-phone]", root).forEach((form) => form.addEventListener("submit", async (ev) => {
    ev.preventDefault();
    const id = form.dataset.phone;
    const save = $("button[type=submit]", form);
    save.disabled = true;
    try {
      await api(`/api/guardians/${encodeURIComponent(id)}`, { method: "PATCH", body: { phone: new FormData(form).get("phone") } });
      toast(t("people_phone_saved"), "ok");
      await again(`form[data-phone="${CSS.escape(id)}"] input`);
    } catch (e) { toast(e.message, "danger"); save.disabled = false; }
  }));
  $$("[data-area]", root).forEach((area) => {
    const g = people.find((p) => p.id === area.dataset.area);
    const name = firstName(g?.name);
    area._bind = () => $("[data-remove]", area).addEventListener("click", () => askFirst(area, {
      question: t("set_person_remove_q", { name }), keep: t("set_keep_person", { name }), remove: t("set_yes_remove"),
      onRemove: async () => {
        await api(`/api/guardians/${encodeURIComponent(g.id)}`, { method: "DELETE" });
        toast(t("set_removed"), "ok");
        await again(null);
      },
    }));
    area._bind();
  });
}

// --------------------------------------------------------- My phone --

function phoneCard(d) {
  const name = String(d.name || "").trim();
  return `<div class="row-card" data-device-card="${esc(d.id)}">
      <div class="row-head">
        <span class="row-icon">${icon("phone")}</span>
        <div class="row-text">
          <span class="row-name">${esc(name && name !== "Phone" ? name : t("set_phone_unnamed"))}</span>
          <span class="row-state"><span>${esc(t("set_phone_last", { when: ago(d.last_seen_at || d.created_at) }))}</span></span>
        </div>
      </div>
      <div class="set-remove" data-area="${esc(d.id)}"><button class="btn btn-outline" type="button" data-remove="${esc(d.id)}">${esc(t("set_phone_remove"))}</button></div>
    </div>`;
}

// The address the Android app is given: this site, except on the
// developer's own computer, where the emulator reaches it as 10.0.2.2.
function appServer() {
  const local = /^(localhost|127\.0\.0\.1|\[::1\])$/.test(location.hostname);
  return local ? `http://10.0.2.2:${location.port || 80}` : location.origin;
}

// #/settings/phone: the paired Android phones (Last used, Remove this
// phone), then "Add my phone" with its code and QR. The server address is
// for whoever sets the app up, folded away under the button.
export async function renderPhoneScreen(root) {
  const view = root.dataset.view;
  const { devices } = await api("/api/devices");
  if (root.dataset.view !== view) return;
  root.innerHTML = `<div class="screen is-snug settings">
      ${back()}
      <h1 class="screen-title">${esc(t("phone_title"))}</h1>
      <p class="screen-lead">${esc(t("phone_lead"))}</p>
      ${devices.length ? devices.map(phoneCard).join("") : emptyCard("phone", t("phones_none"))}
      <h2 class="section-title set-gap" id="setPairTitle">${esc(t("set_phone_add"))}</h2>
      <div class="row-card" role="group" aria-labelledby="setPairTitle">
        <button class="btn btn-gold btn-big" type="button" id="setPairBtn">${esc(t("phone_add"))}</button>
        <div id="setPairResult" aria-live="polite"></div>
        <details class="set-tech">
          <summary>${esc(t("set_phone_tech"))}</summary>
          <label class="set-field"><span>${esc(t("phone_server"))}</span><input id="setServerUrl" inputmode="url" autocomplete="off" spellcheck="false" value="${esc(appServer())}"></label>
        </details>
      </div>
    </div>`;

  $("#setPairBtn", root).addEventListener("click", async (ev) => {
    const b = ev.currentTarget;
    b.disabled = true;
    try {
      const out = await api("/api/devices/pair-code", { method: "POST", body: { serverUrl: $("#setServerUrl", root).value.trim() } });
      // qrSvg is drawn by our server (src/routes/devices.js), from the code and the address.
      $("#setPairResult", root).innerHTML = `<div class="set-pair">
          <div class="qr">${out.qrSvg}</div>
          <p>${esc(t("phone_code"))}</p>
          <p class="code">${esc(out.code)}</p>
          <p>${esc(t("phone_expires"))}</p>
          <p class="set-pair-server">${esc(t("phone_server"))} ${esc(out.serverUrl)}</p>
        </div>`;
    } catch (e) { toast(e.message, "danger"); } finally { b.disabled = false; }
  });
  $$("[data-area]", root).forEach((area) => {
    const id = area.dataset.area;
    area._bind = () => $("[data-remove]", area).addEventListener("click", () => askFirst(area, {
      question: t("set_phone_remove_q"), keep: t("set_keep_phone"), remove: t("set_yes_remove"),
      onRemove: async () => {
        await api(`/api/devices/${encodeURIComponent(id)}`, { method: "DELETE" });
        toast(t("set_removed"), "ok");
        await redraw(root, () => renderPhoneScreen(root), null);
      },
    }));
    area._bind();
  });
}

// ------------------------------------------ What Prudence knows about you --

const breachLabel = (b) => (b.id === "old-password" ? t("breach_old_password") : `${b.source} (${b.date})`);
// A breach found by the lookup (_product/specs/breach-exposure.md), not one
// of the well-known ones: the server keeps it only while it is ticked.
const lookedUp = (b) => /^(hibp|xon)-/.test(String(b?.id || ""));
// Whether her address was looked up, when, and how many breaches hold it.
function lookupState(lookup) {
  if (!lookup) return t("k_breach_not_looked_up");
  const when = ago(lookup.at);
  return lookup.found === 0 ? t("k_breach_looked_up_none", { when }) : lookup.found === 1 ? t("k_breach_looked_up_one", { when }) : t("k_breach_looked_up", { when, n: lookup.found });
}

// The lists of what Prudence learned, in the order of the old Settings page:
// [kind for /api/context/forget, title key, the items, the item's name and
// its detail line]. The senders (up to 40) come last, after the breaches.
function knownLists(context) {
  const words = (x) => (typeof x === "string" ? x : String(x?.name ?? ""));
  return [
    ["provider", "k_providers", context.providers, (p) => [p.name, (p.realDomains || []).join(", ")]],
    ["order", "k_orders", context.orders, (o) => [o.merchant, [o.carrier, o.tracking, o.date].filter(Boolean).join(" · ")]],
    ["contact", "k_contacts", context.trustedContacts, (c) => [c.name, [c.email, c.relation].filter(Boolean).join(" · ")]],
    ["subscription", "k_subs", context.subscriptions, (s) => [words(s), ""]],
    ["sender", "k_senders", (context.knownSenders || []).slice(-40), (s) => [s.name, s.email]],
  ].map(([kind, title, items, label]) => ({ kind, title, items: Array.isArray(items) ? items : [], label }));
}

// #/settings/knows: one card per list, each thing with its Remove; the data
// breaches: whether her address was looked up and the one button that looks
// it up (nothing is sent before the tap), then the breaches found, ticked,
// and the well-known ones of her country as tick boxes; "Look through my
// mailbox again". The API has no way to put a removed thing back (POST
// /api/context/forget only), so a Remove says "Removed." and the list is
// drawn again without it.
export async function renderKnows(root) {
  const view = root.dataset.view;
  const { context, breachOptions, builtAt } = await api("/api/context");
  if (root.dataset.view !== view) return;
  const lists = knownLists(context || {});
  const chosen = new Set((context?.breaches || []).map((b) => b.id));
  // The leaks of her country, and any she already ticked.
  const country = getLang() === "fr" ? "FR" : "US";
  const breaches = [...(context?.breaches || []).filter(lookedUp), ...(breachOptions || []).filter((b) => !b.country || b.country === country || chosen.has(b.id))];
  const lookup = context?.breachLookup || null;
  const card = (l) => `<section class="row-card" aria-labelledby="setK-${l.kind}">
      <h2 class="row-name" id="setK-${l.kind}" tabindex="-1">${esc(t(l.title))}</h2>
      ${l.items.length ? `<ul class="set-items">${l.items.map((x, i) => {
        const [name, sub] = l.label(x);
        return `<li class="set-item"><div class="set-item-words"><span class="set-item-name">${esc(name)}</span>${sub ? `<span class="set-item-sub">${breakable(sub)}</span>` : ""}</div>
          <button class="btn btn-outline" type="button" data-forget="${l.kind}" data-i="${i}" aria-label="${esc(`${t("remove")}: ${name}`)}">${esc(t("remove"))}</button></li>`;
      }).join("")}</ul>` : `<p class="set-item-sub">${esc(t("k_empty"))}</p>`}
    </section>`;
  root.innerHTML = `<div class="screen is-snug settings">
      ${back()}
      <h1 class="screen-title">${esc(t("knows_title"))}</h1>
      <p class="screen-lead">${esc(t("knows_lead"))}</p>
      ${builtAt ? `<p class="set-note">${esc(t("k_built", { when: ago(builtAt) }))}</p>` : ""}
      ${lists.filter((l) => l.kind !== "sender").map(card).join("")}
      <section class="row-card" aria-labelledby="setK-breach">
        <h2 class="row-name" id="setK-breach" tabindex="-1">${esc(t("k_breaches"))}</h2>
        <p class="set-item-name" id="setLookupState">${esc(lookupState(lookup))}</p>
        <p class="set-item-sub">${esc(t("k_breach_lookup_sub"))}</p>
        <button class="btn btn-outline" type="button" id="setLookup" aria-describedby="setLookupState">${esc(t(lookup ? "k_breach_lookup_again" : "k_breach_lookup"))}</button>
        ${breaches.map((b) => `<label class="choice"><input type="checkbox" name="breach" value="${esc(b.id)}"${chosen.has(b.id) ? " checked" : ""}>
          <span class="choice-text"><span class="choice-name">${esc(breachLabel(b))}</span></span></label>`).join("")}
      </section>
      ${lists.filter((l) => l.kind === "sender").map(card).join("")}
      <button class="btn btn-outline btn-big" type="button" id="setRebuild">${esc(t("k_rebuild"))}</button>
    </div>`;

  $$("[data-forget]", root).forEach((b) => b.addEventListener("click", async () => {
    const l = lists.find((x) => x.kind === b.dataset.forget);
    const i = Number(b.dataset.i);
    b.disabled = true;
    try {
      await api("/api/context/forget", { method: "POST", body: { kind: l.kind, item: l.items[i] } });
      toast(t("set_removed"), "ok");
      // The focus goes to the next thing in the same list, or its title.
      await redraw(root, () => renderKnows(root), [`[data-forget="${l.kind}"][data-i="${Math.min(i, l.items.length - 2)}"]`, `#setK-${l.kind}`]);
    } catch (e) { toast(e.message, "danger"); b.disabled = false; }
  }));
  $$("input[name=breach]", root).forEach((c) => c.addEventListener("change", async () => {
    const at = `input[name=breach][value="${CSS.escape(c.value)}"]`;
    try {
      await api("/api/context/breaches", { method: "PUT", body: { ids: $$("input[name=breach]:checked", root).map((x) => x.value) } });
      toast(t("saved"), "ok");
      // An unticked breach from the lookup is gone from the server: the list
      // is drawn again so that it does not look as if ticking it would help.
      if (!c.checked && lookedUp({ id: c.value })) await redraw(root, () => renderKnows(root), [at, "#setLookup"]);
    } catch (e) {
      toast(e.message, "danger");
      await redraw(root, () => renderKnows(root), at);
    }
  }));
  $("#setLookup", root).addEventListener("click", async (ev) => {
    const b = ev.currentTarget;
    b.disabled = true;
    b.textContent = t("k_breach_looking");
    try {
      const out = await api("/api/context/lookup-breaches", { method: "POST" });
      toast(out.lookup?.found ? t("k_breach_found", { n: out.lookup.found }) : t("k_breach_found_none"), "ok");
    } catch (e) {
      toast(t(e.data?.error === "lookup_wait" ? "k_breach_lookup_wait" : "k_breach_lookup_failed"), "danger");
    }
    await redraw(root, () => renderKnows(root), "#setLookup");
  });
  $("#setRebuild", root).addEventListener("click", async (ev) => {
    const b = ev.currentTarget;
    b.disabled = true;
    try {
      await api("/api/context/rebuild", { method: "POST", body: {} });
      toast(t("k_rebuild_started"), "ok");
    } catch (e) { toast(e.message, "danger"); } finally { b.disabled = false; }
  });
}

// --------------------------------------------------- What Prudence did --

// #/settings/did: the last things Prudence did (and that she did through
// it), newest first, each with its date and what happened in plain words.
export async function renderDid(root) {
  const view = root.dataset.view;
  const { events } = await api("/api/audit");
  if (root.dataset.view !== view) return;
  const list = (events || []).slice(0, 50);
  root.innerHTML = `<div class="screen is-snug settings">
      ${back()}
      <h1 class="screen-title">${esc(t("history_title"))}</h1>
      <p class="screen-lead">${esc(t("history_lead"))}</p>
      ${list.length ? `<ol class="row-card set-events">${list.map((e) => `<li class="set-event">
          <span class="set-event-when">${esc(dateTime(e.at))}</span>
          <span class="set-event-what">${esc(eventWords(e))}</span></li>`).join("")}</ol>`
        : emptyCard("clock", t("k_empty"))}
    </div>`;
}

// ------------------------------------------------ Delete your account? --

// #/settings/delete (frame 1s): a screen, not a dialog. "Keep my account"
// first and gold; the red outline button second erases the account (the
// server stops Gmail, revokes Google's access and deletes every row), then
// says goodbye and leaves for the welcome page after 4 seconds.
export function renderDelete(root) {
  root.innerHTML = `<div class="screen is-snug settings set-delete">
      ${back()}
      <h1 class="screen-title">${esc(t("set_delete_title"))}</h1>
      <p class="screen-lead">${esc(t("set_delete_lead"))}</p>
      <a class="btn btn-gold btn-big set-keep" href="#/settings">${esc(t("set_keep_account"))}</a>
      <button class="btn btn-danger-outline btn-big" type="button" id="setDelete">${icon("trash", 26)}<span>${esc(t("delete_btn"))}</span></button>
    </div>`;
  $("#setDelete", root).addEventListener("click", async (ev) => {
    const b = ev.currentTarget;
    b.disabled = true;
    try {
      await api("/api/account", { method: "DELETE" });
    } catch (e) { toast(e.message, "danger"); b.disabled = false; return; }
    root.innerHTML = `<div class="screen"><h1 class="screen-title">${esc(t("delete_done"))}</h1></div>`;
    focusHeading(root);
    setTimeout(() => { location.href = "/"; }, 4000);
  });
}
