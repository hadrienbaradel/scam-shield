// "What Prudence protects" and the menu (_product/specs/protection-menu.md,
// Acceptance): the channel table in public/js/protects.js against the
// feature statuses in _product/spec.md, the rows a senior sees with and
// without a paired phone, the protection score's criteria against the
// channel table, its count and its Coming soon line, the four tabs and the
// screens they light, and the words of the redesign in English and French.
// No database.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { STRINGS, setLang } from "../public/js/i18n.js";
import { CHANNELS, CRITERIA, PENDING, TABS, SCREENS, protectRows, renderProtects, renderScore, scoreOf, pendingOf, screenFor } from "../public/js/protects.js";
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
const REDESIGN = /^(protect_|score_|td_|msg_|blk_|ck_|lh_|set_)|^(tab_blocked|nav_tabs_label|nav_top_label)$/;
const placeholders = (s) => [...String(s).matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort();

test("every word of the channel table, the tabs and the new screens exists in English and in French", () => {
  const used = new Set([
    ...CHANNELS.flatMap((c) => [c.name, ...c.states, ...c.verbs]),
    ...TABS.map((tab) => tab.label),
    ...CRITERIA.flatMap((c) => [c.name, c.step]), "score_title", "score_full", "score_soon",
    ...CHANNELS.filter((c) => c.status !== "built").map((c) => `score_pending_${c.key}`), ...PENDING.map((p) => p.name),
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

// The protection score (protection-menu.md, line 2b). The senior's world in
// six parts, each one either nothing yet or set up.
const nobody = { status: null, devices: [], guardians: [], progress: null, checks: [] };
const thomas = { id: "g1", name: "Thomas", status: "active" };
const oneLesson = { progress: {}, summary: { done: 1, total: 9, stars: 3, days: 1 } };
const servers = { whatsappConfigured: true, whatsappLink: "https://wa.me/15550001111", messengerConfigured: true, messengerLink: "https://m.me/prudence.example" };
const lookedUp = { breachLookup: { at: minutesAgo(1), found: 1 } }; // /api/status after "Look up my email address"
// /api/checks after one voice message checked (src/routes/mail.js records it with the channel "voice").
const voiceChecked = [{ id: "c2", channel: "email", verdict_value: "safe" }, { id: "c1", channel: "voice", verdict_value: "careful" }];
// The score without its Coming soon line, for the cases about the count.
const counted = ({ pending, ...rest }) => rest;

test("the score counts what the senior can turn on today: every built channel, never a Coming soon one", () => {
  assert.deepEqual(CRITERIA.map((c) => c.key), ["email", "texts", "people", "voice", "learn", "breaches", "whatsapp", "facebook"], "the spec's order");
  const byChannel = new Map(CRITERIA.filter((c) => c.channel).map((c) => [c.channel, c]));
  for (const c of CHANNELS) {
    if (c.status === "built") assert.ok(byChannel.has(c.key), `${c.key}: built, so it has a criterion`);
    if (c.status === "soon") assert.ok(!byChannel.has(c.key), `${c.key}: Coming soon, so it is never in the denominator`);
    if (c.status === "server") assert.equal(typeof byChannel.get(c.key)?.available, "function", `${c.key}: counted only where the server runs it`);
  }
  for (const c of CRITERIA) {
    assert.ok(!c.channel || CHANNELS.some((ch) => ch.key === c.channel), `${c.key}: its channel exists`);
    assert.deepEqual([c.name, c.step], [`score_${c.key}`, `score_${c.key}_step`], `${c.key}: its words`);
    assert.ok(Object.isFrozen(c), `${c.key}: frozen`);
  }
});

test("a senior with nothing yet: 0 of 6, and the first step is her email", () => {
  const s = scoreOf(nobody);
  assert.deepEqual(counted(s), { on: 0, total: 6, next: { key: "email", step: "Connect my email", href: "/auth/google?mode=gmail", external: false } });
  assert.deepEqual(scoreOf(undefined), s, "no context at all is nothing yet");
  assert.equal(scoreOf({ ...nobody, status: { gmail: { ...linda.gmail, needsReconnect: true } } }).next.key, "email", "a mailbox Prudence cannot read is not on");
  assert.equal(scoreOf({ ...nobody, status: { gmail: { ...linda.gmail, connected: false } } }).on, 0, "a disconnected mailbox is not on");
});

test("with her email and her phone: 2 of 6, the next step is a trusted person, then a voice message, then a lesson, then the breach list", () => {
  const s = scoreOf({ ...nobody, status: linda, devices: [phone] });
  assert.deepEqual([s.on, s.total], [2, 6]);
  assert.deepEqual(s.next, { key: "people", step: "Add a trusted person", href: "#/settings/people", external: false });
  const invited = scoreOf({ ...nobody, status: linda, devices: [phone], guardians: [{ ...thomas, status: "pending" }] });
  assert.deepEqual([invited.on, invited.next.key], [2, "people"], "an invitation not accepted yet does not count");
  const withThomas = scoreOf({ ...nobody, status: linda, devices: [phone], guardians: [thomas], progress: { summary: { done: 0 } } });
  assert.deepEqual([withThomas.on, withThomas.next], [3, { key: "voice", step: "Try a voice message", href: "#/check/voice", external: false }]);
  const voiceDone = scoreOf({ ...nobody, status: linda, devices: [phone], guardians: [thomas], checks: voiceChecked, progress: { summary: { done: 0 } } });
  assert.deepEqual([voiceDone.on, voiceDone.next], [4, { key: "learn", step: "Start a lesson", href: "#/learn", external: false }]);
  const lessonDone = scoreOf({ ...nobody, status: linda, devices: [phone], guardians: [thomas], checks: voiceChecked, progress: oneLesson });
  assert.deepEqual([lessonDone.on, lessonDone.next], [5, { key: "breaches", step: "Look up my email address", href: "#/settings/knows", external: false }]);
  const nothingFound = scoreOf({ ...nobody, status: { ...linda, breachLookup: { at: minutesAgo(1), found: 0 } }, devices: [phone], guardians: [thomas], checks: voiceChecked, progress: oneLesson });
  assert.deepEqual([nothingFound.on, nothingFound.next], [6, null], "a lookup that found no breach is an answer too, and counts");
  assert.equal(scoreOf({ ...nobody, status: { ...linda, breachLookup: null } }).on, 1, "never looked up: not on");
});

test("everything on, WhatsApp and Messenger run by the server: 8 of 8, no next step", () => {
  const s = scoreOf({ status: { ...linda, ...lookedUp, ...servers }, devices: [phone], guardians: [thomas], checks: voiceChecked, progress: oneLesson });
  assert.deepEqual(counted(s), { on: 8, total: 8, next: null });
  const html = renderScore(s);
  assert.match(html, /<h2 id="scoreTitle" class="score-title">All 8 protections on<\/h2>/);
  assert.doesNotMatch(html, /<a /, "nothing left to do: no link");
  assert.deepEqual(counted(scoreOf({ status: { ...linda, ...lookedUp }, devices: [phone], guardians: [thomas], checks: voiceChecked, progress: oneLesson })), { on: 6, total: 6, next: null },
    "a server without WhatsApp or Messenger: 6 of 6 is the full score");
});

test("voice is on once she has checked one voice message, and not with none or when the checks could not be read", () => {
  const voice = CRITERIA.find((c) => c.key === "voice");
  assert.deepEqual([voice.channel, voice.href], ["voice", "#/check/voice"]);
  assert.equal(voice.on({ checks: voiceChecked }), true, "one voice check among others");
  assert.equal(voice.on({ checks: [{ id: "c9", channel: "voice" }] }), true);
  for (const checks of [[], [{ id: "c3", channel: "email" }, { id: "c4", channel: "pasted" }, { id: "c5", channel: "screenshot" }, { id: "c6", channel: "sms" }], null, undefined, { checks: voiceChecked }, [null]]) {
    assert.equal(voice.on({ checks }), false, `${JSON.stringify(checks)}: no voice check read, not on`);
  }
  const base = { ...nobody, status: linda, devices: [phone], guardians: [thomas] };
  assert.equal(scoreOf({ ...base, checks: voiceChecked }).on - scoreOf({ ...base, checks: null }).on, 1, "the one voice check is one more protection on");
  assert.equal(scoreOf({ ...base, checks: null }).total, 6, "unreadable checks still count voice in the total: it is one tap away");
});

test("the Coming soon line: the channels Coming soon on this server, then the pending list, never counted", () => {
  assert.deepEqual(pendingOf({ status: linda }).map((p) => p.key), ["whatsapp", "facebook", "calls", "instagram", "voicemail"],
    "a server without WhatsApp and Messenger");
  assert.deepEqual(pendingOf({ status: { ...linda, ...servers } }).map((p) => p.key), ["calls", "instagram", "voicemail"],
    "WhatsApp and Messenger run by the server are counted criteria and leave the line by themselves");
  assert.deepEqual(pendingOf({ status: { ...linda, whatsappConfigured: "true", messengerConfigured: true } }).map((p) => p.key), ["whatsapp", "calls", "instagram", "voicemail"],
    "the same flag as the list's row and the criterion: a non-boolean flag is Coming soon");
  assert.deepEqual(pendingOf(undefined), pendingOf({ status: null }), "no context: every server channel is Coming soon");
  assert.deepEqual(pendingOf({ status: linda }).map((p) => p.name), ["WhatsApp", "Messenger", "calls", "Instagram", "voicemail"]);
  const s = scoreOf({ ...nobody, status: linda });
  assert.deepEqual(s.pending, pendingOf({ status: linda }), "scoreOf carries the line");
  assert.equal(s.total, 6, "nothing on the line is in the denominator");
  for (const status of [linda, { ...linda, ...servers }]) {
    const countedHere = CRITERIA.filter((c) => !c.available || c.available({ status })).map((c) => c.key);
    for (const p of pendingOf({ status })) assert.ok(!countedHere.includes(p.key), `${p.key}: on the line, so not counted on this server`);
  }
});

test("the pending list: frozen, nothing that has a channel row or a criterion, plain words in English and French", () => {
  assert.deepEqual(PENDING.map((p) => p.key), ["instagram", "voicemail"]);
  assert.ok(Object.isFrozen(PENDING));
  const TECH = /\b(domain|domaine|api|oauth|token|jeton|sync|webhook|imap|smtp|dm)\b/i;
  for (const p of PENDING) {
    assert.ok(Object.isFrozen(p), `${p.key}: frozen`);
    assert.equal(p.name, `score_pending_${p.key}`, `${p.key}: its words`);
    assert.ok(!CHANNELS.some((c) => c.key === p.key), `${p.key}: a channel row would name it already`);
    assert.ok(!CRITERIA.some((c) => c.key === p.key), `${p.key}: counted, so it leaves the list`);
  }
  const keys = [...CHANNELS.filter((c) => c.status !== "built").map((c) => `score_pending_${c.key}`), ...PENDING.map((p) => p.name), "score_soon"];
  for (const k of keys) {
    for (const l of ["en", "fr"]) {
      const v = STRINGS[l][k];
      assert.ok(typeof v === "string" && v.trim(), `${l}.${k} exists`);
      assert.doesNotMatch(v, TECH, `${l}.${k}: "${v}"`);
    }
  }
});

test("a server running WhatsApp with an http address still counts it, but gives no link to it", () => {
  const whatsapp = CRITERIA.find((c) => c.key === "whatsapp");
  for (const bad of ["http://wa.me/15550001111", "javascript:alert(1)", "", null]) {
    const ctx = { ...nobody, status: { ...linda, whatsappConfigured: true, whatsappLink: bad } };
    assert.deepEqual([scoreOf(ctx).on, scoreOf(ctx).total], [2, 7], `${bad}: counted, and on by itself`);
    assert.equal(whatsapp.href(ctx), null, `${bad}: no link to a strange address`);
  }
  assert.equal(whatsapp.href({ status: servers }), servers.whatsappLink);
  for (const flag of [false, "true", undefined]) {
    assert.equal(scoreOf({ ...nobody, status: { ...linda, whatsappConfigured: flag, whatsappLink: servers.whatsappLink } }).total, 6, `${flag}: not counted`);
  }
});

test("the strip: a decorative gauge, the score in words and one link to the next step", () => {
  const html = renderScore(scoreOf({ ...nobody, status: linda, devices: [phone] }));
  assert.match(html, /^<section class="score" aria-labelledby="scoreTitle">/);
  assert.match(html, /<svg class="score-gauge" viewBox="0 0 56 56" aria-hidden="true" focusable="false">/);
  assert.match(html, />2\/6<\/text>/, "the count inside the gauge");
  assert.match(html, /stroke-dasharray="33 100"/, "two sixths of the arc are gold");
  assert.match(html, /<h2 id="scoreTitle" class="score-title">Protected: 2\u00a0of\u00a06<\/h2>/, "the count never splits over two lines");
  assert.equal((html.match(/<a /g) || []).length, 1, "one link");
  assert.match(html, /<a class="score-step" href="#\/settings\/people">Add a trusted <span class="score-step-end">person<svg/, "the chevron stays with the last word");
  assert.doesNotMatch(html, /\sstyle=/, "no style attribute: the page's CSP allows only styles.css");
  assert.doesNotMatch(html, /%|unprotected|danger|scam/i, "words, never a percentage or a warning");
  assert.doesNotMatch(renderScore(scoreOf(nobody)), /score-bar/, "at zero no gold at all, not even a dot");
  const out = renderScore({ on: 1, total: 2, next: { key: "x", step: "Open <it>", href: "https://wa.me/1", external: true } });
  assert.match(out, /<a class="score-step" href="https:\/\/wa.me\/1" target="_blank" rel="noopener">Open <span class="score-step-end">&lt;it&gt;<svg/, "another app opens in a new tab");
  assert.doesNotMatch(out, /score-soon/, "nothing pending: no Coming soon line");
});

test("the strip's grey Coming soon line: one sentence under the count, none when nothing is pending", () => {
  const html = renderScore(scoreOf({ ...nobody, status: linda, devices: [phone] }));
  assert.match(html, /<p class="score-soon">Coming soon: WhatsApp, Messenger, calls, Instagram, voicemail<\/p>\s*<\/section>$/,
    "the last thing in the strip, after the link");
  assert.equal((html.match(/<a /g) || []).length, 1, "still one link: the line has nothing to tap");
  const both = renderScore(scoreOf({ ...nobody, status: { ...linda, ...servers } }));
  assert.match(both, /<p class="score-soon">Coming soon: calls, Instagram, voicemail<\/p>/);
  const full = renderScore(scoreOf({ status: { ...linda, ...lookedUp, ...servers }, devices: [phone], guardians: [thomas], checks: voiceChecked, progress: oneLesson }));
  assert.match(full, /All 8 protections on<\/h2>[\s\S]*class="score-soon"/, "the full score still names what is on the way");
  assert.doesNotMatch(renderScore({ on: 8, total: 8, next: null, pending: [] }), /score-soon/, "the full score with nothing pending: no line");
  assert.doesNotMatch(renderScore({ on: 8, total: 8, next: null }), /score-soon/, "a score without a pending list: no line");
  assert.match(renderScore({ on: 0, total: 1, next: null, pending: [{ key: "x", name: "A <b>" }, { key: "y", name: " " }] }), /Coming soon: A &lt;b&gt;<\/p>/, "the names are escaped, an empty one dropped");
  assert.doesNotMatch(html, /\sstyle=|%|danger|scam/i, "no style attribute, no percentage, no warning");
});

test("the strip in French", () => {
  globalThis.document = { documentElement: {} }; // setLang records the language on <html>
  try {
    setLang("fr");
    const html = renderScore(scoreOf(nobody));
    assert.match(html, /Protections actives\u00a0: 0\u00a0sur\u00a06/);
    assert.match(html, />Connecter mes <span class="score-step-end">e-mails<svg/);
    assert.match(html, /<p class="score-soon">Bientôt\u00a0: WhatsApp, Messenger, appels, Instagram, messagerie vocale<\/p>/);
    assert.match(renderScore(scoreOf({ status: { ...linda, ...lookedUp }, devices: [phone], guardians: [thomas], checks: voiceChecked, progress: oneLesson })), /Les 6 protections sont actives/);
    assert.equal(scoreOf({ ...nobody, status: linda, devices: [phone], guardians: [thomas] }).next.step, "Essayer un message vocal");
  } finally {
    setLang("en");
    delete globalThis.document;
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
