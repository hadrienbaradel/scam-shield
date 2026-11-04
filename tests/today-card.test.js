// The shared verdict card (public/js/views/card.js) and Today's "moved away
// this week" count (public/js/views/today.js): pure functions, no browser,
// no database. The card is the canvas card of frames 1l to 1n
// (_product/specs/protection-menu.md, Screens; senior-verdict-screen.md).
import { test } from "node:test";
import assert from "node:assert/strict";
import { setLang } from "../public/js/i18n.js";
import { verdictCardHtml, unsureRowHtml, verdictWord, headlineOf } from "../public/js/views/card.js";
import { movedThisWeek, mailboxProblem } from "../public/js/views/today.js";

// setLang records the language on <html>: a stand-in for these tests.
globalThis.document ??= { documentElement: {} };

const careful = {
  verdict: "be_careful",
  headline: "Be careful: check this before you do anything.",
  action_text: "Do not use the link.",
  reasons: [
    { text: "Replies would go to a different address than the sender's.", evidence: "sender" },
    { text: "The link shows one website address but leads to <another>.", evidence: "link" },
    { text: "A third reason.", evidence: "nonsense-kind" },
  ],
  real_company_says: "The real company never asks this by email.",
  source: "Muse Spark",
};
const count = (html, s) => html.split(s).length - 1;

test("every reason is a fact box on the card, escaped, with its chip when the evidence kind is known; no Why button", () => {
  setLang("en");
  const html = verdictCardHtml({ verdict: careful });
  assert.equal(count(html, 'class="vcard-fact"'), 3);
  assert.equal(count(html, 'class="v2-chip"'), 2, "the unknown evidence kind gets no chip");
  assert.ok(html.includes("leads to &lt;another&gt;."), "message words are escaped");
  assert.ok(html.includes(">Check this before you do anything.<"), "the headline drops the leading verdict word");
  assert.ok(html.includes("Be careful") && html.includes('class="v2-card vcard caution"'));
  assert.ok(html.includes("The real company never asks this by email.") && html.includes("Judged by Muse Spark."));
  assert.ok(!/Why we think so/.test(html), "no Why button: the reasons are already on the card");
  assert.ok(!html.includes("BodyBox"), "no message, no fold");
});

test("the message fold, closed or open, and the id prefix", () => {
  setLang("en");
  const message = { fromName: "Bank", from: "x@bank.example", subject: "Hi", body: "<b>pay</b>", audio: "/a.mp3" };
  const closed = verdictCardHtml({ verdict: careful, message, ids: "ck" });
  assert.ok(closed.includes('id="ckCard"') && closed.includes('id="ckHeadline"') && closed.includes('id="ckBody"'));
  assert.ok(closed.includes('aria-expanded="false"') && closed.includes('id="ckBodyBox" class="vcard-body" hidden'));
  assert.ok(closed.includes("Show me the message") && closed.includes('<audio controls preload="none" src="/a.mp3">'));
  assert.ok(closed.includes("&lt;b&gt;pay&lt;/b&gt;") && !closed.includes('id="v2'));
  const open = verdictCardHtml({ verdict: careful, message, open: { body: true } });
  assert.ok(open.includes('id="v2Body"') && open.includes('aria-expanded="true"') && open.includes(">Hide the message<"));
  assert.ok(!open.includes('class="vcard-body" hidden'));
});

test("no verdict is never drawn as Safe", () => {
  setLang("en");
  for (const verdict of [{}, { verdict: "maybe" }, null]) {
    const html = verdictCardHtml({ verdict });
    assert.ok(html.includes("vcard caution") && !html.includes("vcard ok"));
    assert.ok(html.includes("We could not check this message yet."));
  }
  assert.equal(verdictWord("scam"), "Scam");
  assert.equal(headlineOf("arnaque : faux colis"), "Faux colis");
});

test("Still unsure?: Ask the trusted person, or add one; Send it to Prudence is Coming soon; folded on Safe", () => {
  setLang("en");
  const row = unsureRowHtml({ verdict: "scam", guardianName: "Thomas" });
  assert.ok(row.includes("Still unsure?") && row.includes('id="v2Ask"') && row.includes("Ask Thomas"));
  assert.ok(/id="v2Send" class="soon-button" type="button" aria-disabled="true"/.test(row) && row.includes("Coming soon"));
  assert.ok(row.includes("answers on Today within a day") && !row.includes("v2Doubt"));
  const none = unsureRowHtml({ verdict: "be_careful", guardianName: "", ids: "ck" });
  assert.ok(none.includes('id="ckAddTrusted"') && none.includes('href="#/settings/people"') && none.includes("Add a trusted person"));
  const folded = unsureRowHtml({ verdict: "safe", guardianName: "Thomas", folded: true });
  assert.ok(folded.includes('id="v2Doubt"') && folded.includes("I still have a doubt"));
  assert.ok(folded.includes('id="v2UnsureRow" class="vcard-unsure-row" hidden') && folded.includes('id="v2Ask"'));
  setLang("fr");
  const fr = unsureRowHtml({ verdict: "scam", guardianName: "Thomas" });
  assert.ok(fr.includes("Demander à Thomas") && fr.includes("Bientôt"));
  setLang("en");
});

test("moved away this week: only the last seven days, never what she put back; no date, no \"this week\"", () => {
  const now = Date.parse("2026-11-04T20:00:00Z");
  const day = 24 * 3600 * 1000;
  const m = (ago, check) => ({ date: new Date(now - ago * day).toISOString(), check });
  const moved = { action: "moved", restored: false };
  const list = [m(1, moved), m(6.9, moved), m(8, moved), m(2, { action: "moved", restored: true }), m(1, { action: "kept" }), m(1, null)];
  assert.deepEqual(movedThisWeek(list, now), { n: 2, week: true });
  assert.deepEqual(movedThisWeek([], now), { n: 0, week: true });
  assert.deepEqual(movedThisWeek([...list, { check: moved }], now), { n: 4, week: false });
});

test("the all-clear only when the mailbox was really checked within the last day", () => {
  const now = Date.parse("2026-11-04T20:00:00Z");
  const at = (h) => new Date(now - h * 3600000).toISOString();
  const ok = { connected: true, needsReconnect: false, syncStatus: "ok", lastSyncAt: at(0.05), ready: true, push: true };
  const p = (gmail, opts = {}) => mailboxProblem(gmail === undefined ? {} : { gmail }, { now, ...opts });
  assert.equal(p(ok), null);
  assert.equal(p({ ...ok, lastSyncAt: at(23) }), null);
  assert.deepEqual(p(ok, { statusOk: false }), { kind: "error" }, "the status could not be read again");
  assert.deepEqual(p({ ...ok, syncStatus: "error" }), { kind: "error" });
  assert.deepEqual(p({ ...ok, lastSyncAt: null }), { kind: "error" }, "no last check: nothing to call clear");
  assert.deepEqual(p({ ...ok, needsReconnect: true, connected: false }), { kind: "reconnect" });
  assert.deepEqual(p({ ...ok, connected: false }), { kind: "reconnect" }, "no Google token at all");
  assert.deepEqual(p(undefined), { kind: "reconnect" }, "no mailbox");
  assert.deepEqual(p({ ...ok, ready: false }), { kind: "first" });
  assert.deepEqual(p({ ...ok, lastSyncAt: at(25) }), { kind: "stale", at: at(25) });
});
