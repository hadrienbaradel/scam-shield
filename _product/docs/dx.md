Keywords: dx, make, help, doctor, scripts, setup, install, layout, where things live, quick start, developer experience

# Developer experience: don't make me think

A new developer, a judge or an agent never reads code to get the app running or to find where something lives. The command is always `make <verb>`; the help is `make`.

## The three commands

```bash
make install   # fresh clone to ready: Node check (.nvmrc says 24, engines >= 22.9), npm ci, master key + credentials, Postgres image
make server    # the app with restart on change: on the team's shared database (the master key opens it; no jobs), else Postgres up locally
make test      # every suite; add TEST_DB_SUFFIX=<your-name> when others may be testing on the same Postgres
```

`make` alone prints every target with its one-line help, grouped (Setup, Run, Quality, Secrets, Data, Prod, Ops). The OVH host has its own: `make deploy`, `make logs`, `make prod-status`, `make prod-shell`, `make backup-now`, `make backup-pull`, `make backup-restore FILE=...`, and for the shared database `make db-prod-shell` and `make db-prod-url`, all in `scripts/prod.mjs`, reading the host from `.infra/prod/ansible/inventory.ini` (`_product/docs/ops.md`). `make server` runs on that shared database, migrated first and with no background jobs; `make server DB=dev` (and `make server` on a clone without the master key) brings the local compose Postgres up, migrates it and runs the jobs. `make doctor` says what is missing (Node, dependencies, master key and credentials by name, Docker and Postgres, the database `make server` uses, `DB=dev` for the local one, the test database, port 3000) and what to run for each; it is the first answer to "it does not work". The README quick start is these three commands and stays three commands long.

Without Google keys the app still signs you in on your own computer: the welcome buttons open `/dev/signin`, a local sign-in as anyone in the database or as a new person (on the shared database these are production's people and a new one is a dev user in production data: `_product/docs/ops.md`), `/admin/` included for an address in `ADMIN_EMAILS` (`_product/specs/developer-sign-in.md`; the real Google client: `docs/GOOGLE_SETUP.md`). Never put `make server` behind a proxy or a port forward unless `NODE_ENV=production`: the local pages trust loopback.

## Where things live

| Path | Holds |
|---|---|
| `src/` | The server: Fastify app, routes, Google OAuth and Gmail client, sync worker, context builder, link resolver, guardians, jobs, `db/` migrations and the test-database helper |
| `lib/` | The engine, no server: detector, brands, context shape, pattern cards, verdict schema, `llm/` providers, Muse prompts and guardrails, link inspector |
| `public/` | The senior web app: vanilla JS modules, no build step, strict CSP, privacy and terms pages; `public/admin/` is the operator console (`/admin/`, admins only, its own CSS and modules, nothing shared with the senior app) |
| `android/` | The Kotlin SMS companion |
| `scripts/` | Every developer command, plain Node, one file each; the `make` targets call them |
| `tests/` | `node:test` suites and `helpers/` (`_product/docs/testing.md`) |
| `config/` | `credentials.enc` (committed, encrypted), `credentials.example` (every key documented), `master.key` (never committed) |
| `.infra/` | `dev/` Docker Compose Postgres with its data in `dev/_volumes/`; `prod/` Dockerfile, compose, Ansible and the host's scripts (`_product/docs/infra.md`, `_product/docs/ops.md`) |
| `_product/` | What the code should do and how we work: spec, feature specs, competitors, research, marketing, rules (`_product/README.md`) |
| `docs/` | Google Cloud setup, and the original PRD and status notes kept for history |

## Rules

- Every new script gets a `make` target with a `## ` help line in the right `##@` group, in the same commit; a script without a target does not exist for the next person. The name is a verb or noun-verb (`db-migrate`, `secrets-set`); the help line says what it does and what it needs.
- A script prints what it did and what to run next, never a secret (`_product/docs/secrets.md`); a failure is one line naming the fix, not a stack trace.
- Defaults work on a fresh machine: no required env var, no hand-edited file; `make doctor` names anything still missing.
- When a command grows a flag or a step, its help line, this file (if the layout changes) and the README table move with it (`_product/docs/product-process.md`).
