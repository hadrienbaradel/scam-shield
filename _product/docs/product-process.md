Keywords: spec, feature, product, change request, research, docs, definition of done, log, claim, in progress, to do, handoff, pull --rebase
# Product process: spec first, then code

`_product/spec.md` is the product's source of truth. When the implementation changes, the spec changes too, ideally first. A task is not done until the docs match the code.

## The loop

Every request to build or change something goes through these steps, in this order:

1. **Think.** Restate the request in one line; list what it touches (spec rows, code, docs, demo).
2. **Research** when it helps: a small look at what others do, saved as `_product/research/<topic>.md` and listed in `_product/research.md`. Skip when the answer is obvious.
3. **Challenge** the requester in the reply, before building: concerns, alternatives, one recommendation. Short; then act on the decision.
4. **Spec.** Update `_product/spec.md` and `_product/specs/<feature>.md` so they describe the new behavior.
5. **Code** to the spec. If the code forces a different behavior, go back to step 4.
6. **Tests** for the behavior the spec promises (see `_product/docs/testing.md`).
7. **Docs.** Move every doc the change touches (table below); set the feature's status.
8. **Commit** small and coherent (see `_product/docs/git.md`).

Demo first: the hackathon is judged from a 3-minute video. Every feature spec carries a "Demo path", and when scope must be cut, keep what can be shown.

## The team log

`_product/log.md` is how two people and several agent sessions (sometimes on the same computer) avoid doing the same thing twice and keep handoffs out of chat. The session brief prints your rows.

- Claim first: before the first edit, add a row under In progress (who, with the session label when several sessions run; since; what; which files), commit that one file and push, then `git pull --rebase`. Someone else's row on the same files means a message first, not a race.
- Pull often: `git pull --rebase` before every commit and whenever a session resumes. Commit small and push each commit at once; sessions get cut by the network or by usage limits, and a pushed commit is the only state that survives.
- Hand off through the log: anything one of us needs from the other goes under To do (for whom, what, who asked, since). A message in chat is not a handoff until it is a row.
- Close: when the task is done, delete the In progress row and add one Done line (date, who, what, commit); delete the To do rows it answers. Done stays short: one line per task, not per commit.
- Resume after a cut: `git status`, `git pull --rebase`, read your In progress row and the last commit, continue. The log's tables are append-mostly, so a rebase conflict there keeps both sides' rows.

## Spec writing rules

- A spec line is user-facing behavior, one sentence, checkable: "The user has a Report button in the mail; tapping it gives an immediate answer." Say what the user sees, taps and gets back, and what never happens when it matters. Not implementation prose ("a Fastify route posts to...").
- Status is Idea, Planned, Partial, Built or Dropped. Idea: raised, not decided, kept so nothing is lost. Planned: decided, not started. Partial: some behavior lines work. Built: in the code and tested. Dropped: decided against, reason kept.
- Every idea anyone raises (chat, PRD, status notes, code TODOs) is recorded the same day in the Ideas table of `spec.md`, then moves through the statuses. An idea is never silently deleted; it is Built or Dropped with a reason.

`spec.md` feature row:

```
| Feature | Idea/Planned/Partial/Built | one-line spec | [details](specs/<file>.md) |
```

`specs/<feature>.md`:

```
Status: Idea | Planned | Partial | Built | Dropped (date)
## Why                      one or two lines: the user problem, the demo value
## Behavior                 numbered spec lines; this is the contract tests check
## Demo path                the steps shown on video, in order, with what appears on screen
## Out of scope             what this deliberately does not do (yet)
## Acceptance               how to tell it works: test names, `npm run score` targets, manual checks
## Implementation pointers  files and entry points, one line each
## Open questions
```

`research/<topic>.md`:

```
Keywords: ...
Findings, in the shortest form that supports a decision. Claims not checked at the source end with "(unverified)".
## Sources                  URL + accessed date
```

## Progressive disclosure

- `spec.md` stays short: one table row per feature with a one-line spec and a link. Details live in `specs/<feature>.md`.
- When a feature's details outgrow one line, they move to their own file. When a spec file passes about 80 lines, split it (sub-features, or a `specs/<feature>/` folder with an index).
- The same pattern holds for `competitors.md` → `competitors/`, `research.md` → `research/`, `marketing.md` → `marketing/`: the index holds one line per entry and a link.
- `CLAUDE.md` stays short and points to `_product/docs/*.md` rule files. Each rule file starts with a `Keywords:` line so an agent knows when to open it.

## Which doc moves with which change

| Change | Update |
|---|---|
| Code behavior (what the user sees or gets) | `specs/<feature>.md` + the status in `spec.md` |
| A new idea, from anyone, in any channel | a row in the Ideas table of `spec.md`; a `specs/` file once it has more than one line of detail |
| New env var or key | `_product/docs/secrets.md` + `config/credentials.example` (+ `REQUIRED_KEYS` in `lib/credentialStore.js` when the product cannot run without it) |
| New make target or script | Makefile help comment (no Makefile yet: the README script table) + `_product/docs/dx.md` |
| New LLM provider or model | `_product/docs/llm.md` |
| New research | `research/<topic>.md` + a line in `research.md` |
| New competitor | `competitors/<name>.md` + a line in `competitors.md` |
| Demo change | `marketing/demo-plan.md` + the feature's Demo path |
| A new rule or process | `_product/docs/<rule>.md` + a pointer in `CLAUDE.md` |
| A task started or finished, or something you need from the other person | a row in `_product/log.md`: In progress, Done, To do |

## Definition of done

- [ ] The requester saw concerns, alternatives and a recommendation before the build.
- [ ] `spec.md` row and `specs/<feature>.md` describe the behavior as shipped; status correct; Demo path current.
- [ ] Code matches the spec; `npm test` passes; each spec line that can be tested has a test.
- [ ] Every doc in the table above that the change touches is updated.
- [ ] Ideas raised during the work sit in the Ideas table of `spec.md` with status Idea, not lost in chat.
- [ ] No secret, token or `.env` content in the diff.
- [ ] Committed in small, coherent steps with messages in the repo style.
- [ ] `_product/log.md`: your In progress row replaced by one Done line; every ask for the other person under To do.
