// Overview: one panel per dependency, today's counts, the jobs in one
// table and the server block. Refreshed every 30 s by the console.

import { api, esc, chip, toneOf, timeEl, fullTime, num, mb, uptime, duration, kv, setTitle, summary, yesNo, onOff } from "../console.js";

export const label = "Overview";

export async function render(root, params, ctx) {
  const h = await api("/api/admin/health");
  if (ctx.stale()) return;
  setTitle(`Overview ${chip(h.overall)}`);
  const c = h.counts || {};
  const day = c.checks24h || {};
  const s = h.server || {};
  root.innerHTML = `
    <section aria-labelledby="h-checks">
      <div class="section-head"><h2 id="h-checks">Checks</h2><p class="note">Generated ${timeEl(h.generatedAt)}</p></div>
      <div class="checks">${(h.checks || []).map(check).join("") || `<p class="empty">No checks reported.</p>`}</div>
    </section>
    <section aria-labelledby="h-counts">
      <h2 id="h-counts">Today</h2>
      <div class="tiles">
        ${tile(c.users, "People", `${num(c.seniors)} seniors, ${num(c.guardians)} guardians, ${num(c.admins)} admins`)}
        ${tile(c.gmailConnected, "Gmail connected")}
        ${tile(c.reconnectNeeded, "Reconnect needed")}
        ${tile(day.total, "Checks, last 24 h", `${num(day.safe)} safe, ${num(day.be_careful)} be careful, ${num(day.scam)} scam (${num(c.checksTotal)} in all)`)}
        ${tile(c.alertsWaiting, "Alerts waiting")}
        ${tile(c.cardsCandidate, "Candidate cards", `${num(c.cardsActive)} active`)}
        ${tile(c.outboxWaiting, "Outbox, last 7 days")}
        ${tile(c.liveConnections, "Live connections")}
      </div>
    </section>
    <section aria-labelledby="h-jobs">
      <div class="section-head"><h2 id="h-jobs">Jobs</h2><a href="#/jobs">All jobs and runs</a></div>
      <div class="table-wrap"><table class="table">
        <thead><tr><th scope="col">Job</th><th scope="col">Health</th><th scope="col">Last run</th><th scope="col">Next due</th></tr></thead>
        <tbody>${(h.jobs || []).map(jobRow).join("") || `<tr><td colspan="4" class="empty">No background work registered.</td></tr>`}</tbody>
      </table></div>
    </section>
    <section aria-labelledby="h-server">
      <h2 id="h-server">Server</h2>
      <div class="card">${kv([
        ["Version", esc(s.version)],
        ["Node", esc(s.node)],
        ["Started", s.startedAt ? `${timeEl(s.startedAt)} <span class="muted mono">${esc(fullTime(s.startedAt))}</span>` : "–"],
        ["Uptime", esc(uptime(s.uptimeSeconds))],
        ["Memory", esc(mb(s.memoryMb))],
        ["Address", `<span class="mono">${esc(s.baseUrl)}</span> ${s.host ? `<span class="muted">(${esc(s.host)}:${esc(s.port)}, pid ${esc(s.pid)})</span>` : ""}`],
        ["Production", esc(yesNo(s.production))],
        ["Worker", `${esc(onOff(s.worker))} <span class="muted">in this process</span>`],
        ["Poll interval", s.pollSeconds != null ? `every ${esc(num(s.pollSeconds))} s` : "–"],
      ])}</div>
    </section>`;
}


function check(k) {
  return `<article class="check check-${esc(toneOf(k.status))}" aria-label="${esc(k.name)}">
    <div class="check-head"><h3>${esc(k.name)}</h3>${chip(k.status)}</div>
    <p class="detail">${esc(k.detail || "")}</p>
    <p class="meta">Checked ${timeEl(k.checkedAt)}</p>
  </article>`;
}

function tile(n, label, sub) {
  return `<div class="tile"><p class="n">${esc(num(n))}</p><p class="l">${esc(label)}</p>${sub ? `<p class="sub">${esc(sub)}</p>` : ""}</div>`;
}

function jobRow(j) {
  const lr = j.lastRun;
  const last = lr
    ? `${timeEl(lr.finishedAt || lr.startedAt)} <span class="muted">(${esc(duration(lr.durationMs))})</span>${lr.ok === false
      ? `<span class="sub mono err">${esc(lr.error || "failed")}</span>`
      : `<span class="sub">${esc(summary(lr.result))}</span>`}`
    : `<span class="muted">not yet</span>`;
  return `<tr>
    <th scope="row"><a href="#/jobs">${esc(j.name)}</a></th>
    <td>${chip(j.health)}</td>
    <td>${last}</td>
    <td>${j.kind === "loop" ? `<span class="muted">continuous</span>` : timeEl(j.nextDueAt)}</td>
  </tr>`;
}
