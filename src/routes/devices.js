// Android SMS companion. The phone pairs once with a short code shown on
// the web page, then authenticates with its own bearer token (stored here
// only as a hash). Only texts the phone's pre-screen finds risky are sent.

import QRCode from "qrcode";
import { requireUser } from "../auth.js";
import { config } from "../config.js";
import { randomToken, sha256 } from "../crypto.js";
import { many, one, q } from "../db/pool.js";
import { linksFromText } from "../google/gmail.js";
import { runCheck, recordCheck } from "../sync/checker.js";
import { sharedFrom } from "../sync/worker.js";
import { alertGuardians, answersForSenior } from "../guardians.js";
import { audit } from "../sync/actions.js";

const ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
const pairCode = () => Array.from(randomToken(16)).map((c) => ALPHABET[c.charCodeAt(0) % ALPHABET.length]).slice(0, 8).join("");

async function deviceAuth(request, reply) {
  const m = String(request.headers.authorization || "").match(/^Bearer\s+(.+)$/i);
  const device = m && await one(`SELECT d.*, u.id AS uid FROM devices d JOIN users u ON u.id = d.user_id
                                 WHERE d.token_hash = $1 AND d.revoked_at IS NULL`, [sha256(m[1])]);
  if (!device) return reply.code(401).send({ error: "This phone is not paired any more." });
  request.device = device;
  request.user = await one("SELECT * FROM users WHERE id = $1", [device.user_id]);
  await q("UPDATE devices SET last_seen_at = now() WHERE id = $1", [device.id]);
}

export default async function deviceRoutes(app) {
  app.register(async (priv) => {
    priv.addHook("preHandler", requireUser);

    priv.get("/api/devices", async (request) => ({
      devices: await many("SELECT id, name, created_at, last_seen_at FROM devices WHERE user_id = $1 AND token_hash IS NOT NULL AND revoked_at IS NULL", [request.user.id]),
    }));

    priv.post("/api/devices/pair-code", async (request) => {
      const code = pairCode();
      await q("INSERT INTO devices (user_id, pair_code_hash, pair_expires_at) VALUES ($1, $2, now() + interval '10 minutes')", [request.user.id, sha256(code)]);
      // The phone must reach this server: the emulator sees the Mac as
      // 10.0.2.2; a real phone needs the Mac's LAN address and HOST=0.0.0.0.
      const serverUrl = typeof request.body?.serverUrl === "string" && /^https?:\/\//.test(request.body.serverUrl) ? request.body.serverUrl : config.baseUrl;
      const qrSvg = await QRCode.toString(JSON.stringify({ v: 1, server: serverUrl, code }), { type: "svg", margin: 1, width: 240 });
      return { code, serverUrl, qrSvg, expiresInMinutes: 10 };
    });

    priv.delete("/api/devices/:id", async (request) => {
      await q("UPDATE devices SET revoked_at = now() WHERE id = $1 AND user_id = $2", [request.params.id, request.user.id]);
      await audit(request.user.id, "device_removed", { deviceId: request.params.id });
      return { ok: true };
    });
  });

  app.post("/api/devices/pair", { config: { rateLimit: { max: 10, timeWindow: "1 minute" } } }, async (request, reply) => {
    const code = String(request.body?.code || "").toUpperCase().replace(/[^A-Z0-9]/g, "");
    const device = code && await one(`SELECT d.*, u.name AS user_name, u.locale FROM devices d JOIN users u ON u.id = d.user_id
                                      WHERE d.pair_code_hash = $1 AND d.pair_expires_at > now() AND d.revoked_at IS NULL`, [sha256(code)]);
    if (!device) return reply.code(400).send({ error: "This code is wrong or has expired. Make a new one on the Scam Shield page." });
    const token = randomToken();
    await q("UPDATE devices SET token_hash = $2, pair_code_hash = NULL, name = $3, last_seen_at = now() WHERE id = $1",
      [device.id, sha256(token), String(request.body?.name || "Phone").slice(0, 60)]);
    await audit(device.user_id, "device_paired", { deviceId: device.id });
    return { token, userName: device.user_name || "", locale: device.locale };
  });

  app.register(async (dev) => {
    dev.addHook("preHandler", deviceAuth);
    const limited = { config: { rateLimit: { max: 30, timeWindow: "1 minute" } } };

    dev.post("/api/devices/check", limited, async (request, reply) => {
      const { from = "", body = "" } = request.body || {};
      if (!String(body).trim()) return reply.code(400).send({ error: "body required" });
      const message = { channel: "sms", from: String(from).slice(0, 60), fromName: "", subject: "", body: String(body).slice(0, 2000), links: linksFromText(body), auth: "" };
      const { verdict } = await runCheck({ user: request.user, message });
      const check = await recordCheck({ userId: request.user.id, message, verdict, channel: "sms" });
      // Kept in memory for "Ask my trusted person" from the phone, which
      // follows within minutes; never written to the database.
      recentTexts.set(check.id, { message, at: Date.now() });
      const guardians = await many("SELECT id, guardian_name AS name FROM guardianships WHERE senior_id = $1 AND status = 'active'", [request.user.id]);
      const { error, latency_ms, usage, ...publicVerdict } = verdict;
      return { checkId: check.id, verdict: publicVerdict, guardians };
    });

    dev.post("/api/devices/ask", async (request, reply) => {
      const check = await one("SELECT * FROM checks WHERE id = $1 AND user_id = $2", [request.body?.checkId, request.user.id]);
      if (!check) return reply.code(404).send({ error: "unknown check" });
      const message = recentTexts.get(check.id)?.message || { channel: "sms", from: "", fromName: "", subject: "", body: "" };
      const sentTo = await alertGuardians({ senior: request.user, checkId: check.id, shared: sharedFrom(message, check.verdict, true) });
      return { sentTo };
    });

    dev.get("/api/devices/answers", async (request) => ({
      answers: (await answersForSenior(request.user.id, request.query.since || null))
        .filter((a) => a.answer).map((a) => ({ checkId: a.check_id, guardianName: a.guardian_name, answer: a.answer, answeredAt: a.answered_at })),
    }));
  });
}

const recentTexts = new Map();
setInterval(() => {
  for (const [id, v] of recentTexts) if (v.at < Date.now() - 30 * 60000) recentTexts.delete(id);
}, 5 * 60000).unref();
