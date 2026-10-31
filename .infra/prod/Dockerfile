# syntax=docker/dockerfile:1
# Scam Shield server image. Build from the repository root (make prod-build, or
# docker build -f .infra/prod/Dockerfile -t scam-shield:local .); the ignore list is
# Dockerfile.dockerignore next to this file (config/master.key never gets in).
# Runtime environment: MASTER_KEY (64 hex characters, opens the config/credentials.enc
# baked in, encrypted), DATABASE_URL (postgres://user:password@host:5432/scam_shield),
# PORT (3000) and HOST (0.0.0.0 here: the app binds loopback by default). Optional:
# BASE_URL (the public URL, needed for Google sign-in), LOG_LEVEL. Migrations run at start. ffmpeg is in the image.

FROM node:24-alpine AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev --no-audit --no-fund

FROM node:24-alpine
# ffmpeg turns WhatsApp voice notes (Ogg/Opus) into WAV for Muse Voice Transcribe (FFMPEG_PATH, ffmpeg on PATH by default).
RUN apk add --no-cache ffmpeg
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
# The version /api/health and Rollbar name: make prod-build passes the git sha (empty here means "dev").
ARG GIT_SHA
ENV APP_VERSION=$GIT_SHA
USER node
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=30s --retries=3 \
  CMD wget -qO- "http://127.0.0.1:${PORT}/api/health" >/dev/null || exit 1
CMD ["node", "src/server.js"]
