// Early access: the requests from the landing page's "Protect my parent's
// email" (_product/specs/landing-page.md, line 6), newest first. While
// Google sign-in is in its test phase we add each address by hand as a
// test user, write to the person ourselves (the server mails nobody), then
// mark the request added; it is deleted 90 days after that, an open one
// stays. Name and note are the visitor's words: escaped, never trusted.

import { api, $, $$, esc, chipRaw, timeEl, num, toast, busy, isBusy, cap, words } from "../console.js";

export const label = "Early access";

const WHOSE = { parent: "Their parent's", mine: "Their own" };
const LANGUAGES = { en: "English", fr: "French" };
const STATUS = { open: ["warn", "○", "Open"], added: ["ok", "●", "Added"] };
function statusChip(s) {
  const [tone, glyph, word] = STATUS[s] || ["off", "–", cap(words(s || "unknown"))];
  return chipRaw(tone, glyph, word);
}
// Rows come as the table's columns (created_at); a camelCase answer reads the same.
const pick = (o, key) => o?.[key] ?? o?.[key.replace(/_([a-z])/g, (_, c) => c.toUpperCase())];

export async function render(root, params, ctx) {
  const data = await api("/api/admin/early-access");
  if (ctx.stale()) return;
  draw(root, data, ctx);
}

function draw(root, data, ctx) {
  const all = data.requests || [];
  const counts = data.counts || {};
  root.innerHTML = `
    <p class="lead">Requests from the landing page's "Protect my parent's email", newest first. Nothing is mailed from here: add the address as a test user of the Google client, write to the person yourself, then Mark added. A request is deleted 90 days after it was marked added; an open one stays.</p>
    <div class="btn-row" aria-label="Counts">
      ${chipRaw("warn", "○", `${num(counts.open ?? all.filter((r) => r.status === "open").length)} open`)}
      ${chipRaw("ok", "●", `${num(counts.added)} added`)}
    </div>
    <section aria-labelledby="h-requests">
      <h2 id="h-requests" tabindex="-1">Requests (${num(all.length)})</h2>
      <div class="table-wrap"><table class="table">
        <thead><tr><th scope="col">Received</th><th scope="col">Address</th><th scope="col">Whose</th><th scope="col">Name</th><th scope="col">Note</th><th scope="col">Language</th><th scope="col">Status</th><th scope="col">Added</th><th scope="col"><span class="sr-only">Action</span></th></tr></thead>
        <tbody>${all.map(row).join("") || `<tr><td colspan="9" class="empty">No request yet. The form is on the landing page, behind "Protect my parent's email".</td></tr>`}</tbody>
      </table></div>
    </section>`;

  for (const b of $$("[data-added]", root)) b.addEventListener("click", () => { if (!isBusy(b)) markAdded(b, ctx); });
}

function row(r) {
  const id = String(r.id);
  const email = r.email || "";
  return `<tr>
    <td class="nowrap">${timeEl(pick(r, "created_at"))}</td>
    <td class="wrap">${email ? `<a href="mailto:${esc(email)}">${esc(email)}</a>` : "–"}</td>
    <td class="nowrap">${esc(WHOSE[r.whose] || r.whose || "–")}</td>
    <td class="wrap">${esc(r.name || "–")}</td>
    <td class="wrap">${esc(r.note || "–")}</td>
    <td class="nowrap">${esc(LANGUAGES[r.language] || r.language || "–")}</td>
    <td>${statusChip(r.status)}</td>
    <td class="nowrap">${timeEl(pick(r, "added_at"))}</td>
    <td class="actions">${r.status === "open"
      ? `<button type="button" class="btn btn-ghost btn-small" data-added="${esc(id)}" data-email="${esc(email)}" data-focus="added-${esc(id)}" aria-label="Mark added: ${esc(email)}">Mark added</button>`
      : ""}</td>
  </tr>`;
}

async function markAdded(button, ctx) {
  const id = button.dataset.added;
  const email = button.dataset.email;
  busy(button);
  try {
    await api(`/api/admin/early-access/${encodeURIComponent(id)}/added`, { method: "POST", body: {} });
    toast(`Marked added: ${email}`, "ok");
    if (ctx.onPage()) {
      await ctx.refresh();
      $("#h-requests")?.focus({ preventScroll: true });
    }
  } catch (e) {
    toast(`${email}: ${e.message}`, "fail");
    busy(button, false);
  }
}
