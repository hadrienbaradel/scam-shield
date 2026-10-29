Keywords: commit, branch, git, pr, merge, main, pull --rebase, push

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

- Since Oct 29 both of us commit on `main` in small steps (before that, `vlad/product-first` was merged by Hadrien): claim the task in `_product/log.md` first, `git pull --rebase` before every commit, push each commit at once. A branch (`<name>/<topic>`) only for work that would leave `main` broken for more than an hour; it comes back through a PR.
- `git pull --rebase` before you start, before every commit and after any cut session. The log's tables are append-mostly: a conflict there keeps both sides' rows.
- A PR says what changed for the user and names the spec rows it touches.

## Never committed

- Secrets: `.env`, `.env.*`, `.tokens.json`, `*.keystore`, `config/master.key`, downloaded Google client JSON, a key pasted in any file. Keys go into the encrypted `config/credentials.enc` through `make secrets-set KEY=value` (`_product/docs/secrets.md`).
- Real people's data: `.runtime/`, eval corpora, screenshots of a real inbox.
- `node_modules/`, build output, `.context/`.
- A secret that lands in a commit is rotated; a rewritten history does not un-leak it.

## Hackathon

The repo is submitted public. Before submission, open the GitHub URL in a logged-out (private) browser window and check that it opens, the README renders and nothing private shows. Repeat after the last commit.
