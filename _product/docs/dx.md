Keywords: dx, make, help, doctor, scripts, setup, install, layout, where things live, quick start, developer experience, without keys, keyless, codespaces, devcontainer

# Developer experience: don't make me think

A new developer, a judge or an agent never reads code to get the app running or to find where something lives. The command is always `make <verb>`; the help is `make`.

## The three commands

```bash
make install   # fresh clone to ready: Node check (.nvmrc says 24, engines >= 22.9), npm ci, master key + credentials, Postgres image
make server    # the app with restart on change: on the team's shared database (the master key opens it; no jobs), else Postgres up locally
make test      # every suite; add TEST_DB_SUFFIX=<your-name> when others may be testing on the same Postgres
```

`make` alone prints every target with its one-line help, grouped (Setup, Run, Quality, Secrets, Data, Prod, Release, Ops). The OVH host has its own: `make deploy`, `make logs`, `make prod-status`, `make prod-shell`, `make backup-now`, `make backup-pull`, `make backup-restore FILE=...`, and for the shared database `make db-prod-shell` and `make db-prod-url`, all in `scripts/prod.mjs`, reading the host from `.infra/prod/ansible/inventory.ini` (`_product/docs/ops.md`). `make server` runs on that shared database, migrated first and with no background jobs; `make server DB=dev` (and `make server` on a clone without the master key) brings the local compose Postgres up, migrates it and runs the jobs. `make doctor` says what is missing (Node, dependencies, master key and credentials by name, Docker and Postgres, the database `make server` uses, `DB=dev` for the local one, the test database, port 3000) and what to run for each; it is the first answer to "it does not work". The README quick start is these three commands and stays three commands long. The numbers at the top of the README (tests, coverage, seed cases, Android tests, commits, CI runs) and its coverage, tests and seed-case badges are never typed: `make readme-numbers` (`scripts/readme-numbers.mjs`) measures them on a green run (Postgres needed; `gh` for the CI row, kept with its old date when `gh` does not answer) and rewrites the block between `<!-- numbers:start -->` and `<!-- numbers:end -->`; `make check` fails when the README's coverage drifts more than a point from the run's (`_product/docs/testing.md`).

`make release VERSION=vX.Y.Z` tags a green `main` and pushes the tag (it refuses on a malformed version, uncommitted changes, another branch, `main` behind or ahead of `origin/main`, an existing tag, or a latest CI run for HEAD that has not passed, read through `gh`); the Release workflow then publishes the GitHub release with the APK (`_product/docs/git.md`, Releases).

`make pr-review PR=<n>` has Muse Spark review a pull request through `lib/llm` (Llama Prompt Guard 2 reads the diff first when `GROQ_API_KEY` or `HF_TOKEN` is set) and posts it as one comment; `DRY=1` prints it instead. It needs `gh` signed in and the model's key from the credentials; the same script runs on every pull request in GitHub Actions (`_product/docs/git.md`).

Without Google keys the app still signs you in on your own computer: the welcome buttons open `/dev/signin`, a local sign-in as anyone in the database or as a new person (on the shared database these are production's people and a new one is a dev user in production data: `_product/docs/ops.md`), `/admin/` included for an address in `ADMIN_EMAILS` (`_product/specs/developer-sign-in.md`; the real Google client: `docs/GOOGLE_SETUP.md`). Never put `make server` behind a proxy or a port forward unless `NODE_ENV=production`: the local pages trust loopback.

## Try it without keys

A clone with no master key, no `.env` and no key at all runs the product in demo mode, and nothing waits for a key: `lib/credentials.js` says once that there is no master key and carries on (outside production), `TOKEN_ENC_KEY` and the Google keys only switch Gmail sign-in on, `META_MODEL_API_KEY` only switches Muse Spark on. With Docker running, `make server` (`PORT=3207 make server` for another port) starts the compose Postgres, migrates it and opens the app; the welcome page's "Try it with examples first" (`/#/demo`) judges the 37 seed messages against Linda's and Françoise's lives with the rules detector (the startup lines say "Muse Spark: NOT configured — detector only"), and Muse Spark takes over once `META_MODEL_API_KEY` is in the environment (a Codespaces secret, `META_MODEL_API_KEY=... make server`, or `make secrets-set` on a credentials file of your own). `make doctor` still prints FAIL for the master key and `TOKEN_ENC_KEY` there: the team needs them, the demo does not. `LLM_PROVIDER=mock` is no keyless mode: the mock answers only what a test scripts, so every live verdict would come back degraded.

One click: the README's "Open in GitHub Codespaces" badge runs the same path in the browser from `.devcontainer/devcontainer.json` (`_product/docs/infra.md`, Codespaces): `npm ci` and `make db-up` when the codespace is created, `make server` each time the editor attaches, port 3000 opened in a new tab. There `BASE_URL` defaults to the forwarded `https://<codespace>-3000.<forwarding domain>` (`defaultBaseUrl` in `src/config.js`), so the demo's own requests pass the Origin check with no setting.

## Where things live

| Path | Holds |
|---|---|
| `src/` | The server: Fastify app, routes, Google OAuth and Gmail client, sync worker, context builder, link resolver, guardians, jobs, `db/` migrations and the test-database helper |
| `lib/` | The engine, no server: detector, brands, context shape, pattern cards, verdict schema, `llm/` providers, Muse prompts and guardrails, link inspector |
| `public/` | The senior web app: vanilla JS modules, no build step, strict CSP, privacy and terms pages; `public/db/` is the public scam database site (served at `/public/`, no session, its own CSS and modules); `public/admin/` is the operator console (`/admin/`, admins only, its own CSS and modules, nothing shared with the senior app) |
| `data/` | Data shipped with the app: `lessons/` (the Learn tab), `patterns/cards.json` (the seed scam cards), `profiles/` (the demo personas), `library/` (the public scam library: `families.json`, `sources.json`, one JSON entry per file under `entries/`, written by `scripts/library-seed.mjs` and `make library-import SOURCE=uci-sms|mishra-soni LIMIT=100` (`scripts/library-import.mjs`, needs the Muse Spark key), validated by the tests) |
| `android/` | The Kotlin SMS companion |
| `scripts/` | Every developer command, plain Node, one file each; the `make` targets call them |
| `tests/` | `node:test` suites and `helpers/` (`_product/docs/testing.md`) |
| `config/` | `credentials.enc` (committed, encrypted), `credentials.example` (every key documented), `master.key` (never committed) |
| `.infra/` | `dev/` Docker Compose Postgres with its data in `dev/_volumes/`; `prod/` Dockerfile, compose, Ansible and the host's scripts (`_product/docs/infra.md`, `_product/docs/ops.md`) |
| `.devcontainer/` | GitHub Codespaces and VS Code Dev Containers: Node 24, Docker inside for the compose Postgres, the keyless demo on port 3000 (Try it without keys, above) |
| `_product/` | What the code should do and how we work: spec, feature specs, competitors, research, marketing, rules (`_product/README.md`) |
| `docs/` | Google Cloud setup, and the original PRD and status notes kept for history |

## Rules

- Every new script gets a `make` target with a `## ` help line in the right `##@` group, in the same commit; a script without a target does not exist for the next person. The name is a verb or noun-verb (`db-migrate`, `secrets-set`); the help line says what it does and what it needs.
- A script prints what it did and what to run next, never a secret (`_product/docs/secrets.md`); a failure is one line naming the fix, not a stack trace.
- Defaults work on a fresh machine: no required env var, no hand-edited file; `make doctor` names anything still missing.
- When a command grows a flag or a step, its help line, this file (if the layout changes) and the README table move with it (`_product/docs/product-process.md`).
