Keywords: secrets, credentials, master.key, env, api key, token, google client json

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
| `node scripts/credentials.mjs unset KEY` | Removes a key. `node scripts/set-env.mjs KEY=value` still works (forwards to `set`). |
| `node scripts/import-google-client.mjs <json>` | Stores a downloaded Google OAuth client; `make doctor` reports the state by name. |

## Joining the team

A fresh clone has the encrypted file but no key. Ask a teammate for the master key through a channel that is not git, email
or a chat with history (a password manager share, Signal with disappearing messages, or in person), then `make secrets-init` and
paste it: it is saved as `config/master.key` and checked against the file. Working alone or judging? `rm config/credentials.enc`,
then `make secrets-init` makes a key and an empty file of your own (demo mode until keys are set).

## What agents and scripts never do

- Print a value: `show` is for a human who asks. Reports, logs, commits and chat carry names only (`make secrets-keys`, `make doctor`).
- Commit `config/master.key` or a key pasted anywhere (`make check` fails if the key file is tracked; `.gitignore` covers it).
- Read, cat or print `.env`, `config/master.key`, or a downloaded Google client JSON.
- Set a value through a temp file left behind; use `make secrets-set`, `make secrets-import`, or `make secrets-edit`.

## Precedence

A variable set and non-empty in the real environment, or in `.env` when node runs with `--env-file-if-exists=.env`, wins over the
credentials; empty or unset ones are filled from the file. Tests never load the credentials (the autoload is off under `node --test`;
`tests/helpers/env.js` sets its own values). A missing `config/credentials.enc` is a no-op; a present file without a usable key stops
the process with one line naming the fix. `CREDENTIALS_FILE` and `MASTER_KEY_FILE` move the files (tests, mounted secrets).

## If the master key leaks

Anyone with the key and the public repo history can read every version of `config/credentials.enc`, and history cannot be unleaked.
`make secrets-rotate` at once, send the new key, and rotate every provider key the file held: Meta Model API key, Google client
secret (Cloud Console → Clients), Resend, HIBP, abuse.ch, the WhatsApp system-user token and App Secret (Meta app dashboard),
plus `TOKEN_ENC_KEY` (users reconnect Gmail). Same if a value was committed.

## Keys (names; `config/credentials.example` documents each)

Required for the real product: `TOKEN_ENC_KEY` (`make setup` generates it), `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `META_MODEL_API_KEY`.
Optional: `ADMIN_EMAILS`, `DATABASE_URL`, `TEST_DATABASE_URL`, `GMAIL_PUBSUB_TOPIC`, `GMAIL_PUBSUB_SUBSCRIPTION`, `META_MODEL_NAME`,
`META_MODEL_BASE_URL`, `META_MODEL_REASONING_EFFORT`, `LLM_PROVIDER`, `LLM_MODEL`, `LLM_BASE_URL`, `LLM_THINKING`, `OPENAI_API_KEY`,
`ANTHROPIC_API_KEY`, `ANTHROPIC_BASE_URL`, `RESEND_API_KEY`, `MAIL_FROM`, `HIBP_API_KEY`, `ABUSECH_AUTH_KEY`, `PORT`, `HOST`, `BASE_URL`.
WhatsApp channel (`_product/specs/whatsapp-channel.md`; the webhook answers 501 until the first two are set): `WHATSAPP_ACCESS_TOKEN`
(a system-user token, not the 24-hour temporary one), `WHATSAPP_PHONE_NUMBER_ID`, `WHATSAPP_BUSINESS_ACCOUNT_ID`, `WHATSAPP_VERIFY_TOKEN`
(any string, pasted again in Meta's webhook configuration), `WHATSAPP_APP_SECRET` (required: every delivery is signature-checked and
refused with 403 until it is set; the startup line says so), optional `WHATSAPP_GRAPH_VERSION` (default `v22.0`) and `FFMPEG_PATH`.
