Keywords: docker, compose, infra, database, postgres, ci, github actions, deploy, prod, ansible, volumes, test database, TEST_DB_SUFFIX

# Infrastructure

One database: Postgres, the one `make server` starts. Every feature stores its data there (a table and a migration under `src/db/migrations`), including caches, queues and documents; no second datastore (MongoDB, Redis, SQLite, a cloud KV) without a decision noted in `_product/spec.md` and `docs/ARCHITECTURE.md`. Vlad, 2026-10-29.

Two commands run the project: `make install` (Node check, `npm ci`, master key and credentials, the Postgres image pulled) then
`make server` (Postgres via Docker Compose, waits for healthy, creates `scam_shield` and `scam_shield_test`, migrates, starts the
app with restart on change at http://localhost:3000). `make setup` and `make dev` are aliases of these two. `make` lists everything.

## What lives where

- `.infra/dev/docker-compose.yml`: project `scam-shield`, one `postgres:16-alpine` service, bound to `127.0.0.1:5432` (`PG_PORT`),
  trust authentication (no password: dev credentials are not secrets), superuser = your OS user name (`PG_USER`, then `USER`), so the
  default `postgres://localhost/scam_shield` works. `postgres/initdb/10-test-database.sql` creates `scam_shield_test` at first start.
- Volumes are bind mounts in the repo, ignored by git except the `.gitkeep`: `.infra/dev/_volumes/postgres` (dev data),
  `.infra/prod/_volumes/postgres` (prod data). `make db-down` keeps the data; `make db-destroy` deletes it (asks; `FORCE=1` skips).
- `make db-up` (Postgres alone), `make db-logs`, `make db-shell [DB=scam_shield_test]`, `make db-create`, `make db-migrate`.
- `.infra/prod/`: `Dockerfile` (multi-stage, `node:24-alpine`, `npm ci --omit=dev`, non-root `node`, `node src/server.js`;
  needs `MASTER_KEY`, `DATABASE_URL`, `PORT`, `HOST=0.0.0.0`), `docker-compose.yml` (app + Postgres published on 127.0.0.1 only,
  cloudflared under the `cloudflared` profile, restart policies, healthchecks, settings from the `.env` next to it that
  `make deploy` writes on the host), `docker-compose.smoke.yml` (throwaway data for `make prod-smoke`), `ansible/` (playbook,
  `ansible.cfg`, `inventory.example.ini`, README), `scripts/` (the host's daily dump and `make prod-status`).
- `make doctor` reports Docker, the compose plugin, the compose Postgres state, the data folder and the port, never a secret.

## Per-agent test databases

The integration suite truncates its database, so two suites on `scam_shield_test` at the same time collide. Every agent (and every
developer running tests while an agent does) sets a suffix: `make test TEST_DB_SUFFIX=<name>` or `TEST_DB_SUFFIX=<name> make check`.
The suite then runs on `scam_shield_test_<name>` (`<name>` lower-cased, `[a-z0-9_]`, at most 40 characters), created and migrated
on first use by `tests/helpers/db.js` through the maintenance database `postgres` with the same credentials. Unset, the suite uses
`scam_shield_test`. `make db-test-clean` drops every `scam_shield_test_<suffix>` (never the default). Resolution lives in
`src/db/testDatabase.js`; `scripts/doctor.mjs testdb` and `tests/helpers/env.js` both use it. Pick a suffix that is yours alone
(for example the branch or the task name); the same suffix twice at once collides like the default.

## CI

`.github/workflows/ci.yml` runs on every push and pull request (superseded runs are cancelled). Job `node`: Node from `.nvmrc` with
the npm cache, `npm ci`, the dev compose Postgres (`docker compose -f .infra/dev/docker-compose.yml up -d --wait`, `PG_USER=postgres`),
`make check` (master key not tracked, all tests, line coverage >= 93%), `make score`, `coverage/lcov.info` as an artifact. Job
`android`: JDK 17, Gradle cache, `./gradlew assembleDebug testDebugUnitTest`, the debug APK as an artifact. No secret is configured:
the tests set their own environment, and `make score` runs with `CREDENTIALS_FILE` pointing at a file that does not exist.
Results: https://github.com/hadrienbaradel/scam-shield/actions (the badge in the README links there).

## Production: the OVH host

Production is one OVH dedicated server, deployed by `make deploy` from a laptop (the archive of HEAD, then the Ansible playbook;
no vault, the host never clones the repository): the app and Postgres published on 127.0.0.1 only, cloudflared for
heyprudence.com once the tunnel token is set, Postgres on the tailnet through `tailscale serve`, a daily dump, ufw and fail2ban.
Deploying, the deploy-often rule, logs, backups and restore, the shared database, Tailscale and the domain: `_product/docs/ops.md`.
Locally, `make prod-build` builds the image and `make prod-smoke` runs the prod compose on port 3100 with throwaway data and no
background jobs (`WORKER=0`, so it never pings the production heartbeats with the team's credentials), curls `/api/health` and
stops it. `POSTGRES_PASSWORD`: letters and digits (the playbook generates one).

## Three common failures

- `Something already listens on 127.0.0.1:5432`: a local PostgreSQL or an old container. `brew services stop postgresql@14`
  (or `docker rm -f scam-shield-pg`), or `make server PG_PORT=5433` with `DATABASE_URL`/`TEST_DATABASE_URL` set to that port.
- `all predefined address pools have been fully subnetted` (prod compose, or any new compose network): Docker has no subnet left
  for one more project network. `docker network prune` removes the networks of stopped projects. The dev compose and the smoke
  override sit on Docker's default bridge (`network_mode: bridge`) precisely so `make server` never hits this.
- `role "<user>" does not exist` or `database "scam_shield_test" does not exist` after cloning on another account or changing
  `PG_USER`: the data folder was initialized with another superuser. `make db-create` for a missing database;
  `make db-destroy FORCE=1 && make server` recreates the folder (dev data only).
