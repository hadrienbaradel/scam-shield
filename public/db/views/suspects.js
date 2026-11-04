// Suspects: the lookup of a website, a sender address or a phone number
// (#/suspects?q=<indicator>): how many library entries used it, weighted
// by age, when it was first and last seen, and the entries behind the
// count, each opening its page; "contested" while a notice is open,
// "removed" after one was upheld. The contest form under a listing sends
// the four elements of a notice plus the good-faith statement; a decision
// with its reason follows within 7 days and is read back by its id
// (#/suspects?contest=<id>). The empty state says it plainly: no entry,
// no listing.

import { api, $, esc, cap, chip, timeEl, num, hashFor, go, announce, channelWord, countryWord, toast, banner, busy, isBusy } from "../db.js";

export const label = "Suspects";

const KIND_WORDS = { domain: "website", email: "sender address", phone: "phone number" };
const kindWord = (k) => KIND_WORDS[k] || "indicator";
const STATUS = { open: ["warn", "Open"], upheld: ["ok", "Upheld"], dismissed: ["off", "Dismissed"] };
const STATUS_LINES = {
  open: "A reviewer has not decided yet. The listing shows contested meanwhile; a decision with its reason follows within 7 days.",
  upheld: "Upheld: the listing was removed.",
  dismissed: "Dismissed: the listing stays.",
};
// Set by a sent notice, so the next render lands on its status.
let justSent = false;

export async function render(root, params, ctx) {
  const q = (ctx.query.get("q") || "").trim();
  const contestId = (ctx.query.get("contest") || "").trim();
  const header = $("#q");
  if (header && header.value !== q) header.value = q;

  const [result, fam, about] = await Promise.all([
    q ? api(`/api/public/suspects?q=${encodeURIComponent(q)}`).catch((e) => { if (e.status === 400) return { error: e.message }; throw e; }) : null,
    q ? familiesCache() : { families: [] },
    q ? api("/api/public/about").catch(() => null) : null,
  ]);
  if (ctx.stale()) return;
  const families = fam.families || [];
  const listed = Boolean(result && !result.error && result.reports > 0 && !result.removed);

  root.innerHTML = `
    <p class="lead">Look up a website, a sender address or a phone number: how many library entries used it and when it was last seen. The count decays with time, and a listing never says scam without an entry you can read; a private person's number is never listed on its own.</p>
    <form class="form card" id="lookup" role="search" aria-labelledby="h-lookup">
      <h2 id="h-lookup">Look up</h2>
      <div class="field"><label for="l-q">A website, a sender address or a phone number</label>
        <input id="l-q" name="q" type="search" autocomplete="off" spellcheck="false" value="${esc(q)}" data-focus="lookup-q">
        <span class="help">Written any way: a link pasted whole, an address, a number with spaces or dots.</span></div>
      <div class="btn-row"><button type="submit" class="btn" data-focus="lookup-go">Look up</button></div>
    </form>
    <div id="result">${q ? resultBlock(result, families) : ""}</div>
    ${listed ? contestForm(result, about) : ""}
    <form class="form card" id="contestStatus" novalidate aria-labelledby="h-status">
      <h2 id="h-status">Check a notice</h2>
      <div class="field"><label for="cs-id">Notice id</label>
        <input id="cs-id" name="id" autocomplete="off" spellcheck="false" value="${esc(contestId)}" data-focus="cs-id">
        <span class="help">The id the page gave you when you sent a notice; the decision and its reason appear here.</span></div>
      <div class="btn-row"><button type="submit" class="btn btn-ghost" data-focus="cs-check">Check</button></div>
      <div id="statusOut" aria-live="polite"></div>
    </form>`;

  if (result && !result.error) {
    announce(result.removed ? `${result.indicator.value}: removed after a contest`
      : result.reports ? `${result.indicator.value}: reported ${num(result.reports)} ${result.reports === 1 ? "time" : "times"}${result.contested ? ", contested" : ""}`
        : `${result.indicator.value}: nothing reported`);
  }
  $("#lookup", root).addEventListener("submit", (e) => { e.preventDefault(); go(hashFor("suspects", { q: $("#l-q", root).value.trim() })); });
  // The whole row opens the entry; the link in the first cell is the keyboard path.
  $("#result tbody", root)?.addEventListener("click", (e) => {
    const tr = e.target.closest("tr.row-link");
    if (!tr || e.target.closest("a") || window.getSelection()?.toString()) return;
    location.hash = tr.dataset.href;
  });
  const form = $("#contestForm", root);
  if (form) form.addEventListener("submit", (e) => { e.preventDefault(); send(root, form, result, ctx); });
  $("#contestStatus", root).addEventListener("submit", (e) => { e.preventDefault(); check(root, $("#cs-id", root).value.trim()); });
  if (contestId) check(root, contestId, { focus: justSent });
  justSent = false;
}

// ---- The listing ------------------------------------------------------------------

function resultBlock(r, families) {
  if (!r) return "";
  if (r.error) return banner(r.error);
  const ind = r.indicator || {};
  const word = kindWord(ind.kind);
  const head = `<h2 id="h-result">${esc(cap(word))} <code>${esc(ind.value)}</code></h2>`;
  if (r.removed) {
    return `<section class="card" aria-labelledby="h-result">${head}
      <p>${chip("off", "removed")} Removed after a contest on ${timeEl(r.removedAt)}. This ${esc(word)} is listed no more; the library entries that mentioned it stay, as examples.</p>
    </section>`;
  }
  if (!r.reports) {
    return `<section class="card" aria-labelledby="h-result">${head}
      <p class="empty">Nothing reported for this. A listing never says scam without an entry behind it.</p>
      <p class="small muted">Received a message that used it? <a href="#/submit">Submit it to the library</a>: once a reviewer approves it, this ${esc(word)} is listed with the entry as its evidence.</p>
    </section>`;
  }
  return `<section class="card" aria-labelledby="h-result">${head}
    <p><strong>Reported ${esc(num(r.reports))} ${r.reports === 1 ? "time" : "times"}</strong>, last seen ${timeEl(r.lastSeen)}, weight ${esc(String(r.weight))}${r.contested ? ` ${chip("warn", "contested")}` : ""}</p>
    ${r.contested ? `<p class="small">A notice contests this listing; a decision with its reason follows within 7 days. The count stays meanwhile: it is the number of entries, nothing else.</p>` : ""}
    <p class="small muted">Reported: the number of library entries that used this ${esc(word)}, first seen ${timeEl(r.firstSeen)}. The weight counts 1 for an entry seen in the last 90 days, 0.5 within a year, 0.25 after, so an old sighting counts for less.</p>
    <div class="table-wrap"><table class="table">
      <thead><tr>
        <th scope="col">First seen</th><th scope="col">Last seen</th><th scope="col">Family</th><th scope="col" class="col-channel">Channel</th><th scope="col">Country</th><th scope="col">Brand</th>
      </tr></thead>
      <tbody>${(r.entries || []).map((e) => row(e, families)).join("")}</tbody>
    </table></div>
  </section>`;
}

function row(e, families) {
  const href = `#/library/${encodeURIComponent(e.id)}`;
  const fname = families.find((f) => f.id === e.family)?.name?.en || e.family || "–";
  return `<tr class="row-link" data-href="${esc(href)}">
    <td class="nowrap"><a class="row-open" href="${esc(href)}" data-focus="entry-${esc(e.id)}" aria-label="Open: ${esc(e.brand || fname)}, ${esc(e.id)}">${timeEl(e.first_seen)}</a></td>
    <td class="nowrap">${timeEl(e.last_seen)}</td>
    <td><a class="chip chip-family" href="${esc(hashFor("library", { family: e.family }))}">${esc(fname)}</a></td>
    <td class="col-channel">${chip("channel", channelWord(e.channel))}</td>
    <td>${e.country ? `<span class="chip chip-country" title="${esc(countryWord(e.country))}">${esc(String(e.country).toUpperCase())}</span>` : `<span class="muted">–</span>`}</td>
    <td class="wrap">${esc(e.brand || "–")}</td>
  </tr>`;
}

// ---- The notice -------------------------------------------------------------------

function contestForm(r, about) {
  const word = kindWord(r.indicator.kind);
  const url = `${location.origin}${location.pathname}${hashFor("suspects", { q: r.indicator.value })}`;
  return `<form class="form card" id="contestForm" novalidate aria-labelledby="h-contest">
    <h2 id="h-contest">Contest this listing</h2>
    <p class="small muted">If this ${esc(word)} is yours and the listing is wrong (a spoofed number, a hijacked address, a site cleaned since), send a notice with the four elements below. The listing shows "contested" at once; a decision with its reason follows within 7 days.${operatorLine(about)}</p>
    <div id="contestOut" aria-live="polite"></div>
    <div class="form-row">
      <div class="field"><label for="c-name">Your name</label>
        <input id="c-name" name="name" autocomplete="name" maxlength="200" data-focus="c-name"></div>
      <div class="field"><label for="c-email">Your email address</label>
        <input id="c-email" name="email" type="email" autocomplete="email" maxlength="320" data-focus="c-email">
        <span class="help">For the decision; never published.</span></div>
    </div>
    <div class="field"><label for="c-url">The listing you contest</label>
      <input id="c-url" name="url" type="url" maxlength="2000" value="${esc(url)}" data-focus="c-url">
      <span class="help">Its exact address, filled in for you.</span></div>
    <div class="field"><label for="c-reason">Why the listing is wrong</label>
      <textarea id="c-reason" name="reason" rows="5" maxlength="5000" data-focus="c-reason"></textarea></div>
    <label class="checkline"><input type="checkbox" name="goodFaith" id="c-faith" data-focus="c-faith"><span>I believe in good faith that what this notice says is accurate and complete.</span></label>
    <div class="btn-row">
      <button type="submit" class="btn" id="c-send" data-focus="c-send">Send the notice</button>
      <span class="small muted">Up to 5 notices a minute from one place.</span>
    </div>
  </form>`;
}

function operatorLine(about) {
  if (!about?.operator && !about?.contact) return ` It goes to the operator named on <a href="#/about">About</a>.`;
  return ` It goes to the operator named on <a href="#/about">About</a>${about.operator ? `, ${esc(about.operator)}` : ""}${about.contact ? ` (${contactLink(about.contact)})` : ""}.`;
}

function contactLink(c) {
  const s = String(c || "").trim();
  if (/^https?:\/\//i.test(s)) return `<a href="${esc(s)}" rel="noopener noreferrer">${esc(s)}</a>`;
  if (/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s)) return `<a href="mailto:${esc(s)}">${esc(s)}</a>`;
  return esc(s);
}

function invalid(el, on) {
  if (!el) return;
  if (on) el.setAttribute("aria-invalid", "true");
  else el.removeAttribute("aria-invalid");
}

const FIELDS = ["name", "email", "url", "reason", "goodFaith"];

async function send(root, form, result, ctx) {
  const button = $("#c-send", root);
  if (isBusy(button)) return;
  const out = $("#contestOut", root);
  const v = (n) => form[n].value.trim();
  const missing = !v("name") ? ["name", "Give your name."]
    : !v("email") ? ["email", "Give your email address: the decision is sent there."]
      : !v("url") ? ["url", "Give the address of the listing you contest."]
        : !v("reason") ? ["reason", "Say why the listing is wrong."]
          : !form.goodFaith.checked ? ["goodFaith", "Tick the good-faith statement."] : null;
  for (const n of FIELDS) invalid(form[n], missing?.[0] === n);
  if (missing) { out.innerHTML = banner(missing[1]); form[missing[0]].focus(); return; }

  busy(button);
  button.textContent = "Sending…";
  out.innerHTML = "";
  try {
    const res = await api("/api/public/suspects/contest", { method: "POST",
      body: { indicator: result.indicator.value, name: v("name"), email: v("email"), url: v("url"), reason: v("reason"), goodFaith: true } });
    if (!ctx.onPage()) return;
    toast("Notice sent. The listing shows contested now.", "ok");
    justSent = true;
    go(hashFor("suspects", { q: result.indicator.value, contest: res.id }));
  } catch (e) {
    if (!ctx.onPage()) return;
    out.innerHTML = banner(e.status === 429 ? "Too many notices from here in a minute. Wait a little and send it again." : e);
    const key = e.data?.missing;
    if (key && form[key]) { invalid(form[key], true); form[key].focus(); }
  } finally {
    busy(button, false);
    button.textContent = "Send the notice";
  }
}

async function check(root, id, { focus = false } = {}) {
  const out = $("#statusOut", root);
  const input = $("#cs-id", root);
  if (!id) { out.innerHTML = banner("Paste the notice id first."); input.focus(); return; }
  out.innerHTML = `<p class="loading">Checking…</p>`;
  try {
    const s = await api(`/api/public/suspects/contest/${encodeURIComponent(id)}`);
    const [tone, word] = STATUS[s.status] || ["off", s.status || "unknown"];
    out.innerHTML = `<div class="notice${s.status === "upheld" ? " notice-ok" : s.status === "open" ? " notice-warn" : ""}" role="status" tabindex="-1">
      <p>${chip(tone, word)} <code>${esc(s.id || id)}</code> · sent ${timeEl(s.createdAt)}${s.decidedAt ? ` · decided ${timeEl(s.decidedAt)}` : ""}</p>
      <p>${esc(STATUS_LINES[s.status] || "")}${s.decision ? ` Reason: ${esc(s.decision)}` : ""}</p>
      ${s.status === "open" ? `<p class="small muted">Keep the id: <a href="${esc(hashFor("suspects", { contest: s.id }))}">bookmark this page</a> to read the decision.</p>` : ""}
    </div>`;
    if (focus) $(".notice", out)?.focus();
  } catch (e) {
    out.innerHTML = banner(e.status === 404 ? "No notice with this id." : e);
  }
}

let familiesPromise = null;
function familiesCache() {
  if (!familiesPromise) familiesPromise = api("/api/public/families").catch((e) => { familiesPromise = null; throw e; });
  return familiesPromise;
}
