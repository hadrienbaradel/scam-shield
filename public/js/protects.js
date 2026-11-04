// The menu's tables (_product/specs/protection-menu.md): the six channels of
// "What Prudence protects", the four tabs, and the senior's screens with the
// tab each one lights. One table each, read by main.js (the header and the
// tab bar), views/today.js and the Settings screen; tests/menu.test.js holds
// them to the spec. No DOM access at import time: the tests import this
// module under Node.

import { t, ago } from "./i18n.js";
import { esc, icon } from "./ui.js";

// --------------------------------------------------------------- channels --
// Ordered as the list shows them. status: "built" or "soon". A channel leaves
// "soon" only when its feature is Built in _product/spec.md (the test reads the
// spec table; the app never reads the spec at run time). name, states and
// verbs are the i18n keys a row of this channel can show (protect_* in
// i18n.js); icon is a name for icon() in ui.js.
export const CHANNELS = Object.freeze([
  { key: "email", status: "built", icon: "mail", name: "protect_email",
    states: ["protect_email_on", "protect_email_checked", "protect_email_first", "protect_email_retry", "protect_email_lost", "protect_email_off"],
    verbs: ["protect_email_verb", "protect_email_reconnect", "protect_email_connect"] },
  { key: "texts", status: "built", icon: "chat", name: "protect_texts",
    states: ["protect_texts_on", "protect_texts_on_phone", "protect_texts_none"], verbs: ["protect_texts_change", "protect_texts_add"] },
  { key: "voice", status: "built", icon: "mic", name: "protect_voice", states: ["protect_voice_state"], verbs: ["protect_voice_verb"] },
  { key: "whatsapp", status: "soon", icon: "whatsapp", name: "protect_whatsapp", states: ["protect_whatsapp_line"], verbs: [] },
  { key: "facebook", status: "soon", icon: "messenger", name: "protect_facebook", states: ["protect_facebook_line"], verbs: [] },
  { key: "calls", status: "soon", icon: "phone", name: "protect_calls", states: ["protect_calls_line"], verbs: [] },
].map((c) => Object.freeze(c)));

// Where the email row's verb goes when Prudence cannot read the mailbox.
const GMAIL_SIGN_IN = "/auth/google?mode=gmail";

// The email row, from /api/status's gmail block (src/routes/account.js):
// connected, needsReconnect, syncStatus, lastSyncAt, ready, push. The status
// has no "connected since" date, so the row says "On" and when it was last
// checked, never a date it does not have.
function emailRow(g) {
  if (!g) return { stateKey: "protect_email_off", on: false, verbKey: "protect_email_connect", href: GMAIL_SIGN_IN };
  if (g.needsReconnect) return { stateKey: "protect_email_lost", on: false, verbKey: "protect_email_reconnect", href: GMAIL_SIGN_IN };
  const base = { on: true, verbKey: "protect_email_verb", href: "#/messages" };
  if (!g.ready) return { ...base, stateKey: "protect_email_first" };
  if (g.syncStatus === "error") return { ...base, stateKey: "protect_email_retry" };
  if (g.lastSyncAt) return { ...base, stateKey: "protect_email_checked", vars: { when: ago(g.lastSyncAt) } };
  return { ...base, stateKey: "protect_email_on" };
}

// The texts row, from /api/devices's list (id, name, created_at,
// last_seen_at): the phone used last names the row.
function textsRow(devices) {
  const list = Array.isArray(devices) ? devices : [];
  if (!list.length) return { stateKey: "protect_texts_none", on: false, verbKey: "protect_texts_add", href: "#/settings/phone" };
  const last = [...list].sort((a, b) => String(b.last_seen_at || "").localeCompare(String(a.last_seen_at || "")))[0];
  const device = String(last.name || "").trim();
  return device && device !== "Phone"
    ? { stateKey: "protect_texts_on", vars: { device }, on: true, verbKey: "protect_texts_change", href: "#/settings/phone" }
    : { stateKey: "protect_texts_on_phone", on: true, verbKey: "protect_texts_change", href: "#/settings/phone" };
}

// The rows to draw for one senior, in CHANNELS order, in the current
// language. status: the /api/status payload; devices: the list from
// /api/devices (missing or empty: no phone paired yet); a guardians list
// (/api/guardians) may be passed too, no row reads it today. Each row:
// { key, soon, icon, name, state, on (true: the green check before the
// state), verb, href, verbKey, label }; a soon row has no verb and no href,
// and label is what a screen reader announces for it.
export function protectRows(status, { devices } = {}) {
  return CHANNELS.map((c) => {
    const name = t(c.name);
    if (c.status === "soon") {
      return { key: c.key, soon: true, icon: c.icon, name, state: t(c.states[0]), on: false, verb: null, href: null, verbKey: null,
        label: t("protect_soon_label", { name }) };
    }
    const r = c.key === "email" ? emailRow(status?.gmail)
      : c.key === "texts" ? textsRow(devices)
      : { stateKey: "protect_voice_state", on: false, verbKey: "protect_voice_verb", href: "#/check/voice" };
    return { key: c.key, soon: false, icon: c.icon, name, state: t(r.stateKey, r.vars), on: r.on, verb: t(r.verbKey), href: r.href, verbKey: r.verbKey, label: name };
  });
}

// The list as PrudenceProtects.dc.html draws it: white row cards (a 44 px
// navy-wash icon circle, the name, the state with the green check when on,
// one full-width 64 px outline verb that is a link to its route), then the
// grey Coming soon rows (no button, the "Coming soon" pill, one line of what
// they will do, announced as "<name>, coming soon, no action"). Classes:
// styles.css, "2026-11-04 redesign: shared components". heading: false drops
// the "What Prudence protects" title (the section is then labelled by it).
export function renderProtects(rows, { heading = true } = {}) {
  const title = esc(t("protect_title"));
  const row = (r) => r.soon
    ? `<div class="row-card row-soon" role="group" aria-label="${esc(r.label)}">
        <span class="row-icon is-grey">${icon(r.icon)}</span>
        <div class="row-text">
          <div class="row-title"><span class="row-name">${esc(r.name)}</span><span class="pill-soon">${esc(t("protect_soon"))}</span></div>
          <span class="row-state">${esc(r.state)}</span>
        </div>
      </div>`
    : `<div class="row-card" data-channel="${esc(r.key)}">
        <div class="row-head">
          <span class="row-icon">${icon(r.icon)}</span>
          <div class="row-text">
            <span class="row-name">${esc(r.name)}</span>
            <span class="row-state">${r.on ? icon("check-circle", 20, 2.5) : ""}<span>${esc(r.state)}</span></span>
          </div>
        </div>
        <a class="btn btn-outline" href="${esc(r.href)}">${esc(r.verb)}</a>
      </div>`;
  return `<section class="protects"${heading ? ' aria-labelledby="protectsTitle"' : ` aria-label="${title}"`}>
      ${heading ? `<h2 id="protectsTitle" class="section-title">${title}</h2>` : ""}
      ${rows.map(row).join("")}
    </section>`;
}

// ------------------------------------------------------------------- tabs --
// The bottom tab bar of the signed-in senior (PrudenceTabs.dc.html), in order;
// on a computer the same four are top links. label: i18n key; icon: ui.js.
export const TABS = Object.freeze([
  { key: "today", href: "#/today", label: "v2_tab_today", icon: "home" },
  { key: "check", href: "#/check", label: "v2_tab_check", icon: "search" },
  { key: "learn", href: "#/learn", label: "learn_tab", icon: "book" },
  { key: "blocked", href: "#/blocked", label: "tab_blocked", icon: "circle-slash" },
].map((tab) => Object.freeze(tab)));

// ---------------------------------------------------------------- screens --
// Every screen of the senior's phone column: its route, the name main.js puts
// in root.dataset.view while it is on screen (a late answer meant for another
// screen checks it and is dropped), the tab it lights (null: none, the
// header's Settings button is gold instead) and whether it needs a connected
// mailbox (mail: true; without one the guardian page is drawn). A route also
// covers what follows it after a "/" (#/learn/parcel-fee is Learn), unless a
// longer route is listed. #/people is the old address of My people.
export const SCREENS = Object.freeze([
  { route: "#/today", view: "today", tab: "today", mail: true },
  { route: "#/messages", view: "messages", tab: "today", mail: true },
  { route: "#/check", view: "check", tab: "check" },
  { route: "#/check/paste", view: "check-paste", tab: "check" },
  { route: "#/check/photo", view: "check-photo", tab: "check" },
  { route: "#/check/voice", view: "check-voice", tab: "check" },
  { route: "#/check/more", view: "check-more", tab: "check" },
  { route: "#/learn", view: "learn", tab: "learn" },
  { route: "#/blocked", view: "blocked", tab: "blocked", mail: true },
  { route: "#/settings", view: "settings", tab: null },
  { route: "#/settings/people", view: "settings-people", tab: null },
  { route: "#/settings/phone", view: "settings-phone", tab: null },
  { route: "#/settings/knows", view: "settings-knows", tab: null },
  { route: "#/settings/did", view: "settings-did", tab: null },
  { route: "#/settings/delete", view: "settings-delete", tab: null },
  { route: "#/people", view: "settings-people", tab: null },
].map((s) => Object.freeze(s)));

// The screen for a location hash, or null when the hash is not a screen of
// the senior's column (#/inbox, #/folder/..., #/guardian, #/admin, the demo).
// "", "#" and "#/" are Today. A query string is ignored.
export function screenFor(hash) {
  const path = String(hash || "").split("?")[0].replace(/\/+$/, "");
  if (path === "" || path === "#") return SCREENS[0];
  let best = null;
  for (const s of SCREENS) {
    if ((path === s.route || path.startsWith(`${s.route}/`)) && (!best || s.route.length > best.route.length)) best = s;
  }
  return best;
}
