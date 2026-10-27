// Gmail OAuth + read-only inbox access.
// Scope is gmail.readonly on purpose: the app can never send, move or
// delete mail. Tokens live in .tokens.json (gitignored) for the demo.

import { readFile, writeFile } from "node:fs/promises";

const TOKEN_FILE = new URL("../.tokens.json", import.meta.url);
const SCOPES = ["https://www.googleapis.com/auth/gmail.readonly"];

export const gmailConfigured = () =>
  Boolean(process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET);

const redirectUri = () =>
  process.env.GOOGLE_REDIRECT_URI || "http://localhost:3000/auth/google/callback";

export function authUrl() {
  const p = new URLSearchParams({
    client_id: process.env.GOOGLE_CLIENT_ID,
    redirect_uri: redirectUri(),
    response_type: "code",
    scope: SCOPES.join(" "),
    access_type: "offline",
    prompt: "consent",
  });
  return `https://accounts.google.com/o/oauth2/v2/auth?${p}`;
}

async function saveTokens(t) {
  await writeFile(TOKEN_FILE, JSON.stringify(t, null, 2));
}
async function loadTokens() {
  try { return JSON.parse(await readFile(TOKEN_FILE, "utf8")); } catch { return null; }
}
export async function gmailConnected() {
  return Boolean((await loadTokens())?.access_token);
}

export async function exchangeCode(code) {
  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      code,
      client_id: process.env.GOOGLE_CLIENT_ID,
      client_secret: process.env.GOOGLE_CLIENT_SECRET,
      redirect_uri: redirectUri(),
      grant_type: "authorization_code",
    }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error_description || "Token exchange failed");
  await saveTokens(data);
  return data;
}

async function accessToken() {
  const t = await loadTokens();
  if (!t) return null;
  if (!t.refresh_token) return t.access_token;
  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: process.env.GOOGLE_CLIENT_ID,
      client_secret: process.env.GOOGLE_CLIENT_SECRET,
      refresh_token: t.refresh_token,
      grant_type: "refresh_token",
    }),
  });
  const data = await res.json();
  if (res.ok) { await saveTokens({ ...t, ...data }); return data.access_token; }
  return t.access_token;
}

function header(headers, name) {
  return headers?.find((h) => h.name.toLowerCase() === name.toLowerCase())?.value || "";
}

function decodeBody(part) {
  if (!part) return "";
  if (part.body?.data) return Buffer.from(part.body.data, "base64url").toString("utf8");
  for (const p of part.parts || []) {
    const text = decodeBody(p);
    if (text) return text;
  }
  return "";
}

function findPart(part, mime) {
  if (!part) return null;
  if (part.mimeType === mime && part.body?.data) return part;
  for (const p of part.parts || []) {
    const found = findPart(p, mime);
    if (found) return found;
  }
  return null;
}

function linksFromHtml(payload) {
  const part = findPart(payload, "text/html");
  if (!part) return [];
  const html = Buffer.from(part.body.data, "base64url").toString("utf8");
  const links = [];
  for (const m of html.matchAll(/<a[^>]+href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi)) {
    links.push({ href: m[1], text: m[2].replace(/<[^>]+>/g, "").trim() });
  }
  return links;
}

export async function listInbox(max = 15) {
  const token = await accessToken();
  if (!token) return null;
  const auth = { authorization: `Bearer ${token}` };
  const listRes = await fetch(
    `https://gmail.googleapis.com/gmail/v1/users/me/messages?maxResults=${max}&labelIds=INBOX`,
    { headers: auth },
  );
  if (!listRes.ok) throw new Error(`Gmail list ${listRes.status}`);
  const list = await listRes.json();
  const emails = [];
  for (const m of list.messages || []) {
    const r = await fetch(`https://gmail.googleapis.com/gmail/v1/users/me/messages/${m.id}?format=full`, { headers: auth });
    if (!r.ok) continue;
    const msg = await r.json();
    const h = msg.payload?.headers || [];
    const from = header(h, "From");
    const match = from.match(/^(.*?)\s*<([^>]+)>$/);
    const authResults = header(h, "Authentication-Results").toLowerCase();
    emails.push({
      id: msg.id,
      fromName: match ? match[1].replace(/"/g, "") : from,
      from: match ? match[2] : from,
      replyTo: header(h, "Reply-To"),
      subject: header(h, "Subject") || "(no subject)",
      date: header(h, "Date"),
      body: (decodeBody(msg.payload) || msg.snippet || "").slice(0, 6000),
      links: linksFromHtml(msg.payload),
      auth: `${authResults.includes("spf=fail") ? "spf=fail " : ""}${authResults.includes("dkim=fail") ? "dkim=fail" : ""}`.trim(),
    });
  }
  return emails;
}
