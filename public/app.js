const $ = (s) => document.querySelector(s);
let emails = [];
let current = null;
let currentVerdict = null;
const quick = new Map();

const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

async function api(path, options) {
  const res = await fetch(path, options);
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `Request failed (${res.status})`);
  return data;
}

async function loadStatus() {
  try {
    const s = await api("/api/status");
    if (s.gmailConnected) { $("#modeBadge").textContent = "Gmail connected"; $("#connectBtn").hidden = true; }
    else if (s.gmailConfigured) $("#modeBadge").textContent = "Demo inbox — Gmail ready to connect";
    if (s.museConfigured) $("#modeBadge").textContent += " · Muse Spark on";
  } catch { /* stays demo */ }
}

const check = (email) => api("/api/check", {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({ message: email, locale: email.locale || "en-US", profile: email.profile || "linda" }),
});

function pillFor(id) {
  const q = quick.get(id);
  if (!q) return `<span class="pill">Not checked yet</span>`;
  const label = q.verdict === "scam" ? "Scam" : q.verdict === "be_careful" ? "Be careful" : "Safe";
  const cls = q.verdict === "scam" ? "danger" : q.verdict === "be_careful" ? "caution" : "ok";
  return `<span class="pill ${cls}">${label}</span>`;
}

function renderList() {
  $("#emailList").innerHTML = emails.map((e, i) => `
    <button class="email-item" role="option" data-i="${i}" aria-selected="${current === e}">
      <p class="email-from">${esc(e.fromName || e.from)} ${e.channel && e.channel !== "email" ? `<span class="pill">${esc(e.channel)}</span>` : ""}</p>
      <p class="email-subject">${esc(e.subject || "(message)")}</p>
      <p class="email-date">${esc(e.date || e.id || "")}</p>
      ${pillFor(e.id)}
    </button>`).join("");
  document.querySelectorAll(".email-item").forEach((b) =>
    b.addEventListener("click", () => selectEmail(emails[Number(b.dataset.i)])));
}

async function selectEmail(email) {
  current = email;
  renderList();
  $("#emptyState").hidden = true;
  $("#reader").hidden = false;
  $("#trustedPanel").hidden = true;
  $("#mailMeta").textContent = `From: ${email.fromName || ""} <${email.from || ""}> · ${email.channel || "email"}`;
  $("#mailSubject").textContent = email.subject || "(message)";
  $("#mailBody").textContent = email.body || "";
  $("#verdict").className = "verdict caution";
  $("#verdict").innerHTML = `<h3>Checking this message…</h3><p>Please wait a moment.</p>`;
  $("#whyList").innerHTML = ""; $("#stepsList").innerHTML = ""; $("#sourceLine").textContent = "";
  try {
    currentVerdict = await check(email);
    quick.set(email.id, currentVerdict);
    renderList();
    showVerdict(currentVerdict);
  } catch (e) {
    $("#verdict").innerHTML = `<h3>We could not check this one.</h3><p>${esc(e.message)}. To be safe, do not click anything in it.</p>`;
  }
}

function showVerdict(v) {
  const el = $("#verdict");
  el.className = `verdict ${v.verdict === "scam" ? "danger" : v.verdict === "be_careful" ? "caution" : "ok"}`;
  el.innerHTML = `<h3>${esc(v.headline)}</h3><p>${esc(v.action_text)}</p><p class="score">Confidence: ${Math.round(v.confidence * 100)}% · Checked against your own orders, providers and known breaches</p>`;
  $("#whyList").innerHTML = v.reasons.map((r) => `<li>${esc(r.text)}</li>`).join("");
  const steps = [v.action_text];
  if (v.real_company_says) steps.push(v.real_company_says);
  if (v.escalate_to_guardian) steps.push("Tap “Ask a trusted person” below and let someone you trust look before you do anything.");
  $("#stepsList").innerHTML = steps.map((s) => `<li>${esc(s)}</li>`).join("");
  $("#sourceLine").textContent = `Checked by Scam Shield's rules and your personal context first. Explanation: ${v.source || "detector"}.`;
  $("#askBtn").hidden = !v.escalate_to_guardian && v.verdict === "safe";
}

$("#readAloudBtn").addEventListener("click", () => {
  if (!currentVerdict) return;
  speechSynthesis.cancel();
  const u = new SpeechSynthesisUtterance(`${currentVerdict.headline}. ${currentVerdict.reasons.map((r) => r.text).join(". ")}. ${currentVerdict.action_text}`);
  u.rate = 0.92;
  u.lang = currentVerdict.language === "fr" ? "fr-FR" : "en-US";
  speechSynthesis.speak(u);
});

$("#askBtn").addEventListener("click", () => { $("#trustedPanel").hidden = false; $("#contactName").focus(); });

$("#makeSummaryBtn").addEventListener("click", async () => {
  if (!current || !currentVerdict) return;
  const data = await api("/api/trusted-contact", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ contactName: $("#contactName").value, email: current, verdict: currentVerdict }),
  });
  $("#summaryText").value = data.summary;
  $("#mailtoBtn").href = data.mailto;
});

$("#copyBtn").addEventListener("click", async () => {
  await navigator.clipboard.writeText($("#summaryText").value);
  $("#copyBtn").textContent = "Copied ✓";
  setTimeout(() => ($("#copyBtn").textContent = "Copy the note"), 2000);
});

$("#pasteForm").addEventListener("submit", async (ev) => {
  ev.preventDefault();
  const f = new FormData(ev.target);
  const email = { id: `paste-${Date.now()}`, channel: "email", fromName: "", from: f.get("from"),
    subject: f.get("subject"), body: f.get("body"), date: "Checked by you just now", links: [], locale: "en-US", profile: "linda" };
  emails = [email, ...emails];
  await selectEmail(email);
  window.scrollTo({ top: 0, behavior: "smooth" });
});

(async function init() {
  await loadStatus();
  const inbox = await api("/api/inbox");
  emails = inbox.emails || [];
  if (inbox.source === "gmail") $("#modeBadge").textContent = "Your Gmail";
  if (inbox.error) $("#inboxHint").textContent = "Gmail could not be read, so here is the demo inbox instead.";
  renderList();
  for (const e of emails) {
    try { quick.set(e.id, await check(e)); renderList(); } catch { /* leave unchecked */ }
  }
})();
