# Scam Shield

Senior-first scam protection for Gmail and SMS: each message is judged against the senior's own life (orders, bank, carrier, the people they write to) with Meta's Muse Spark through a provider-agnostic LLM layer. Node >= 22.9 ESM, Fastify, Postgres.
Entry for the Meta Global AI Developer Hackathon 2026 (Cerebral Valley, Indie track): due Wednesday Nov 4, 2026, 9:00 PM ET, judged from a 3-minute video of work built during the event (kickoff Oct 26, 12:00 PM ET); the repo goes public. Team: Hadrien (product), Vlad (CTO).
Always write in English: code, docs, commits, replies.

## Session start

A hook (`scripts/session-brief.mjs`) prints a brief: who is working on what right now and what you owe the other person (`_product/log.md`), what changed since the developer's last commit, the product state, the open feasibility questions. Greet the developer by name, summarize the brief in three lines (your In progress and To do rows first), then offer the seven options: 1) what changed, 2) discuss undiscussed ideas, 3) brainstorm, 4) implement a Planned or Partial feature, 5) marketing, pitch and video, 6) research, 7) technical feasibility. Then follow `_product/docs/product-process.md` for whatever they pick.

## How we work

Open the rule file whose keywords match what you are about to touch; each starts with a `Keywords:` line.

| When you touch... | Keywords | Read |
|---|---|---|
| A feature, an idea, a change request, research, "is it done?" | spec first, ideas lifecycle, challenge, research, definition of done | `_product/docs/product-process.md` |
| Starting a task, finishing it, handing something off, resuming after a cut session | log, claim, in progress, to do, handoff, pull --rebase | `_product/docs/product-process.md` (The team log) |
| Commits, branches, PRs, releases | small commits, push often, branch, never committed, pr review, release, tag | `_product/docs/git.md` |
| Tests, coverage, the quality gate | test, coverage, threshold, ratchet, score, mock llm, TEST_DB_SUFFIX | `_product/docs/testing.md` |
| Scripts, make targets, local setup, the README quick start | make, help, doctor, scripts, layout, dx | `_product/docs/dx.md` |
| Postgres, Docker, compose, CI, deployment | infra, docker, compose, postgres, test database, ci, github actions, deploy, prod, ansible | `_product/docs/infra.md` |
| The server, deploys, backups, logs, the prod database | deploy, server, ovh, ops, backup, tailscale, logs, cloudflared | `_product/docs/ops.md` |
| Keys, env vars, credentials | secrets, master.key, api key, token | `_product/docs/secrets.md` |
| The model layer, providers, prompts | llm, provider, model, muse, openai, anthropic, ollama | `_product/docs/llm.md` |
| A user-facing screen | ui, design, ux, screen, css, accessibility, claude design | `_product/docs/design.md` |
| Code structure, a new module in lib/ or src/, a pipeline change, a design decision | architecture, module, decision, diagram | `docs/ARCHITECTURE.md` |

Product map: `_product/spec.md` (features, statuses, ideas; read it first), `_product/log.md` (who works on what now, what each of us owes the other, what got done), `_product/competitors.md`, `_product/research.md`, `_product/marketing.md`; the folder is explained in `_product/README.md`.

## Non-negotiables

- Spec before code: `_product/spec.md` and `_product/specs/<feature>.md` change before (or with) the implementation.
- Docs move with the code: a task is done when every doc it touches matches what shipped and `node scripts/docs-check.mjs` passes.
- Never read, cat or print `.env` or `config/master.key`; keys go in only through `make secrets-set KEY=value`; reports name keys, never values.
- Meta registrations by Vlad (developer account, apps, WhatsApp test numbers, hackathon forms) use `vladztools@gmail.com`, never another address; Hadrien registers under his own account (`_product/docs/secrets.md`, Accounts).
- Many agents work at the same time: touch only the files of your task, run tests with `make test TEST_DB_SUFFIX=<your-name>`, never commit, revert or reformat someone else's files.
- Claim first, pull often: before the first edit, add your row under In progress in `_product/log.md` (who, since, what, which files), commit that file and push, then `git pull --rebase`; rebase again before every commit and whenever you resume. Someone else's row on the same files means a message first, not a race.
- Commit small and push every commit at once: sessions get cut (network, quotas). The log is the handoff: a finished task becomes one Done line; anything you need from the other person goes under their To do; chat does not count until it is a row.
- Meta's Muse Spark stays the default model and stays visible in the product and the demo; other providers are development fallbacks.
- Senior-first UI, designed with Claude Design before it is built (`_product/docs/design.md`): one verdict, one action, plain words.
- Every new capability ships with its Settings entry (state, one action) and its onboarding step (one question, skippable), in the spec and in the build (`_product/docs/product-process.md`, the settings and onboarding rule).
- Demo-first scope: what cannot be shown in the 3-minute video is cut or deferred.

## Skill routing

When the request matches a skill, invoke it via the Skill tool; when in doubt, invoke it.
- Product ideas, brainstorming: /office-hours
- Strategy, scope: /plan-ceo-review
- Architecture: /plan-eng-review
- Design system or plan review: /design-consultation or /plan-design-review
- Full review pipeline: /autoplan
- Bugs, errors: /investigate
- QA, testing site behavior: /qa or /qa-only
- Code review, diff check: /review
- Visual polish: /design-review
- Ship, deploy, PR: /ship or /land-and-deploy
- Save progress: /context-save
- Resume context: /context-restore
- Backlog-ready spec or issue: /spec
