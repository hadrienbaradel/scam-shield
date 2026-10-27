# syntax=docker/dockerfile:1
# Scam Shield server image. Build from the repository root (make prod-build, or
# docker build -f .infra/prod/Dockerfile -t scam-shield:local .); the ignore list is
# Dockerfile.dockerignore next to this file (config/master.key never gets in).
# Runtime environment: MASTER_KEY (64 hex characters, opens the config/credentials.enc
# baked in, encrypted), DATABASE_URL (postgres://user:password@host:5432/scam_shield),
# PORT (3000) and HOST (0.0.0.0 here: the app binds loopback by default). Optional:
# BASE_URL (the public URL, needed for Google sign-in), LOG_LEVEL. Migrations run at start.

FROM node:24-alpine AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev --no-audit --no-fund

FROM node:24-alpine
ENV NODE_ENV=production PORT=3000 HOST=0.0.0.0
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY package.json ./
COPY lib ./lib
COPY src ./src
COPY public ./public
COPY prompts ./prompts
COPY data ./data
COPY testcases ./testcases
COPY config/credentials.enc ./config/credentials.enc
USER node
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=30s --retries=3 \
  CMD wget -qO- "http://127.0.0.1:${PORT}/api/health" >/dev/null || exit 1
CMD ["node", "src/server.js"]
