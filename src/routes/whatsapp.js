// WhatsApp Cloud API webhook: Meta's verification handshake (GET) and
// message deliveries (POST). Every delivery must carry a valid
// X-Hub-Signature-256 (HMAC with WHATSAPP_APP_SECRET); it is answered 200
// at once, then handled by src/channels/whatsapp.js (Meta retries
// unanswered deliveries for 36 hours; the channel answers each message id
// once). Fail closed: 501 until WHATSAPP_ACCESS_TOKEN and
// WHATSAPP_PHONE_NUMBER_ID are set, 403 for every delivery until
// WHATSAPP_APP_SECRET is set; the app starts without any of them. The GET
// handshake needs only WHATSAPP_VERIFY_TOKEN, so the dashboard can be
// wired first.

import { createWhatsAppChannel, shippedCards, verificationChallenge, verifySignature, whatsappConfig, whatsappConfigured } from "../channels/whatsapp.js";
import { liveCards } from "../sync/checker.js";

export default async function whatsappRoutes(app, opts = {}) {
  const env = opts.env || process.env;
  const channel = opts.channel || createWhatsAppChannel({
    env, log: app.log,
    // The cards a human activated on the admin page, or the shipped ones when Postgres is down.
    patternCards: () => liveCards().catch(() => shippedCards()),
  });
  if (whatsappConfigured(env) && !whatsappConfig(env).appSecret) {
    app.log.warn("WhatsApp webhook inactive until WHATSAPP_APP_SECRET is set: every delivery is refused (403)");
  }

  // The signature covers the raw bytes, so this plugin keeps them. Scoped
  // to these routes; the rest of the app parses JSON as before.
  app.addContentTypeParser("application/json", { parseAs: "buffer" }, (request, body, done) => {
    request.rawBody = body;
    try { done(null, body.length ? JSON.parse(body) : {}); } catch (e) { e.statusCode = 400; done(e); }
  });

  app.get("/api/whatsapp/webhook", async (request, reply) => {
    const challenge = verificationChallenge(request.query, whatsappConfig(env).verifyToken);
    if (challenge === null) return reply.code(403).type("text/plain").send("Forbidden");
    return reply.type("text/plain").send(challenge);
  });

  app.post("/api/whatsapp/webhook", async (request, reply) => {
    if (!whatsappConfigured(env)) return reply.code(501).send({ error: "WhatsApp channel is not configured (WHATSAPP_ACCESS_TOKEN, WHATSAPP_PHONE_NUMBER_ID)" });
    const { appSecret } = whatsappConfig(env);
    if (!appSecret) return reply.code(403).send({ error: "WhatsApp webhook inactive until WHATSAPP_APP_SECRET is set" });
    if (!verifySignature(request.rawBody || Buffer.alloc(0), request.headers["x-hub-signature-256"], appSecret)) {
      return reply.code(403).send({ error: "bad signature" });
    }
    channel.handle(request.body).catch((e) => request.log.error({ err: e.message }, "whatsapp webhook"));
    return reply.code(200).type("text/plain").send("EVENT_RECEIVED");
  });
}
