# _product/

The product side of Scam Shield: what it does, for whom, why, and how we work. Code lives in `lib/`, `src/`, `public/`, `android/`; this folder decides what that code should do.

**Two rules.** Spec first, then code: `spec.md` is the source of truth and changes before (or with) the implementation.
Docs move with the code: a change is done when every doc it touches matches what shipped.

| Path | What it holds |
|---|---|
| `spec.md` | One table row per feature: status (Idea / Planned / Partial / Built / Dropped), a one-line spec, a link; an Ideas table for what is raised but not yet planned. Read this first. |
| `log.md` | The team log: In progress (who, since, what, files), To do per person (asked by, since), Done (date, who, what, commit). Claim a task here before the first edit; the session brief prints your rows. |
| `specs/<feature>.md` | The detail per feature: why, behavior lines, demo path, out of scope, acceptance, pointers, open questions. |
| `competitors.md`, `competitors/` | Who else does this: one line each in the index, one file per competitor worth more. |
| `research.md`, `research/` | What we looked up (practices, data, rules of the game): index plus one file per topic, with sources. |
| `marketing.md`, `marketing/` | Positioning, pitch, the 3-minute demo plan (`marketing/demo-plan.md`), submission material. |
| `docs/` | The rules agents and humans follow, one file each, each opening with a `Keywords:` line. |

## docs/

| File | Rules for |
|---|---|
| `docs/product-process.md` | The change loop (think → research → challenge → spec → code → tests → docs → commit), spec templates, which doc moves with which change, definition of done. |
| `docs/git.md` | Commit rhythm and messages, branches, what never gets committed, the public-repo check. |
| `docs/testing.md` | How behavior is tested: `make test` / `coverage` / `check`, the 93% line-coverage ratchet, per-agent test databases, one test per spec line, the mock model. |
| `docs/dx.md` | Don't make me think: `make` is the help, the three commands, `make doctor`, where things live, every script gets a target. |
| `docs/design.md` | Senior-first screens designed with Claude Design before they are built; the design system; accessibility checks before Built. |
| `docs/infra.md` | Postgres in Docker Compose for dev and what lives where, per-agent test databases, CI (GitHub Actions), the production skeleton (image, compose, Ansible), three common failures. |
| `docs/secrets.md` | Env vars and keys: the encrypted `config/credentials.enc`, `make secrets-*`, never printed. |
| `docs/llm.md` | LLM providers and models, how to add or swap one; the mock provider for tests. |

Progressive disclosure: an index file stays short (one line per entry), details live in the matching folder, and a file over about 80 lines is split. `CLAUDE.md` at the repo root stays short and points here.

Hackathon: Meta Global AI Developer Hackathon 2026, judged from a 3-minute video, due Nov 4, 2026. Every feature carries a demo path; scope favors what can be shown.
