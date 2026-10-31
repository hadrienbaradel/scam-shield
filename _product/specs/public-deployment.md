# Public deployment and Google verification
Status: Partial · Last updated: 2026-10-31

## Why
Today everything runs on one laptop with up to 100 Google test users whose access expires every 7 days. Real seniors need a stable address, verified Gmail access and a privacy policy at a real domain.

## Behavior
1. Prudence runs on Vlad's OVH dedicated server, and reaches the internet at https://heyprudence.com through a Cloudflare Tunnel once its token is set (no inbound port for the app); the guardian's email links and the phone app point to it. Until then it answers only on the host itself.
2. `make deploy` from a laptop ships the laptop's committed HEAD and is done only when the server's health check names that commit with the database up; a deploy never shows a secret, and the server's database password is made on the server at the first deploy and never changes after.
3. The server takes keys only for SSH, no root login, a firewall that lets in only SSH and the team's private network (Tailscale), bans an address after 5 failed logins in 10 minutes, installs security updates daily without rebooting, and runs without swap.
4. The production database is shared with the team over Tailscale only (never on the public internet): `make server DB=prod` runs a laptop's app on it without background jobs, `make db-prod-shell` opens it; daily work and tests stay on each laptop's own database.
5. The production database is dumped every day at 03:00 server time and the last 30 dumps are kept; `make backup-pull` copies the latest one to a laptop, and a failed dump pings the backup heartbeat's failure address when one is set.
6. Google has verified the app for the restricted gmail.modify scope (demo video of the consent flow, privacy policy, homepage), and a yearly CASA security assessment is passed; sign-ins no longer expire after 7 days and the "unverified app" warning disappears.
7. Guardian emails are delivered by a real provider (Resend) from a real sender address.
8. Instant checks use the existing Pub/Sub topic with a pull subscription (no public webhook needed).

## Demo path
The video shows the app at https://heyprudence.com on a real phone (Thomas's one-tap link, 1:15-1:47); the server itself is never on screen.

## Out of scope
Google verification and CASA before the hackathon deadline; multi-region; a second server or a managed database; incremental backups (decision: full daily dumps, the database is a few megabytes and a dump restores in one step; `_product/docs/ops.md`); paid plans; app stores.

## Acceptance
- Lines 1 to 5, checked on the host on Oct 31: `make deploy` passed end to end, `/api/health` on the host answers `{"ok":true,"db":"ok","version":"<deployed sha>"}`; `swapon --show` empty; ufw active with 22/tcp and `tailscale0` only; fail2ban's sshd jail counts failed logins; sshd says `permitrootlogin no`, `passwordauthentication no`, `x11forwarding no`; Postgres and the app listen on 127.0.0.1 only; the timer's first dump `2026-10-31.dump` exists and `make backup-pull` copied it; a deploy with an invalid tunnel token fails with what to do and `TUNNEL_TOKEN=off` stops cloudflared.
- Built when: the tunnel token is set and https://heyprudence.com serves the app, Google sign-in works there (its redirect URI registered), the host is on the tailnet with Tailscale SSH checked and public SSH closed (`ssh_public=false`), `make server DB=prod` answers from a laptop, and a restore has been rehearsed once. Lines 6 and 7 stay Planned after that.
- The CI workflow runs on every push (`.github/workflows/ci.yml`, since 99c1cbf): `make check` and `make score` on Postgres, the Android debug APK with its unit tests; the APK is a downloadable artifact of each run.

## Implementation pointers
- `.infra/prod/`: `docker-compose.yml` (app, Postgres, cloudflared profile), `Dockerfile`, `ansible/playbook.yml` (the host), `scripts/backup.sh`, `scripts/status.sh`; `scripts/prod.mjs` behind the make targets; `_product/docs/ops.md` for running it.
- src/config.js (HOST, BASE_URL, TRUST_PROXY, secure cookies when https), src/notify/email.js (RESEND_API_KEY, MAIL_FROM), src/google/pubsub.js (ADC on a server), public/privacy.html, public/terms.html, docs/GOOGLE_SETUP.md.

## Open questions
- Where the server is: its address block is OVH Canada's and it answers in about 90 ms from Paris, so North America, not the EU this spec first planned; does the privacy page need to say where the data lives?
- Does the video need the deployed URL (judges score from the video), or only a public GitHub repo? The one-tap scene needs a public address either way.
- Who pays for CASA, and when?
- Single-process assumptions (in-memory SSE, caches, breaker) are fine on one box; is one box the plan for the first year?
