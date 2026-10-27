# Public deployment and Google verification
Status: Planned · Last updated: 2026-10-27

## Why
Today everything runs on one laptop with up to 100 Google test users whose access expires every 7 days. Real seniors need a stable address, verified Gmail access and a privacy policy at a real domain.

## Behavior
1. Scam Shield runs at a public HTTPS address in the EU (Railway EU is the plan), with the same privacy rules; the guardian's email links and the phone app point to it.
2. Google has verified the app for the restricted gmail.modify scope (demo video of the consent flow, privacy policy, homepage), and a yearly CASA security assessment is passed; sign-ins no longer expire after 7 days and the "unverified app" warning disappears.
3. Guardian emails are delivered by a real provider (Resend) from a real sender address.
4. Instant checks use the existing Pub/Sub topic with a pull subscription (no public webhook needed).

## Out of scope
Before the hackathon deadline; multi-region; paid plans; app stores.

## Acceptance
- Not started. Blockers listed in docs/GOOGLE_SETUP.md: public domain + policy + terms, OAuth verification, CASA (weeks and budget), the organisation's publication warning and data scan before any public deploy.
- The CI workflow (server tests + score on Postgres, Android tests + debug build) exists on a local branch `ci-workflow` and is not pushed (needs a token with workflow scope).

## Implementation pointers
src/config.js (HOST, BASE_URL, secure cookies when https), src/notify/email.js (RESEND_API_KEY, MAIL_FROM), src/google/pubsub.js (ADC on a server), public/privacy.html, public/terms.html, docs/GOOGLE_SETUP.md.

## Open questions
- Does the video need a deployed URL at all (judges score from the video), or only a public GitHub repo?
- Hosting choice (Railway EU vs. a VM) and who pays for CASA?
- Single-process assumptions (in-memory SSE, caches, breaker) are fine on one box; is one box the plan for the first year?
