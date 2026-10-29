// Outbox: the emails Prudence sent or would have sent. The text is only
// present outside production; the server decides, the page just shows it.

import { api, esc, timeEl } from "../console.js";

export const label = "Outbox";

export async function render(root, params, ctx) {
  const { mails = [] } = await api("/api/admin/outbox");
  if (ctx.stale()) return;
  root.innerHTML = `
    <p class="lead">Emails to guardians and seniors, newest first. With no email provider they wait here (kept 7 days); the text is hidden in production.</p>
    <div class="table-wrap"><table class="table">
      <thead><tr><th scope="col">Time</th><th scope="col">To</th><th scope="col">Subject</th><th scope="col">Via</th></tr></thead>
      <tbody>${mails.map(row).join("") || `<tr><td colspan="4" class="empty">No email in the last 7 days.</td></tr>`}</tbody>
    </table></div>`;
}

function row(m) {
  return `<tr>
    <td class="nowrap">${timeEl(m.createdAt)}</td>
    <td class="wrap">${esc(m.to)}</td>
    <td class="wrap">${esc(m.subject)}${m.text != null ? `<details><summary>Text</summary><pre>${esc(m.text)}</pre></details>` : ""}</td>
    <td class="nowrap">${esc(m.via)}</td>
  </tr>`;
}
