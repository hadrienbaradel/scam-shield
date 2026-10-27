# _product/

The product side of Scam Shield: what it does, for whom, why, and how we work. Code lives in `lib/`, `src/`, `public/`, `android/`; this folder decides what that code should do.

**Two rules.** Spec first, then code: `spec.md` is the source of truth and changes before (or with) the implementation.
Docs move with the code: a change is done when every doc it touches matches what shipped.

| Path | What it holds |
|---|---|
| `spec.md` | One table row per feature: status (Built / Partial / Planned), a one-line spec, a link. Read this first. |
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
| `docs/testing.md` | How behavior is tested and what must pass before a commit. (being written) |
| `docs/dx.md` | Scripts, make targets, local setup conventions. (being written) |
| `docs/secrets.md` | Env vars and keys: where they go, how they are set, never printed. (being written) |
| `docs/llm.md` | LLM providers and models, how to add or swap one. (being written) |

Progressive disclosure: an index file stays short (one line per entry), details live in the matching folder, and a file over about 80 lines is split. `CLAUDE.md` at the repo root stays short and points here.

Hackathon: Meta Global AI Developer Hackathon 2026, judged from a 3-minute video, due Nov 4, 2026. Every feature carries a demo path; scope favors what can be shown.
