// Scam Shield server: Fastify app + background jobs.
// Security defaults: strict CSP (no inline scripts), httpOnly session
// cookie, Origin check on every state-changing request from a browser,
// per-route rate limits, loopback-only unless HOST says otherwise.

import Fastify from "fastify";
import cookie from "@fastify/cookie";
import helmet from "@fastify/helmet";
import rateLimit from "@fastify/rate-limit";
import multipart from "@fastify/multipart";
import fastifyStatic from "@fastify/static";
import { fileURLToPath, pathToFileURL } from "node:url";
import { config, googleConfigured } from "./config.js";
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

const publicDir = fileURLToPath(new URL("../public/", import.meta.url));

export async function buildApp({ logger = true } = {}) {
  const app = Fastify({ logger, trustProxy: false, bodyLimit: 1024 * 1024 });

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
  });
  await app.register(rateLimit, { global: false });
  await app.register(multipart, { limits: { fileSize: 8 * 1024 * 1024, files: 1 } });
  app.addContentTypeParser("application/x-www-form-urlencoded", { parseAs: "string", bodyLimit: 4096 },
    (request, body, done) => done(null, Object.fromEntries(new URLSearchParams(body))));

  // A browser request that changes something must come from our own pages.
  // The phone app authenticates with a bearer token instead of a cookie.
  const origin = new URL(config.baseUrl).origin;
  app.addHook("onRequest", async (request, reply) => {
    if (["GET", "HEAD", "OPTIONS"].includes(request.method)) return;
    if (/^Bearer\s/i.test(request.headers.authorization || "") || request.url === "/api/devices/pair") return;
    const from = request.headers.origin || (request.headers.referer ? new URL(request.headers.referer).origin : null);
    if (from !== origin) return reply.code(403).send({ error: `Requests must come from ${origin}` });
  });
  app.addHook("preHandler", async (request) => {
    // Phone requests carry a bearer token and are authenticated per route.
    if (!request.user && !/^Bearer\s/i.test(request.headers.authorization || "")) request.user = await loadUser(request);
  });

  await app.register(authRoutes);
  await app.register(accountRoutes);
  await app.register(mailRoutes);
  await app.register(guardianRoutes);
  await app.register(deviceRoutes);
  await app.register(adminRoutes);
  await app.register(demoRoutes);
  await app.register(fastifyStatic, { root: publicDir, index: ["index.html"] });

  app.setErrorHandler((err, request, reply) => {
    request.log.error(err);
    const status = err.statusCode && err.statusCode < 500 ? err.statusCode : 500;
    reply.code(status).send({ error: status === 500 ? "Something went wrong on our side. To be safe, do not click anything in the message." : err.message });
  });
  return app;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await migrate();
  const app = await buildApp({ logger: { level: process.env.LOG_LEVEL || "info" } });
  await app.listen({ port: config.port, host: config.host });
  console.log(`Scam Shield on ${config.baseUrl}`);
  console.log(`  Google sign-in: ${googleConfigured() ? "configured" : "NOT configured (demo only) — see docs/GOOGLE_SETUP.md"}`);
  console.log(`  Muse Spark: ${museConfigured() ? museModel() : "NOT configured — detector only"}`);
  startJobs();
  const shutdown = async () => { stopJobs(); await app.close(); await pool.end(); process.exit(0); };
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}
