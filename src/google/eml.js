// Raw email files (.eml): downloaded from Gmail ("Download message") or
// forwarded as attachments. Parsed into the same message shape as Gmail
// sync, so the checks are identical. The file itself is never stored.

import { simpleParser } from "mailparser";
import { htmlToText, linksFromHtml, linksFromText, parseAuthResults } from "./gmail.js";
import { hiddenTextFromHtml } from "../../lib/promptGuard/hidden.js";

export async function parseEml(source) {
  const mail = await simpleParser(source, { skipImageLinks: true, skipTextToHtml: true });
  const from = mail.from?.value?.[0] || {};
  const replyTo = mail.replyTo?.value?.[0]?.address?.toLowerCase() || "";
  const unfold = (h) => h.line.replace(/^[^:]+:\s*/, "").replace(/\r?\n\s+/g, " ");
  const authHeaders = mail.headerLines.filter((h) => h.key === "authentication-results")
    .map((h) => ({ name: "Authentication-Results", value: unfold(h) }));
  // A file can say anything about itself. Its authentication is trusted
  // only if Gmail visibly received it: the first hop arriving "from"
  // somewhere was accepted "by mx.google.com". Otherwise: unverified.
  const firstInbound = mail.headerLines.filter((h) => h.key === "received").map(unfold).find((v) => /\bfrom\b/i.test(v)) || "";
  const viaGmail = /\bby mx\.google\.com\b/i.test(firstInbound);
  const html = typeof mail.html === "string" ? mail.html : "";
  const hiddenText = hiddenTextFromHtml(html); // for the injection checks only
  const body = (mail.text || htmlToText(html) || "").trim();
  const seen = new Set();
  const links = [...linksFromHtml(html), ...linksFromText(mail.text || "")]
    .filter((l) => (seen.has(l.href) ? false : seen.add(l.href)))
    .slice(0, 40);
  return {
    channel: "email",
    fromName: from.name || "",
    from: (from.address || "").toLowerCase(),
    replyTo: replyTo && replyTo !== (from.address || "").toLowerCase() ? replyTo : "",
    subject: mail.subject || "",
    date: mail.date ? mail.date.toISOString() : "",
    body: body.slice(0, 6000),
    links,
    auth: viaGmail ? parseAuthResults(authHeaders, from.address || "") : "spf=none dkim=none dmarc=none",
    authVerified: viaGmail,
    attachments: (mail.attachments || []).map((a) => ({ filename: a.filename || "", mimeType: a.contentType || "", size: a.size || 0 })),
    ...(hiddenText ? { hiddenText } : {}),
  };
}
