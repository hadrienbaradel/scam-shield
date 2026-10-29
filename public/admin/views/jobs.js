// Jobs: every piece of background work with its health and a Run now
// button, the last 100 runs (filter by job) and the recent error lines.

import { api, $, $$, esc, chip, chipRaw, timeEl, duration, summary, toast, sleep, setUpdated, busy, isBusy } from "../console.js";

export const label = "Jobs";

let filter = "";

export async function render(root, params, ctx) {
  const data = await api("/api/admin/jobs");
  if (ctx.stale()) return;
  draw(root, data, ctx);
}

function draw(root, data, ctx) {
  const jobs = data.jobs || [];
  const runs = data.runs || [];
  const errors = data.errors || [];
  root.innerHTML = `
    <section aria-labelledby="h-work">
      <h2 id="h-work">Background work</h2>
      <div class="table-wrap"><table class="table">
        <thead><tr>
          <th scope="col">Job</th><th scope="col">Schedule</th><th scope="col">Health</th>
          <th scope="col">Last run</th><th scope="col">Next due</th><th scope="col"><span class="sr-only">Action</span></th>
        </tr></thead>
        <tbody>${jobs.map(jobRow).join("") || `<tr><td colspan="6" class="empty">No background work registered.</td></tr>`}</tbody>
      </table></div>
    </section>
    <section aria-labelledby="h-runs">
      <div class="section-head">
        <h2 id="h-runs">Last ${runs.length} runs</h2>
        <div class="field"><label for="runFilter">Show</label>
          <select id="runFilter" data-focus="run-filter">
            <option value="">All jobs</option>
            ${jobs.filter((j) => j.canRun).map((j) => `<option value="${esc(j.id)}"${filter === j.id ? " selected" : ""}>${esc(j.name)}</option>`).join("")}
          </select></div>
      </div>
      <div class="table-wrap"><table class="table">
        <thead><tr>
          <th scope="col">Time</th><th scope="col">Job</th><th scope="col">Trigger</th>
          <th scope="col" class="num">Duration</th><th scope="col">Outcome</th><th scope="col">Result or error</th>
        </tr></thead>
        <tbody id="runRows">${runRows(runs, jobs)}</tbody>
      </table></div>
    </section>
    <section aria-labelledby="h-errors">
      <h2 id="h-errors">Recent errors</h2>
      ${errors.length ? `<ul class="lines">${errors.map((e) => `<li>${esc(e)}</li>`).join("")}</ul>` : `<p class="empty">No error since the server started.</p>`}
    </section>`;

  $("#runFilter", root).addEventListener("change", (e) => {
    filter = e.target.value;
    $("#runRows", root).innerHTML = runRows(runs, jobs);
  });
  for (const b of $$("[data-run]", root)) {
    b.addEventListener("click", () => {
      if (!isBusy(b)) runNow(root, b.dataset.run, jobs.find((j) => j.id === b.dataset.run)?.name || b.dataset.run, ctx);
    });
  }
}

function jobRow(j) {
  const lr = j.lastRun;
  const last = lr
    ? `${timeEl(lr.finishedAt || lr.startedAt)} <span class="muted nowrap">(${esc(duration(lr.durationMs))})</span>${lr.ok === false
      ? `<span class="sub mono err">${esc(lr.error || "failed")}</span>`
      : `<span class="sub">${esc(summary(lr.result))}</span>`}`
    : `<span class="muted">not yet</span>`;
  return `<tr>
    <th scope="row">${esc(j.name)}<span class="sub">${esc(j.what || "")}</span></th>
    <td class="nowrap">${esc(j.schedule)}</td>
    <td>${chip(j.health)}</td>
    <td>${last}</td>
    <td class="nowrap">${j.kind === "loop" ? `<span class="muted">continuous</span>` : timeEl(j.nextDueAt)}</td>
    <td class="actions">${j.canRun
      ? `<button type="button" class="btn btn-ghost btn-small" data-run="${esc(j.id)}" data-focus="run-${esc(j.id)}" aria-label="Run now: ${esc(j.name)}"${j.running ? ' aria-disabled="true"' : ""}>Run now</button>`
      : ""}</td>
  </tr>`;
}

function runRows(runs, jobs) {
  const names = Object.fromEntries(jobs.map((j) => [j.id, j.name]));
  const shown = filter ? runs.filter((r) => r.job === filter) : runs;
  if (!shown.length) return `<tr><td colspan="6" class="empty">${filter ? "No run of this job yet." : "No run recorded yet."}</td></tr>`;
  return shown.map((r) => `<tr>
    <td class="nowrap">${timeEl(r.startedAt)}</td>
    <td>${esc(names[r.job] || r.job)}</td>
    <td>${esc(r.trigger)}</td>
    <td class="num nowrap">${esc(duration(r.durationMs))}</td>
    <td>${outcome(r)}</td>
    <td>${r.ok === false ? `<span class="mono err">${esc(r.error || "failed")}</span>` : esc(summary(r.result))}</td>
  </tr>`).join("");
}

function outcome(r) {
  if (r.ok === true) return chipRaw("ok", "●", "OK");
  if (r.ok === false) return chipRaw("fail", "✕", "Failed");
  return chipRaw("info", "↻", "Running", "chip-running");
}

// Run now: start, say what the server answered, then follow the run until
// it is over (every 2 s, one minute at most) and redraw. "Already running"
// (a scheduled tick, another tab) follows that run the same way. The button
// stays focusable while busy, so the focus survives the redraws.
async function runNow(root, id, name, ctx) {
  const button = $(`[data-run="${CSS.escape(id)}"]`, root);
  busy(button);
  try {
    await api(`/api/admin/jobs/${encodeURIComponent(id)}/run`, { method: "POST", body: {} });
    toast(`${name}: started`);
  } catch (e) {
    toast(`${name}: ${e.message}`, "fail");
    if (e.status !== 409) { busy(button, false); return; }
  }
  const until = Date.now() + 60000;
  let job = null;
  while (Date.now() < until) {
    await sleep(2000);
    if (!ctx.onPage()) return;
    let data;
    try { data = await api("/api/admin/jobs"); } catch (e) { toast(e.message, "fail"); return; }
    if (!ctx.onPage()) return;
    const key = document.activeElement?.dataset?.focus;
    draw(root, data, ctx);
    setUpdated();
    if (key) $(`[data-focus="${CSS.escape(key)}"]`, root)?.focus({ preventScroll: true });
    job = (data.jobs || []).find((j) => j.id === id);
    if (!job || !job.running) break;
  }
  if (!job) return;
  if (job.running) toast(`${name}: still running after a minute; the table will catch up on the next refresh`);
  else if (job.lastRun?.ok === false) toast(`${name}: failed (${job.lastRun.error || "no detail"})`, "fail");
  else toast(`${name}: finished in ${duration(job.lastRun?.durationMs)}`, "ok");
}
