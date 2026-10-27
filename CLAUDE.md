# Scam Shield

Senior-first scam protection for Gmail and SMS: each message is judged against the senior's own life (orders, bank, carrier, the people they write to) with Meta's Muse Spark through a provider-agnostic LLM layer. Node >= 22.9 ESM, Fastify, Postgres.
Entry for the Meta Global AI Developer Hackathon 2026 (Cerebral Valley, Indie track): due Wednesday Nov 4, 2026, 9:00 PM ET, judged from a 3-minute video of work built during the event (kickoff Oct 26, 12:00 PM ET); the repo goes public. Team: Hadrien (product), Vlad (CTO).
Always write in English: code, docs, commits, replies.

## Session start

A hook (`scripts/session-brief.mjs`) prints a brief: what changed since the developer's last commit, the product state, the open feasibility questions. Greet the developer by name, summarize the brief in three lines, then offer the seven options: 1) what changed, 2) discuss undiscussed ideas, 3) brainstorm, 4) implement a Planned or Partial feature, 5) marketing, pitch and video, 6) research, 7) technical feasibility. Then follow `_product/docs/product-process.md` for whatever they pick.

## How we work

Open the rule file whose keywords match what you are about to touch; each starts with a `Keywords:` line.

| When you touch... | Keywords | Read |
|---|---|---|
| A feature, an idea, a change request, research, "is it done?" | spec first, ideas lifecycle, challenge, research, definition of done | `_product/docs/product-process.md` |
| Commits, branches, PRs | small commits, push often, branch, never committed | `_product/docs/git.md` |
| Tests, coverage, the quality gate | test, coverage, threshold, ratchet, score, mock llm, TEST_DB_SUFFIX | `_product/docs/testing.md` |
| Scripts, make targets, local setup, the README quick start | make, help, doctor, scripts, layout, dx | `_product/docs/dx.md` |
| Postgres, Docker, compose, CI, deployment | infra, docker, compose, postgres, test database, ci, github actions, deploy, prod, ansible | `_product/docs/infra.md` |
| Keys, env vars, credentials | secrets, master.key, api key, token | `_product/docs/secrets.md` |
| The model layer, providers, prompts | llm, provider, model, muse, openai, anthropic, ollama | `_product/docs/llm.md` |
| A user-facing screen | ui, design, ux, screen, css, accessibility, claude design | `_product/docs/design.md` |

Product map: `_product/spec.md` (features, statuses, ideas; read it first), `_product/competitors.md`, `_product/research.md`, `_product/marketing.md`; the folder is explained in `_product/README.md`.

## Non-negotiables

- Spec before code: `_product/spec.md` and `_product/specs/<feature>.md` change before (or with) the implementation.
- Docs move with the code: a task is done when every doc it touches matches what shipped and `node scripts/docs-check.mjs` passes.
- Never read, cat or print `.env` or `config/master.key`; keys go in only through `make secrets-set KEY=value`; reports name keys, never values.
- Many agents work at the same time: touch only the files of your task, run tests with `make test TEST_DB_SUFFIX=<your-name>`, never commit, revert or reformat someone else's files.
- Meta's Muse Spark stays the default model and stays visible in the product and the demo; other providers are development fallbacks.
- Senior-first UI, designed with Claude Design before it is built (`_product/docs/design.md`): one verdict, one action, plain words.
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
