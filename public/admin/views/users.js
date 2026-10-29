// Users: every account in one table, then one page per person with what
// the context covers, the last checks, the trusted people, the phones
// and the audit trail. Counts, statuses, ids and times only: never a
// message, a verdict's words or anything a senior shared.

import { api, $, esc, chipRaw, tag, timeEl, fullTime, num, duration, kv, setTitle, toast, banner, words, cap, yesNo, plural, busy, isBusy } from "../console.js";

export const label = "Users";
export const title = (params) => (params[0] ? "Person" : "Users");

export async function render(root, params, ctx) {
  if (params[0]) return detail(root, params[0], ctx);
  return list(root, ctx);
}

// ---- Chips for this page ---------------------------------------------------

const GMAIL = {
  ok: ["ok", "●", "Connected"], reauth_needed: ["warn", "▲", "Reconnect needed"],
  revoked: ["fail", "✕", "Revoked"], none: ["off", "–", "No token"],
};
function gmailChip(g) {
  if (!g) return chipRaw("off", "–", "None");
  const [tone, glyph, word] = GMAIL[g.tokenStatus] || ["off", "–", cap(words(g.tokenStatus || "unknown"))];
  return chipRaw(tone, glyph, word);
}
// gmail_state.sync_status in plain words; the error line stays as the server wrote it.
const SYNC = { ok: "sync ok", syncing: "syncing now", pending: "first sync not done yet", error: "sync failed", reauth_needed: "reconnect needed" };
const syncWords = (s) => SYNC[s] || words(s || "unknown");
function syncLine(g) {
  if (!g?.syncStatus) return "";
  if (["ok", "syncing", "pending"].includes(g.syncStatus)) return `<span class="sub">${esc(syncWords(g.syncStatus))}</span>`;
  return `<span class="sub err">${esc(syncWords(g.syncStatus))}${g.syncError ? `: <span class="mono">${esc(g.syncError)}</span>` : ""}</span>`;
}
const pushChip = (g) => (g?.pushActive ? chipRaw("ok", "●", "On") : chipRaw("off", "–", "Off"));

const VERDICT = { safe: ["ok", "●", "Safe"], be_careful: ["warn", "▲", "Be careful"], scam: ["fail", "✕", "Scam"] };
function verdictChip(v) {
  const [tone, glyph, word] = VERDICT[v] || ["off", "–", cap(words(v || "unknown"))];
  return chipRaw(tone, glyph, word);
}
const roles = (list) => (list || []).map((r) => tag(r)).join("") || `<span class="muted">none</span>`;
const FEEDBACK = { not_scam: "not a scam", is_scam: "is a scam" };

// ---- List -----------------------------------------------------------------

async function list(root, ctx) {
  const { users = [] } = await api("/api/admin/users");
  if (ctx.stale()) return;
  root.innerHTML = `
    <p class="lead">${plural(users.length, "account")}, newest first. Open a person for the context coverage, the last checks and the audit trail.</p>
    <div class="table-wrap"><table class="table table-wide">
      <thead><tr>
        <th scope="col">Person</th><th scope="col">Roles</th><th scope="col">Gmail</th><th scope="col">Last sync</th><th scope="col">Push</th>
        <th scope="col" class="num">Checks</th><th scope="col" class="num">People</th><th scope="col" class="num">Phones</th>
        <th scope="col" class="num">Alerts</th><th scope="col">Last seen</th>
      </tr></thead>
      <tbody>${users.map(row).join("") || `<tr><td colspan="10" class="empty">No account yet.</td></tr>`}</tbody>
    </table></div>`;
}

function row(u) {
  const g = u.gmail;
  const c = u.checks || {};
  return `<tr>
    <th scope="row"><a href="#/users/${encodeURIComponent(u.id)}" data-focus="user-${esc(u.id)}">${esc(u.email)}</a><span class="sub">${esc(u.name || "")}${u.locale ? ` (${esc(u.locale)})` : ""}</span></th>
    <td>${roles(u.roles)}</td>
    <td class="gmail-cell">${gmailChip(g)}${syncLine(g)}</td>
    <td class="nowrap">${g ? timeEl(g.lastSyncAt) : "–"}</td>
    <td>${g ? pushChip(g) : "–"}</td>
    <td class="num">${esc(num(c.total))}<span class="sub nowrap">${esc(num(c.scam))} scam, ${esc(num(c.be_careful))} careful</span></td>
    <td class="num">${esc(num(u.guardians?.active))}${u.guardians?.invited ? `<span class="sub nowrap">${esc(num(u.guardians.invited))} invited</span>` : ""}</td>
    <td class="num">${esc(num(u.devices?.active))}</td>
    <td class="num">${esc(num(u.alerts?.waiting))}${u.alerts?.answered ? `<span class="sub nowrap">${esc(num(u.alerts.answered))} answered</span>` : ""}</td>
    <td class="nowrap">${timeEl(u.lastSeenAt)}</td>
  </tr>`;
}

// ---- One person -------------------------------------------------------------

async function detail(root, id, ctx) {
  const d = await api(`/api/admin/users/${encodeURIComponent(id)}`);
  if (ctx.stale()) return;
  const u = d.user || {};
  const g = u.gmail;
  const c = u.checks || {};
  setTitle(esc(u.name || u.email || "Person"));
  root.innerHTML = `
    <p><a href="#/users">Back to users</a></p>
    <section aria-labelledby="h-account">
      <div class="section-head"><h2 id="h-account">Account</h2>
        <div class="btn-row"><button type="button" class="btn" id="syncNow" data-focus="sync-now">Sync now</button></div></div>
      <div id="syncOut"></div>
      <div class="card">${kv([
        ["Email", esc(u.email)],
        ["Name", esc(u.name)],
        ["Language", esc(u.locale)],
        ["Roles", roles(u.roles)],
        ["Id", `<span class="mono">${esc(u.id)}</span>`],
        ["Created", timeEl(u.createdAt)],
        ["Last seen", timeEl(u.lastSeenAt)],
        ["Onboarded", esc(yesNo(u.onboarded))],
        ["Mail mode", esc(u.actMode)],
        ["Auto alert", esc(yesNo(u.autoAlert))],
        ["Sessions", esc(num(u.sessions))],
        ["Gmail", `${gmailChip(g)} ${g?.email ? `<span class="muted">${esc(g.email)}</span>` : ""}`],
        ["Sync", g ? `${esc(g.syncStatus ? syncWords(g.syncStatus) : "–")}${g.syncError ? ` <span class="mono err">${esc(g.syncError)}</span>` : ""}` : "–"],
        ["Last sync", g ? timeEl(g.lastSyncAt) : "–"],
        ["Backfill done", g ? esc(yesNo(g.backfillDone)) : "–"],
        ["Push", g ? `${pushChip(g)} ${g.watchExpiration ? `<span class="muted">expires ${esc(fullTime(g.watchExpiration))}</span>` : ""}` : "–"],
        ["Checks", `${esc(num(c.total))} <span class="muted">(${esc(num(c.safe))} safe, ${esc(num(c.be_careful))} be careful, ${esc(num(c.scam))} scam; ${esc(num(c.last24h))} in the last 24 h)</span>`],
        ["Alerts", `${esc(num(u.alerts?.waiting))} waiting, ${esc(num(u.alerts?.answered))} answered`],
      ])}</div>
    </section>
    <section aria-labelledby="h-context">
      <h2 id="h-context">What the context covers</h2>
      <div class="card">${context(d.context)}</div>
    </section>
    <section aria-labelledby="h-checks">
      <h2 id="h-checks">${d.recentChecks?.length ? `Last ${plural(d.recentChecks.length, "check")}` : "Checks"}</h2>
      <div class="table-wrap"><table class="table">
        <thead><tr><th scope="col">Time</th><th scope="col">Channel</th><th scope="col">Verdict</th><th scope="col">Judged by</th>
          <th scope="col" class="num">Latency</th><th scope="col">Action</th><th scope="col">Feedback</th></tr></thead>
        <tbody>${(d.recentChecks || []).map(checkRow).join("") || `<tr><td colspan="7" class="empty">No check yet.</td></tr>`}</tbody>
      </table></div>
    </section>
    <section aria-labelledby="h-guardians">
      <h2 id="h-guardians">Trusted people</h2>
      <div class="table-wrap"><table class="table">
        <thead><tr><th scope="col">Name</th><th scope="col">Email</th><th scope="col">Relation</th><th scope="col">Status</th><th scope="col">Invited</th><th scope="col">Accepted</th></tr></thead>
        <tbody>${(d.guardians || []).map(guardianRow).join("") || `<tr><td colspan="6" class="empty">No trusted person yet.</td></tr>`}</tbody>
      </table></div>
    </section>
    <section aria-labelledby="h-devices">
      <h2 id="h-devices">Phones</h2>
      <div class="table-wrap"><table class="table">
        <thead><tr><th scope="col">Name</th><th scope="col">Paired</th><th scope="col">Last seen</th><th scope="col">Removed</th></tr></thead>
        <tbody>${(d.devices || []).map(deviceRow).join("") || `<tr><td colspan="4" class="empty">No phone paired.</td></tr>`}</tbody>
      </table></div>
    </section>
    <section aria-labelledby="h-audit">
      <h2 id="h-audit">${d.audit?.length ? `Last ${plural(d.audit.length, "audit event")}` : "Audit events"}</h2>
      <div class="table-wrap"><table class="table">
        <thead><tr><th scope="col">Event</th><th scope="col">Time</th><th scope="col">Detail</th></tr></thead>
        <tbody>${(d.audit || []).map(auditRow).join("") || `<tr><td colspan="3" class="empty">Nothing recorded yet.</td></tr>`}</tbody>
      </table></div>
    </section>`;

  $("#syncNow", root).addEventListener("click", async () => {
    const b = $("#syncNow", root);
    const out = $("#syncOut", root);
    if (isBusy(b)) return;
    busy(b);
    out.innerHTML = "";
    try {
      await api(`/api/admin/users/${encodeURIComponent(id)}/sync`, { method: "POST", body: {} });
      toast(`Sync started for ${u.email || "this person"}`);
      setTimeout(() => { if (ctx.onPage()) ctx.refresh(); }, 3000);
    } catch (e) {
      if (e.status === 401 || e.status === 403) out.innerHTML = banner(e);
      else toast(e.message, "fail");
    } finally { busy(b, false); }
  });
}

function context(c) {
  if (!c) return `<p class="empty">Nothing learned yet: the first Gmail sync builds the context.</p>`;
  const cov = c.coverage || {};
  const counts = Object.entries(c.counts || {}).map(([k, v]) => [cap(words(k)), esc(num(v))]);
  return kv([
    ["Built", timeEl(c.builtAt)],
    ["Emails read", esc(num(cov.emailsRead))],
    ["Since", esc(cov.since)],
    ...counts,
  ]);
}

function checkRow(k) {
  return `<tr>
    <td class="nowrap">${timeEl(k.createdAt)}</td>
    <td>${esc(k.channel)}</td>
    <td>${verdictChip(k.verdict)}${k.degraded ? ` ${tag("degraded", "warn")}` : ""}</td>
    <td>${esc(k.source || "–")}</td>
    <td class="num nowrap">${esc(duration(k.latencyMs))}</td>
    <td>${esc(k.action || "none")}${k.restoredAt ? `<span class="sub">put back ${timeEl(k.restoredAt)}</span>` : ""}</td>
    <td>${esc(FEEDBACK[k.userFeedback] || k.userFeedback || "–")}</td>
  </tr>`;
}

function guardianRow(g) {
  return `<tr>
    <td>${esc(g.name || "–")}</td><td class="wrap">${esc(g.email)}</td><td>${esc(g.relation || "–")}</td>
    <td>${g.status === "active" ? chipRaw("ok", "●", "Active") : g.status === "invited" ? chipRaw("off", "○", "Invited") : chipRaw("off", "–", cap(words(g.status || "unknown")))}</td>
    <td class="nowrap">${timeEl(g.createdAt)}</td><td class="nowrap">${timeEl(g.acceptedAt)}</td>
  </tr>`;
}

function deviceRow(d) {
  return `<tr>
    <td>${esc(d.name || "–")}</td><td class="nowrap">${timeEl(d.createdAt)}</td>
    <td class="nowrap">${timeEl(d.lastSeenAt)}</td><td class="nowrap">${d.revokedAt ? timeEl(d.revokedAt) : "–"}</td>
  </tr>`;
}

function auditRow(a) {
  return `<tr>
    <td>${esc(a.event)}</td><td class="nowrap">${timeEl(a.at)}</td>
    <td><code class="json">${esc(a.detail == null ? "" : JSON.stringify(a.detail))}</code></td>
  </tr>`;
}
