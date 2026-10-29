# Prudence

*Ask twice.* (Working title until Oct 28, 2026: Scam Shield. Code, database and repository names still say `scam-shield` until after the hackathon.)
[![CI](https://github.com/hadrienbaradel/scam-shield/actions/workflows/ci.yml/badge.svg)](https://github.com/hadrienbaradel/scam-shield/actions/workflows/ci.yml)

**Senior-first scam protection that judges each message against the user's own life: their real orders, bank, carrier, known breaches and the people they write to.** Built for the [Meta Global AI Developer Hackathon](https://dev.meta.ai) (Oct 26 – Nov 4, 2026, Indie track, "Build for Your World"). Team: Hadrien (product) and Vlad (CTO). Features and where each one stands: [_product/spec.md](_product/spec.md). The original PRD and the first status notes stay in [docs/](docs/) for history. What was built during the hackathon, with times: [docs/PROVENANCE.md](docs/PROVENANCE.md).

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

## Quick start

Needs Node 22.9+ (`.nvmrc` says 24; `nvm install` reads it) and Docker, which runs Postgres for you (details, including a local PostgreSQL already on port 5432: [_product/docs/infra.md](_product/docs/infra.md)). Three commands:

```bash
make install   # fresh clone to ready: dependencies, master key + credentials, Postgres image
make server    # Postgres up, databases, migrations, then the app at http://localhost:3000
make test      # every suite (make check adds the coverage threshold: what CI runs)
```

`make` alone lists every command with a one-line help; `make doctor` says what is missing when something does not work.

Without Google keys the app runs the public examples (`/#/demo`). To connect real Gmail, follow [docs/GOOGLE_SETUP.md](docs/GOOGLE_SETUP.md): the Google Cloud project and Pub/Sub are already set up, and the OAuth client is a 5-minute console step. To switch on Muse Spark:

```bash
make secrets-set META_MODEL_API_KEY=...   # from dev.meta.ai; stored encrypted, never printed
```

Keys live in `config/credentials.enc`, committed and encrypted; `config/master.key` opens it and is never committed (a teammate passes it out of band and `make secrets-init` pastes it; on your own, `make secrets-init` makes a fresh one). `node scripts/set-env.mjs KEY=value` is a deprecated shim that forwards to `make secrets-set`. Rules: [_product/docs/secrets.md](_product/docs/secrets.md).

Always open the app at exactly `BASE_URL` (default `http://localhost:3000`): sign-in and cookies depend on it.

| Command | What it does |
|---|---|
| `make server` / `make start` | Server plus background jobs (`server` brings Postgres up and restarts on change; `start` is what production runs) |
| `make test` / `make coverage` / `make check` | Every suite: engine, real-mail regression, server units, the model layer against fake APIs, the scripts, integration against Postgres (skipped when it is down); `check` adds the line-coverage threshold. `TEST_DB_SUFFIX=<name>` gives a run its own test database |
| `make score` / `make score-muse` | PRD pass criteria on the seed cases (A 100%, no false Scam on C); `score-muse` runs them through Muse Spark |
| `make gate` | After a live Gmail sign-in: sync, verdicts, Muse vs fallback, Gmail actions, safety checks (no email printed) |
| `node scripts/eval-corpus.mjs` / `eval-urls.mjs` | Accuracy on public corpora and phishing URL lists (data stays in `.runtime/eval/`) |
| `make db-migrate` | Apply database migrations (`make server` does it at start too) |
| `make secrets-set KEY=value` | Store a key encrypted; `make secrets-keys` lists names and whether each is set, never a value |
| `node scripts/docs-check.mjs` | Product docs in step with the code: spec links, statuses, keywords, indexes, stale advice |

## Product docs

The product side lives in [_product/](_product/README.md). [_product/spec.md](_product/spec.md) has one row per feature with its status (Idea, Planned, Partial, Built, Dropped) and an Ideas table; `_product/specs/` holds the detail per feature; next to them sit competitors, research, marketing and the rules agents and humans follow (`_product/docs/`). Spec first, then code; docs move with the code.

## Layout

```
lib/        engine: detector, brands, context, pattern cards, verdict schema, the LLM layer (lib/llm), Muse prompts and guardrails, link inspector, threat-feed safeguards
src/        server: Fastify app, routes, Google OAuth + Gmail client, sync worker, context builder, link resolver, guardians, jobs, migrations
public/     web app (vanilla JS modules, no build), privacy and terms pages
android/    Kotlin companion app
prompts/    Muse Spark system prompt (from the PRD)
scripts/    the developer commands behind the make targets (doctor, credentials, score, gate, evals, docs-check, session brief)
config/     credentials.enc (committed, encrypted), credentials.example (every key, documented), master.key (never committed)
.infra/     dev/ Docker Compose Postgres (data in .infra/dev/_volumes/); prod/ Dockerfile, compose and Ansible skeleton
_product/   spec, feature specs, competitors, research, marketing, and the rules in _product/docs/
testcases/  PRD regression cases;  tests/  node:test suites;  docs/  Google setup, original PRD and status notes
```

## Privacy and safety rules in the code

- Mail bodies are never stored. The database keeps verdicts, message ids and sender domains for 90 days, plus what a senior explicitly shared with a guardian.
- Google tokens are encrypted with AES-256-GCM. Sessions, invitations, one-tap links and phone tokens are stored only as hashes.
- The Gmail client has no send, trash or delete methods, and refuses SPAM/TRASH labels.
- A one-tap email link only opens a confirmation page, so a mail scanner opening the link can't answer for the guardian. Each link works once.
- Strict CSP (no inline scripts), Origin check on every browser write, rate limits, server bound to loopback by default.
- Muse Spark runs in Standard mode only; a `-contributor` model id is refused before any request leaves.
- Delete my account: stops Gmail push, revokes Google access, erases every row.

## Built during the hackathon

The rules count only what was built during the event. The organizers answered on Discord that building started when the kickoff ended, at 12:24 PM ET on Monday Oct 26, 2026. Every file in this repository was written after that: the first ones are from 12:54 PM ET, the first commit (the hackathon backbone) landed at 20:12 ET, and every commit since is dated after it. Built so far, with statuses in [_product/spec.md](_product/spec.md):

- Gmail connection and scanning (not yet verified on a live inbox)
- Verdict engine: rules + Muse Spark, one strict JSON verdict per message
- Life context, "What Scam Shield knows about you" (not yet verified live)
- Senior web app and verdict screen
- Reversible mail actions: label, move only with consent, Put it back (not yet verified live)
- Trusted person loop
- Check something else: pasted text, screenshot, .eml
- Android SMS companion (emulator only)
- Threat feed and pattern cards (live feeds not yet verified)
- Demo mode: the public examples for Linda (US) and Françoise (FR)
- Privacy controls and account deletion

Nothing in the repository predates the event. The full timeline, from file creation times and git history, is in [docs/PROVENANCE.md](docs/PROVENANCE.md). The video will open with the one-line statement the organizers ask for: what was pre-existing (open-source libraries, public datasets used for testing) and what was built this week (everything else).

## Status (Oct 26, 2026)

Superseded on 2026-10-27 by [_product/spec.md](_product/spec.md), which carries each feature's status, and by `_product/research/feasibility.md` for the open technical questions; kept as written.

Working locally end to end on the fake-Gmail integration tests, the demo, and the Android emulator. Waiting on: the Google OAuth client (console step), the Muse Spark API key, a live Gmail run, and a Chrome extension (next). Public deployment (Railway EU) comes after Google verification planning.
