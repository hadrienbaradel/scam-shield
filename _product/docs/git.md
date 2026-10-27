Keywords: commit, branch, git, pr, merge

# Git rules

## Rhythm

- Many small, frequent commits. Each one is coherent: the spec, code, tests and docs for one change, or one logical step. Never a day's work in one commit, never half a change.
- Commit as soon as `npm test` passes for the step. A spec change ships in the same commit as its code, or in the one just before.
- Before committing, `git status` and `git diff --stat`: only the files of this change, nothing generated, nothing secret.

## Messages

One line, `Area: what changed, in plain words`, as in `git log --oneline`:

- `Engine: a phone number is never a website address`
- `Trusted contacts: a typed name is a claim, not the person`
- `Docs: status for Vlad (what is built, measured accuracy, decisions, open items)`

Area is the part of the product or repo (Engine, Sync, Guardians, Android, Spec, Docs, Tests, Security...). Say what the user or reader gets, not which files moved. A body is optional, for the why when the line cannot carry it. No `feat:`/`fix:` prefixes, no ticket numbers.

## Branches

- Work on a branch (`<name>/<topic>`, e.g. `vlad/product-first`). `main` is Hadrien's integration branch until the team decides otherwise: changes reach it through a PR or Hadrien merging, never a direct push by someone else.
- Pull `main` into the branch often; nine days leave no room for a long divergence.
- A PR says what changed for the user and names the spec rows it touches.

## Never committed

- Secrets: `.env`, `.env.*` (except `.env.example`), `.tokens.json`, `*.keystore`, `config/master.key`, downloaded Google client JSON, a key pasted in any file. Keys go through `node scripts/set-env.mjs KEY=value`.
- Real people's data: `.runtime/`, eval corpora, screenshots of a real inbox.
- `node_modules/`, build output, `.context/`.
- A secret that lands in a commit is rotated; a rewritten history does not un-leak it.

## Hackathon

The repo is submitted public. Before submission, open the GitHub URL in a logged-out (private) browser window and check that it opens, the README renders and nothing private shows. Repeat after the last commit.
