# Micro-learning (Learn tab: gamified anti-scam lessons)
Status: Planned · Raised by Vlad, 2026-10-27 · Decided by Vlad 2026-10-29 (Hadrien: object in the log) · Last updated: 2026-10-29

## Why
A verdict protects the person today; a one-minute lesson protects them next time. Companies train staff with short chat-style lessons (Elba's Sam, Riot's Albert): one idea per line, a question with buttons, a cheer, a tip. Seniors deserve the same, in plain words, funny, with the scam characters that actually reach them. On video it is a 15-second beat that shows the product teaches, not only judges.

## Behavior
1. **Learn is one tap away.** A fourth tab on the phone bar (Today, Check, Learn, My people) and a top link on a computer open the lessons; `#/demo/learn` opens them without sign-in, in the visitor's language, so the video and a judge can see them.
2. **The Learn home** shows a short welcome, the person's stars, badges and "N days in a row" (only when N ≥ 2), then the lessons as big cards: the character, the title, "1 minute", and the stars already earned (0 to 3). One tap opens a lesson; a finished lesson can be played again.
3. **A lesson is a short conversation, one step at a time.** Prudence says one to three short lines (key words in bold), then asks one question with two to four big answer buttons. A lesson has exactly three questions. No typing, no timer, nothing else required.
4. **Right or wrong, the person is never shamed.** A right answer gets a cheer, confetti and a star. A wrong answer gets a warm line ("Good instinct to stop and think. Here is the trick.") and the explanation; no penalty, no second try on the same question, and the lesson goes on.
5. **Every step can be read aloud** with the same Listen button as the verdict card, in the lesson's language; the whole lesson works by keyboard and screen reader (focus moves to each new step, the reply is announced).
6. **The lesson ends with** the stars earned (out of 3), the badge when it is the first time through, the one rule to remember in a plain sentence ("A real carrier never asks you to pay a fee by text."), "Try it on a real one" when the lesson names a demo case (opens that message as a demo card judged by the real engine), and "Next lesson" or "Back to Learn".
7. **Progress is kept.** Stars per lesson (the best score), badges, days in a row and lessons done are saved in the person's account when signed in (the existing Postgres database, one row per person) and on the device in demo mode. A day missed never removes anything: the streak quietly starts again at 1. "Delete my account" erases the progress with everything else.
8. **Lessons are YAML files** under `data/lessons/en/` and `data/lessons/fr/`, one file per lesson, the same id in both languages (format below). A broken file fails `make lessons-check` and the test suite with the file name and the problem; the app shows the lessons that load.
9. **Tone: warm and witty.** Every trick has a character the person can recognise and laugh at (Mr. Tiny Fee, the Urgency Monster, Cousin Stuck Abroad, the Bank That Forgot Your Name, Mr. Gift Card, the Pop-up That Screams). The joke is always on the scammer, never on the person. Plain words, short lines, no jargon.
10. **Nothing is ever lost or raced.** No timers, no leaderboards, no points taken away, no countdown; the person can leave in the middle and come back to the Learn home.

## Lesson file format (YAML)
```yaml
id: parcel-fee                  # [a-z0-9-], the file name, the same in en/ and fr/
title: The $1.99 parcel trap
character: Mr. Tiny Fee         # the scam character of this lesson
emoji: "📦"                     # one emoji, decorative (aria-hidden)
minutes: 1
badge: Parcel-fee spotter       # earned the first time the lesson is finished
rule: A real carrier never asks you to pay a fee by text.
demo_case: D1                   # optional: an id from testcases/cases.json whose locale matches the lesson's language
steps:
  - say:                        # 1 to 3 lines; **bold** is the only markup; lines stay under 140 characters
      - Meet **Mr. Tiny Fee**. He never asks for much. Just $1.99 to release a parcel.
      - He counts on one thought. "It is only two dollars."
  - ask: A text says your package is on hold until you pay $1.99. What do you do?
    choices:                    # 2 to 4 choices, exactly one with right: true, each with a reply
      - text: Pay it. It is only $1.99.
        reply: That is exactly what Mr. Tiny Fee hopes. The fee is bait; the page keeps your card.
      - text: Check on the carrier's own website or app.
        right: true
        reply: Yes! Your parcel is where it always was. Mr. Tiny Fee goes home empty-handed.
```
Rules checked by `lib/lessons.js` (and `make lessons-check`): the fields above are all required except `demo_case`; `steps` holds `say` and `ask` steps in any order with exactly three `ask`; each `say` has 1 to 3 lines; each `ask` has 2 to 4 choices, exactly one `right: true`, every choice a `reply`; every `en/<id>.yaml` has a `fr/<id>.yaml` and the two have the same number of steps and choices; `demo_case` must exist in `testcases/cases.json` with a locale that starts with the lesson's language.

## Gamification (what fits a 70-year-old)
- Stars: one per right answer, three per lesson; the best score is kept; confetti on each right answer, a bigger one on 3 of 3.
- Badges: one per lesson, earned the first time the lesson is finished whatever the score; shown on the Learn home with the character's emoji.
- Days in a row: counted on days with at least one lesson finished; shown only from 2 days; a gap starts again at 1, silently.
- The progress line reads "3 of 8 lessons · 7 stars · 2 days in a row".
- Left out on purpose: timers, leaderboards, levels, hearts or lives, anything that goes down.

## Demo path
After the USPS scene (video 0:57), 15 seconds: Linda taps Learn → "The $1.99 parcel trap" with Mr. Tiny Fee → one question, the right answer, confetti and a star → "Mr. Tiny Fee goes home empty-handed." → the rule. Caption: "One minute a day, built from the scams that reach her." Record at phone width with text size Largest.

## Out of scope
A lesson written by Muse from the person's own flagged message (kept as an idea), lessons sent by the trusted person, progress shared with the family, a "Learn why" button on the red card (follows once the "Checked:" chips land in `today.js`), a course, certificates, leaderboards.

## Acceptance
- `tests/lessons.test.js`: one test per Behavior line that can be tested without a browser, named after the line: the YAML loader and every validation rule (8), EN/FR twins (8), stars, badges and streak rules (7), `GET /api/lessons` in both languages (1), the shipped lessons all valid with a demo case that exists (6, 8).
- Progress in the account (7): tests in `tests/lessons.test.js` run against the test database and are skipped with a reason without Postgres, like the integration suite; account deletion leaves no progress row.
- `make lessons-check` passes on every file under `data/lessons/`; `make check` stays at or above the coverage threshold; `node scripts/docs-check.mjs` reports zero errors.
- Manual, before Built: the Learn tab and one lesson at phone width with text size Largest; keyboard-only and VoiceOver pass; a reading check by one person outside the team; the design artifact agreed before the build (`_product/docs/design.md`).

## Implementation pointers
`data/lessons/en/*.yaml`, `data/lessons/fr/*.yaml` (content); `lib/lessons.js` (load, validate, list by language; `applyLessonResult()` pure rules for stars, badges and streak); `scripts/lessons-check.mjs` (`make lessons-check`); a migration in `src/db/migrations/` (table `lesson_progress`, one JSONB row per person, removed with the account); `src/routes/lessons.js` (`GET /api/lessons?lang=`, `GET /api/learn/progress`, `PUT /api/learn/progress/:lessonId`); account deletion in `src/routes/account.js`; `public/js/views/learn.js` (the screens), `.learn-*` in `public/styles.css`, the strings in `public/js/i18n.js`, the tab and route in `public/js/main.js`.

## Open questions
- Which lesson goes into the video, and where exactly (Hadrien; the script's 0:57 beat is the proposal).
- Should Muse Spark write a fresh practice message in the lesson's family ("Try one more")? Kept as an idea until the lessons work.
- Does the senior want lessons offered after a red card, or only from the tab? The three-senior reading check can ask.
