// Outgoing email (guardian invitations and alerts). Uses Resend when
// RESEND_API_KEY is set; otherwise the message is kept in the local outbox
// at /dev/outbox so the whole loop can be tested on one machine.
// Scam Shield never sends from the user's own Gmail.

import { config } from "../config.js";
import { q } from "../db/pool.js";

export async function sendEmail({ to, subject, text, html }) {
  if (config.resend.apiKey) {
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { authorization: `Bearer ${config.resend.apiKey}`, "content-type": "application/json" },
      body: JSON.stringify({ from: config.resend.from, to: [to], subject, text, html }),
      signal: AbortSignal.timeout(15000),
    });
    if (!res.ok) throw new Error(`Resend ${res.status}: ${(await res.text()).slice(0, 200)}`);
    await q("INSERT INTO outbox (to_email, subject, text_body, html_body, sent_via) VALUES ($1, $2, $3, $4, 'resend')", [to, subject, text, html || null]);
    return { via: "resend" };
  }
  await q("INSERT INTO outbox (to_email, subject, text_body, html_body, sent_via) VALUES ($1, $2, $3, $4, 'local-outbox')", [to, subject, text, html || null]);
  return { via: "local-outbox" };
}

const escapeHtml = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

// Big, plain buttons. Links lead to a confirmation page (GET never
// records an answer), so mail scanners that pre-open links can't answer.
export function buttonsHtml(intro, buttons, footer) {
  const btn = (b) => `<a href="${escapeHtml(b.href)}" style="display:block;margin:12px 0;padding:18px;border-radius:12px;background:${b.color};color:#fff;font:600 20px/1.2 Arial,sans-serif;text-align:center;text-decoration:none">${escapeHtml(b.label)}</a>`;
  return `<div style="max-width:560px;font:18px/1.5 Arial,sans-serif;color:#111">${intro.map((p) => `<p>${escapeHtml(p)}</p>`).join("")}${buttons.map(btn).join("")}<p style="color:#555;font-size:15px">${escapeHtml(footer)}</p></div>`;
}
