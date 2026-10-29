// Gmail access, deliberately narrow. The client exposes only what Scam
// Shield needs: read messages and history, create its own labels, add or
// remove labels (to file a scam away or put it back), and push watch.
// There is no send, trash or delete anywhere in this file, and label
// changes touching SPAM or TRASH are refused.

import { hiddenTextFromHtml } from "../../lib/promptGuard/hidden.js";

const API = "https://gmail.googleapis.com/gmail/v1/users/me";
const FORBIDDEN_LABELS = ["TRASH", "SPAM", "DRAFT", "SENT"];
export const LABEL_NAMES = { parent: "Prudence", scam: "Prudence/Scam", careful: "Prudence/Check first" };
// The working title until Oct 28, 2026: labels made then are renamed in place.
const OLD_LABEL_NAMES = { parent: "Scam Shield", scam: "Scam Shield/Scam", careful: "Scam Shield/Check first" };

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function queryString(query = {}) {
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries(query)) {
    if (v === undefined || v === null || v === "") continue;
    for (const item of Array.isArray(v) ? v : [v]) p.append(k, String(item));
  }
  const s = p.toString();
  return s ? `?${s}` : "";
}

export function gmailClient(getToken, { fetchImpl = fetch } = {}) {
  async function call(path, { method = "GET", query, body } = {}) {
    for (let attempt = 0; ; attempt++) {
      const res = await fetchImpl(`${API}${path}${queryString(query)}`, {
        method,
        headers: { authorization: `Bearer ${await getToken()}`, ...(body ? { "content-type": "application/json" } : {}) },
        body: body ? JSON.stringify(body) : undefined,
        signal: AbortSignal.timeout(20000),
      });
      if (res.ok) return res.status === 204 ? null : res.json();
      const data = res.status === 403 ? await res.clone().json().catch(() => ({})) : null;
      const quota = res.status === 403 && /rateLimitExceeded|userRateLimitExceeded|quota/i.test(JSON.stringify(data || {}));
      if ((res.status === 429 || res.status >= 500 || quota) && attempt < 3) {
        // Honour Retry-After when Google sends it; otherwise back off with jitter.
        const retryAfter = Number(res.headers.get("retry-after"));
        await sleep(Number.isFinite(retryAfter) && retryAfter > 0 ? Math.min(retryAfter, 30) * 1000 : 500 * 2 ** attempt + Math.random() * 250);
        continue;
      }
      const errData = data || await res.json().catch(() => ({}));
      const err = new Error(`Gmail ${method} ${path.split("?")[0]} ${res.status}: ${errData.error?.message || ""}`.trim());
      err.status = res.status;
      throw err;
    }
  }

  return Object.freeze({
    profile: () => call("/profile"),
    listMessages: ({ q, labelIds, maxResults = 50, pageToken } = {}) =>
      call("/messages", { query: { q, labelIds, maxResults, pageToken } }),
    getMessage: (id, format = "full", metadataHeaders) =>
      call(`/messages/${encodeURIComponent(id)}`, { query: { format, metadataHeaders } }),
    getThread: (id) => call(`/threads/${encodeURIComponent(id)}`, { query: { format: "full" } }),
    // New mail, and mail that comes back into the inbox (from spam,
    // un-archived) — both need a check.
    listHistory: (startHistoryId, pageToken) =>
      call("/history", { query: { startHistoryId, historyTypes: ["messageAdded", "labelAdded"], labelId: "INBOX", pageToken } }),
    listLabels: () => call("/labels"),
    createLabel: (name, color) => call("/labels", { method: "POST",
      body: { name, labelListVisibility: "labelShow", messageListVisibility: "show", ...(color ? { color } : {}) } }),
    // Only our own labels are ever renamed (ensureLabels); never a person's.
    renameLabel: (id, name) => call(`/labels/${encodeURIComponent(id)}`, { method: "PATCH", body: { name } }),
    modifyLabels(id, { add = [], remove = [] } = {}) {
      if ([...add, ...remove].some((l) => FORBIDDEN_LABELS.includes(l))) throw new Error("Prudence never moves mail to spam or trash");
      return call(`/messages/${encodeURIComponent(id)}/modify`, { method: "POST", body: { addLabelIds: add, removeLabelIds: remove } });
    },
    watch: (topicName) => call("/watch", { method: "POST", body: { topicName, labelIds: ["INBOX"], labelFilterBehavior: "INCLUDE" } }),
    stop: () => call("/stop", { method: "POST" }),
  });
}

// Creates "Prudence", "Prudence/Scam" and "Prudence/Check first" if
// missing; returns their ids. Labels made under the working title
// ("Prudence/…") are renamed in place, parent first, so the messages
// keep them and nothing is duplicated.
export async function ensureLabels(client) {
  let existing = (await client.listLabels()).labels || [];
  const named = (n) => existing.find((l) => l.name === n);
  let renamed = false;
  for (const key of ["parent", "scam", "careful"]) {
    const old = named(OLD_LABEL_NAMES[key]);
    if (old && !named(LABEL_NAMES[key])) { await client.renameLabel(old.id, LABEL_NAMES[key]); renamed = true; }
  }
  if (renamed) existing = (await client.listLabels()).labels || [];
  const byName = new Map(existing.map((l) => [l.name, l.id]));
  const make = async (name, color) => {
    if (byName.has(name)) return byName.get(name);
    try { return (await client.createLabel(name, color)).id; } catch (e) {
      if (e.status === 400 && color) return (await client.createLabel(name)).id;
      if (e.status === 409) return ((await client.listLabels()).labels || []).find((l) => l.name === name)?.id;
      throw e;
    }
  };
  await make(LABEL_NAMES.parent);
  return {
    scam: await make(LABEL_NAMES.scam, { backgroundColor: "#fb4c2f", textColor: "#ffffff" }),
    careful: await make(LABEL_NAMES.careful, { backgroundColor: "#ffad47", textColor: "#000000" }),
  };
}

// ---------- Normalization: Gmail API message -> detector message ----------

export function header(headers, name) {
  return headers?.find((h) => h.name.toLowerCase() === name.toLowerCase())?.value || "";
}

export function parseAddress(value = "") {
  const m = String(value).match(/^\s*"?([^"<]*?)"?\s*<([^>]+)>\s*$/);
  if (m) return { name: m[1].trim(), email: m[2].trim().toLowerCase() };
  const bare = String(value).match(/[^\s<>"]+@[^\s<>"]+/);
  return { name: "", email: (bare ? bare[0] : String(value).trim()).toLowerCase() };
}

function charsetOf(part) {
  const ct = header(part.headers, "Content-Type") || part.mimeType || "";
  return (ct.match(/charset="?([^";]+)"?/i)?.[1] || "utf-8").toLowerCase();
}

function partText(part) {
  const bytes = Buffer.from(part.body.data, "base64url");
  try { return new TextDecoder(charsetOf(part) === "iso-8859-1" ? "windows-1252" : charsetOf(part)).decode(bytes); } catch { return bytes.toString("utf8"); }
}

export function findPart(part, mime) {
  if (!part) return null;
  if (part.mimeType === mime && part.body?.data) return part;
  for (const p of part.parts || []) {
    const found = findPart(p, mime);
    if (found) return found;
  }
  return null;
}

const ENTITIES = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " ", eacute: "é", egrave: "è", agrave: "à", ccedil: "ç", euro: "€", rsquo: "’", lsquo: "‘", hellip: "…", mdash: "—", ndash: "–" };
export function decodeEntities(s = "") {
  return String(s).replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, e) => {
    if (e[0] === "#") {
      const code = e[1].toLowerCase() === "x" ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
      return Number.isFinite(code) ? String.fromCodePoint(code) : m;
    }
    return ENTITIES[e.toLowerCase()] ?? m;
  });
}

export function htmlToText(html = "") {
  return decodeEntities(String(html)
    .replace(/<(style|script|head|title)[^>]*>[\s\S]*?<\/\1>/gi, " ")
    .replace(/<br\s*\/?>|<\/(p|div|tr|li|h[1-6]|table)>/gi, "\n")
    .replace(/<[^>]+>/g, " "))
    .replace(/[ \t ]+/g, " ")
    .replace(/\s*\n\s*/g, "\n")
    .trim();
}

export function linksFromHtml(html = "") {
  const links = [];
  for (const m of String(html).matchAll(/<a\b[^>]*\bhref\s*=\s*["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi)) {
    const href = decodeEntities(m[1]).trim();
    if (!/^https?:\/\//i.test(href)) continue;
    const alt = m[2].match(/\balt\s*=\s*["']([^"']*)["']/i)?.[1] || "";
    links.push({ href, text: htmlToText(m[2]).replace(/\s+/g, " ").trim() || alt.trim() });
  }
  return links;
}

export function linksFromText(text = "") {
  return [...String(text).matchAll(/\bhttps?:\/\/[^\s<>"')\]]+/gi)].map((m) => ({ href: m[0].replace(/[.,;:!?]+$/, ""), text: m[0].replace(/[.,;:!?]+$/, "") }));
}

const registrable = (d = "") => {
  const parts = String(d).toLowerCase().replace(/[>\s]/g, "").split(".").filter(Boolean);
  const two = parts.slice(-2).join(".");
  return ["co.uk", "com.br", "com.au", "gouv.fr", "co.jp", "com.mx", "org.uk"].includes(two) ? parts.slice(-3).join(".") : two;
};

// Gmail's own verdict on the message. Only the TOPMOST
// Authentication-Results header counts, and only when Gmail wrote it
// (authserv-id exactly "mx.google.com"): anything lower down could have
// been written by the sender. A pass counts only when it is aligned with
// the visible From domain: a DKIM signature by sendgrid.info proves
// nothing about certdata.com.br. Unverifiable -> "none".
export function parseAuthResults(headers, fromAddress = "") {
  const first = (headers || []).find((h) => h.name.toLowerCase() === "authentication-results")?.value || "";
  if (!/^\s*mx\.google\.com\s*;/i.test(first)) return "spf=none dkim=none dmarc=none";
  const from = registrable(String(fromAddress).split("@").pop());
  const results = [...first.matchAll(/\b(spf|dkim|dmarc)=(\w+)([^;]*)/gi)].map((m) => ({ kind: m[1].toLowerCase(), result: m[2].toLowerCase(), props: m[3] }));
  const domainIn = (props, key) => registrable((props.match(new RegExp(`${key}=@?(?:[^@\\s;]*@)?([a-z0-9.-]+)`, "i")) || [])[1] || "");
  const verdictFor = (kind, key) => {
    const rs = results.filter((r) => r.kind === kind);
    if (rs.some((r) => r.result === "pass" && (!from || domainIn(r.props, key) === from))) return "pass";
    if (rs.some((r) => ["fail", "softfail", "permerror"].includes(r.result))) return "fail";
    return "none";
  };
  return `spf=${verdictFor("spf", "smtp\\.mailfrom")} dkim=${verdictFor("dkim", "header\\.[id]")} dmarc=${verdictFor("dmarc", "header\\.from")}`;
}

// Files attached to the message (name, type, size): web-page attachments
// (.html, .svg) are a classic way to hide a fake login page.
export function attachmentsOf(part, out = []) {
  if (!part) return out;
  if (part.filename) out.push({ filename: part.filename, mimeType: part.mimeType || "", size: part.body?.size || 0 });
  for (const p of part.parts || []) attachmentsOf(p, out);
  return out;
}

export function normalizeMessage(msg) {
  const h = msg.payload?.headers || [];
  const from = parseAddress(header(h, "From"));
  const replyTo = header(h, "Reply-To") ? parseAddress(header(h, "Reply-To")).email : "";
  const plain = findPart(msg.payload, "text/plain");
  const html = findPart(msg.payload, "text/html");
  const htmlText = html ? partText(html) : "";
  // What the reader cannot see (white on white, hidden, comments): for the
  // injection checks only; the body stays the text as shown.
  const hiddenText = hiddenTextFromHtml(htmlText);
  const body = (plain ? partText(plain) : htmlToText(htmlText)) || decodeEntities(msg.snippet || "");
  const seen = new Set();
  const links = [...linksFromHtml(htmlText), ...linksFromText(plain ? body : "")]
    .filter((l) => (seen.has(l.href) ? false : seen.add(l.href)))
    .slice(0, 40);
  return {
    id: msg.id,
    threadId: msg.threadId,
    channel: "email",
    fromName: decodeEntities(from.name),
    from: from.email,
    replyTo: replyTo && replyTo !== from.email ? replyTo : "",
    subject: header(h, "Subject") || "",
    date: msg.internalDate ? new Date(Number(msg.internalDate)).toISOString() : header(h, "Date"),
    body: body.slice(0, 6000),
    snippet: decodeEntities(msg.snippet || ""),
    links,
    auth: parseAuthResults(h, from.email),
    attachments: attachmentsOf(msg.payload),
    labelIds: msg.labelIds || [],
    isBulk: Boolean(header(h, "List-Unsubscribe") || /bulk|list/i.test(header(h, "Precedence"))),
    ...(hiddenText ? { hiddenText } : {}),
  };
}
