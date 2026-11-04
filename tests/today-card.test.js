// The shared verdict card (public/js/views/card.js) and Today's "moved away
// this week" count (public/js/views/today.js): pure functions, no browser,
// no database. The card is the canvas card of frames 1l to 1n
// (_product/specs/protection-menu.md, Screens; senior-verdict-screen.md).
import { test } from "node:test";
import assert from "node:assert/strict";
import { setLang } from "../public/js/i18n.js";
import { verdictCardHtml, unsureRowHtml, verdictWord, headlineOf, lookCloserHtml, runLookCloser, bindVerdictCard } from "../public/js/views/card.js";
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

// Look closer (_product/specs/investigate.md): the button, the busy line, the
// trace, the none and failure cases, drawn by card.js for Check and Today.
const LOOK = {
  verdict: "scam", confidence: 0.98, headline: "Scam: a fake USPS fee.", what_to_do: "Delete it.", ms: 9133, source: "Muse Spark (muse-spark-1.3)",
  reasons: [{ text: "USPS does not write to you.", check: 2 }, { text: "The website is <2> days old.", check: 1 }],
  checks: [{ n: 1, found: "The website usps-hold.test was registered 2 days ago (example)" }, { n: 2, found: "USPS is not one of the companies that write to you" }],
};

test("Look closer sits next to Ask only where the message is at hand, folded with the row on a Safe card", () => {
  setLang("en");
  const row = unsureRowHtml({ verdict: "scam", guardianName: "Thomas", lookCloser: true });
  assert.ok(row.includes('<button id="v2Closer" class="btn btn-outline btn-big" type="button">') && row.includes("Look closer"));
  assert.ok(row.indexOf('id="v2Ask"') < row.indexOf('id="v2Closer"') && row.indexOf('id="v2Closer"') < row.indexOf('id="v2Send"'), "after Ask, before Send it to Prudence");
  assert.ok(row.includes('<div id="v2Checks" class="vcard-checks" aria-live="polite" hidden></div>'), "an empty live section waits for the answer");
  assert.ok(!unsureRowHtml({ verdict: "scam", guardianName: "Thomas" }).includes("Closer"), "no message at hand, no button");
  const folded = unsureRowHtml({ verdict: "safe", guardianName: "", folded: true, ids: "ck", lookCloser: true });
  assert.ok(folded.indexOf('id="ckUnsureRow" class="vcard-unsure-row" hidden') < folded.indexOf('id="ckCloser"'), "behind I still have a doubt");
  setLang("fr");
  assert.ok(unsureRowHtml({ verdict: "scam", lookCloser: true }).includes("Regarder de plus près"));
  setLang("en");
});

test("Look closer shows the busy line, then every check numbered, the closer verdict with each reason's check, and the source line", () => {
  setLang("en");
  assert.ok(lookCloserHtml({ busy: true }).includes("Prudence is looking closer. About ten seconds."));
  assert.ok(lookCloserHtml({ busy: true }).includes('role="status"'));
  const html = lookCloserHtml({ result: LOOK }, "ck");
  assert.ok(html.includes('<h3 id="ckChecksTitle" class="section-title" tabindex="-1">Prudence checked:</h3>'));
  assert.ok(html.includes('<ol class="vcard-check-list"><li>The website usps-hold.test was registered 2 days ago (example)</li><li>USPS is not one of the companies that write to you</li></ol>'));
  assert.ok(html.includes('class="vcard vcard-closer danger"') && html.includes("After looking closer: Scam"));
  assert.ok(html.includes(">A fake USPS fee.<"), "the headline without the verdict word");
  assert.ok(html.includes('<p class="vcard-closer-do">Delete it.</p>'), "what to do, as large as the reasons");
  assert.ok(html.includes('USPS does not write to you.<span class="v2-chip">Check 2</span>'));
  assert.ok(html.includes('The website is &lt;2&gt; days old.<span class="v2-chip">Check 1</span>'), "escaped");
  assert.ok(html.includes("Looked closer by Muse Spark (muse-spark-1.3): 2 checks in 9 s"));
  assert.ok(lookCloserHtml({ result: { ...LOOK, checks: [LOOK.checks[0]], reasons: [LOOK.reasons[1]], ms: 300 } }).includes(": 1 check in 1 s"));
  const noted = lookCloserHtml({ result: { ...LOOK, notes: ["The list of dangerous websites was not checked (no key here)"] } });
  assert.ok(noted.includes('</ol><p class="vcard-small">The list of dangerous websites was not checked (no key here)</p>'), "a note under the checks, not numbered");
  assert.ok(noted.includes(": 2 checks in 9 s"), "and not counted as a check");
  setLang("fr");
  const fr = lookCloserHtml({ result: { ...LOOK, verdict: "be_careful" } });
  assert.ok(fr.includes("Prudence a vérifié :") && fr.includes("Après avoir regardé de plus près : Attention") && fr.includes("Vérification 2"));
  assert.ok(fr.includes("Regardé de plus près par Muse Spark (muse-spark-1.3) : 2 vérifications en 9 s"));
  setLang("en");
});

test("with nothing usable the card keeps its verdict, and a look that could not run offers Try again in plain words", () => {
  setLang("en");
  const none = lookCloserHtml({ result: { verdict: null, none: "no_answer", checks: [{ n: 1, found: "The website was registered 2 days ago" }] } }, "v2");
  assert.ok(none.includes("Prudence checked:") && none.includes("<li>The website was registered 2 days ago</li>"), "the checks made stay on the card");
  assert.ok(none.indexOf("</ol>") < none.indexOf("Prudence could not look closer this time. The verdict above stands."), "then the verdict above stands");
  assert.ok(!none.includes("After looking closer"));
  const nothing = lookCloserHtml({ result: { verdict: null, none: "no_reason", checks: [] } }, "v2");
  assert.ok(!nothing.includes("Prudence checked:") && nothing.includes('id="v2ChecksTitle"') && nothing.includes("The verdict above stands."), "no check made: one sentence, focusable");
  const failed = lookCloserHtml({ failed: true }, "v2");
  assert.ok(failed.includes("Prudence could not look closer right now. Please try again in a minute."));
  assert.ok(failed.includes('<button id="v2CloserRetry" class="btn btn-gold btn-big" type="button">Try again</button>'));
  assert.doesNotMatch(failed, /fetch|error|50\d/i);
  const again = unsureRowHtml({ verdict: "scam", lookCloser: true, closer: LOOK });
  assert.ok(!again.includes('id="v2Closer"') && again.includes("Prudence checked:") && !again.includes("hidden></div>"), "a look already made is drawn again, without its button");
});

// A stand-in for the page: elements by id, innerHTML kept as text.
function fakePage() {
  const els = new Map();
  const el = (id) => {
    if (!els.has(id)) {
      els.set(id, { id, hidden: false, disabled: false, attrs: {}, innerHTML: "", isConnected: true, listeners: {}, removed: false, focused: false,
        setAttribute(k, v) { this.attrs[k] = v; }, addEventListener(type, fn) { this.listeners[type] = fn; }, remove() { this.removed = true; },
        focus() { this.focused = true; }, querySelector(sel) { const want = sel.slice(1); return this.innerHTML.includes(`id="${want}"`) ? el(want) : null; } });
    }
    return els.get(id);
  };
  return { el, querySelector: (sel) => el(sel.slice(1)) };
}

test("tapping Look closer: the button waits, the answer replaces the busy line, focus moves to it; a failure retries the same call", async () => {
  setLang("en");
  const page = fakePage();
  let tapped = 0;
  bindVerdictCard(page, { ids: "ck", onLookCloser: () => { tapped++; } });
  page.el("ckCloser").listeners.click();
  assert.equal(tapped, 1);
  let release;
  const kept = [];
  const running = runLookCloser(page, { ids: "ck", send: () => new Promise((r) => { release = r; }), onResult: (r) => kept.push(r) });
  assert.equal(page.el("ckCloser").disabled, true);
  assert.equal(page.el("ckChecks").hidden, false);
  assert.ok(page.el("ckChecks").innerHTML.includes("Prudence is looking closer."));
  release(LOOK);
  await running;
  assert.ok(page.el("ckChecks").innerHTML.includes("Prudence checked:"));
  assert.equal(page.el("ckCloser").removed, true, "one look per card");
  assert.equal(page.el("ckChecksTitle").focused, true);
  assert.deepEqual(kept, [LOOK]);
  // A failure, then Try again sends the same thing.
  const page2 = fakePage();
  let calls = 0;
  const send = async () => { calls++; if (calls === 1) throw new Error("502"); return LOOK; };
  await runLookCloser(page2, { ids: "v2", send });
  assert.ok(page2.el("v2Checks").innerHTML.includes("Try again"));
  assert.equal(page2.el("v2Closer").removed, true, "the button goes once; the failure brings its own Try again");
  await page2.el("v2CloserRetry").listeners.click();
  await new Promise((r) => setImmediate(r));
  assert.equal(calls, 2);
  assert.ok(page2.el("v2Checks").innerHTML.includes("After looking closer: Scam"));
  // The server cannot look closer (503): said once, no Try again; signed out (401): back to sign in.
  const page5 = fakePage();
  await runLookCloser(page5, { ids: "v2", send: async () => { throw Object.assign(new Error("503"), { status: 503 }); } });
  assert.ok(page5.el("v2Checks").innerHTML.includes("Prudence cannot look closer here for now. The verdict above stands."));
  assert.ok(!page5.el("v2Checks").innerHTML.includes("Try again"));
  assert.equal(page5.el("v2Closer").removed, true);
  const page6 = fakePage();
  globalThis.location = { href: "/#/check" };
  try {
    await runLookCloser(page6, { ids: "v2", send: async () => { throw Object.assign(new Error("401"), { status: 401 }); } });
    assert.equal(globalThis.location.href, "/");
  } finally { delete globalThis.location; }
  // A card no longer on screen drops a late answer; Stop (an abort) says nothing.
  const page3 = fakePage();
  const late = runLookCloser(page3, { ids: "v2", send: async () => { page3.el("v2Checks").isConnected = false; return LOOK; } });
  await late;
  assert.ok(page3.el("v2Checks").innerHTML.includes("looking closer"), "left as it was");
  const page4 = fakePage();
  await runLookCloser(page4, { ids: "v2", send: async () => { throw new DOMException("Stopped", "AbortError"); } });
  assert.ok(page4.el("v2Checks").innerHTML.includes("looking closer"));
});
