# Scam Shield developer commands. `make` lists them; `make setup` is the first one.
# GNU Make 3.81 (the macOS default) or newer, on macOS and Linux.
# Nothing here prints a secret: .env is read by the app and by scripts/doctor.mjs, never shown.

SHELL := /bin/bash
.DEFAULT_GOAL := help
.PHONY: help setup doctor deps dev start test coverage check score score-muse \
        db-up db-down db-destroy db-create db-migrate gate clean clean-all

NODE   ?= node
NPM    ?= npm
ENV    := --env-file-if-exists=.env
DOCTOR := $(NODE) scripts/doctor.mjs

# Postgres in Docker, for a machine without PostgreSQL (make db-up).
PG_CONTAINER ?= scam-shield-pg
PG_IMAGE     ?= postgres:16-alpine
PG_PORT      ?= 5432
PG_USER      ?= $(shell whoami)
PG_DBS       := scam_shield scam_shield_test

##@ Setup

help:
	@if [ -t 1 ]; then b=$$(tput bold); c=$$(tput setaf 6); r=$$(tput sgr0); else b=; c=; r=; fi; \
	printf "\n$${b}Scam Shield$${r}  Node $$($(NODE) --version 2>/dev/null || echo 'NOT FOUND: nvm install, or https://nodejs.org')  -  new here? run: make setup\n"; \
	awk -v b="$$b" -v c="$$c" -v r="$$r" 'BEGIN { FS = ":.*## " } \
	  /^##@ / { printf "\n%s%s%s\n", b, substr($$0, 5), r } \
	  /^[a-zA-Z0-9_-]+:.*## / { printf "  %s%-11s%s %s\n", c, $$1, r, $$2 }' $(MAKEFILE_LIST); \
	echo

setup: ## Fresh clone to running: Node check, npm ci, .env, database, next steps
	@command -v $(NODE) >/dev/null || { echo "Node is not installed: nvm install (reads .nvmrc), or https://nodejs.org"; exit 1; }
	@$(DOCTOR) node --quiet
	@$(MAKE) --no-print-directory deps
	@if $(DOCTOR) db --quiet; then \
	  $(NODE) $(ENV) scripts/setup.mjs && ($(MAKE) --no-print-directory db-create || true); \
	else \
	  echo "The database is not ready (see above): writing .env now, the migration runs when it is."; \
	  $(NODE) scripts/setup.mjs 2>/dev/null | grep -v '^Database' || true; \
	fi
	@$(DOCTOR) env --quiet || true
	@printf "\nNext:\n  make dev       start the app at http://localhost:3000 (demo mode until the Google keys are set)\n  make doctor    what is still missing\n  Google sign-in: docs/GOOGLE_SETUP.md    Muse Spark: node scripts/set-env.mjs META_MODEL_API_KEY=...\n\n"

doctor: ## What is missing: Node, dependencies, .env keys (names only), Postgres, port 3000
	@$(DOCTOR)

##@ Run

dev: deps ## Server with restart on change, at http://localhost:3000
	@$(DOCTOR) db --quiet
	@$(NPM) run dev

start: deps ## Server without the watcher (what production runs)
	@$(DOCTOR) db --quiet
	@$(NPM) start

##@ Quality

test: deps ## All tests (the integration tests skip when Postgres is down)
	@$(DOCTOR) testdb --quiet
	@$(NPM) test

coverage: deps ## Tests with coverage: table on screen, coverage/lcov.info for tools
	@$(DOCTOR) testdb --quiet
	@$(NPM) run coverage

check: deps ## What CI runs: all tests, line coverage above the threshold (needs Postgres)
	@$(NPM) run check

score: deps ## PRD pass criteria on the seed cases (detector only, no API key needed)
	@$(NPM) run score

score-muse: deps ## The same through Muse Spark (paid API; answers cached in .runtime/eval)
	@$(NODE) $(ENV) scripts/score.mjs --muse

##@ Data

db-up: ## Postgres in Docker: start or create it, create both databases, migrate
	@command -v docker >/dev/null || { echo "Docker not found: install PostgreSQL instead (README), then make db-create"; exit 1; }
	@if docker ps --format '{{.Names}}' | grep -qx '$(PG_CONTAINER)'; then \
	  echo "$(PG_CONTAINER) is already running"; \
	elif docker ps -a --format '{{.Names}}' | grep -qx '$(PG_CONTAINER)'; then \
	  docker start $(PG_CONTAINER) >/dev/null && echo "started $(PG_CONTAINER)"; \
	elif $(NODE) -e "const s=require('net').connect($(PG_PORT),'127.0.0.1');s.on('connect',()=>{s.end();process.exit(0)});s.on('error',()=>process.exit(1))" 2>/dev/null; then \
	  echo "Something already listens on port $(PG_PORT) (a local PostgreSQL?): use it with make db-create, or stop it first"; exit 1; \
	else \
	  docker run -d --name $(PG_CONTAINER) -p 127.0.0.1:$(PG_PORT):5432 \
	    -e POSTGRES_USER='$(PG_USER)' -e POSTGRES_DB=scam_shield -e POSTGRES_HOST_AUTH_METHOD=trust \
	    -v $(PG_CONTAINER)-data:/var/lib/postgresql/data $(PG_IMAGE) >/dev/null \
	    && echo "created $(PG_CONTAINER): $(PG_IMAGE) on 127.0.0.1:$(PG_PORT), superuser $(PG_USER), no password (localhost only)"; \
	fi
	@for i in $$(seq 1 30); do docker exec $(PG_CONTAINER) pg_isready -q -h localhost -U '$(PG_USER)' >/dev/null 2>&1 && break; sleep 1; done
	@$(MAKE) --no-print-directory db-create db-migrate

db-down: ## Stop the Docker Postgres (data is kept; make db-up restarts it)
	@docker stop $(PG_CONTAINER) >/dev/null && echo "stopped $(PG_CONTAINER)"

db-destroy: ## Remove the Docker Postgres and its data (both databases are lost)
	@docker rm -f $(PG_CONTAINER) >/dev/null 2>&1 || true
	@docker volume rm $(PG_CONTAINER)-data >/dev/null 2>&1 || true
	@echo "removed $(PG_CONTAINER) and its data"

db-create: ## Create the scam_shield and scam_shield_test databases (local PostgreSQL or the Docker one)
	@if docker ps --format '{{.Names}}' 2>/dev/null | grep -qx '$(PG_CONTAINER)'; then create="docker exec $(PG_CONTAINER) createdb -U $(PG_USER)"; \
	elif command -v createdb >/dev/null; then create="createdb"; \
	else echo "No createdb on PATH and no $(PG_CONTAINER) container: make db-up (Docker), or install PostgreSQL (README)"; exit 1; fi; \
	for db in $(PG_DBS); do \
	  if out=$$($$create $$db 2>&1); then echo "created database $$db"; \
	  elif echo "$$out" | grep -q 'already exists'; then echo "database $$db exists"; \
	  else echo "$$out"; exit 1; fi; \
	done

db-migrate: deps ## Apply the migrations in src/db/migrations (make dev does it at start too)
	@$(DOCTOR) db --quiet
	@$(NPM) run migrate

gate: deps ## After a live Gmail sign-in: sync, verdicts, Gmail actions, safety checks (no mail printed)
	@$(DOCTOR) db --quiet
	@$(NPM) run gate

##@ Ops

clean: ## Remove coverage output and logs (keeps node_modules, .env and the .runtime caches)
	@rm -rf coverage *.log
	@echo "removed coverage/ and logs"

clean-all: clean ## clean, plus node_modules (the next make command reinstalls)
	@rm -rf node_modules
	@echo "removed node_modules/"

# --- secrets (managed by scripts/credentials.mjs; targets added later) ---

# Dependencies: npm ci whenever package.json or the lock file changed since the last install.
deps: node_modules/.package-lock.json
	@:
node_modules/.package-lock.json: package.json $(wildcard package-lock.json)
	@echo "Installing dependencies (npm ci)..."
	@if [ -f package-lock.json ]; then $(NPM) ci --no-audit --no-fund; else $(NPM) install --no-audit --no-fund; fi
	@touch $@
