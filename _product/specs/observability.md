# Observability: errors, heartbeats, health
Status: Built (unverified live) · Last updated: 2026-10-30

## Why
A deployed Prudence that judges and testers use must tell us when it breaks, before they do: a crash, a job that stopped working or a dead database reaches Rollbar or a monitor, not a server log nobody reads.
The senior never sees any of this: nothing changes on their screens, and nothing of theirs leaves the server.

## Behavior
1. Errors reach Rollbar only when `ROLLBAR_ACCESS_TOKEN` (a post_server_item token) is set; without it nothing is sent, no process listener is added and the server runs as today. Each item names the environment (`NODE_ENV`, `development` when unset) and the code version (`APP_VERSION`, the git sha the image is built with, `dev` when unset). An uncaught exception is reported, then the process exits so compose restarts it instead of keeping a broken server alive; an unhandled promise rejection is reported and the server keeps running. No IP, email, username or person is attached to any item.
2. A request that ends in a 500 is reported with its route; a 4xx (not found, refused, invalid, rate limited) never is; the answer the user gets does not change.
3. Personal data never leaves the box: a reported request carries only its method and route pattern (`POST /api/messages/:id/undo-keep`), never its headers, cookies, body, query string, IP or user id; values under keys named text, snippet, subject, from, to, email, phone, mobile, code, state, refresh_token or id_token are scrubbed wherever they appear, as are `code=` and `state=` inside any text, on top of Rollbar's own list (passwords, tokens, cookies, authorization); every email address and phone number left in a message, title, trace or custom field becomes `[address]` or `[phone]` before the item is sent, and the raw copy of the error that Rollbar adds after those steps loses its message and stack.
4. A scheduled background job (Gmail poll, push renewal, threat feed, retention) is reported when it starts failing: its first failed run since it last succeeded, or since the server started; the failed runs after that are not reported again (the admin console and `job_runs` still record each one); its next successful run sends one info item, "Job poll recovered after 3 failed runs". Each job's failures group under one Rollbar item.
5. In production (`NODE_ENV=production`) a job with a heartbeat URL pings it after every run: a GET on the URL after a run that succeeded, on `<url>/fail` after one that failed (Better Stack's convention). One key per job: `HEARTBEAT_POLL_URL`, `HEARTBEAT_WATCH_URL`, `HEARTBEAT_THREATFEED_URL`, `HEARTBEAT_RETENTION_URL`. The ping never delays or fails the run (5 s at most, never awaited, errors swallowed), and the URL, a secret, is never logged. Without the URL, or outside production, nothing is pinged: the laptops load the same credentials file and would keep a dead server's heartbeat green.
6. `GET /api/health`, without sign-in, asks Postgres `SELECT 1` and answers 200 `{ "ok": true, "db": "ok", "version": "<APP_VERSION or dev>" }`, or 503 `{ "ok": false, "db": "down", "version": ... }` when the query fails, so the monitor sees a dead database and a deploy can wait for its own sha.
7. `TRUST_PROXY` sets Fastify's `trustProxy`, so that behind the tunnel the visitor's address, not the tunnel's, keys the rate limits: unset or `false` (the default) trusts no proxy (`request.ip` is the socket's address); `true` trusts the proxies on this machine or its private networks (cloudflared, a local reverse proxy), so `request.ip` is the address Cloudflare appended and never one a visitor wrote into `X-Forwarded-For`; anything else is a comma-separated list of proxy addresses, CIDRs or names (`loopback`, `uniquelocal`).

## Demo path
Nothing on the senior's screen and not in the 3-minute video: a human looks at Rollbar's items (by environment and version), Better Stack's monitor and heartbeats, and the admin console's Jobs page.

## Out of scope
Session replay, telemetry (console and network breadcrumbs), performance tracing, alerting rules (who is told, when, how), paid plans; errors in the browser (the senior app, the admin console); the Pub/Sub listener, which is not a scheduled job; the deploy marker and the after-deploy Rollbar check (the deploy job's work, `research/ops-services.md` F).

## Acceptance
- `tests/observability.test.js`, one or more tests per line: no token means no client, no listener, no call (1); the options: environment, version, capture and exit, no IP or person (1); a crash in a child process is reported, then it exits 1 (1); a 500 is reported and a 4xx is not, answers unchanged (2); the item a local Rollbar endpoint receives carries only method and route, no header, cookie, body, query or IP, scrubs the listed keys and `code=`/`state=`, masks an email and a phone number in the message, the title and the trace, and drops Rollbar's raw copy of the error (3); a job failing three times reports once and its recovery once (4); heartbeat on success, `/fail` on failure, none without a URL or outside production, a hanging heartbeat does not block the run (5); health 200 with db ok and the version, 503 when the pool rejects (6); `TRUST_PROXY` values and the rate limit keyed on the address Cloudflare appended, never on one a visitor wrote (7).
- `TEST_DB_SUFFIX=observability make check` green; `node scripts/docs-check.mjs` zero errors.
- Manual, once the account exists: `make secrets-set ROLLBAR_ACCESS_TOKEN=...`, then `node --import ./lib/credentials.js --input-type=module -e 'const m = await import("./lib/errorTracking.js"); m.initErrorTracking(); m.reportError(new Error("observability check")); await m.flushErrorTracking()'` and see the item in Rollbar (environment development, version dev); stop Postgres and `curl -i localhost:3000/api/health` answers 503.

## Implementation pointers
- `lib/errorTracking.js`: the Rollbar client (`initErrorTracking`, `reportError`, `reportJobFailing`, `reportJobRecovered`, `flushErrorTracking`), its options, `addRequestData`, the scrub list and the masking (`ADDRESS`, `PHONE`, `maskPayload`).
- `src/server.js`: `initErrorTracking()` first when run directly, the error handler reports 500s, `trustProxy` from config, a flush at shutdown.
- `src/jobs/scheduler.js`: `runJob` reports a job's change of state (`failures` per job) and calls `pingHeartbeat` (`heartbeats`: the URLs, production only, `fetch`, 5 s).
- `src/config.js`: `appVersion`, `heartbeats`, `trustProxy` (`parseTrustProxy`).
- `src/routes/account.js`: `/api/health`.
- `.infra/prod/Dockerfile` (`ARG GIT_SHA`, `ENV APP_VERSION`) and `make prod-build` (`--build-arg GIT_SHA=<HEAD>`).
- Keys: `config/credentials.example`, `_product/docs/secrets.md`, `make doctor`.

## Open questions
- Rollbar's scrubber matches a key anywhere in the item, and the item's own `body` holds the error: with `body` on the list every item arrives as `********` (checked against rollbar 4.2.0), so `body` stays off it; a reported request never carries one (line 3).
- Why `true` is not Fastify's own `true`: that takes the leftmost X-Forwarded-For entry, which a visitor writes, so every request through the tunnel could claim a fresh rate-limit bucket (and free Muse checks on the demo). A hop count is no way out: Fastify 5.12 trusts nothing for a number. Trusting only private and loopback proxies assumes cloudflared adds no entry of its own (unverified on the host).
- `make prod-smoke` runs with `NODE_ENV=production` and the team's credentials: once the heartbeat URLs are set, a smoke run's jobs ping the production heartbeats (`WORKER=0` in the smoke compose stops that); its Rollbar items say production too, with version `dev`, which a real deploy never has.
- The pg pool has no connection timeout, so against an unreachable (not refusing) database the health check waits instead of answering 503; `connectionTimeoutMillis` in `src/db/pool.js` would bound it.
- A job that flaps (fails, recovers, fails) is reported at each change: add a quiet hour per job if the Gmail poll ever does, to keep within the free 5,000 items a month.
