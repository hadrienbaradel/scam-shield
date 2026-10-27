// Small server-rendered pages for links opened from email (invitations,
// one-tap answers) and the local outbox. No scripts: plain forms.

export const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

export function page({ title, body, lang = "en" }) {
  return `<!doctype html><html lang="${esc(lang)}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(title)} · Scam Shield</title><link rel="stylesheet" href="/styles.css"></head>
<body class="plain-page"><header class="topbar"><div class="brand"><div class="shield" aria-hidden="true">✓</div><div><p class="brand-name">Scam Shield</p></div></div></header>
<main class="plain-main">${body}</main></body></html>`;
}
