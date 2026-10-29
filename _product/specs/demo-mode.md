# Demo mode (public examples)
Status: Built · Last updated: 2026-10-27

## Why
Judges, testers and anyone without a test Google account must see the product in 30 seconds. The demo runs the real engine on the PRD's own scenarios, with nothing faked in the verdict.

## Behavior
1. "Try it with examples first" on the welcome page opens `/#/demo` without sign-in, in the visitor's language (English examples for Linda, US; French examples for Françoise, France).
2. The left pane lists the 37 seed messages (emails, texts, a screenshot transcript, a voice-note transcript) with their channel; tapping one shows the sender, the subject, the live verdict card, Read aloud, and the message text.
3. Each verdict is computed on the spot by the same engine as a real inbox (Muse Spark when switched on, rules otherwise), against the example person's life context and the shipped pattern cards; scam links end in `.test` and can never resolve.
4. When Google sign-in is configured, a "Protect my own email" button sits above the examples.
5. The demo is rate-limited (60 checks a minute per visitor) and stores nothing.

## Demo path
This is the safety net for the video: if the live Gmail flow is not ready, film the demo inbox (Scam, Safe, Be careful in a row, one read aloud). It cannot show labels, Put it back or the trusted-person answer.

## Out of scope
Custom examples typed by the visitor (use "Check something" after sign-in), guardian flow in demo, persisting demo verdicts.

## Acceptance
- `npm run score` 37/37 with rules; `npm run score -- --muse` 34/36 (B2/B12 decision pending); every verdict passes the schema.
- `/api/demo/inbox` and `/api/demo/check` serve without a session; A-set 5/5, no false Scam on C (PRD criteria).

## Implementation pointers
src/routes/demo.js, testcases/cases.json (37 cases, sets A/B/C/D/L), data/profiles/linda.json, data/profiles/francoise.json, data/patterns/cards.json, public/js/views/pages.js renderDemo, scripts/score.mjs.

## Open questions
- Hackathon rule: the video must show only what was built during the event. Is a scripted demo inbox acceptable as the main footage, or must the live Gmail flow be shown?
- Should the demo let a visitor paste their own message without sign-in (today paste requires an account)?
- D6 and B1 are text stand-ins for a screenshot and a voice note: label them honestly in the demo list?
