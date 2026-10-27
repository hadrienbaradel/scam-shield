import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { extname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { checkMessage, museConfigured } from "./lib/muse.js";
import { authUrl, exchangeCode, gmailConfigured, gmailConnected, listInbox } from "./lib/gmail.js";

const root = fileURLToPath(new URL(".", import.meta.url));
const PORT = Number(process.env.PORT || 3000);
const MIME = { ".html": "text/html", ".css": "text/css", ".js": "text/javascript", ".json": "application/json", ".svg": "image/svg+xml" };

function json(res, status, data) {
  res.writeHead(status, { "content-type": "application/json" });
  res.end(JSON.stringify(data));
}

async function bodyJson(req) {
  const chunks = [];
  for await (const c of req) chunks.push(c);
  return JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}");
}

const PROFILES = {
  linda: JSON.parse(await readFile(new URL("./data/profiles/linda.json", import.meta.url), "utf8")),
  francoise: JSON.parse(await readFile(new URL("./data/profiles/francoise.json", import.meta.url), "utf8")),
};
const CARDS = JSON.parse(await readFile(new URL("./data/patterns/cards.json", import.meta.url), "utf8"));
const CASES = JSON.parse(await readFile(new URL("./testcases/cases.json", import.meta.url), "utf8"));
const DEMO_INBOX = CASES.cases.map((c) => ({
  ...c.message, id: c.id, profile: c.profile, locale: c.locale,
  threadHistory: c.threadHistory || [], mockLinkInspection: c.mockLinkInspection || {},
  date: `Case ${c.id} · ${c.message.channel || "email"}`,
}));

async function currentInbox() {
  if (await gmailConnected()) {
    try {
      const emails = await listInbox();
      return { source: "gmail", emails: emails.map((e) => ({ ...e, profile: "linda", locale: "en-US" })) };
    } catch (e) { return { source: "demo", error: String(e.message || e), emails: DEMO_INBOX }; }
  }
  return { source: "demo", emails: DEMO_INBOX };
}

const server = createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);
  try {
    if (url.pathname === "/api/health") return json(res, 200, { ok: true });

    if (url.pathname === "/api/status") {
      return json(res, 200, {
        gmailConfigured: gmailConfigured(),
        gmailConnected: await gmailConnected(),
        museConfigured: museConfigured(),
      });
    }

    if (url.pathname === "/auth/google") {
      if (!gmailConfigured()) return json(res, 400, { error: "Gmail is not configured yet. Set GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET — see README." });
      res.writeHead(302, { location: authUrl() });
      return res.end();
    }

    if (url.pathname === "/auth/google/callback") {
      const code = url.searchParams.get("code");
      if (!code) return json(res, 400, { error: "Missing code" });
      await exchangeCode(code);
      res.writeHead(302, { location: "/" });
      return res.end();
    }

    if (url.pathname === "/api/inbox") return json(res, 200, await currentInbox());

    if (url.pathname === "/api/check" && req.method === "POST") {
      const { message, locale, profile, personalContext, patternCards, threadHistory, mockLinkInspection } = await bodyJson(req);
      if (!message?.body && !message?.subject) return json(res, 400, { error: "message required" });
      const verdict = await checkMessage({
        locale: locale || message.locale || "en-US",
        message,
        personalContext: personalContext || PROFILES[profile || message.profile] || PROFILES.linda,
        patternCards: patternCards || CARDS,
        threadHistory: threadHistory || message.threadHistory || [],
        mockLinkInspection: mockLinkInspection || message.mockLinkInspection || {},
        linkInspection: mockLinkInspection || message.mockLinkInspection || {},
      });
      return json(res, 200, verdict);
    }

    if (url.pathname === "/api/profiles") return json(res, 200, PROFILES);
    if (url.pathname === "/api/patterns") return json(res, 200, CARDS);

    if (url.pathname === "/api/trusted-contact" && req.method === "POST") {
      const { contactName = "my trusted person", email, analysis, verdict } = await bodyJson(req);
      const text = [
        `Hi, this is a safety check from Scam Shield.`,
        `Could you look at this email with me before I do anything?`,
        ``,
        `From: ${email?.fromName || ""} <${email?.from || ""}>`,
        `Subject: ${email?.subject || ""}`,
        `Verdict: ${verdict?.headline || analysis?.explanation?.headline || verdict?.verdict || analysis?.verdict || "needs a look"}`,
        `Why: ${((verdict?.reasons || []).map((r) => r.text).join(" ") || (analysis?.explanation?.why || []).join(" "))}`,
        ``,
        `I have not clicked anything yet. Thank you!`,
      ].join("\n");
      return json(res, 200, {
        contactName,
        summary: text,
        mailto: `mailto:?subject=${encodeURIComponent("Please check this email with me")}&body=${encodeURIComponent(text)}`,
      });
    }

    const filePath = join(root, "public", url.pathname === "/" ? "index.html" : url.pathname);
    const data = await readFile(filePath);
    res.writeHead(200, { "content-type": MIME[extname(filePath)] || "text/plain" });
    res.end(data);
  } catch (e) {
    if (e.code === "ENOENT") { res.writeHead(404); return res.end("Not found"); }
    json(res, 500, { error: String(e.message || e) });
  }
});

server.listen(PORT, () => {
  console.log(`Scam Shield running at http://localhost:${PORT}`);
  console.log(gmailConfigured() ? "Gmail OAuth: configured" : "Gmail OAuth: not configured (demo inbox) — see README");
});
