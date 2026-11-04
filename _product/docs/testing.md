Keywords: test, tests, coverage, threshold, ratchet, score, mock llm, postgres, TEST_DB_SUFFIX, docs-check, definition of done

# Testing

Tests are `node:test` suites in `tests/*.test.js`, run one file at a time. `tests/helpers/env.js` sets a fixed environment (it pins `NODE_ENV=test` and clears `SYNC_POLL_SECONDS` too, so a shell export never changes a suite's outcome); the encrypted credentials are never loaded under `node --test`, so nothing comes from the developer's shell or keys.

## Commands

| Command | Runs |
|---|---|
| `make test` | Every suite. The integration suite skips itself when Postgres is unreachable; everything else runs anywhere. |
| `make coverage` | The same with a coverage table on screen and `coverage/lcov.info` for tools. |
| `make check` | What CI runs: `config/master.key` not tracked by git, Postgres required (no silent skip), every suite, line coverage at or above the threshold, then the README's coverage within one point of this run's. |
| `make readme-numbers` | Re-measures the numbers at the top of `README.md` (tests, coverage, seed cases, Android tests, commits, CI runs) and its badges, from a green run. |
| `make score` | The PRD pass criteria on the 41 seed cases (A set 100%, no false Scam on the C set) with the detector alone; `make score-muse` sends them through Muse Spark (paid, answers cached in `.runtime/eval/`), `make score-open` through Muse Spark Open, Meta's open weights, on Baseten (`BASETEN_API_KEY`; `_product/docs/llm.md`). |
| `node scripts/docs-check.mjs` | Spec links, statuses, `Keywords:` lines, indexes, stale advice, committed conflict markers. Part of the definition of done. |
| `make lessons-check` | Every lesson file under `data/lessons/` against the format of `_product/specs/micro-learning.md`: required fields, a story that starts and ends with a say, at most two says in a row and the character's own text at least once, 1 to 3 lines per say from the narrator, the character or you (the borrowed name under 40 characters), exactly three questions with one right answer and a tell on every other choice, texts under 140 characters, `**bold**` only, EN/FR twins that play the same (steps, speakers, right choices), demo cases that exist. Part of `make check`. |

## Coverage threshold: 94% of lines, ratcheted

`make check` fails below 94% line coverage on `lib/` and `src/` (`--test-coverage-lines` in `package.json`; raised from 84 on Oct 30 at 93.98% measured, to 94 on Nov 4 at 95.13%, to 95 the same day at 96.19% with the public database's suites). The rule is a ratchet: when coverage rises, raise the threshold to the new floor in the same commit; never lower it. A change that drops coverage adds tests, it does not touch the number.

The README's numbers are measured, not typed: `make readme-numbers` (`scripts/readme-numbers.mjs`, tested in `tests/readmeNumbers.test.js`) writes them, and `make check`, so CI, fails with "run make readme-numbers" when the README's coverage (table or badge) and the run's `coverage/lcov.info` differ by more than one point. The same code measures a few tenths apart from run to run (Nov 4: 94.64% on CI, 94.77% to 94.86% on a fresh local test database, 94.71% on a migrated one, which skips `src/db/migrate.js`'s apply path); the point of tolerance absorbs that, and a fresh `TEST_DB_SUFFIX` comes closest to CI.

## Postgres and per-agent databases

- Only `tests/integration.test.js`, `tests/admin.test.js` and `tests/dev-signin.test.js` need Postgres (`tests/security-headers.test.js` stubs the pool and runs without it) (`dbAvailable()` in `tests/helpers/db.js`); without it those suites are skipped and `make test` stays green. `make check` refuses to run without it.
- The database is `TEST_DATABASE_URL` (default `postgres://localhost/scam_shield_test`). Each run truncates it, so two runs on the same database collide. Never the shared production database: `tests/helpers/env.js` replaces any `DATABASE_URL` from the environment, and the credentials (whose `DATABASE_URL` is that database) never load under `node --test`; `tests/shared-database.test.js` proves both and wants every suite that imports `src/` to load `tests/helpers/env.js` first (or `tests/helpers/db.js`, which does).
- Several agents or terminals at once: `make test TEST_DB_SUFFIX=<your-name>` (same for `make check` and `make coverage`) runs against `scam_shield_test_<your-name>`, created on first use by the helper (`src/db/testDatabase.js`); `make db-test-clean` drops every suffixed copy and never the base database.
- `tests/lessons.test.js` also uses Postgres for the lesson-progress routes and account deletion (skipped with a reason without it); the lesson files, the rules and `GET /api/lessons` are tested without a database.
- `tests/investigate.test.js` (Look closer) uses Postgres for its signed-in route only (skipped with a reason without it); the engine, its tools (all injected) and the demo route run without one.

## Writing tests

- One test per behavior line of the feature spec (`_product/specs/<feature>.md`, section Behavior), named after the line as the user would say it: `test("a text from a phone number is never described as a website address")`, not `test("domainOf")`. A spec line without a test keeps the feature Partial.
- Where it goes: `detector.test.js` and `real-mail.test.js` for verdicts on messages (regressions from real mail stay there), `muse.test.js` for redaction, prompts and guardrails, `llm.test.js` for providers, `units.test.js` for server pieces, `integration.test.js` for anything that touches Postgres or the HTTP app (`admin.test.js` for the admin console's API, `admin-jobs.test.js` for the job health rules without a database), one file per script (`doctor`, `credentials`, `docs-check`, `session-brief`).
- The model is never called for real. `LLM_PROVIDER=mock` routes the engine to the shared mock provider: `mock.script(answer, ...)` queues answers, `mock.calls[i]` holds every request, `mock.reset()` in `afterEach`; adapters get an injected `fetchImpl` (`_product/docs/llm.md`, "The mock provider in tests").
- Nothing in a test reads `.env`, `config/master.key` or the network; fixtures are synthetic or redacted (`testcases/`), never a real inbox.

## Before a commit

`make test TEST_DB_SUFFIX=<your-name>` green, `make score` unchanged or better, `node scripts/docs-check.mjs` with zero errors, and the spec status updated (`_product/docs/product-process.md`, Definition of done).
