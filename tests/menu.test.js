// "What Prudence protects" and the menu (_product/specs/protection-menu.md,
// Acceptance): the channel table in public/js/protects.js against the
// feature statuses in _product/spec.md, the rows a senior sees with and
// without a paired phone, the four tabs and the screens they light, and the
// words of the redesign in English and French. No database.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { STRINGS, setLang } from "../public/js/i18n.js";
import { CHANNELS, TABS, SCREENS, protectRows, renderProtects, screenFor } from "../public/js/protects.js";
import { ICON_NAMES } from "../public/js/ui.js";

const minutesAgo = (n) => new Date(Date.now() - n * 60000).toISOString();
const linda = { gmail: { connected: true, needsReconnect: false, syncStatus: "ok", lastSyncAt: minutesAgo(2), ready: true, push: true } };
const phone = { id: "d1", name: "Linda's phone", created_at: minutesAgo(9000), last_seen_at: minutesAgo(5) };
const byKey = (rows) => Object.fromEntries(rows.map((r) => [r.key, r]));

test("the channels come in the spec's order: email, texts and voice built, WhatsApp and Messenger from the server, calls coming soon", () => {
  assert.deepEqual(CHANNELS.map((c) => c.key), ["email", "texts", "voice", "whatsapp", "facebook", "calls"]);
  assert.deepEqual(CHANNELS.map((c) => c.status), ["built", "built", "built", "server", "server", "soon"]);
  for (const c of CHANNELS) {
    assert.ok(ICON_NAMES.includes(c.icon), `${c.key}: icon "${c.icon}" exists in ui.js`);
    assert.equal(c.status === "soon", c.verbs.length === 0, `${c.key}: a Coming soon row has no verb, the others have one`);
  }
  const read = Object.fromEntries(CHANNELS.filter((c) => c.status === "server").map((c) => [c.key, [c.configuredBy, c.linkBy]]));
  assert.deepEqual(read, { whatsapp: ["whatsappConfigured", "whatsappLink"], facebook: ["messengerConfigured", "messengerLink"] },
    "the /api/status fields that turn WhatsApp and Messenger on (names agreed with the channel sessions)");
});

// The Features table of _product/spec.md: | Feature | Status | One-line spec | Details |.
function featureRows() {
  const lines = readFileSync(new URL("../_product/spec.md", import.meta.url), "utf8").split("\n");
  const start = lines.findIndex((l) => /^\|\s*Feature\s*\|\s*Status\s*\|/.test(l));
  assert.ok(start >= 0, "spec.md has its Features table");
  const rows = [];
  for (const line of lines.slice(start + 2)) {
    if (!line.startsWith("|")) break;
    const cells = line.split(/(?<!\\)\|/).map((c) => c.trim());
    rows.push({ name: cells[1], status: cells[2] });
  }
  return rows;
}

// Which Features row decides each static channel. A channel whose row is
// missing is Coming soon (phone calls: an idea only on Nov 4).
const FEATURE_ROW = {
  email: /^Gmail connection and scanning$/,
  texts: /^Android SMS companion$/,
  voice: /^Check something else \(text, picture, voice note, \.eml\)$/,
  calls: /^(Your )?phone calls?\b|^Calls?\b|^Call protection\b/i,
};

// WhatsApp and Facebook and Messenger are not held to the spec table: whether
// they are on is read from the server (/api/status whatsappConfigured,
// messengerConfigured), because the Prudence number and Page exist only where
// their keys are set; the Messenger and WhatsApp test below covers them. The
// static channels are: phone calls (the only static Coming soon row) and the
// three built ones, which must stay Built in the spec.
test("a static channel is Coming soon exactly when its feature is not Built in _product/spec.md", () => {
  const rows = featureRows();
  assert.ok(rows.length > 10, "the Features table was read");
  const fixed = CHANNELS.filter((c) => c.status !== "server");
  assert.deepEqual(fixed.map((c) => c.key), ["email", "texts", "voice", "calls"]);
  assert.deepEqual(Object.keys(FEATURE_ROW).sort(), fixed.map((c) => c.key).sort(), "every static channel has its row rule");
  for (const c of fixed) {
    const found = rows.filter((r) => FEATURE_ROW[c.key].test(r.name));
    assert.ok(found.length <= 1, `${c.key}: at most one Features row (${found.map((r) => r.name).join(", ")})`);
    const built = Boolean(found[0] && /^Built\b/.test(found[0].status));
    assert.equal(c.status, built ? "built" : "soon",
      `${c.key}: "${found[0]?.name ?? "no row"}" is "${found[0]?.status ?? "absent"}" in spec.md, so the row must be ${built ? "built" : "Coming soon"}`);
  }
});

// The older keys the redesigned screens read (i18n.js names them per group):
// deleting one would break a screen silently, with t() printing the key.
const REUSED = [
  "nav_settings", "v2_tab_today", "v2_tab_check", "learn_tab", "sign_out", "lang_switch", "skip",
  "v2_morning", "v2_afternoon", "v2_evening", "v2_need_one", "v2_need_many", "v2_look_one", "v2_look",
  "box_inbox", "box_careful", "pill_scam", "pill_careful", "pill_safe", "put_back_done", "no_subject", "empty_box",
  "channel_q", "ch_sms", "ch_whatsapp", "eml_title", "eml_btn", "v2_read_short", "v2_ask", "checking", "please_wait",
  "learn_title", "learn_lead", "learn_to_try", "learn_minutes_one", "learn_start", "learn_no_stars", "learn_question", "learn_next", "learn_back",
  "settings_title", "v2_tab_people", "mode_move", "mode_move_sub", "mode_label", "mode_label_sub", "size_q", "size_1", "size_2", "size_3",
  "lang_q", "knows_title", "history_title", "delete_btn", "phone_title", "people_title", "saved",
];
const REDESIGN = /^(protect_|td_|msg_|blk_|ck_|lh_|set_)|^(tab_blocked|nav_tabs_label|nav_top_label)$/;
const placeholders = (s) => [...String(s).matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort();

test("every word of the channel table, the tabs and the new screens exists in English and in French", () => {
  const used = new Set([
    ...CHANNELS.flatMap((c) => [c.name, ...c.states, ...c.verbs]),
    ...TABS.map((tab) => tab.label),
    "protect_title", "protect_soon", "protect_soon_label",
    ...REUSED,
    ...Object.keys(STRINGS.en).filter((k) => REDESIGN.test(k)),
  ]);
  for (const key of used) {
    for (const l of ["en", "fr"]) assert.ok(typeof STRINGS[l][key] === "string" && STRINGS[l][key].trim(), `${l}.${key} exists and is not empty`);
  }
});

test("English and French have the same keys, with the same {placeholders}", () => {
  const en = Object.keys(STRINGS.en);
  const fr = Object.keys(STRINGS.fr);
  assert.deepEqual(en.filter((k) => !(k in STRINGS.fr)), [], "no English key is missing in French");
  assert.deepEqual(fr.filter((k) => !(k in STRINGS.en)), [], "no French key is missing in English");
  for (const k of en) assert.deepEqual(placeholders(STRINGS.fr[k]), placeholders(STRINGS.en[k]), `${k}: same placeholders`);
});

test("Linda without a phone: her email is on, her texts need the app, voice is one tap away, three rows are coming soon", () => {
  const rows = protectRows(linda);
  const r = byKey(rows);
  assert.deepEqual(rows.map((x) => x.key), CHANNELS.map((c) => c.key));
  assert.equal(r.email.state, "On · checked 2 minutes ago");
  assert.equal(r.email.on, true);
  assert.deepEqual([r.email.verb, r.email.href], ["See my messages", "#/messages"]);
  assert.equal(r.texts.state, "Needs the Prudence app on your Android phone");
  assert.equal(r.texts.on, false);
  assert.deepEqual([r.texts.verb, r.texts.href], ["Add my phone", "#/settings/phone"]);
  assert.deepEqual([r.voice.state, r.voice.verb, r.voice.href], ["Send one any time", "Check a voice message", "#/check/voice"]);
  for (const k of ["whatsapp", "facebook", "calls"]) { // no whatsappConfigured or messengerConfigured in Linda's status
    assert.equal(r[k].soon, true);
    assert.equal(r[k].verb, null, `${k}: no verb`);
    assert.equal(r[k].href, null, `${k}: nowhere to go`);
    assert.match(r[k].label, /coming soon, no action$/, `${k}: announced as coming soon, no action`);
  }
  assert.deepEqual(protectRows(linda, { devices: [] }), rows, "an empty phone list is no phone");
});

test("WhatsApp and Messenger are on only when the server says so, and their button opens the app in a new tab", () => {
  const cases = [
    ["whatsapp", "whatsappConfigured", "whatsappLink", "https://wa.me/15550001111", "WhatsApp messages", "Forward any message to Prudence on WhatsApp", "Open WhatsApp"],
    ["facebook", "messengerConfigured", "messengerLink", "https://m.me/prudence.example", "Facebook and Messenger", "Send any message to Prudence on Messenger", "Open Messenger"],
  ];
  for (const [key, flag, linkField, link, name, state, verb] of cases) {
    for (const st of [linda, { ...linda, [flag]: false, [linkField]: link }, { ...linda, [flag]: "true", [linkField]: link }, { ...linda, [flag]: null, [linkField]: null }]) {
      const r = byKey(protectRows(st))[key];
      assert.deepEqual([r.soon, r.verb, r.href], [true, null, null], `${key}: a missing, false or non-boolean flag is Coming soon`);
      assert.equal(r.label, `${name}, coming soon, no action`);
    }
    const on = byKey(protectRows({ ...linda, [flag]: true, [linkField]: link }))[key];
    assert.deepEqual([on.soon, on.on, on.state, on.verb, on.href, on.external], [false, true, state, verb, link, true], `${key} on`);
    const html = renderProtects(protectRows({ ...linda, [flag]: true, [linkField]: link }));
    assert.ok(html.includes(`<a class="btn btn-outline" href="${link}" target="_blank" rel="noopener">${verb}</a>`), `${key}: the link button`);
    assert.equal((html.match(/class="row-card row-soon"/g) || []).length, 2, `${key} on: the two other rows stay Coming soon`);
    for (const bad of ["javascript:alert(1)", "http://wa.me/x", "https://x\" onclick=\"y", "", undefined]) {
      const r = byKey(protectRows({ ...linda, [flag]: true, [linkField]: bad }))[key];
      assert.deepEqual([r.on, r.verb, r.href], [true, null, null], `${key} ${String(bad)}: on, but no button to a strange address`);
    }
  }
  const both = renderProtects(protectRows({ ...linda, whatsappConfigured: true, whatsappLink: cases[0][3], messengerConfigured: true, messengerLink: cases[1][3] }));
  assert.equal((both.match(/class="row-card row-soon"/g) || []).length, 1, "with both on, only phone calls is Coming soon");
});

test("Linda with her phone paired: the texts row names it and offers Change", () => {
  const r = byKey(protectRows(linda, { devices: [phone] }));
  assert.equal(r.texts.state, "On, on Linda's phone");
  assert.equal(r.texts.on, true);
  assert.deepEqual([r.texts.verb, r.texts.href], ["Change", "#/settings/phone"]);
  const two = byKey(protectRows(linda, { devices: [{ ...phone, name: "Old tablet", last_seen_at: minutesAgo(9000) }, phone] }));
  assert.equal(two.texts.state, "On, on Linda's phone", "the phone used last names the row");
  const unnamed = byKey(protectRows(linda, { devices: [{ ...phone, name: "Phone" }] }));
  assert.equal(unnamed.texts.state, "On, on your phone", "the app's default name is not shown");
});

test("the email row says what is true and never a date it does not have", () => {
  const email = (gmail) => byKey(protectRows({ gmail })).email;
  assert.deepEqual([email({ ...linda.gmail, lastSyncAt: null }).state], ["On"]);
  assert.equal(email({ ...linda.gmail, ready: false }).state, "On · getting to know your mailbox");
  assert.equal(email({ ...linda.gmail, syncStatus: "error" }).state, "On · checking again in a minute");
  const lost = email({ ...linda.gmail, needsReconnect: true });
  assert.deepEqual([lost.state, lost.on, lost.verb, lost.href], ["Prudence cannot read your email right now", false, "Connect Gmail again", "/auth/google?mode=gmail"]);
  const none = email(null);
  assert.deepEqual([none.state, none.on, none.verb], ["Not connected yet", false, "Connect my email"]);
  for (const g of [linda.gmail, { ...linda.gmail, lastSyncAt: null }]) assert.doesNotMatch(email(g).state, /since|depuis|\d{4}/i);
});

test("in French the same rows carry the canvas words", () => {
  globalThis.document = { documentElement: {} }; // setLang records the language on <html>
  try {
    setLang("fr");
    const r = byKey(protectRows(linda, { devices: [phone] }));
    assert.equal(r.email.state, "Activé · vérifié il y a 2 minutes");
    assert.equal(r.email.verb, "Voir mes messages");
    assert.deepEqual([r.texts.state, r.texts.verb], ["Activé, sur Linda's phone", "Changer"]);
    assert.equal(byKey(protectRows(linda)).texts.verb, "Ajouter mon téléphone");
    assert.match(r.whatsapp.label, /^Messages WhatsApp, bientôt, aucune action$/);
    assert.match(renderProtects(protectRows(linda)), /Ce que Prudence protège/);
  } finally {
    setLang("en");
    delete globalThis.document;
  }
});

test("the list draws one outline link per built row and no button at all on a Coming soon row", () => {
  const html = renderProtects(protectRows(linda));
  assert.match(html, /<h2 id="protectsTitle" class="section-title">What Prudence protects<\/h2>/);
  assert.equal((html.match(/<a class="btn btn-outline" href="/g) || []).length, 3);
  assert.match(html, /href="#\/messages">See my messages<\/a>/);
  assert.match(html, /href="#\/settings\/phone">Add my phone<\/a>/);
  assert.match(html, /href="#\/check\/voice">Check a voice message<\/a>/);
  const soon = html.split('class="row-card row-soon"').slice(1);
  assert.equal(soon.length, 3);
  for (const part of soon) {
    const row = part.split('<div class="row-card')[0];
    assert.doesNotMatch(row, /<a |<button/, "a Coming soon row has nothing to tap");
    assert.match(row, /aria-label="[^"]+, coming soon, no action"/);
    assert.match(row, /<span class="pill-soon">Coming soon<\/span>/);
  }
  assert.doesNotMatch(html, /\sstyle=/, "no style attribute: the page's CSP allows only styles.css");
  assert.equal((html.match(/stroke="currentColor" stroke-width="2.5"/g) || []).length, 1, "the green check sits only before a state that is on");
  const bare = renderProtects(protectRows(linda), { heading: false });
  assert.doesNotMatch(bare, /<h2/);
  assert.match(bare, /<section class="protects" aria-label="What Prudence protects">/);
});

test("no technical word in the protect strings or the redesign's words", () => {
  const TECH = /\b(domain|domaine|api|oauth|token|jeton|sync)/i;
  for (const l of ["en", "fr"]) {
    for (const [k, v] of Object.entries(STRINGS[l])) {
      if (!/^protect_/.test(k) && !REDESIGN.test(k)) continue;
      assert.doesNotMatch(v, TECH, `${l}.${k}: "${v}"`);
      assert.doesNotMatch(v, /%/, `${l}.${k}: no percentage`);
    }
  }
});

test("four tabs, and every senior screen lights the tab the design gives it", () => {
  assert.deepEqual(TABS.map((tab) => [tab.key, tab.href, tab.icon]),
    [["today", "#/today", "home"], ["check", "#/check", "search"], ["learn", "#/learn", "book"], ["blocked", "#/blocked", "circle-slash"]]);
  for (const tab of TABS) assert.ok(ICON_NAMES.includes(tab.icon), `${tab.key}: icon exists`);
  const lit = (hash) => (screenFor(hash) ? screenFor(hash).tab : "wide");
  const cases = {
    "": "today", "#/": "today", "#/today": "today", "#/messages": "today",
    "#/check": "check", "#/check/paste": "check", "#/check/photo": "check", "#/check/voice": "check", "#/check/more": "check",
    "#/learn": "learn", "#/learn/parcel-fee": "learn", "#/blocked": "blocked",
    "#/settings": null, "#/settings/people": null, "#/settings/phone": null, "#/settings/knows": null, "#/settings/did": null, "#/settings/delete": null,
    "#/people": null,
    "#/inbox": "wide", "#/folder/scam": "wide", "#/guardian": "wide", "#/admin": "wide", "#/demo": "wide", "#/checkup": "wide",
  };
  for (const [hash, tab] of Object.entries(cases)) assert.equal(lit(hash), tab, `${hash || "(empty)"} lights ${tab}`);
  assert.equal(screenFor("#/check/photo").view, "check-photo");
  assert.equal(screenFor("#/people").view, "settings-people", "the old address draws My people");
  assert.equal(new Set(SCREENS.map((s) => s.route)).size, SCREENS.length, "one entry per route");
  assert.deepEqual(SCREENS.filter((s) => s.mail).map((s) => s.view), ["today", "messages", "blocked"], "only the mailbox screens need Gmail");
});
