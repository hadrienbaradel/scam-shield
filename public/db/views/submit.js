// Submit: the form that sends a scam example to the library (#/submit),
// what the server answered (pending with its status URL, a duplicate with
// the existing entry, or the error in plain words), and the Check status box
// that reads one submission by its id (#/submit?status=<id>).

import { api, $, esc, chip, toast, banner, busy, isBusy, num, timeEl, CHANNELS, hashFor } from "../db.js";

export const label = "Submit";

const MIN = 20;
const MAX = 10000;
const COUNTRIES = ["FR", "US", "GB", "CA", "BE", "CH", "DE", "ES", "IT", "NL", "PT", "IE", "AU"];
const LANGUAGES = ["en", "fr", "es", "de", "it", "nl", "pt"];

export async function render(root, params, ctx) {
  root.innerHTML = `
    <p class="lead">Send a scam you received: an email, a text, a chat message, what a caller said, a web page or a letter. Remove your own name and details before sending; the scam's links, numbers and sender stay: they are the evidence. What you send is redacted again, classified and read by a reviewer before it appears. Published under CC BY 4.0.</p>
    <div id="answer" aria-live="polite"></div>
    <form class="form card" id="submitForm" novalidate aria-labelledby="h-form">
      <h2 id="h-form">The example</h2>
      <div class="form-row">
        <div class="field"><label for="s-channel">Where it came from</label>
          <select id="s-channel" name="channel" required data-focus="s-channel">
            <option value="">Choose…</option>
            ${Object.entries(CHANNELS).map(([v, w]) => `<option value="${v}">${esc(w)}</option>`).join("")}
          </select></div>
        <div class="field"><label for="s-country">Country</label>
          <input id="s-country" name="country" list="s-countries" maxlength="2" autocomplete="off" data-focus="s-country">
          <datalist id="s-countries">${COUNTRIES.map((c) => `<option value="${c}"></option>`).join("")}</datalist>
          <span class="help">Two letters, FR or US; leave empty if unsure.</span></div>
        <div class="field"><label for="s-language">Language</label>
          <input id="s-language" name="language" list="s-languages" maxlength="2" autocomplete="off" data-focus="s-language">
          <datalist id="s-languages">${LANGUAGES.map((l) => `<option value="${l}"></option>`).join("")}</datalist>
          <span class="help">Two letters, en or fr.</span></div>
      </div>
      <div class="form-row">
        <div class="field"><label for="s-from">Sender</label>
          <input id="s-from" name="from" autocomplete="off" spellcheck="false" data-focus="s-from">
          <span class="help">The address or number it came from; it stays, as evidence.</span></div>
        <div class="field"><label for="s-subject">Subject</label>
          <input id="s-subject" name="subject" autocomplete="off" data-focus="s-subject">
          <span class="help">Emails only.</span></div>
      </div>
      <div class="field"><label for="s-body">The message</label>
        <textarea id="s-body" name="body" rows="10" required minlength="${MIN}" maxlength="${MAX}" aria-describedby="s-count" data-focus="s-body"></textarea>
        <span class="counter" id="s-count">0 of ${num(MAX)} characters (at least ${MIN})</span></div>
      <div class="field"><label for="s-links">Links in the message</label>
        <textarea id="s-links" name="links" rows="2" spellcheck="false" data-focus="s-links"></textarea>
        <span class="help">One per line, optional: the addresses behind the words, when the message hides them.</span></div>
      <div class="field"><label for="s-note">A note for the reviewer</label>
        <textarea id="s-note" name="note" rows="2" data-focus="s-note"></textarea>
        <span class="help">Optional: who it pretended to be, what happened next. Never published.</span></div>
      <div class="btn-row">
        <button type="submit" class="btn" id="s-send" data-focus="s-send">Send to the library</button>
        <span class="small muted">Up to 10 submissions a minute from one place.</span>
      </div>
    </form>
    <form class="form card" id="statusForm" novalidate aria-labelledby="h-status">
      <h2 id="h-status">Check a submission</h2>
      <div class="field"><label for="st-id">Submission id</label>
        <div class="btn-row">
          <input id="st-id" name="id" autocomplete="off" spellcheck="false" size="38" value="${esc(ctx.query.get("status") || "")}" data-focus="st-id">
          <button type="submit" class="btn btn-ghost" data-focus="st-check">Check status</button>
        </div>
        <span class="help">The id the page gave you when you sent an example.</span></div>
      <div id="statusOut" aria-live="polite"></div>
    </form>`;

  const form = $("#submitForm", root);
  const body = $("#s-body", root);
  const counter = $("#s-count", root);
  const count = () => {
    const n = body.value.length;
    const short = n < MIN;
    counter.textContent = `${num(n)} of ${num(MAX)} characters${short ? ` (at least ${MIN})` : ""}`;
    counter.classList.toggle("err", short && n > 0);
  };
  body.addEventListener("input", count);
  form.addEventListener("submit", (e) => { e.preventDefault(); send(root, form, ctx); });

  const statusForm = $("#statusForm", root);
  statusForm.addEventListener("submit", (e) => { e.preventDefault(); check(root, $("#st-id", root).value.trim()); });
  const wanted = (ctx.query.get("status") || "").trim();
  if (wanted) check(root, wanted);
}

function invalid(el, on) {
  if (on) el.setAttribute("aria-invalid", "true");
  else el.removeAttribute("aria-invalid");
}

async function send(root, form, ctx) {
  const button = $("#s-send", root);
  if (isBusy(button)) return;
  const answer = $("#answer", root);
  const channel = form.channel.value;
  const text = form.body.value;
  invalid(form.channel, !channel);
  invalid(form.body, text.length < MIN || text.length > MAX);
  if (!channel) { answer.innerHTML = banner("Say where the message came from."); form.channel.focus(); return; }
  if (text.length < MIN) { answer.innerHTML = banner(`The message is too short: at least ${MIN} characters.`); form.body.focus(); return; }
  if (text.length > MAX) { answer.innerHTML = banner(`The message is too long: at most ${num(MAX)} characters.`); form.body.focus(); return; }

  const links = form.links.value.split(/\r?\n/).map((l) => l.trim()).filter(Boolean).map((href) => ({ text: href, href }));
  const message = { body: text };
  if (form.from.value.trim()) message.from = form.from.value.trim();
  if (form.subject.value.trim()) message.subject = form.subject.value.trim();
  if (links.length) message.links = links;
  const payload = { channel, message };
  const country = form.country.value.trim().toUpperCase();
  const language = form.language.value.trim().toLowerCase();
  if (country) payload.country = country;
  if (language) payload.language = language;
  if (form.note.value.trim()) payload.note = form.note.value.trim();

  busy(button);
  button.textContent = "Sending…";
  answer.innerHTML = "";
  try {
    const res = await api("/api/public/library/submit", { method: "POST", body: payload });
    if (!ctx.onPage()) return;
    const statusUrl = typeof res.statusUrl === "string" && /^\/api\/public\/library\/submit\//.test(res.statusUrl) ? res.statusUrl : `/api/public/library/submit/${encodeURIComponent(res.id)}`;
    answer.innerHTML = `<div class="notice notice-ok" role="status">
      <p><strong>Received.</strong> Your example is waiting for a reviewer; it appears in the library once approved.</p>
      <p>Submission id <code>${esc(res.id)}</code> · status URL <a href="${esc(statusUrl)}">${esc(statusUrl)}</a> · <a href="${esc(hashFor("submit", { status: res.id }))}">bookmark this page to check later</a></p>
    </div>`;
    form.reset();
    $("#s-count", root).textContent = `0 of ${num(MAX)} characters (at least ${MIN})`;
    $("#st-id", root).value = res.id || "";
    toast("Sent. A reviewer reads it before it appears.", "ok");
    if (res.id) check(root, res.id);
    $("#answer a", root)?.focus();
  } catch (e) {
    if (!ctx.onPage()) return;
    if (e.status === 409) {
      const entryId = e.data?.entryId;
      answer.innerHTML = `<div class="notice notice-warn" role="status">
        <p><strong>Already in the library.</strong> ${esc(e.message)}</p>
        ${entryId ? `<p>See <a href="#/library/${encodeURIComponent(entryId)}">the existing entry ${esc(entryId)}</a>, or check its status below with that id.</p>` : ""}
      </div>`;
    } else if (e.status === 429) {
      answer.innerHTML = banner("Too many submissions from here in a minute. Wait a little and send it again.");
    } else {
      answer.innerHTML = banner(e);
    }
  } finally {
    busy(button, false);
    button.textContent = "Send to the library";
  }
}

const STATUS = { pending: ["warn", "Pending review"], approved: ["ok", "Approved"], rejected: ["fail", "Rejected"], withdrawn: ["off", "Withdrawn"] };

async function check(root, id) {
  const out = $("#statusOut", root);
  const input = $("#st-id", root);
  if (!id) { out.innerHTML = banner("Paste the submission id first."); input.focus(); return; }
  out.innerHTML = `<p class="loading">Checking…</p>`;
  try {
    const s = await api(`/api/public/library/submit/${encodeURIComponent(id)}`);
    const [tone, word] = STATUS[s.status] || ["off", s.status || "unknown"];
    const lines = {
      pending: "A reviewer has not read it yet. Check again in a day or two.",
      approved: "It is published in the library.",
      rejected: "It was not published.",
      withdrawn: "It was withdrawn before review.",
    };
    out.innerHTML = `<div class="notice" role="status">
      <p>${chip(tone, word)} <code>${esc(s.id || id)}</code>${s.decided_at || s.decidedAt ? ` · decided ${timeEl(s.decided_at || s.decidedAt)}` : ""}</p>
      <p>${esc(lines[s.status] || "")}${s.reason ? ` Reason: ${esc(s.reason)}` : ""}</p>
      ${s.entryId ? `<p><a href="#/library/${encodeURIComponent(s.entryId)}">Open the entry ${esc(s.entryId)}</a></p>` : ""}
    </div>`;
  } catch (e) {
    out.innerHTML = banner(e.status === 404 ? "No submission with this id." : e);
  }
}
