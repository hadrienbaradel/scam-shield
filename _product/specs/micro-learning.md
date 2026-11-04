# Micro-learning (Learn tab: gamified anti-scam lessons)
Status: Partial · Raised by Vlad, 2026-10-27 · Decided by Vlad 2026-10-29 (Hadrien: object in the log) · Lessons became stories 2026-11-04 (Vlad) · Last updated: 2026-11-04

## Why
A verdict protects the person today; a one-minute lesson protects them next time. Companies train staff with short chat-style lessons (Elba's Sam, Riot's Albert): one idea per line, a question with buttons, a cheer, a tip. Seniors deserve the same, in plain words, funny, with the scam characters that actually reach them. The first version (2026-10-29) explained the trick and then asked three questions: a lecture, then a test. Since 2026-11-04 a lesson is a story the person is inside, the shape of Duolingo's Stories and of the "Bad News" game where the player hears the manipulator think ([research/micro-learning.md](../research/micro-learning.md), "Lessons as stories"): the scammer's text lands on the screen, the person decides, the scammer reacts, and the rule is what they did, not what they were told.

## Behavior
1. **Learn is one tap away.** A third tab on the phone bar (Today, Check, Learn, Blocked since the 2026-11-04 redesign, `protection-menu.md`) and a top link on a computer open the lessons; `#/demo/learn` opens them without sign-in, in the visitor's language, so the video and a judge can see them.
2. **The Learn home** shows a short welcome, the person's stars, badges and "N days in a row" (only when N ≥ 2), then the lessons as big cards: the character, the title, "1 minute", and the stars already earned (0 to 3). One tap opens a lesson; a finished lesson can be played again.
3. **A lesson is a short story the person is inside, one screen at a time.** It opens on the scene (one line: a Tuesday morning, a phone that buzzes), then the character's message appears as a text on the screen, under the name he borrows ("USPS", "Your bank"). The narrator adds at most two short screens between questions, never a lecture. Three times the story stops on "What do you do?" with two to four big buttons; the message that provoked the question stays on the same screen, above it (a say right before an ask shares its screen), so the person never decides from memory. After each choice the character answers in his own voice (gloating when the choice helps him, deflating when it does not) and the narrator says in one plain line what gave him away. The story ends with the scammer leaving empty-handed. No typing, no timer, nothing else required.
4. **Wrong is a scene, not a verdict.** A wrong choice plays out for one screen: the character pounces (short, funny), the narrator names the tell, and a Rewind button brings the story back to the same choice with the tried answer greyed and marked "Tried". The person chooses again until the story moves on, so every lesson ends with the right moves made by the person's own hand. A right choice gets the character's defeat, a cheer, confetti and a star. Never a red mark on the person's own choice, never the word "wrong", no penalty.
5. **Every step can be read aloud** with the same Listen button as the verdict card, in the lesson's language; a bubble is read with its speaker first ("USPS says: ..."); the whole lesson works by keyboard and screen reader (focus moves to each new step, the reply is announced).
6. **The lesson ends with** the stars earned (out of 3), the badge when it is the first time through, the one rule to remember in a plain sentence ("Never pay a delivery fee from a link in a text."), "Try it on a real one" when the lesson names a demo case (opens that message as a demo card judged by the real engine), and "Next lesson" or "Back to Learn".
7. **Progress is kept.** Stars per lesson (the best score), badges, days in a row and lessons done are saved in the person's account when signed in (the existing Postgres database, one row per person) and on the device in demo mode. A day missed never removes anything: the streak quietly starts again at 1. "Delete my account" erases the progress with everything else.
8. **Lessons are YAML files** under `data/lessons/en/` and `data/lessons/fr/`, one file per lesson, the same id in both languages (format below). A broken file fails `make lessons-check` and the test suite with the file name and the problem; the app shows the lessons that load.
9. **Tone: warm and witty, and never ambiguous.** Every trick has a character the person can recognise and laugh at (Mr. Tiny Fee, the Urgency Monster, Cousin Stuck Abroad, the Bank That Forgot Your Name, Mr. Gift Card, the Pop-up That Screams). The joke is always on the scammer, never on the person. The character speaks in the first person and is plainly the villain: vain, petty, in a hurry, with one running gag per lesson (Mr. Tiny Fee's coin jar, the Urgency Monster's watch that runs fast). The narrator is literal and plain, never ironic, so a person who takes words at face value still gets the lesson. Plain words, short lines, no jargon, nothing that mocks age, memory or phones.
10. **Nothing is ever lost or raced.** No timers, no leaderboards, no points taken away, no countdown; the person can leave in the middle and come back to the Learn home.

## Design (agreed 2026-10-29, Claude Design canvas: https://claude.ai/artifact/Jtbbq6m8txVZxPBdPkFSJZ, private until shared)
Nine phone frames at 390 px. Each step replaces the screen, like Today's one card at a time, so every question stands on its own; a stepper row ("Choice 1 of 3" and three drawn stars) sits under the Back / Listen header; a wrong answer shows "Your answer" in a plain box, never red on the person's own choice (since 2026-11-04 no "Right answer" reveal: the story rewinds instead, below); confetti is CSS only and skipped under reduced motion; stars are drawn, not the ★ character (the font has none and gold on white fails contrast); the Learn tab icon is an open book; in demo mode a two-tab bar (Today, Learn) appears so the video can show "Linda taps Learn". Open for Hadrien: the French "Aujourd'hui" tab label does not fit a quarter-width tab at the two larger text sizes ("Accueil"?).
Story screens (2026-11-04): the character's text is a message bubble on the left under the name he borrows, his emoji as the avatar, the narrator's lines stay plain text, the person's own lines sit on the right; a say right before a question shares the question's screen (the message on top, the question as the heading, the buttons under it); after a choice the character's reply is a bubble under his real name and the narrator's line sits under it with a bulb; the Rewind screen has one big button ("Rewind", a ⏪ drawn arrow) and the question comes back with the tried answer greyed and marked "Tried". Built on 2026-11-04 before the canvas gained these two frames, because of the deadline; adding them to the canvas is Vlad's To do in the log.

## Lesson file format (YAML)
```yaml
id: parcel-fee                  # [a-z0-9-], the file name, the same in en/ and fr/
order: 1                        # position on the Learn home, 1 or more, unique in a language, equal in the two languages
title: The $1.99 parcel trap
character: Mr. Tiny Fee         # the scam character of this lesson; he speaks in the first person
emoji: "📦"                     # one emoji, decorative (aria-hidden); the avatar on his bubbles
minutes: 1
badge: Parcel-fee spotter       # earned the first time the lesson is finished
rule: Never pay a delivery fee from a link in a text. Go to the carrier's own website or app.
demo_case: D1                   # optional: an id from testcases/cases.json whose locale matches the lesson's language
steps:                          # the story, one step per screen; it starts and ends with a say
  - say:                        # the narrator (from: narrator is the default): 1 to 3 lines, **bold** the only markup, under 140 characters
      - Tuesday, 7:40 in the morning. Your phone buzzes.
  - from: character             # a text from the character, shown as a message bubble
    as: USPS                    # optional, only with from: character; the name he borrows, shown on the bubble
    say:                        # a line with a colon and a space in it goes in quotes, or YAML reads it as a field
      - "Your parcel is waiting at our depot. A small fee of **$1.99** is due. Pay here: usps-fee.example"
  - ask: What do you do?        # exactly three asks per lesson
    choices:                    # 2 to 4 choices, exactly one with right: true
      - text: Pay it. It is only $1.99.
        reply: Wonderful! Now just your card number, the date and the three little digits on the back. For $1.99. Promise.
        tell: A $1.99 fee that needs your whole card is not a fee. It is your card.
      - text: Open the carrier's own app and look.
        right: true
        reply: Oh no. Not the app. Nobody checks the app. Fine. FINE.
        tell: Your parcel is where it always was. Going to the carrier yourself costs nothing and proves everything.
  - from: you                   # what the person says or does, on the right of the screen
    say:
      - I will look it up myself, thank you.
  - from: character
    as: USPS
    say:
      - FINAL NOTICE. Pay **today** or your parcel goes back to the sender.
  - ask: And now?
    choices:
      - text: Tap the link, just to look.
        reply: Just a look! Come in, come in. Mind the step.
        tell: His page is built to make you type. A look is how it starts.
      - text: Use the tracking number from the shop, on the carrier's own website.
        right: true
        reply: The tracking number. From the shop. Who taught you that?
        tell: You went to them, so he gets nothing. Not even $1.99.
  - say:
      - The text says USPS. His texts always say USPS. Or FedEx. Or "Parcel Service".
  - ask: How do you know it is really USPS?
    choices:
      - text: It says USPS, so it is USPS.
        reply: It does say USPS. I typed it myself. Lovely font, no?
        tell: Anyone can type a name into a text. A name proves nothing.
      - text: I cannot tell from the text, so I ask USPS myself.
        right: true
        reply: Ask them? That is cheating. I am filing a complaint.
        tell: You cannot tell from the text, and you do not have to. You ask the carrier.
  - say:
      - Mr. Tiny Fee walks home. The coin jar stays empty.
```
Rules checked by `lib/lessons.js` (and `make lessons-check`): the fields above are all required except `demo_case`, `from`, `as` and the right choice's `tell`, and no other field is allowed (a `demo-case` typo is caught); `id` is `[a-z0-9-]` and equals the file name; `order` is a whole number of 1 or more, unique within a language and the same in the EN and FR twins, and the Learn home lists lessons by it; `emoji` is exactly one emoji; `minutes` is a whole number of 1 or more; `steps` holds `say` and `ask` steps with exactly three `ask`; the first and the last step are a `say`; never more than two `say` steps in a row, whoever speaks (no lecture); at least one `say` comes from the character (the scam is shown, not described); each `say` has 1 to 3 lines; `from` is `narrator`, `character` or `you`; `as` is allowed only with `from: character` and stays under 40 characters; each `ask` has 2 to 4 choices, exactly one `right: true` (`right` is true or false when present), every choice a `reply` in the character's voice, every choice that is not right a `tell` (the narrator's plain line), the right one optionally; every text (title, rule, lines, questions, choices, replies, tells) stays under 140 characters with `**bold**` as the only markup (a line with a colon followed by a space goes in quotes, or YAML reads it as a field; the validator says so); every `en/<id>.yaml` has a `fr/<id>.yaml` and the two have the same step kinds in the same order with the same `from` on each `say`, the same number of choices per question and the right choice at the same position, so the two languages play the same (lines per `say` may differ); `demo_case` must exist in `testcases/cases.json` with a locale that starts with the lesson's language.

## Gamification (what fits a 70-year-old)
- Stars: one per choice got right the first time, three per lesson; the best score is kept; confetti on each right choice, a bigger one on 3 of 3.
- Badges: one per lesson, earned the first time the lesson is finished whatever the score; shown on the Learn home with the character's emoji.
- Days in a row: counted on days with at least one lesson finished (the person's own date, sent by the app); shown only from 2 days and while the last day is yesterday, today or later; a gap starts again at 1, silently; a result dated before the last recorded day leaves the streak alone.
- The progress line reads "3 of 8 lessons · 7 stars · 2 days in a row".
- Left out on purpose: timers, leaderboards, levels, hearts or lives, anything that goes down.
- Visible from zero (Vlad, 2026-11-04, `protection-menu.md` line 7): three empty drawn stars on every lesson card, the badges still to earn in grey, "Your first star is one minute away" instead of "0 of 8 lessons · 0 stars"; today the game only appears after the first lesson.

## Demo path
Not in the Nov 4 video: Hadrien decided on 2026-10-31 (the cut is capped at 2:57). Kept for a later cut, 15 seconds after a parcel scene: Linda taps Learn → "The $1.99 parcel trap" → Mr. Tiny Fee's text under the USPS name → "What do you do?" → the right answer, his "Fine. FINE.", confetti and a star → "The coin jar stays empty." → the rule. Caption: "One minute a day, built from the scams that reach her." Record at phone width with text size Largest.

## Out of scope
Claiming that lessons prevent scams: independent studies find awareness training changes little on its own ([research/micro-learning.md](../research/micro-learning.md)); the verdict is the protection, the lessons explain it. A lesson written by Muse from the person's own flagged message (kept as an idea), lessons sent by the trusted person, progress shared with the family, a "Learn why" button on the red card (follows once the "Checked:" chips land in `today.js`), a course, certificates, leaderboards, branching stories with more than one path (a wrong choice rewinds; it never opens a second story).

## Acceptance
- `tests/lessons.test.js`: one test per Behavior line that can be tested without a browser, named after the line: the YAML loader and every validation rule (8), EN/FR twins (8), stars, badges and streak rules (7), `GET /api/lessons` in both languages (1), the shipped lessons all valid with a demo case that exists (6, 8).
- Stories (3, 4, 9): each new rule of the format has its test (the first and last step are a say, two says in a row at most, at least one say from the character, `from` and `as`, `tell` on every choice that is not right, twins with the same `from` and the right choice at the same position); the sample lesson of the format section is a fixture that passes; `GET /api/lessons` carries `from`, `as` and `tell`.
- Progress in the account (7): tests in `tests/lessons.test.js` run against the test database and are skipped with a reason without Postgres, like the integration suite; account deletion leaves no progress row.
- `make lessons-check` passes on every file under `data/lessons/`; `make check` stays at or above the coverage threshold; `node scripts/docs-check.mjs` reports zero errors.
- Manual, before Built: the Learn tab and one lesson at phone width with text size Largest; keyboard-only and VoiceOver pass; a reading check by one person outside the team; the design artifact agreed before the build (`_product/docs/design.md`).
- 2026-11-04: a ninth lesson, `leaked-details` ("They know your real details", Mr. I-Know-Your-Number), from `breach-exposure.md` line 8; its French twin opens the Bouygues debit notice (A3b).
- Where it stood (2026-10-29): 40 tests in `tests/lessons.test.js`, `make lessons-check` 0 problems on 8 lessons, line coverage 91% (threshold 84), headless-browser pass at 390 px in EN and FR at Normal and Largest (focus on every heading, dock on the measured tab bar, reduced motion, late answers dropped), design agreed.
- Where it stands (2026-11-04): all nine lessons rewritten as stories in EN and FR (`make lessons-check`: 9 lessons, 0 problems), 51 tests in `tests/lessons.test.js` (600 in all, 96% line coverage, threshold 95), headless pass at 390 px in English at Normal and in French at Largest (the message on the question's screen, the wrong-choice screen with the reply, the tell and Rewind, the tried answer greyed, the first-try star, the end screen with 2 of 3 stars, no sideways scroll, no console error). Still open before Built: the reading check with one senior outside the team, VoiceOver on a real phone, Hadrien's call on the French tab label, the two story frames on the canvas.

## Implementation pointers
`data/lessons/en/*.yaml`, `data/lessons/fr/*.yaml` (content); `lib/lessons.js` (load, validate, list by language; `applyLessonResult()` pure rules for stars, badges and streak); `scripts/lessons-check.mjs` (`make lessons-check`); a migration in `src/db/migrations/` (table `lesson_progress`, one JSONB row per person, removed with the account); `src/routes/lessons.js` (`GET /api/lessons?lang=`, `GET /api/learn/progress?day=`, `PUT /api/learn/progress/:lessonId` with `{ stars, day }`, 30 a minute per person); account deletion needs nothing in `src/routes/account.js` (the row goes with the user, a test proves it); `public/js/views/learn.js` (the screens; `#/learn`, `#/learn/<id>`, `#/demo/learn`; the speaker bubbles, the reply and tell after a choice, the Rewind and the "Tried" state; demo progress under the `ss_learn_progress` key in localStorage with the rules copied from `lib/lessons.js`), `.learn-*` and the four-column tab bar in `public/styles.css`, the `learn_*` strings in `public/js/i18n.js`, the tab, the nav link and the measured tab-bar height in `public/js/main.js`, `speak()` in `public/js/ui.js`.

## Open questions
- Stars and badges: in one study people aged about 85 called points and badges "meaningless" and felt watched by scores (Altmeyer et al., 2018, in [research/micro-learning.md](../research/micro-learning.md)). Vlad kept stars, badges and the gentle streak on 2026-10-29 for the 70+ target and the video; if the reading check with seniors confirms the study, the badges become a "Rules I know" wall and the stars go quiet.
- Rewind to the same choice, or play the right move for the person after one wrong try? Rewind today (the person makes the right move by hand); the reading check with a senior decides whether a second tap on a two-button question feels like a game or a chore.
- Does a senior who takes words at face value hear the character's gloating as advice? The character is plainly the villain and the narrator's line is literal; the reading check asks this first.
- Should Muse Spark write a fresh practice message in the lesson's family ("Try one more")? Kept as an idea until the lessons work.
- Does the senior want lessons offered after a red card, or only from the tab? The three-senior reading check can ask.
