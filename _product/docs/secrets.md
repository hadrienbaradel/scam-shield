Keywords: secrets, credentials, master.key, env, api key, token, google client json, account, register, meta app, developer account, gitleaks, leak

# Secrets

Keys are committed, encrypted: `config/credentials.enc` holds `KEY=value` lines sealed with AES-256-GCM (one line, so diffs stay small).
`config/master.key` (32 random bytes, 64 hex characters, mode 600) opens it and is never committed; teammates pass it out of band.
`MASTER_KEY` in the environment replaces the file (CI, hosts). Entry points (`src/server.js`, `src/db/migrate.js`, the scripts) import
`lib/credentials.js` first, which copies the file into `process.env`; the npm scripts also pass `--import ./lib/credentials.js`.
`.env` is transition only: `make secrets-import` moves it in, then it is deleted. The CLI is `scripts/credentials.mjs` (`make secrets-*`).

## Commands

| Command | Does |
|---|---|
| `make secrets-init` | Creates `config/master.key` if missing (or pastes the team's, without echo) and an empty `config/credentials.enc`. |
| `make secrets-set KEY=value [KEY2=v2]` | Sets keys; alone, reads pasted `KEY=value` lines until Ctrl-D. Prints names only. |
| `make secrets-keys` | Names and `set`/`empty`, required ones marked. Never a value. |
| `make secrets-check` | Lists the required keys that are missing; exit 1 if any. |
| `make secrets-edit` | VISUAL or EDITOR (vi) on a private 0600 temp copy, re-encrypted on exit, deleted even on error. |
| `make secrets-import FILE=.env` | Merges a dotenv file (names printed), then tells you to delete it. |
| `make secrets-rotate` | New master key, file re-encrypted; share the key again, update `MASTER_KEY` where set. |
| `node scripts/credentials.mjs show [KEY]` | The values, for a human at a terminal, after a warning line. |
| `make secrets-unset KEY=NAME` | Removes keys by name (`KEY="A B"` for several; `node scripts/credentials.mjs unset` underneath). `node scripts/set-env.mjs KEY=value` still works (forwards to `set`). |
| `node scripts/import-google-client.mjs <json>` | Stores a downloaded Google OAuth client; `make doctor` reports the state by name. |

## Joining the team

A fresh clone has the encrypted file but no key. Ask a teammate for the master key through a channel that is not git, email
or a chat with history (a password manager share, Signal with disappearing messages, or in person), then `make secrets-init` and
paste it: it is saved as `config/master.key` and checked against the file. Working alone or judging? `rm config/credentials.enc`,
then `make secrets-init` makes a key and an empty file of your own (demo mode until keys are set).

## Accounts

Meta registrations by Vlad (developer account, apps, WhatsApp test numbers and tokens, hackathon forms) use `vladztools@gmail.com`,
never another address; Hadrien registers under his own account. An agent that reaches a sign-up or login form while acting for Vlad
fills that address and stops: passwords and verification codes are typed by the person, never pasted in a chat.

## What agents and scripts never do

- Print a value: `show` is for a human who asks. Reports, logs, commits and chat carry names only (`make secrets-keys`, `make doctor`).
- Commit `config/master.key` or a key pasted anywhere (`make check` fails if the key file is tracked; `.gitignore` covers it).
- Read, cat or print `.env`, `config/master.key`, or a downloaded Google client JSON.
- Set a value through a temp file left behind; use `make secrets-set`, `make secrets-import`, or `make secrets-edit`.

## Precedence

A variable set and non-empty in the real environment, or in `.env` (read by `lib/credentials.js` itself, so that `make server`'s watch mode
never watches the repo root: node's `--env-file-if-exists` makes it restart on every `.git` write), wins over the
credentials; empty or unset ones are filled from the file. That is what keeps the host's container on its compose Postgres
(compose sets `DATABASE_URL`) and `make server DB=dev` on the local one, while the credentials' `DATABASE_URL` names the
shared database (`tests/shared-database.test.js`). Tests never load the credentials (the autoload is off under `node --test`;
`tests/helpers/env.js` sets its own values). A missing `config/credentials.enc` is a no-op; a present file without a usable key stops
the process with one line naming the fix. `CREDENTIALS_FILE` and `MASTER_KEY_FILE` move the files (tests, mounted secrets).

## Scanning

gitleaks scans every push and pull request in CI (job `secrets`, false positives in `.gitleaks.toml`; `_product/docs/infra.md`, CI); once
the repo is public, secret-scanning push protection (Hadrien, admin) also refuses a push that carries a known key format. A key that
reached a commit is rotated at once (below): a red scan, a rewritten history or a deleted branch does not un-leak it.

## GitHub Actions secrets

GitHub has no master key, so a workflow cannot open `config/credentials.enc`, and no key is ever written in a workflow file: a key a workflow needs is a repository secret, set by the repository owner (Hadrien; on a personal-account repository only the owner can) in Settings → Secrets and variables → Actions, and passed to one step as `${{ secrets.NAME }}`. `META_MODEL_API_KEY` there lets the pull-request reviewer (`.github/workflows/pr-review.yml`) call Muse Spark; `GROQ_API_KEY` (or `HF_TOKEN`), optional, turns on Prompt Guard 2 for the diff. Without them the reviewer skips with a notice, and `make pr-review PR=<n>` does the same review from a laptop with the credentials. A key rotated in the credentials (below) is replaced in its secret too.

## If the master key leaks

Anyone with the key and the public repo history can read every version of `config/credentials.enc`, and history cannot be unleaked.
`make secrets-rotate` at once, send the new key, and rotate every provider key the file held: Meta Model API key, Google client
secret (Cloud Console → Clients), Resend, HIBP, abuse.ch, the WhatsApp system-user token and App Secret (Meta app dashboard),
plus `TOKEN_ENC_KEY` (users reconnect Gmail). Same if a value was committed.

## Keys (names; `config/credentials.example` documents each)

Required for the real product: `TOKEN_ENC_KEY` (`make setup` generates it), `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `META_MODEL_API_KEY`.
Optional: `ADMIN_EMAILS`, `TEST_DATABASE_URL`, `GMAIL_PUBSUB_TOPIC`, `GMAIL_PUBSUB_SUBSCRIPTION`, `META_MODEL_NAME`,
`META_MODEL_BASE_URL`, `META_MODEL_REASONING_EFFORT`, `LLM_PROVIDER`, `LLM_MODEL`, `LLM_BASE_URL, LLM_TRANSCRIBE_MODEL`, `LLM_THINKING`, `OPENAI_API_KEY`,
`ANTHROPIC_API_KEY`, `ANTHROPIC_BASE_URL`, `RESEND_API_KEY`, `MAIL_FROM`, `HIBP_API_KEY`, `ABUSECH_AUTH_KEY`, `BLUESKY_IDENTIFIER`, `BLUESKY_APP_PASSWORD`, `PUBLIC_DB_OPERATOR`, `PUBLIC_DB_CONTACT`, `PORT`, `HOST`, `BASE_URL`.
`HIBP_API_KEY` (Have I Been Pwned, Core 1, $4.39 a month) switches the breach lookup the senior asks for from XposedOrNot's free list to Have I Been Pwned's search; without it the product still looks breaches up (`_product/specs/breach-exposure.md`).
`BLUESKY_IDENTIFIER` and `BLUESKY_APP_PASSWORD` (a Bluesky account's handle and an app password from Settings → App passwords, never the account password) are declared for the scam watch's keyword search on Bluesky, which refuses unauthenticated calls; nothing reads them yet (`_product/specs/public-database.md`, line 8). `PUBLIC_DB_OPERATOR` and `PUBLIC_DB_CONTACT` (not secrets) are the operator line and the contact point shown on the public database's About page and its contest form; defaults name the team and the repository's issues page.
Shared database (`_product/docs/ops.md`): `DATABASE_URL`, the production Postgres over Tailscale (`postgres://scam_shield:<password>@100.127.78.127:5432/scam_shield`), piped from the host's `.env` into the credentials without being printed, by `make deploy` when it is missing and by `make db-prod-url`; `make server`, `make db-prod-shell` and every command that loads the credentials open it, the host's container and `make server DB=dev` override it from the environment, tests never see it. It replaced `PROD_DATABASE_URL` on Nov 1. The host's Postgres password changes with the rest if the master key leaks.
WhatsApp channel (`_product/specs/whatsapp-channel.md`; the webhook answers 501 until the first two are set): `WHATSAPP_ACCESS_TOKEN`
(a system-user token, not the 24-hour temporary one), `WHATSAPP_PHONE_NUMBER_ID`, `WHATSAPP_BUSINESS_ACCOUNT_ID`, `WHATSAPP_VERIFY_TOKEN`
(any string, pasted again in Meta's webhook configuration), `WHATSAPP_APP_SECRET` (required: every delivery is signature-checked and
refused with 403 until it is set; the startup line says so), `META_APP_ID` (the Meta app's id, not secret, read by `scripts/whatsapp-check.mjs`
for the app's webhook subscription), optional `WHATSAPP_GRAPH_VERSION` (default `v22.0`) and `FFMPEG_PATH`.

Messenger channel (`_product/specs/messenger-channel.md`; the webhook answers 501 until the first two are set): `MESSENGER_PAGE_ACCESS_TOKEN`
(a Page access token of the Prudence Page, generated in the app's Messenger settings), `MESSENGER_PAGE_ID`, `MESSENGER_VERIFY_TOKEN` (any string,
pasted again in Meta's webhook configuration), `MESSENGER_APP_SECRET` (required: every delivery is signature-checked and refused with 403
until it is set), `MESSENGER_PAGE_LINK` (the Page's m.me address shown in Settings; not secret), optional `MESSENGER_GRAPH_VERSION`
(default `v26.0`) and `MESSENGER_GROUP_MS` (how long Prudence waits after the last message of a burst before answering, default 3000).
Prompt Guard 2 (`_product/specs/prompt-guard.md`; off without a key): `GROQ_API_KEY` or `HF_TOKEN` (Inference Providers permission, its account having accepted the model's licence), optional `PROMPT_GUARD_PROVIDER` (`auto`, `groq`, `hf`, `mock`, `off`), `PROMPT_GUARD_THRESHOLD` (0.8), `PROMPT_GUARD_TIMEOUT_MS` (3000).
Observability (`_product/specs/observability.md`; nothing is sent or pinged without them): `ROLLBAR_ACCESS_TOKEN` (post_server_item; the deploy and read tokens are GitHub Actions secrets, not here), `HEARTBEAT_POLL_URL`, `HEARTBEAT_WATCH_URL`,
`HEARTBEAT_THREATFEED_URL`, `HEARTBEAT_SCAMWATCH_URL`, `HEARTBEAT_RETENTION_URL` (secrets, pinged in production only; rotate them with the rest if the master key leaks), `HEARTBEAT_BACKUP_URL` (the host's daily dump; `make deploy` copies it into the host's `.env`), optional `APP_VERSION` (the image sets the git sha) and `TRUST_PROXY` (default `false`).
