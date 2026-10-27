#!/usr/bin/env node
// Scam Shield device-API mock for testing the Android companion.
// Node 22, zero dependencies. Binds 127.0.0.1 only (the emulator reaches it as 10.0.2.2).
// Port: 3000 if free, otherwise 3999. Override with PORT=xxxx.
//
//   node android/tools/mock-server.mjs
//
// Pairing code: TEST1234. Extra test-only routes:
//   POST /__mock/revoke   -> every token becomes invalid (next device call gets 401)
//   POST /__mock/answer   {"checkId":"…","answer":"scam|real|call_me"} -> queue a guardian answer
//   GET  /__mock/log      -> requests seen so far
// After POST /api/devices/ask, Thomas answers "scam" automatically after ANSWER_DELAY_MS (default 5000).

import http from "node:http";
import net from "node:net";
import { randomUUID } from "node:crypto";

const HOST = "127.0.0.1";
const PAIR_CODE = "TEST1234";
const ANSWER_DELAY_MS = Number(process.env.ANSWER_DELAY_MS ?? 5000);

const tokens = new Set();
const checks = new Map(); // checkId -> { from, body, receivedAt }
const answers = [];
const log = [];

const guardians = [{ id: "a3f1c2d4-0000-4000-8000-000000000001", name: "Thomas" }];

// A port counts as busy if anything answers on it (e.g. the real server bound to
// 0.0.0.0 or ::, which macOS would otherwise let us shadow on 127.0.0.1) or if we cannot bind it.
function somethingListening(port) {
  return new Promise((resolve) => {
    const sock = net.connect({ port, host: HOST });
    sock.setTimeout(500);
    sock.once("connect", () => { sock.destroy(); resolve(true); });
    sock.once("timeout", () => { sock.destroy(); resolve(false); });
    sock.once("error", () => resolve(false));
  });
}

function canBind(port) {
  return new Promise((resolve) => {
    const s = net.createServer();
    s.once("error", () => resolve(false));
    s.once("listening", () => s.close(() => resolve(true)));
    s.listen(port, HOST);
  });
}

async function portFree(port) {
  return !(await somethingListening(port)) && (await canBind(port));
}

function send(res, status, obj) {
  const body = JSON.stringify(obj);
  res.writeHead(status, { "content-type": "application/json; charset=utf-8", "content-length": Buffer.byteLength(body) });
  res.end(body);
}

function readJson(req) {
  return new Promise((resolve) => {
    let raw = "";
    req.setEncoding("utf8");
    req.on("data", (c) => { raw += c; if (raw.length > 64_000) req.destroy(); });
    req.on("end", () => { try { resolve(raw ? JSON.parse(raw) : {}); } catch { resolve(null); } });
  });
}

function authed(req) {
  const m = /^Bearer (.+)$/.exec(req.headers.authorization || "");
  return m && tokens.has(m[1]);
}

const looksFrench = (t) => /[éèàçù]|\b(mamie|numéro|colis|votre|vous)\b/i.test(t);
const hasLink = (t) => /(https?:\/\/|www\.)|\b[a-z0-9-]+\.(com|net|org|top|info|test|xyz|ly)\b/i.test(t);

function verdictFor(body) {
  const fr = looksFrench(body);
  if (/usps|redeliver|colis|toll|péage/i.test(body)) {
    return fr ? {
      verdict: "scam", confidence: 0.94,
      headline: "STOP. Ce SMS est une arnaque.",
      reasons: [
        { text: "Le lien ne mène pas au vrai site de La Poste.", evidence: "link" },
        { text: "Il réclame un petit paiement pour un colis.", evidence: "money" },
        { text: "Il cherche à vous presser.", evidence: "urgency" },
      ],
      action: "delete", action_text: "Supprimez-le. N'appuyez pas sur le lien.",
      real_company_says: "La Poste ne demande jamais de paiement par SMS.",
      escalate_to_guardian: true, guardian_summary: "Faux SMS de livraison avec un lien de paiement.", language: "fr",
    } : {
      verdict: "scam", confidence: 0.94,
      headline: "STOP. This looks like a scam.",
      reasons: [
        { text: "The link does not go to usps.com.", evidence: "link" },
        { text: "It asks for a small payment to release a package.", evidence: "money" },
        { text: "USPS does not text you about fees.", evidence: "brand" },
      ],
      action: "delete", action_text: "Delete it. Do not tap the link.",
      real_company_says: "USPS will never text you asking for a payment or personal details.",
      escalate_to_guardian: true, guardian_summary: "Fake USPS redelivery text with a payment link.", language: "en",
    };
  }
  if (/(envoyer|send|wire|gift|cadeau|bitcoin|code)/i.test(body) || /new number|nouveau numéro|changé de numéro/i.test(body)) {
    return fr ? {
      verdict: "scam", confidence: 0.88,
      headline: "STOP. Quelqu'un se fait passer pour un proche.",
      reasons: [
        { text: "Il dit avoir changé de numéro.", evidence: "new_number" },
        { text: "Il demande de l'argent tout de suite.", evidence: "money" },
      ],
      action: "call", action_text: "Appelez votre proche sur son ancien numéro avant de faire quoi que ce soit.",
      real_company_says: null, escalate_to_guardian: true, guardian_summary: null, language: "fr",
    } : {
      verdict: "scam", confidence: 0.88,
      headline: "STOP. Someone may be pretending to be family.",
      reasons: [
        { text: "They say they have a new number.", evidence: "new_number" },
        { text: "They ask for money right away.", evidence: "money" },
      ],
      action: "call", action_text: "Call your relative on their old number before doing anything.",
      real_company_says: null, escalate_to_guardian: true, guardian_summary: null, language: "en",
    };
  }
  if (/safe-example/i.test(body)) {
    return {
      verdict: "safe", confidence: 0.7, headline: "This looks fine.", reasons: [],
      action: "none", action_text: "No action needed.", real_company_says: null,
      escalate_to_guardian: false, guardian_summary: null, language: fr ? "fr" : "en",
    };
  }
  return fr ? {
    verdict: "be_careful", confidence: 0.6, headline: "Prudence avec ce SMS.",
    reasons: [{ text: "Il contient un lien que nous ne connaissons pas.", evidence: "link" }],
    action: "ask", action_text: "N'appuyez pas sur le lien. Demandez à un proche.",
    real_company_says: null, escalate_to_guardian: false, guardian_summary: null, language: "fr",
  } : {
    verdict: "be_careful", confidence: 0.6, headline: "Be careful with this text.",
    reasons: [{ text: "It has a link we do not recognize.", evidence: "link" }],
    action: "ask", action_text: "Don't tap the link. Ask someone you trust.",
    real_company_says: null, escalate_to_guardian: false, guardian_summary: null, language: "en",
  };
}

function addAnswer(checkId, answer) {
  answers.push({ checkId, guardianName: "Thomas", answer, answeredAt: new Date().toISOString() });
}

async function handle(req, res) {
  const url = new URL(req.url, `http://${HOST}`);
  const route = `${req.method} ${url.pathname}`;
  const entry = { at: new Date().toISOString(), route };
  log.push(entry);

  if (route === "POST /api/devices/pair") {
    const body = await readJson(req);
    entry.body = body;
    if (!body || typeof body.code !== "string") return send(res, 400, { error: "Missing code" });
    if (body.code.toUpperCase() !== PAIR_CODE) return send(res, 400, { error: "Invalid or expired pairing code" });
    const token = "mock-" + randomUUID();
    tokens.add(token);
    console.log(`[mock] paired device "${body.name}"`);
    return send(res, 200, { token, userName: "Linda", locale: "en-US" });
  }

  if (url.pathname.startsWith("/api/devices/") && !authed(req)) {
    console.log(`[mock] 401 ${route}`);
    return send(res, 401, { error: "Unauthorized" });
  }

  if (route === "POST /api/devices/check") {
    const body = await readJson(req);
    entry.body = body;
    if (!body || typeof body.body !== "string") return send(res, 400, { error: "Missing body" });
    const checkId = randomUUID();
    checks.set(checkId, body);
    const verdict = verdictFor(body.body);
    console.log(`[mock] check from=${body.from} receivedAt=${body.receivedAt} -> ${verdict.verdict} (${checkId})`);
    return send(res, 200, { checkId, verdict, guardians });
  }

  if (route === "POST /api/devices/ask") {
    const body = await readJson(req);
    entry.body = body;
    if (!body || !checks.has(body.checkId)) return send(res, 400, { error: "Unknown checkId" });
    console.log(`[mock] ask for ${body.checkId}; Thomas answers in ${ANSWER_DELAY_MS} ms`);
    setTimeout(() => addAnswer(body.checkId, "scam"), ANSWER_DELAY_MS);
    return send(res, 200, { sentTo: guardians.map((g) => g.name) });
  }

  if (route === "GET /api/devices/answers") {
    const since = Date.parse(url.searchParams.get("since") || "") || 0;
    return send(res, 200, { answers: answers.filter((a) => Date.parse(a.answeredAt) > since) });
  }

  if (route === "POST /__mock/revoke") {
    tokens.clear();
    console.log("[mock] all tokens revoked");
    return send(res, 200, { revoked: true });
  }
  if (route === "POST /__mock/answer") {
    const body = await readJson(req);
    if (!body?.checkId || !["scam", "real", "call_me"].includes(body.answer)) return send(res, 400, { error: "checkId + answer required" });
    addAnswer(body.checkId, body.answer);
    return send(res, 200, { ok: true });
  }
  if (route === "GET /__mock/log") return send(res, 200, { log });

  return send(res, 404, { error: "Not found" });
}

const preferred = process.env.PORT ? [Number(process.env.PORT)] : [3000, 3999];
let port = null;
for (const p of preferred) {
  if (await portFree(p)) { port = p; break; }
}
if (port == null) {
  console.error(`[mock] none of ports ${preferred.join(", ")} is free on ${HOST}`);
  process.exit(1);
}
if (port !== preferred[0]) console.log(`[mock] port ${preferred[0]} busy, falling back to ${port}`);

http.createServer((req, res) => {
  handle(req, res).catch((e) => { console.error(e); send(res, 500, { error: "mock error" }); });
}).listen(port, HOST, () => {
  console.log(`[mock] Scam Shield device API mock listening on http://${HOST}:${port} (emulator: http://10.0.2.2:${port}); pair code ${PAIR_CODE}`);
});
