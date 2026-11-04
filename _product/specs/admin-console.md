# Admin console (health, background jobs, users)
Status: Built · Last updated: 2026-10-29

## Why
Two people run Prudence from one laptop during the hackathon and, soon, behind a public tunnel for the video and the judges. When Linda's inbox does not sync, nobody can tell today whether the poller died, Google refused the token, Muse Spark tripped its breaker or the feed job is the one failing: the only signals are server logs and `/api/status` for the signed-in person. The console is the operator's screen: separate from the senior app, dense, honest, read-mostly.

## Behavior
1. `/admin/` opens an operator console that is not the senior app: its own look, its own navigation (Overview, Jobs, Users, Scam reports, Outbox). Only a Google account listed in `ADMIN_EMAILS` gets in; a signed-in non-admin sees "Admins only", a visitor sees "Sign in first" with a sign-in link.
2. Overview shows one line per dependency (Postgres, Muse Spark, Google sign-in, instant checks, background worker, email, link lookups, breach lookups, voice, live updates) with a status word (OK, Warning, Failing, Off) that is never color alone, a plain detail ("4 ms; 6 migrations; pool 1 busy of 10") and the time it was checked; the page refreshes itself every 30 s and says when it last did.
3. Overview also shows the server (version, Node, started, uptime, memory, address, production or not) and today's counts: people, Gmail connected, reconnect needed, checks in the last 24 h by verdict, alerts waiting for an answer, candidate cards, outbox mail, live connections.
4. Jobs lists every piece of background work (Gmail poll, push renewal, threat feed, scam watch, retention, and the Pub/Sub listener) with what it does in one sentence, its schedule, whether it is running now, the last run (when, how long, result counts or the error line), the next due time, its health (OK, Stale, Failing, Off, Pending, Running) and a Run now button where a run makes sense; below, the last 100 runs and the recent error lines.
5. Job runs are written to the database, so the history and the health survive a server restart; runs older than 30 days are deleted by retention.
6. Health rules: a scheduled job is OK when its last run succeeded within twice its interval, Stale when it has not run in that time, Failing when the last run failed, Pending before its first run after a start, Off when the worker is off in this process; the listener is OK while listening, Failing on an error, Off when not configured. The threat feed fails when every source failed and notes each source error otherwise; the Gmail poll fails when every mailbox failed to sync and notes each failing mailbox otherwise; a run cut by a restart is closed as failed ("interrupted") at the next start, never left Running.
7. Users lists every account: email, name, language, roles (senior, guardian, admin), created, last seen, onboarded, mail mode, Gmail (connected, reconnect needed, revoked, none; a token Google can no longer refresh reads reconnect needed, never connected) with sync state and last sync, push state, counts of checks by verdict, trusted people, phones, alerts and sessions. A user's page adds what the context covers (how many emails, since when, counts per kind), the last 20 checks (time, channel, verdict, who judged, latency, action), the last 30 audit events, the trusted people and phones, and a Sync now button.
8. The console never shows a message's text, subject or sender, a verdict's headline or reasons, anything a senior shared with a guardian, or a secret value: counts, statuses, timestamps, ids and error lines only.
9. Scam reports (the threat-feed candidates) are reviewed from the console: approve, reject, edit the card, fetch now (a manual run of the Threat feed job, so it shows in Jobs and is refused while one runs); the senior app's "Scam reports" page is retired once the sessions working on `public/js/main.js` have landed. The scam watch's queue (`/api/admin/db/watch`: approve with an edited one action, reject with a reason, run now) is reviewed the same way on its own page (`public-database.md`).
10. Outbox lists the emails Prudence sent or would have sent (to, subject, channel, time), never their text: an alert's text is what the senior shared, and a local copy holds live one-tap links. Outside production the page links to the local outbox (`/dev/outbox`: this machine only, refused through a tunnel or proxy) where the test links can be clicked.
11. Nothing in the console deletes an account, a message, a verdict or a run; the only writes are Run now, Sync now and the card review.
12. The console is keyboard and screen-reader usable (landmarks, labelled buttons, visible focus, the refresh announced) and works from 360 px to a wide desktop; it is an operator tool, so the senior-first type and button sizes do not apply.

## Demo path
Not in the 3-minute video (operator tool). Available if a scene needs proof of a live backend: 5 s on Overview while Linda's inbox syncs (the poll job running, Postgres OK, Muse Spark OK).

## Out of scope
Editing or deleting users, impersonation, graphs or metric history, alerting (email or chat when a check fails), coordination across several server processes, the WhatsApp channel's status (one registry row once that channel lands), and the `ADMIN_EMAILS` comment in `config/credentials.example` (file claimed by the WhatsApp session; one line to update after).

## Acceptance
- `tests/admin.test.js` (HTTP + Postgres, skipped without it): one test per behavior line above that the API can show (access, health list, jobs list and Run now, run history persisted, users list and page, the privacy line, outbox, sync now).
- `tests/admin-jobs.test.js` (no database): the health rules of line 6 on a fake registry; retention deletes runs older than 30 days (integration).
- `make check` green, `node scripts/docs-check.mjs` zero errors, a manual pass in Chrome at `http://localhost:3000/admin/` with `ADMIN_EMAILS` set (done 2026-10-29: headless Chrome against the real server on a seeded test database, every page at 1280 and 360 px, keyboard, both themes, zero console errors; a code review and its fixes the same day).

## Implementation pointers
src/jobs/scheduler.js (JOBS registry, runJob, jobsReport, job_runs), src/db/migrations/006_job_runs.sql, src/jobs/retention.js (job_runs retention), src/admin/health.js (checks, server, counts), src/admin/users.js (queries), src/admin/console.html (shell served to admins), src/routes/admin.js (shell + /api/admin/health, jobs, users, outbox; cards unchanged), src/notify/sse.js (streamStats), public/admin/console.js, console.css, views/ (vanilla modules, no build, strict CSP).

## Open questions
- When Postgres is down the console cannot sign the admin in (the session lookup fails first), so "Postgres Failing" is only visible in the server log; a keyless status page would show it.
- Alert the admins (email) when a check is Failing for more than an hour? After the hackathon.
- On the public tunnel, is `ADMIN_EMAILS` enough, or should `/admin/` also be restricted to the LAN?
