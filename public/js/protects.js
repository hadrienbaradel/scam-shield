// The menu's tables (_product/specs/protection-menu.md): the six channels of
// "What Prudence protects", the criteria of the protection score on Today,
// the four tabs, and the senior's screens with the tab each one lights. One
// table each, read by main.js (the header and the tab bar), views/today.js
// and the Settings screen; tests/menu.test.js holds them to the spec. No DOM access at import time: the tests import this
// module under Node.

import { t, ago } from "./i18n.js";
import { esc, icon } from "./ui.js";

// --------------------------------------------------------------- channels --
// Ordered as the list shows them. status:
// - "built": always drawn with its state and verb;
// - "soon": the grey Coming soon row. It leaves "soon" only when its feature
//   is Built in _product/spec.md (tests/menu.test.js reads the spec table; the
//   app never reads the spec at run time);
// - "server": on only when /api/status says this server runs it (the boolean
//   named by configuredBy, the link to open named by linkBy), Coming soon
//   otherwise: the Prudence WhatsApp number and the Prudence Page exist only
//   where their keys are set. A field the server does not send counts as
//   false.
// name, states and verbs are the i18n keys a row of this channel can show
// (protect_* in i18n.js); icon is a name for icon() in ui.js.
export const CHANNELS = Object.freeze([
  { key: "email", status: "built", icon: "mail", name: "protect_email",
    states: ["protect_email_on", "protect_email_checked", "protect_email_first", "protect_email_retry", "protect_email_lost", "protect_email_off"],
    verbs: ["protect_email_verb", "protect_email_reconnect", "protect_email_connect"] },
  { key: "texts", status: "built", icon: "chat", name: "protect_texts",
    states: ["protect_texts_on", "protect_texts_on_phone", "protect_texts_none"], verbs: ["protect_texts_change", "protect_texts_add"] },
  { key: "voice", status: "built", icon: "mic", name: "protect_voice", states: ["protect_voice_state"], verbs: ["protect_voice_verb"] },
  { key: "whatsapp", status: "server", configuredBy: "whatsappConfigured", linkBy: "whatsappLink", icon: "whatsapp", name: "protect_whatsapp",
    states: ["protect_whatsapp_line", "protect_whatsapp_on"], verbs: ["protect_whatsapp_verb"] },
  { key: "facebook", status: "server", configuredBy: "messengerConfigured", linkBy: "messengerLink", icon: "messenger", name: "protect_facebook",
    states: ["protect_facebook_line", "protect_facebook_on"], verbs: ["protect_facebook_verb"] },
  { key: "calls", status: "soon", icon: "phone", name: "protect_calls", states: ["protect_calls_line"], verbs: [] },
].map((c) => Object.freeze(c)));

// Where the email row's verb goes when Prudence cannot read the mailbox.
const GMAIL_SIGN_IN = "/auth/google?mode=gmail";

// The server's address for its WhatsApp number or Messenger Page (wa.me,
// m.me), or null when it is not an https address: a strange address gives
// no button rather than a strange one, on the list and on the score.
const httpsLink = (v) => {
  const s = String(v || "");
  return /^https:\/\/[^\s"'<>]+$/.test(s) ? s : null;
};

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

// A channel the server runs (status "server"): its row, or null while this
// server does not run it. The link opens in a new tab (httpsLink).
function serverRow(c, status) {
  if (status?.[c.configuredBy] !== true) return null;
  const link = httpsLink(status[c.linkBy]);
  return { stateKey: c.states[1], on: true, verbKey: link ? c.verbs[0] : null, href: link, external: Boolean(link) };
}

// The rows to draw for one senior, in CHANNELS order, in the current
// language. status: the /api/status payload; devices: the list from
// /api/devices (missing or empty: no phone paired yet); a guardians list
// (/api/guardians) may be passed too, no row reads it today. Each row:
// { key, soon, icon, name, state, on (true: the green check before the
// state), verb, href, external (true: opens another app or site in a new
// tab), verbKey, label }; a soon row has no verb and no href, and label is
// what a screen reader announces for it.
export function protectRows(status, { devices } = {}) {
  return CHANNELS.map((c) => {
    const name = t(c.name);
    const fromServer = c.status === "server" ? serverRow(c, status) : null;
    if (c.status === "soon" || (c.status === "server" && !fromServer)) {
      return { key: c.key, soon: true, icon: c.icon, name, state: t(c.states[0]), on: false, verb: null, href: null, verbKey: null,
        label: t("protect_soon_label", { name }) };
    }
    const r = fromServer || (c.key === "email" ? emailRow(status?.gmail)
      : c.key === "texts" ? textsRow(devices)
      : { stateKey: "protect_voice_state", on: false, verbKey: "protect_voice_verb", href: "#/check/voice" });
    return { key: c.key, soon: false, icon: c.icon, name, state: t(r.stateKey, r.vars), on: r.on, verb: r.verbKey ? t(r.verbKey) : null,
      href: r.href, external: Boolean(r.external), verbKey: r.verbKey, label: name };
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
        ${r.href ? `<a class="btn btn-outline" href="${esc(r.href)}"${r.external ? ' target="_blank" rel="noopener"' : ""}>${esc(r.verb)}</a>` : ""}
      </div>`;
  return `<section class="protects"${heading ? ' aria-labelledby="protectsTitle"' : ` aria-label="${title}"`}>
      ${heading ? `<h2 id="protectsTitle" class="section-title">${title}</h2>` : ""}
      ${rows.map(row).join("")}
    </section>`;
}

// ------------------------------------------------------------------ score --
// The protection score, the strip under Today's greeting (protection-menu.md,
// line 2b): how many protections are on, and the one step that turns on the
// next. One row per protection the senior can turn on today, in the order
// the strip offers them. Every new capability adds its row here when it
// ships, next to its Settings row and its onboarding step (the settings and
// onboarding rule, _product/docs/product-process.md): the strip is where the
// senior and the demo see the product grow. A Coming soon channel never has
// a row (the full score must always be reachable), and neither has voice:
// there is nothing to set up, a voice message can be checked any time.
// A row: key; channel (the CHANNELS key it stands for, when it is one); name
// and step (i18n keys: what it is, the words of the link that turns it on);
// href (where that link goes, or a function of ctx for a server's address);
// on(ctx); available(ctx) when the row counts only on some servers (no
// available: it always counts). ctx: { status (/api/status), devices
// (/api/devices), guardians (/api/guardians), progress (/api/learn/progress) },
// any of them missing or null.
const serverCriterion = (key) => {
  const c = CHANNELS.find((ch) => ch.key === key);
  return {
    key, channel: key, name: `score_${key}`, step: `score_${key}_step`,
    // Counted only where this server runs it (the same flag as its row in
    // the list), and then on by itself: there is nothing to set up.
    available: (ctx) => ctx.status?.[c.configuredBy] === true,
    on: () => true,
    href: (ctx) => httpsLink(ctx.status?.[c.linkBy]),
  };
};
export const CRITERIA = Object.freeze([
  { key: "email", channel: "email", name: "score_email", step: "score_email_step", href: GMAIL_SIGN_IN,
    on: (ctx) => Boolean(ctx.status?.gmail) && ctx.status.gmail.connected !== false && !ctx.status.gmail.needsReconnect },
  { key: "texts", channel: "texts", name: "score_texts", step: "score_texts_step", href: "#/settings/phone",
    on: (ctx) => Array.isArray(ctx.devices) && ctx.devices.length > 0 },
  // A person who has not accepted the invitation yet cannot answer: not yet.
  { key: "people", name: "score_people", step: "score_people_step", href: "#/settings/people",
    on: (ctx) => Array.isArray(ctx.guardians) && ctx.guardians.some((g) => g?.status === "active") },
  // One lesson finished (lib/lessons.js summarize: done counts them).
  { key: "learn", name: "score_learn", step: "score_learn_step", href: "#/learn",
    on: (ctx) => Number(ctx.progress?.summary?.done) >= 1 },
  // Her address looked up once in the breach list (breach-exposure.md; the
  // status's breachLookup block). An address in no breach is an answer too,
  // so a lookup that found nothing counts: the answer is what protects.
  { key: "breaches", name: "score_breaches", step: "score_breaches_step", href: "#/settings/knows",
    on: (ctx) => Boolean(ctx.status?.breachLookup?.at) },
  serverCriterion("whatsapp"),
  serverCriterion("facebook"),
].map((c) => Object.freeze(c)));

// The score for one senior, { on, total, next }: on of the total criteria
// this server counts, and next, the first of them in order not on yet ({ key, step (its
// words in the current language), href, external (true: another app or site,
// opened in a new tab) }), or null at the full score.
export function scoreOf(ctx) {
  const c = ctx || {};
  const counted = CRITERIA.filter((row) => !row.available || row.available(c));
  const first = counted.find((row) => !row.on(c));
  const href = first ? (typeof first.href === "function" ? first.href(c) : first.href) : null;
  return {
    on: counted.filter((row) => row.on(c)).length,
    total: counted.length,
    next: first ? { key: first.key, step: t(first.step), href, external: /^https:/.test(href || "") } : null,
  };
}

// The gauge's three-quarter arc on a 56 x 56 box: from 135 degrees to 405
// (bottom left, over the top, to bottom right), radius 22, so the 6-wide
// stroke and its round ends stay inside the box.
const GAUGE_ARC = (() => {
  const at = (deg) => [Math.cos, Math.sin].map((f) => (28 + 22 * f((deg * Math.PI) / 180)).toFixed(2)).join(" ");
  return `M${at(135)}A22 22 0 1 1 ${at(405)}`;
})();

// The strip (styles.css, "2026-11-04 protection score"): the gauge, gold over
// a navy-wash track with the count inside, decorative because the title
// says the same in words; the title ("Protected: 3 of 5", at the full score
// "All 5 protections on"); the one link to the next step, none at the full
// score. The link's tap area is the whole strip (.score-step::after): a
// finger anywhere on it gets the next step. Words, never a percentage, and
// no colour of danger: a low score is an invitation (design.md).
export function renderScore({ on, total, next }) {
  const full = on >= total;
  const count = `${on}/${total}`;
  const title = full ? t("score_full", { total }) : t("score_title", { on, total });
  // pathLength 100: the gold dash is the share that is on. None at zero:
  // a zero dash with round ends would still draw a dot.
  const bar = on > 0
    ? `<path class="score-bar" d="${GAUGE_ARC}" pathLength="100" stroke-dasharray="${esc(Math.round((100 * on) / Math.max(1, total)))} 100"/>`
    : "";
  // The chevron stays on the line of the last word, however the words wrap.
  const words = String(next?.step || "").split(" ");
  const last = words.pop();
  const label = `${words.length ? `${esc(words.join(" "))} ` : ""}<span class="score-step-end">${esc(last)}${icon("chevron-right", 22, 2.5)}</span>`;
  const link = !full && next?.href
    ? `<a class="score-step" href="${esc(next.href)}"${next.external ? ' target="_blank" rel="noopener"' : ""}>${label}</a>`
    : "";
  return `<section class="score" aria-labelledby="scoreTitle">
      <svg class="score-gauge" viewBox="0 0 56 56" aria-hidden="true" focusable="false">
        <path class="score-track" d="${GAUGE_ARC}"/>${bar}
        <text class="score-count${count.length > 3 ? " is-long" : ""}" x="28" y="28" text-anchor="middle" dominant-baseline="central">${esc(count)}</text>
      </svg>
      <div class="score-words">
        <h2 id="scoreTitle" class="score-title">${esc(title)}</h2>
        ${link}
      </div>
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
