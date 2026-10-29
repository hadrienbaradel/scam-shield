// Outbox: the emails Prudence sent or would have sent (to, subject, channel,
// time), never their text (spec line 10): an alert's text is what the senior
// shared, and a local copy holds live one-tap links. Outside production the
// server names the local outbox (localOutbox), where the test links work.

import { api, esc, timeEl } from "../console.js";

export const label = "Outbox";

export async function render(root, params, ctx) {
  const { mails = [], localOutbox = null } = await api("/api/admin/outbox");
  if (ctx.stale()) return;
  root.innerHTML = `
    <p class="lead">Emails to guardians and seniors, newest first, kept 7 days. Their text never shows here: it can hold what a senior shared and live one-tap links.</p>
    ${typeof localOutbox === "string" && /^\/(?!\/)/.test(localOutbox)
      ? `<p><a href="${esc(localOutbox)}" target="_blank" rel="noopener noreferrer" data-focus="local-outbox">Open the local outbox (this machine only)</a> <span class="muted small">(opens in a new tab)</span></p>` : ""}
    <div class="table-wrap"><table class="table">
      <thead><tr><th scope="col">Time</th><th scope="col">To</th><th scope="col">Subject</th><th scope="col">Via</th></tr></thead>
      <tbody>${mails.map(row).join("") || `<tr><td colspan="4" class="empty">No email in the last 7 days.</td></tr>`}</tbody>
    </table></div>`;
}

function row(m) {
  return `<tr>
    <td class="nowrap">${timeEl(m.createdAt)}</td>
    <td class="wrap">${esc(m.to)}</td>
    <td class="wrap">${esc(m.subject)}</td>
    <td class="nowrap">${esc(m.via)}</td>
  </tr>`;
}
