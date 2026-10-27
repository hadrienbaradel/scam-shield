// Gmail access, deliberately narrow. The client exposes only what Scam
// Shield needs: read messages and history, create its own labels, add or
// remove labels (to file a scam away or put it back), and push watch.
// There is no send, trash or delete anywhere in this file, and label
// changes touching SPAM or TRASH are refused.

const API = "https://gmail.googleapis.com/gmail/v1/users/me";
const FORBIDDEN_LABELS = ["TRASH", "SPAM", "DRAFT", "SENT"];
export const LABEL_NAMES = { parent: "Scam Shield", scam: "Scam Shield/Scam", careful: "Scam Shield/Check first" };

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
      if ((res.status === 429 || res.status >= 500) && attempt < 3) { await sleep(500 * 2 ** attempt); continue; }
      const data = await res.json().catch(() => ({}));
      const err = new Error(`Gmail ${method} ${path.split("?")[0]} ${res.status}: ${data.error?.message || ""}`.trim());
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
    listHistory: (startHistoryId, pageToken) =>
      call("/history", { query: { startHistoryId, historyTypes: "messageAdded", labelId: "INBOX", pageToken } }),
    listLabels: () => call("/labels"),
    createLabel: (name, color) => call("/labels", { method: "POST",
      body: { name, labelListVisibility: "labelShow", messageListVisibility: "show", ...(color ? { color } : {}) } }),
    modifyLabels(id, { add = [], remove = [] } = {}) {
      if ([...add, ...remove].some((l) => FORBIDDEN_LABELS.includes(l))) throw new Error("Scam Shield never moves mail to spam or trash");
      return call(`/messages/${encodeURIComponent(id)}/modify`, { method: "POST", body: { addLabelIds: add, removeLabelIds: remove } });
    },
    watch: (topicName) => call("/watch", { method: "POST", body: { topicName, labelIds: ["INBOX"], labelFilterBehavior: "INCLUDE" } }),
    stop: () => call("/stop", { method: "POST" }),
  });
}

// Creates "Scam Shield", "Scam Shield/Scam" and "Scam Shield/Check first"
// if missing; returns their ids.
export async function ensureLabels(client) {
  const existing = (await client.listLabels()).labels || [];
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

// Gmail's own verdicts on the message, from mx.google.com's header.
export function parseAuthResults(headers) {
  const all = (headers || []).filter((h) => h.name.toLowerCase() === "authentication-results").map((h) => h.value);
  const mine = all.find((v) => /^\s*mx\.google\.com/i.test(v)) || all[0] || "";
  const get = (k) => mine.match(new RegExp(`\\b${k}=(\\w+)`, "i"))?.[1]?.toLowerCase() || "none";
  return `spf=${get("spf")} dkim=${get("dkim")} dmarc=${get("dmarc")}`;
}

export function normalizeMessage(msg) {
  const h = msg.payload?.headers || [];
  const from = parseAddress(header(h, "From"));
  const replyTo = header(h, "Reply-To") ? parseAddress(header(h, "Reply-To")).email : "";
  const plain = findPart(msg.payload, "text/plain");
  const html = findPart(msg.payload, "text/html");
  const htmlText = html ? partText(html) : "";
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
    auth: parseAuthResults(h),
    labelIds: msg.labelIds || [],
    isBulk: Boolean(header(h, "List-Unsubscribe") || /bulk|list/i.test(header(h, "Precedence"))),
  };
}
