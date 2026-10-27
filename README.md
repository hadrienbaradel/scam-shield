# Scam Shield

**Senior-first scam protection that judges each message against the user's own life: their real orders, bank, carrier, known breaches and the people they write to.** Built for the [Meta Global AI Developer Hackathon](https://dev.meta.ai) (Oct 26 – Nov 4, 2026, Indie track, "Build for Your World"). Team: Hadrien (product) and Vlad (CTO). Product requirements: [docs/PRD.md](docs/PRD.md).

Americans 60+ reported **$7.7 billion** lost to online fraud in 2025 (FBI IC3). Gmail already blocks most phishing in bulk. What it does not do is explain, in words a frightened 74-year-old can act on at 9pm, *why* a message is dangerous and *what to do instead*, or check it against *her* life ("your parcel comes by Amazon Logistics, not Chronopost").

## What it does

- **Connects to the user's Gmail** (Google sign-in) and checks every new inbox message within seconds (Gmail push via Pub/Sub, with polling as a backup).
- **Learns a personal context from their own genuine mail**: providers and the addresses they really write from, recent orders and carriers, subscriptions, the people they write to. Data breaches can be ticked in settings, or looked up via HIBP. Every item can be seen and removed.
- **Judges with Meta's Muse Spark** (`muse-spark-1.3`, Standard mode only, so nothing trains Meta's models). A deterministic detector gathers the evidence, is the fallback when the API is unavailable, and acts as a two-way guardrail: the model can neither clear a proven scam nor condemn an authenticated sender the user knows.
- **Acts, reversibly.** Suspicious mail gets a "Scam Shield/Check first" label. Scams get "Scam Shield/Scam" and are moved out of the inbox if the user chose that. **It never sends, never trashes, never deletes**, and authenticated mail from someone the user knows is never moved. **Put it back** undoes any move and teaches the sender.
- **Ask my trusted person.** One tap shows a guardian exactly what the senior chose to share. The guardian answers *Scam / Real / I'll call you* by email link or on their dashboard, and the answer appears live on the senior's screen.
- **Checks anything else**: pasted text messages and WhatsApps, and screenshots or photos (read by Muse Spark, never stored).
- **Android companion** ([android/](android/)) screens incoming texts on the phone and sends only risky ones for a verdict.
- **Threat feed**: daily IC3 and cybermalveillance.gouv.fr alerts become *candidate* pattern cards. They can only reach "active" after human review on the admin page.
- **Live link checks** that never tip off a scammer: domain age from RDAP without visiting the link, known malware and phishing sites from abuse.ch URLhaus (host name only, set `ABUSECH_AUTH_KEY`), and redirects followed only on request or for URL shorteners, with an SSRF guard.
- Built for 60+: 19px+ type with a three-step size setting, 64px buttons, read aloud, EN/FR, one decision per screen.

## Run it locally

Needs Node 22+ and PostgreSQL 14+ (`brew install postgresql@14 && brew services start postgresql@14`).

```bash
createdb scam_shield && createdb scam_shield_test
npm install
npm run setup        # creates .env with a fresh encryption key, migrates the database
npm start            # http://localhost:3000
```

Without Google keys the app runs the public examples (`/#/demo`). To connect real Gmail, follow [docs/GOOGLE_SETUP.md](docs/GOOGLE_SETUP.md): the Google Cloud project and Pub/Sub are already set up, and the OAuth client is a 5-minute console step. To switch on Muse Spark:

```bash
node scripts/set-env.mjs META_MODEL_API_KEY=...   # from dev.meta.ai; never printed
```

Always open the app at exactly `BASE_URL` (default `http://localhost:3000`): sign-in and cookies depend on it.

| Script | What it does |
|---|---|
| `npm start` / `npm run dev` | Server plus background jobs (`dev` restarts on change) |
| `npm test` | 84 tests: engine, real-mail regression, server units, Muse Spark against a fake API, integration against Postgres |
| `npm run score` | PRD pass criteria on the seed cases (A 100%, no false Scam on C) |
| `npm run migrate` | Apply database migrations |
| `node scripts/set-env.mjs KEY=value` | Set `.env` keys without displaying the file |

## Layout

```
lib/       engine: detector, brands, context, pattern cards, verdict schema, Muse Spark layer, link inspector, threat-feed safeguards
src/       server: Fastify app, routes, Google OAuth + Gmail client, sync worker, context builder, link resolver, guardians, jobs
public/    web app (vanilla JS modules, no build), privacy and terms pages
android/   Kotlin companion app
prompts/   Muse Spark system prompt (from the PRD)
testcases/ PRD regression cases;  tests/  node:test suites;  docs/  PRD map and Google setup
```

## Privacy and safety rules in the code

- Mail bodies are never stored. The database keeps verdicts, message ids and sender domains for 90 days, plus what a senior explicitly shared with a guardian.
- Google tokens are encrypted with AES-256-GCM. Sessions, invitations, one-tap links and phone tokens are stored only as hashes.
- The Gmail client has no send, trash or delete methods, and refuses SPAM/TRASH labels.
- A one-tap email link only opens a confirmation page, so a mail scanner opening the link can't answer for the guardian. Each link works once.
- Strict CSP (no inline scripts), Origin check on every browser write, rate limits, server bound to loopback by default.
- Muse Spark runs in Standard mode only; a `-contributor` model id is refused before any request leaves.
- Delete my account: stops Gmail push, revokes Google access, erases every row.

## Status (Oct 26, 2026)

Working locally end to end on the fake-Gmail integration tests, the demo, and the Android emulator. Waiting on: the Google OAuth client (console step), the Muse Spark API key, a live Gmail run, and a Chrome extension (next). Public deployment (Railway EU) comes after Google verification planning.
