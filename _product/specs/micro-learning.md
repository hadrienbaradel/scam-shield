# Micro-learning (Learn tab: gamified anti-scam lessons)
Status: Partial · Raised by Vlad, 2026-10-27 · Decided by Vlad 2026-10-29 (Hadrien: object in the log) · Last updated: 2026-10-29

## Why
A verdict protects the person today; a one-minute lesson protects them next time. Companies train staff with short chat-style lessons (Elba's Sam, Riot's Albert): one idea per line, a question with buttons, a cheer, a tip. Seniors deserve the same, in plain words, funny, with the scam characters that actually reach them. On video it is a 15-second beat that shows the product teaches, not only judges.

## Behavior
1. **Learn is one tap away.** A fourth tab on the phone bar (Today, Check, Learn, My people) and a top link on a computer open the lessons; `#/demo/learn` opens them without sign-in, in the visitor's language, so the video and a judge can see them.
2. **The Learn home** shows a short welcome, the person's stars, badges and "N days in a row" (only when N ≥ 2), then the lessons as big cards: the character, the title, "1 minute", and the stars already earned (0 to 3). One tap opens a lesson; a finished lesson can be played again.
3. **A lesson is a short conversation, one step at a time.** Prudence says one to three short lines (key words in bold), then asks one question with two to four big answer buttons. A lesson has exactly three questions. No typing, no timer, nothing else required.
4. **Right or wrong, the person is never shamed.** A right answer gets a cheer, confetti and a star. A wrong answer gets a warm line ("Good instinct to stop and think. Here is the trick.") and the explanation; no penalty, no second try on the same question, and the lesson goes on.
5. **Every step can be read aloud** with the same Listen button as the verdict card, in the lesson's language; the whole lesson works by keyboard and screen reader (focus moves to each new step, the reply is announced).
6. **The lesson ends with** the stars earned (out of 3), the badge when it is the first time through, the one rule to remember in a plain sentence ("Never pay a delivery fee from a link in a text."), "Try it on a real one" when the lesson names a demo case (opens that message as a demo card judged by the real engine), and "Next lesson" or "Back to Learn".
7. **Progress is kept.** Stars per lesson (the best score), badges, days in a row and lessons done are saved in the person's account when signed in (the existing Postgres database, one row per person) and on the device in demo mode. A day missed never removes anything: the streak quietly starts again at 1. "Delete my account" erases the progress with everything else.
8. **Lessons are YAML files** under `data/lessons/en/` and `data/lessons/fr/`, one file per lesson, the same id in both languages (format below). A broken file fails `make lessons-check` and the test suite with the file name and the problem; the app shows the lessons that load.
9. **Tone: warm and witty.** Every trick has a character the person can recognise and laugh at (Mr. Tiny Fee, the Urgency Monster, Cousin Stuck Abroad, the Bank That Forgot Your Name, Mr. Gift Card, the Pop-up That Screams). The joke is always on the scammer, never on the person. Plain words, short lines, no jargon.
10. **Nothing is ever lost or raced.** No timers, no leaderboards, no points taken away, no countdown; the person can leave in the middle and come back to the Learn home.

## Design (agreed 2026-10-29, Claude Design canvas: https://claude.ai/artifact/Jtbbq6m8txVZxPBdPkFSJZ, private until shared)
Nine phone frames at 390 px. Each step replaces the screen, like Today's one card at a time, so every question stands on its own; a stepper row ("Question 1 of 3" and three drawn stars) sits under the Back / Listen header; a wrong answer shows "Your answer" in a plain box and "Right answer" in green with a check, never red on the person's own choice; confetti is CSS only and skipped under reduced motion; stars are drawn, not the ★ character (the font has none and gold on white fails contrast); the Learn tab icon is an open book; in demo mode a two-tab bar (Today, Learn) appears so the video can show "Linda taps Learn". Open for Hadrien: the French "Aujourd'hui" tab label does not fit a quarter-width tab at the two larger text sizes ("Accueil"?).

## Lesson file format (YAML)
```yaml
id: parcel-fee                  # [a-z0-9-], the file name, the same in en/ and fr/
order: 1                        # position on the Learn home, 1 or more, unique in a language, equal in the two languages
title: The $1.99 parcel trap
character: Mr. Tiny Fee         # the scam character of this lesson
emoji: "📦"                     # one emoji, decorative (aria-hidden)
minutes: 1
badge: Parcel-fee spotter       # earned the first time the lesson is finished
rule: Never pay a delivery fee from a link in a text. Go to the carrier's own website or app.
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
Rules checked by `lib/lessons.js` (and `make lessons-check`): the fields above are all required except `demo_case`, and no other field is allowed (a `demo-case` typo is caught); `id` is `[a-z0-9-]` and equals the file name; `order` is a whole number of 1 or more, unique within a language and the same in the EN and FR twins, and the Learn home lists lessons by it (the parcel lesson is first, as in the video); `emoji` is exactly one emoji; `minutes` is a whole number of 1 or more; `steps` holds `say` and `ask` steps in any order with exactly three `ask`; each `say` has 1 to 3 lines; each `ask` has 2 to 4 choices, exactly one `right: true` (`right` is true or false when present), every choice a `reply`; every text (title, rule, lines, questions, choices, replies) stays under 140 characters with `**bold**` as the only markup; every `en/<id>.yaml` has a `fr/<id>.yaml` and the two have the same step kinds in the same order and the same number of choices per question (lines per `say` may differ); `demo_case` must exist in `testcases/cases.json` with a locale that starts with the lesson's language.

## Gamification (what fits a 70-year-old)
- Stars: one per right answer, three per lesson; the best score is kept; confetti on each right answer, a bigger one on 3 of 3.
- Badges: one per lesson, earned the first time the lesson is finished whatever the score; shown on the Learn home with the character's emoji.
- Days in a row: counted on days with at least one lesson finished (the person's own date, sent by the app); shown only from 2 days and while the last day is yesterday, today or later; a gap starts again at 1, silently; a result dated before the last recorded day leaves the streak alone.
- The progress line reads "3 of 8 lessons · 7 stars · 2 days in a row".
- Left out on purpose: timers, leaderboards, levels, hearts or lives, anything that goes down.

## Demo path
After the USPS scene (video 0:57), 15 seconds: Linda taps Learn → "The $1.99 parcel trap" with Mr. Tiny Fee → one question, the right answer, confetti and a star → "Mr. Tiny Fee goes home empty-handed." → the rule. Caption: "One minute a day, built from the scams that reach her." Record at phone width with text size Largest.

## Out of scope
Claiming that lessons prevent scams: independent studies find awareness training changes little on its own ([research/micro-learning.md](../research/micro-learning.md)); the verdict is the protection, the lessons explain it. A lesson written by Muse from the person's own flagged message (kept as an idea), lessons sent by the trusted person, progress shared with the family, a "Learn why" button on the red card (follows once the "Checked:" chips land in `today.js`), a course, certificates, leaderboards.

## Acceptance
- `tests/lessons.test.js`: one test per Behavior line that can be tested without a browser, named after the line: the YAML loader and every validation rule (8), EN/FR twins (8), stars, badges and streak rules (7), `GET /api/lessons` in both languages (1), the shipped lessons all valid with a demo case that exists (6, 8).
- Progress in the account (7): tests in `tests/lessons.test.js` run against the test database and are skipped with a reason without Postgres, like the integration suite; account deletion leaves no progress row.
- `make lessons-check` passes on every file under `data/lessons/`; `make check` stays at or above the coverage threshold; `node scripts/docs-check.mjs` reports zero errors.
- Manual, before Built: the Learn tab and one lesson at phone width with text size Largest; keyboard-only and VoiceOver pass; a reading check by one person outside the team; the design artifact agreed before the build (`_product/docs/design.md`).
- Where it stands (2026-10-29): 40 tests in `tests/lessons.test.js`, `make lessons-check` 0 problems on 8 lessons, line coverage 91% (threshold 84), headless-browser pass at 390 px in EN and FR at Normal and Largest (focus on every heading, dock on the measured tab bar, reduced motion, late answers dropped), design agreed. Still open before Built: the reading check with one senior outside the team, VoiceOver on a real phone, Hadrien's call on the French tab label.

## Implementation pointers
`data/lessons/en/*.yaml`, `data/lessons/fr/*.yaml` (content); `lib/lessons.js` (load, validate, list by language; `applyLessonResult()` pure rules for stars, badges and streak); `scripts/lessons-check.mjs` (`make lessons-check`); a migration in `src/db/migrations/` (table `lesson_progress`, one JSONB row per person, removed with the account); `src/routes/lessons.js` (`GET /api/lessons?lang=`, `GET /api/learn/progress?day=`, `PUT /api/learn/progress/:lessonId` with `{ stars, day }`, 30 a minute per person); account deletion needs nothing in `src/routes/account.js` (the row goes with the user, a test proves it); `public/js/views/learn.js` (the screens; `#/learn`, `#/learn/<id>`, `#/demo/learn`; demo progress under the `ss_learn_progress` key in localStorage with the rules copied from `lib/lessons.js`), `.learn-*` and the four-column tab bar in `public/styles.css`, the `learn_*` strings in `public/js/i18n.js`, the tab, the nav link and the measured tab-bar height in `public/js/main.js`, `speak()` in `public/js/ui.js`.

## Open questions
- Stars and badges: in one study people aged about 85 called points and badges "meaningless" and felt watched by scores (Altmeyer et al., 2018, in [research/micro-learning.md](../research/micro-learning.md)). Vlad kept stars, badges and the gentle streak on 2026-10-29 for the 70+ target and the video; if the reading check with seniors confirms the study, the badges become a "Rules I know" wall and the stars go quiet.
- Which lesson goes into the video, and where exactly (Hadrien; the script's 0:57 beat is the proposal).
- Should Muse Spark write a fresh practice message in the lesson's family ("Try one more")? Kept as an idea until the lessons work.
- Does the senior want lessons offered after a red card, or only from the tab? The three-senior reading check can ask.
