// Messenger Platform webhook: Meta's verification handshake (GET) and
// message deliveries (POST) for the Prudence Page. Every delivery must
// carry a valid X-Hub-Signature-256 (HMAC with MESSENGER_APP_SECRET); it is
// answered 200 at once, then handled by src/channels/messenger.js (Meta
// retries unanswered deliveries for 36 hours; the channel answers each
// message id once). Fail closed: 501 until MESSENGER_PAGE_ACCESS_TOKEN and
// MESSENGER_PAGE_ID are set, 403 for every delivery until
// MESSENGER_APP_SECRET is set; the app starts without any of them. The GET
// handshake needs only MESSENGER_VERIFY_TOKEN, so the dashboard can be
// wired first.

import { createMessengerChannel, messengerConfig, messengerConfigured, verificationChallenge, verifySignature } from "../channels/messenger.js";
import { shippedCards } from "../channels/whatsapp.js";
import { liveCards } from "../sync/checker.js";

export default async function messengerRoutes(app, opts = {}) {
  const env = opts.env || process.env;
  const channel = opts.channel || createMessengerChannel({
    env, log: app.log,
    // The cards a human activated on the admin page, or the shipped ones when Postgres is down.
    patternCards: () => liveCards().catch(() => shippedCards()),
  });
  if (messengerConfigured(env) && !messengerConfig(env).appSecret) {
    app.log.warn("Messenger webhook inactive until MESSENGER_APP_SECRET is set: every delivery is refused (403)");
  }
  // Conversations still in their grouping window are judged and answered before the server stops.
  app.addHook("onClose", async () => { channel.flush?.(); await channel.idle?.(); });

  // The signature covers the raw bytes, so this plugin keeps them. Scoped
  // to these routes; the rest of the app parses JSON as before.
  app.addContentTypeParser("application/json", { parseAs: "buffer" }, (request, body, done) => {
    request.rawBody = body;
    try { done(null, body.length ? JSON.parse(body) : {}); } catch (e) { e.statusCode = 400; done(e); }
  });

  app.get("/api/messenger/webhook", async (request, reply) => {
    const challenge = verificationChallenge(request.query, messengerConfig(env).verifyToken);
    if (challenge === null) return reply.code(403).type("text/plain").send("Forbidden");
    return reply.type("text/plain").send(challenge);
  });

  app.post("/api/messenger/webhook", async (request, reply) => {
    if (!messengerConfigured(env)) return reply.code(501).send({ error: "Messenger channel is not configured (MESSENGER_PAGE_ACCESS_TOKEN, MESSENGER_PAGE_ID)" });
    const { appSecret } = messengerConfig(env);
    if (!appSecret) return reply.code(403).send({ error: "Messenger webhook inactive until MESSENGER_APP_SECRET is set" });
    if (!verifySignature(request.rawBody || Buffer.alloc(0), request.headers["x-hub-signature-256"], appSecret)) {
      return reply.code(403).send({ error: "bad signature" });
    }
    channel.handle(request.body).catch((e) => request.log.error({ err: e.message }, "messenger webhook"));
    return reply.code(200).type("text/plain").send("EVENT_RECEIVED");
  });
}
