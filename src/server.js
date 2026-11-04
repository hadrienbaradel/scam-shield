// Prudence server: Fastify app + background jobs.
// Security defaults: strict CSP (no inline scripts), httpOnly session
// cookie, Origin check on every state-changing request from a browser,
// per-route rate limits, loopback-only unless HOST says otherwise.
// Observability: errors of 500 and above go to Rollbar when
// ROLLBAR_ACCESS_TOKEN is set, as method and route only (lib/errorTracking.js);
// TRUST_PROXY says which proxy may name the client's address.

import "../lib/credentials.js";
import Fastify from "fastify";
import cookie from "@fastify/cookie";
import helmet from "@fastify/helmet";
import rateLimit from "@fastify/rate-limit";
import multipart from "@fastify/multipart";
import fastifyStatic from "@fastify/static";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { config, describeDatabase, googleConfigured } from "./config.js";
import { initErrorTracking, errorTrackingOn, reportError, flushErrorTracking } from "../lib/errorTracking.js";
import { loadUser } from "./auth.js";
import { migrate } from "./db/migrate.js";
import { pool } from "./db/pool.js";
import { museConfigured, museModel } from "../lib/muse.js";
import { startJobs, stopJobs } from "./jobs/scheduler.js";
import authRoutes from "./routes/auth.js";
import accountRoutes from "./routes/account.js";
import mailRoutes from "./routes/mail.js";
import guardianRoutes from "./routes/guardians.js";
import deviceRoutes from "./routes/devices.js";
import adminRoutes from "./routes/admin.js";
import demoRoutes from "./routes/demo.js";
import dbRoutes from "./routes/db.js";
import adminDbRoutes from "./routes/adminDb.js";
import lessonRoutes from "./routes/lessons.js";
import whatsappRoutes from "./routes/whatsapp.js";
import { webhookActive, whatsappConfigured } from "./channels/whatsapp.js";
import messengerRoutes from "./routes/messenger.js";
import dbWatchRoutes from "./routes/dbWatch.js";
import { messengerConfigured, webhookActive as messengerWebhookActive } from "./channels/messenger.js";

const publicDir = fileURLToPath(new URL("../public/", import.meta.url));

// trustProxy: TRUST_PROXY by default (src/config.js); tests pass their own.
export async function buildApp({ logger = true, trustProxy = config.trustProxy } = {}) {
  // forceCloseConnections: app.close() also ends the open /api/events streams;
  // without it a phone or a tab left on the app holds the old process, and
  // the watcher's restart (make server) waits on it with nothing on port 3000.
  const app = Fastify({ logger, trustProxy, bodyLimit: 1024 * 1024, forceCloseConnections: true });

  await app.register(cookie);
  await app.register(helmet, {
    contentSecurityPolicy: {
      useDefaults: false,
      directives: {
        defaultSrc: ["'self'"], scriptSrc: ["'self'"], styleSrc: ["'self'"], imgSrc: ["'self'", "data:"],
        connectSrc: ["'self'"], fontSrc: ["'self'"], objectSrc: ["'none'"], frameAncestors: ["'none'"],
        baseUri: ["'self'"], formAction: ["'self'"],
      },
    },
    hsts: config.secureCookies,
    crossOriginEmbedderPolicy: false,
    // Form posts from our own script-free pages must carry a real Origin (no-referrer sends Origin: null); other sites still get no Referer.
    referrerPolicy: { policy: "same-origin" },
  });
  // Limits count per signed-in person (per IP otherwise), after sign-in is known.
  await app.register(rateLimit, { global: false, hook: "preHandler", keyGenerator: (request) => request.user?.id || request.ip });
  await app.register(multipart, { limits: { fileSize: 8 * 1024 * 1024, files: 1 } });
  app.addContentTypeParser("application/x-www-form-urlencoded", { parseAs: "string", bodyLimit: 4096 },
    (request, body, done) => done(null, Object.fromEntries(new URLSearchParams(body))));

  // A browser request that changes something must come from our own pages.
  // The phone app authenticates with a bearer token instead of a cookie.
  const origin = new URL(config.baseUrl).origin;
  app.addHook("onRequest", async (request, reply) => {
    if (["GET", "HEAD", "OPTIONS"].includes(request.method)) return;
    if (/^Bearer\s/i.test(request.headers.authorization || "") || request.url === "/api/devices/pair" || request.url === "/api/whatsapp/webhook" || request.url === "/api/messenger/webhook") return; // Meta signs the webhooks (src/routes/whatsapp.js, src/routes/messenger.js)
    // No Origin: the Referer's origin; a Referer that is not a URL counts as no origin (403, never a 500).
    const { origin: sent, referer } = request.headers;
    const from = sent || (referer && URL.canParse(referer) ? new URL(referer).origin : null);
    if (from !== origin) return reply.code(403).send({ error: `Requests must come from ${origin}` });
  });
  app.addHook("onRequest", async (request) => {
    // Phone requests carry a bearer token and are authenticated per route.
    if (!request.user && !/^Bearer\s/i.test(request.headers.authorization || "")) request.user = await loadUser(request);
  });

  // Set before the route plugins load: `await app.register` finalises each
  // child context at once, so a handler set after them would not reach their
  // routes and a 500 would send Fastify's default body, raw error text included.
  app.setErrorHandler((err, request, reply) => {
    request.log.error(err);
    const status = err.statusCode && err.statusCode < 500 ? err.statusCode : 500;
    if (status >= 500) reportError(err, request);
    reply.code(status).send({ error: status === 500 ? "Something went wrong on our side. To be safe, do not click anything in the message." : err.message });
  });
  await app.register(authRoutes);
  await app.register(accountRoutes);
  await app.register(mailRoutes);
  await app.register(guardianRoutes);
  await app.register(deviceRoutes);
  await app.register(adminRoutes);
  await app.register(demoRoutes);
  await app.register(dbRoutes);
  await app.register(adminDbRoutes);
  await app.register(lessonRoutes);
  await app.register(whatsappRoutes);
  await app.register(messengerRoutes);
  await app.register(dbWatchRoutes);
  await app.register(fastifyStatic, { root: publicDir, index: ["index.html"] });
  // The public database's site (public/db/) at /public/: another interface of heyprudence, no session, never the senior's app.
  await app.register(fastifyStatic, { root: join(publicDir, "db"), prefix: "/public/", decorateReply: false, index: ["index.html"] });

  return app;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  initErrorTracking(); // first, so a failed migration is reported too
  // MIGRATE=0 (never in production): make server on the shared database migrated it once before starting
  // this process (scripts/prod.mjs), so a restart on a file change never applies a migration still being written.
  const applied = process.env.MIGRATE === "0" && !config.production ? null : await migrate();
  const app = await buildApp({ logger: { level: process.env.LOG_LEVEL || "info" } });
  await app.listen({ port: config.port, host: config.host });
  console.log(`Prudence on ${config.baseUrl}`);
  console.log(`  Database: ${describeDatabase(config.databaseUrl)}; migrations: ${applied === null ? "not run here (MIGRATE=0)" : applied.length ? `applied ${applied.join(", ")}` : "up to date"}`);
  console.log(`  Background jobs: ${config.worker ? "on" : `off (${config.workerOff})`}`);
  console.log(`  Google sign-in: ${googleConfigured() ? "configured" : "NOT configured (demo only) — see docs/GOOGLE_SETUP.md"}`);
  console.log(`  Muse Spark: ${museConfigured() ? museModel() : "NOT configured — detector only"}`);
  console.log(`  URLhaus (abuse.ch) link lookups: ${config.abusechKey ? "on (host names only)" : "off (no ABUSECH_AUTH_KEY)"}`);
  console.log(`  WhatsApp channel: ${webhookActive() ? "on (/api/whatsapp/webhook)" : whatsappConfigured() ? "webhook inactive until WHATSAPP_APP_SECRET is set" : "off (no WHATSAPP_ACCESS_TOKEN or WHATSAPP_PHONE_NUMBER_ID)"}`);
  console.log(`  Messenger channel: ${messengerWebhookActive() ? "on (/api/messenger/webhook)" : messengerConfigured() ? "webhook inactive until MESSENGER_APP_SECRET is set" : "off (no MESSENGER_PAGE_ACCESS_TOKEN or MESSENGER_PAGE_ID)"}`);
  console.log(`  Rollbar error tracking: ${errorTrackingOn() ? `on (${process.env.NODE_ENV || "development"}, version ${config.appVersion})` : "off (no ROLLBAR_ACCESS_TOKEN)"}`);
  const beats = Object.values(config.heartbeats).filter(Boolean).length;
  console.log(`  Heartbeats: ${!config.production ? "off outside production" : beats ? `${beats} of ${Object.keys(config.heartbeats).length} jobs` : "off (no HEARTBEAT_*_URL)"}`);
  startJobs();
  const shutdown = async () => { stopJobs(); await app.close(); await pool.end(); await flushErrorTracking(); process.exit(0); };
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}
