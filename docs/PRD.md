# Scam Shield — PRD (backbone summary, Oct 26 2026)

> Superseded on 2026-10-27 by `_product/spec.md` (features, statuses, ideas) and the feature files under `_product/specs/`.
> Kept for history: it maps Hadrien's full PRD (Oct 26, 2026) to the code at the end of the first sprint; the team keeps the spec current, not this file.

Full PRD by Hadrien Baradel (Oct 26, 2026) was the starting point; this file maps it to the code in this repo as of Oct 26. Team: Hadrien (product), Vlad (CTO). Indie Developer track, theme "Build for Your World". Build Oct 26 – Nov 4, 2026; due Nov 4, 9:00 PM ET.

## Wedge

Generic checkers judge one message in isolation. Scam Shield judges it against the user's own life: their real orders, carrier, bank, known breaches, and trusted contacts. US first ($7.75B reported lost by people 60+ in 2025, FBI IC3), France as second-market proof (Bouygues breach, 6.4M customers, real IBANs reused in fake €69.90 debit notices in 2026).

## What is built in this backbone

| PRD piece | Where |
|---|---|
| Fixed verdict JSON (verdict, confidence, headline, reasons[{text,evidence}], action, real_company_says, impersonated_brand, scam_type, matched_pattern_ids, escalate_to_guardian, guardian_summary, language) | [lib/schema.js](../lib/schema.js) |
| Muse Spark system prompt, verbatim from PRD | [prompts/scam-shield-system.md](../prompts/scam-shield-system.md) |
| Tagged prompt builder + Meta Model API call (api.meta.ai, `muse-spark-1.3`, Standard mode enforced by model id) + schema check + two-way guardrail + detector fallback; screenshot transcription; pattern-card extraction | [lib/muse.js](../lib/muse.js) |
| Deterministic detector: auth, sender/link vs brand, final-redirect judging, free-hosting, domain age, breach-data, carrier/order fit, pressure/payment, hacked-contact, thread trajectory, prompt-injection as signal | [lib/detector.js](../lib/detector.js) |
| Personal context shape + learning from legit mail (real inbox: providers, orders/carriers, subscriptions, correspondents, breaches) | [lib/context.js](../lib/context.js), [src/context/builder.js](../src/context/builder.js) |
| Pattern cards + safeguards (candidate caps at be_careful, never flag real brand domains, 90-day retirement) | [lib/patterns.js](../lib/patterns.js), [lib/threatfeed.js](../lib/threatfeed.js), [data/patterns/cards.json](../data/patterns/cards.json) |
| Link inspector + live checks (RDAP domain age, on-demand redirect resolution, SSRF guard) | [lib/linkInspector.js](../lib/linkInspector.js), [src/links/resolver.js](../src/links/resolver.js) |
| Google sign-in (PKCE), gmail.modify, allow-listed Gmail client, sync worker, Scam Shield labels, move + put back, Pub/Sub push | [src/google/](../src/google), [src/sync/](../src/sync) |
| Guardian loop: invite, share preview, one-tap answer, live answer on the senior's screen | [src/guardians.js](../src/guardians.js), [src/routes/guardians.js](../src/routes/guardians.js) |
| Threat-feed job (IC3, cybermalveillance.gouv.fr) + review page | [src/jobs/threatfeed.js](../src/jobs/threatfeed.js), `#/admin` |
| Android SMS companion | [android/](../android) |
| Regression cases A/B/C/D + Linda/Françoise seed, SMS seed | [testcases/cases.json](../testcases/cases.json), [testcases/sms_seed.json](../testcases/sms_seed.json) |
| Scoring harness vs PRD pass criteria | [scripts/score.mjs](../scripts/score.mjs) (`npm run score`) |
| Senior web app (19px+ with size setting, 64px buttons, verdict card, Ask my trusted person, read-aloud FR/EN, screenshot check, what we know about you, delete account) | [public/](../public) |

## PRD pass criteria, current status

- A set (Hadrien's real cases): 100% required → **5/5 in seed form** (A1–A4 incl. A3b; A5 is the guardian loop, covered by the trusted-contact flow + B7/B2 tests).
- C set: no false Scam → **0 false Scam in seed set** (PRD's 200-mail family-inbox gate still to run).
- B set: 10/12 or better → seed covers B1, B2, B6–B12, all passing.
- D set: all passing in seed form.

Run `npm test` (146 tests) and `npm run score` (36/36 cases). Measured accuracy and open items: [STATUS.md](STATUS.md).

## Not yet built (PRD P0/P1 remaining)

- Live run on real Gmail (needs the OAuth client, docs/GOOGLE_SETUP.md) and the Muse Spark key; then the 200-legit-mail false-positive gate on real inboxes.
- Real .eml import from Françoise's Gmail (`messages.import`, redacted) replacing synthetic A-case bodies.
- Chrome extension ("Check this" in Gmail web and on pages).
- Sandboxed link screenshot service (headless browser, isolated container); today redirects and page title/forms only.
- iOS share-sheet check; voice-note check (Muse Voice Transcribe); QR/logo spotting (SAM 3.1); Muse Image for "Scam of the week"; Muse Glimmer on-device runtime in the Android pre-screen slot.
- FTC feed (no working RSS URL found yet).
- Google verification + CASA, public deployment (Railway EU), 3-senior filmed comprehension test.

## Privacy and platform constraints (from PRD)

Standard mode only (never Contributor). Demo data redacted or synthetic only; real .eml stays off the repo (organizers get a perpetual license). Gmail restricted scopes: Testing mode + test users for the hackathon; verification + CASA planned from November. Guardian sees only what the senior shares. Store verdicts and features, not mail bodies.

## Open decisions for Vlad

Stack/hosting (EU), Gmail push (Pub/Sub vs polling), link sandbox hosting, Glimmer runtime on a mid-range Android, guardian channel (web push vs WhatsApp), breach-list source for launch.
