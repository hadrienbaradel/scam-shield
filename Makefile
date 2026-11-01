# Scam Shield developer commands. `make` lists them; `make install` then `make server` is the whole story.
# GNU Make 3.81 (the macOS default) or newer, on macOS and Linux.
# Nothing here prints a secret: keys live encrypted in config/credentials.enc (make secrets-keys
# shows names only); config/master.key opens it and is never committed (_product/docs/secrets.md).
# Infrastructure lives in .infra/: dev/docker-compose.yml (Postgres, data in dev/_volumes/postgres)
# and prod/ (Dockerfile, compose, Ansible). _product/docs/infra.md explains it.

SHELL := /bin/bash
.DEFAULT_GOAL := help
.PHONY: help install setup doctor deps server dev start test coverage check score score-muse \
        db-up db-down db-destroy db-create db-migrate db-logs db-shell db-test-clean gate \
        prod-build prod-smoke deploy logs prod-status prod-shell backup-now backup-pull backup-restore db-prod-shell db-prod-url \
        clean clean-all \
        secrets-init secrets-set secrets-unset secrets-edit secrets-keys secrets-check secrets-import secrets-rotate

NODE   ?= node
NPM    ?= npm
ENV    := --env-file-if-exists=.env
DOCTOR := $(NODE) scripts/doctor.mjs
CRED   := $(NODE) scripts/credentials.mjs
FILE   ?= .env

# Postgres in Docker Compose (.infra/dev/docker-compose.yml): loopback only, trust authentication,
# superuser = your OS user name, so the default postgres://localhost/scam_shield needs no password.
COMPOSE  := docker compose -f .infra/dev/docker-compose.yml
PG_PORT  ?= 5432
PG_USER  ?= $(shell whoami)
PG_DBS   := scam_shield scam_shield_test
PG_DATA  := .infra/dev/_volumes/postgres
DB       ?= scam_shield
# Which database the app runs on (_product/docs/ops.md, The shared database). make server: the team's shared
# production database, DATABASE_URL in config/credentials.enc (over Tailscale, no jobs), or this laptop's
# Postgres when the credentials name none (no master key: a judge's clone). DB=dev: always the local one,
# DEV_DATABASE_URL. The Data targets (db-up, db-migrate, ...) and make start always work on the local one.
DEV_DATABASE_URL ?= postgres://localhost:$(PG_PORT)/scam_shield
LOCAL_DB := DATABASE_URL='$(DEV_DATABASE_URL)'
DB_ENV    = $(if $(filter dev local,$(DB)),$(LOCAL_DB))
# make test TEST_DB_SUFFIX=<name>: the suite runs on scam_shield_test_<name> (created on first use),
# so agents can run tests side by side. Exported for compose, the doctor and the tests.
TEST_DB_SUFFIX ?=
export PG_PORT PG_USER TEST_DB_SUFFIX

# Production image and compose (.infra/prod), tried locally by make prod-build and make prod-smoke;
# the OVH host (make deploy, logs, backups, the shared database) through scripts/prod.mjs, which reads
# the host from .infra/prod/ansible/inventory.ini (_product/docs/ops.md).
PROD         := $(NODE) scripts/prod.mjs
PROD_COMPOSE := docker compose -f .infra/prod/docker-compose.yml
PROD_IMAGE   ?= scam-shield:local
SMOKE_PORT   ?= 3100

##@ Setup

help:
	@if [ -t 1 ]; then b=$$(tput bold); c=$$(tput setaf 6); r=$$(tput sgr0); else b=; c=; r=; fi; \
	printf "\n$${b}Scam Shield$${r}  Node $$($(NODE) --version 2>/dev/null || echo 'NOT FOUND: nvm install, or https://nodejs.org')  -  new here? make install, then make server\n"; \
	awk -v b="$$b" -v c="$$c" -v r="$$r" 'BEGIN { FS = ":.*## " } \
	  /^##@ / { printf "\n%s%s%s\n", b, substr($$0, 5), r } \
	  /^[a-zA-Z0-9_-]+:.*## / { printf "  %s%-14s%s %s\n", c, $$1, r, $$2 }' $(MAKEFILE_LIST); \
	echo

install: ## Fresh clone to ready: Node check, npm ci, master key + credentials, Postgres image pulled; then make server
	@command -v $(NODE) >/dev/null || { echo "Node is not installed: nvm install (reads .nvmrc), or https://nodejs.org"; exit 1; }
	@$(DOCTOR) node --quiet
	@$(MAKE) --no-print-directory deps
	@if [ -z "$$MASTER_KEY" ] && [ ! -f config/master.key ]; then $(CRED) init || true; fi
	@$(NODE) $(ENV) scripts/setup.mjs --no-db || true
	@if command -v docker >/dev/null && docker info >/dev/null 2>&1; then \
	  $(COMPOSE) pull --quiet postgres && echo "Postgres image ready (.infra/dev/docker-compose.yml, data will live in $(PG_DATA))"; \
	else echo "Docker is not running or not installed (OrbStack or Docker Desktop): make server needs it, or run PostgreSQL yourself (README) then make db-create"; fi
	@$(DOCTOR) secrets --quiet || true
	@printf "\nNext:\n  make server    Postgres (Docker Compose) + migrations + the app at http://localhost:3000 (demo mode until the Google keys are set)\n  make doctor    what is still missing\n  Keys: make secrets-set META_MODEL_API_KEY=...   Google sign-in: docs/GOOGLE_SETUP.md   rules: _product/docs/secrets.md\n  Joining the team: get config/master.key from a teammate, then make secrets-init. On your own: rm config/credentials.enc, then make secrets-init.\n\n"

setup: install ## Alias of make install (older docs)

doctor: ## What is missing: Node, dependencies, master key + credentials (names only), Docker + compose Postgres, the database make server uses (DB=dev: the local one), port 3000
	@$(DB_ENV) $(DOCTOR)

##@ Run

server: deps ## The app with restart on change: on the shared production database over Tailscale (migrated first, no jobs; the local one without a master key); DB=dev: local Postgres up (compose), migrations, jobs on
	@mode=$$($(PROD) db-mode "$(DB)") || exit 1; \
	if [ "$$mode" = shared ]; then $(PROD) db-server; \
	else $(LOCAL_DB) $(MAKE) --no-print-directory db-up && $(LOCAL_DB) $(NPM) run dev; fi

dev: server ## Alias of make server

start: deps ## Server without the watcher (what production runs), on the local Postgres with jobs on; make db-up first
	@$(LOCAL_DB) $(DOCTOR) db --quiet
	@$(LOCAL_DB) $(NPM) start

##@ Quality  (make test TEST_DB_SUFFIX=<name> gives this run its own scam_shield_test_<name>)

test: deps ## All tests (the integration tests skip when Postgres is down)
	@$(DOCTOR) testdb --quiet
	@$(NPM) test

coverage: deps ## Tests with coverage: table on screen, coverage/lcov.info for tools
	@$(DOCTOR) testdb --quiet
	@$(NPM) run coverage

docs-check: ## Product docs in sync: spec links, statuses, keywords, indexes, CLAUDE.md links, stale references
	@node scripts/docs-check.mjs

lessons-check: ## Lesson files in data/lessons: the YAML format, EN/FR twins, demo cases (_product/specs/micro-learning.md)
	@node scripts/lessons-check.mjs

check: deps docs-check lessons-check ## What CI runs: docs in sync, lessons valid, master.key not in git, all tests, line coverage above the threshold (needs Postgres)
	@if git ls-files --error-unmatch config/master.key >/dev/null 2>&1; then echo "config/master.key is tracked by git: git rm --cached config/master.key, then make secrets-rotate (a committed key is leaked)"; exit 1; fi
	@$(NPM) run check

score: deps ## PRD pass criteria on the seed cases (detector only, no API key needed)
	@$(NPM) run score

score-muse: deps ## The same through Muse Spark (paid API; answers cached in .runtime/eval)
	@$(NODE) $(ENV) scripts/score.mjs --muse

##@ Secrets  (config/credentials.enc is committed, encrypted; config/master.key never is)

secrets-init: ## First time: create config/master.key (or paste the team's) and config/credentials.enc
	@$(CRED) init

secrets-set: ## make secrets-set KEY=value [KEY2=value2], or make secrets-set alone and paste KEY=value lines
	@$(CRED) set $(MAKEOVERRIDES)

secrets-unset: ## Remove keys by name: make secrets-unset KEY=NAME, or KEY="NAME1 NAME2" (names printed, never a value)
	@[ -n "$(KEY)" ] || { echo "Name the key: make secrets-unset KEY=NAME"; exit 1; }
	@$(CRED) unset $(KEY)

secrets-edit: ## Open the decrypted keys in VISUAL or EDITOR (vi by default), re-encrypt on exit
	@$(CRED) edit

secrets-keys: ## Key names and whether each is set (never a value)
	@$(CRED) keys

secrets-check: ## Required keys present? Exit 1 with the missing names if not
	@$(CRED) check

secrets-import: ## Move a dotenv file into the credentials: make secrets-import FILE=.env (then delete the file)
	@$(CRED) import $(FILE)

secrets-rotate: ## New master key, file re-encrypted; share the key again (and rotate provider keys if it leaked)
	@$(CRED) rotate

##@ Data  (Postgres from .infra/dev/docker-compose.yml, data in .infra/dev/_volumes/postgres)

db-up: ## Postgres via Docker Compose: start it (waits for healthy), create both databases, migrate
	@if command -v docker >/dev/null; then \
	  if [ -z "$$($(COMPOSE) ps -q --status running postgres 2>/dev/null)" ] \
	     && $(NODE) -e "const s=require('net').connect($(PG_PORT),'127.0.0.1');s.on('connect',()=>{s.end();process.exit(0)});s.on('error',()=>process.exit(1))" 2>/dev/null; then \
	    echo "Something already listens on 127.0.0.1:$(PG_PORT) (a local PostgreSQL? the old scam-shield-pg container?): use it with make db-create, stop it, or make server PG_PORT=5433"; exit 1; \
	  fi; \
	  $(COMPOSE) up -d --wait --quiet-pull postgres; \
	elif $(DOCTOR) db --quiet >/dev/null 2>&1; then echo "Docker not found; using the PostgreSQL already listening"; \
	else echo "Docker not found: install OrbStack or Docker Desktop (make server), or run PostgreSQL yourself (README) then make db-create"; exit 1; fi
	@$(MAKE) --no-print-directory db-create db-migrate

db-down: ## Stop and remove the compose Postgres container (the data stays in .infra/dev/_volumes/postgres)
	@$(COMPOSE) down --remove-orphans && echo "stopped; data kept in $(PG_DATA) (make db-up restarts it, make db-destroy wipes it)"

db-destroy: ## Remove the compose Postgres AND its data folder (asks first; FORCE=1 skips the question)
	@if [ "$(FORCE)" != "1" ]; then printf "Delete $(PG_DATA) (scam_shield, scam_shield_test and every agent copy)? [y/N] "; read -r a; case "$$a" in y|Y) ;; *) echo "kept"; exit 1;; esac; fi
	@$(COMPOSE) down -v --remove-orphans >/dev/null 2>&1 || true
	@rm -rf $(PG_DATA) 2>/dev/null || docker run --rm -v "$(CURDIR)/.infra/dev/_volumes:/v" postgres:16-alpine rm -rf /v/postgres
	@echo "removed the compose Postgres and $(PG_DATA)"

db-create: ## Create scam_shield and scam_shield_test if missing (the compose Postgres, or a local one via createdb)
	@if [ -n "$$($(COMPOSE) ps -q --status running postgres 2>/dev/null)" ]; then create="$(COMPOSE) exec -T postgres createdb -U $(PG_USER)"; \
	elif command -v createdb >/dev/null; then create="createdb"; \
	else echo "No Postgres: make db-up (Docker Compose), or install PostgreSQL (README) then make db-create"; exit 1; fi; \
	for db in $(PG_DBS); do \
	  if out=$$($$create $$db 2>&1); then echo "created database $$db"; \
	  elif echo "$$out" | grep -q 'already exists'; then echo "database $$db exists"; \
	  else echo "$$out"; exit 1; fi; \
	done

db-migrate: deps ## Apply the migrations in src/db/migrations to the local Postgres (DEV_DATABASE_URL; make server migrates the shared one itself)
	@$(LOCAL_DB) $(DOCTOR) db --quiet
	@$(LOCAL_DB) $(NPM) run migrate

db-logs: ## Follow the compose Postgres logs
	@$(COMPOSE) logs -f --tail=100 postgres

db-shell: ## psql on the compose Postgres: make db-shell [DB=scam_shield_test]
	@$(COMPOSE) exec postgres psql -U $(PG_USER) -d $(DB)

db-prod-shell: deps ## psql on the shared production database over Tailscale (DATABASE_URL in the credentials; psql from brew install libpq, or Docker)
	@$(PROD) db-shell

db-prod-url: deps ## Store DATABASE_URL (the shared database) in config/credentials.enc, piped from the host's .env and never shown; then commit that file
	@$(PROD) db-url

db-test-clean: deps ## Drop every scam_shield_test_<suffix> database (the agents' copies), never scam_shield_test
	@$(NPM) run --silent test:db-clean

gate: deps ## After a live Gmail sign-in: sync, verdicts, Gmail actions, safety checks (no mail printed); on the database make server uses (DB=dev: the local one)
	@$(DB_ENV) $(DOCTOR) db --quiet
	@$(DB_ENV) $(NPM) run gate

##@ Prod  (the OVH host, _product/docs/ops.md; .infra/prod: Dockerfile, compose, ansible/, the host in ansible/inventory.ini)

deploy: deps ## Ship this checkout's HEAD to the OVH host (Ansible) until /api/health names it: [TS_AUTHKEY=...] [TUNNEL_TOKEN=...]
	@$(PROD) deploy

logs: ## Follow the app's logs on the OVH host (pino JSON, over SSH; Ctrl-C stops)
	@$(PROD) logs

prod-status: ## The OVH host at a glance: deployed commit, containers, health, disk, last backup, tailnet, firewall, swap
	@$(PROD) status

prod-shell: ## SSH into the OVH host (user and address from .infra/prod/ansible/inventory.ini)
	@$(PROD) ssh

backup-now: ## Dump the production database now, on the host (/var/backups/prudence/<date>.dump)
	@$(PROD) backup-now

backup-pull: ## Copy the latest production dump into .runtime/backups/ here (the off-host copy)
	@$(PROD) backup-pull

backup-restore: deps ## Put a dump back into production (asks first): make backup-restore FILE=<date>.dump, or FILE=.runtime/backups/<date>.dump
	@$(PROD) backup-restore "$(FILE)"

prod-build: ## Build the production image here (node:24-alpine, npm ci --omit=dev, non-root, APP_VERSION = the git sha): PROD_IMAGE=scam-shield:local
	@docker build -f .infra/prod/Dockerfile --build-arg GIT_SHA=$$(git rev-parse HEAD) -t $(PROD_IMAGE) .

prod-smoke: ## Run the prod compose locally on port 3100 with throwaway data, curl /api/health, stop it (needs the master key)
	@[ -n "$$MASTER_KEY" ] || [ -f config/master.key ] || { echo "No master key: make secrets-init (or set MASTER_KEY)"; exit 1; }
	@export MASTER_KEY="$${MASTER_KEY:-$$(cat config/master.key)}" POSTGRES_PASSWORD=smoke APP_PORT=$(SMOKE_PORT) BASE_URL=http://localhost:$(SMOKE_PORT); \
	smoke="$(PROD_COMPOSE) -f .infra/prod/docker-compose.smoke.yml -p scam-shield-smoke"; status=0; \
	$$smoke up -d --build --wait || status=$$?; \
	if [ $$status -eq 0 ]; then \
	  if out=$$(curl -fsS --max-time 10 http://127.0.0.1:$(SMOKE_PORT)/api/health); then echo "GET /api/health on 127.0.0.1:$(SMOKE_PORT): $$out"; else echo "GET /api/health failed"; status=1; fi; \
	fi; \
	[ $$status -eq 0 ] || $$smoke logs --tail=40 app; \
	$$smoke down -v --remove-orphans >/dev/null 2>&1; \
	if [ $$status -eq 0 ]; then echo "prod smoke OK (stopped, throwaway data removed)"; else echo "prod smoke FAILED"; exit $$status; fi

##@ Ops

clean: ## Remove coverage output and logs (never node_modules, config/master.key, the .runtime caches or the data folders)
	@rm -rf coverage *.log
	@echo "removed coverage/ and logs"

clean-all: clean ## clean, plus node_modules (the next make command reinstalls)
	@rm -rf node_modules
	@echo "removed node_modules/"

# Dependencies: npm ci whenever package.json or the lock file changed since the last install.
deps: node_modules/.package-lock.json
	@:
node_modules/.package-lock.json: package.json $(wildcard package-lock.json)
	@echo "Installing dependencies (npm ci)..."
	@if [ -f package-lock.json ]; then $(NPM) ci --no-audit --no-fund; else $(NPM) install --no-audit --no-fund; fi
	@touch $@
