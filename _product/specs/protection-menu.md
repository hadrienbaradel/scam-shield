# What Prudence protects (the menu)
Status: Planned · Raised by Vlad, 2026-11-04 (his phone screenshot of the menu) · Last updated: 2026-11-04

## Why
On a phone the top of the app is a wall of links (Today, My email, Check something, Learn, My trusted people, Settings, Sign out) and it says nothing about what Prudence watches: only the email, while the product also checks texts, voice messages and pictures, and WhatsApp, Facebook and calls are on the way. A senior must see in one list what is protected, what needs one step from them, and what is coming, with no dead button anywhere. Design first (`_product/docs/design.md`): the brief and the current screens are in `_product/design/2026-11-04-redesign/`.

## Behavior
1. **One menu, five places.** On a phone the bar at the bottom has four tabs, Today, Check, Learn, My people, and a Settings button (gear and the word) sits at the top right of every screen; Sign out lives at the end of Settings (`settings-and-onboarding.md`, lines 1 and 12). On a computer the same five are top links. "My email" leaves the menu: the message list opens from Today ("See all my messages") and from the email row below.
2. **"What Prudence protects"** is a list on Today, under the greeting, and the first section of Settings: one row per channel with its name, its state in words with an icon (never color alone) and at most one button with a verb.
3. The rows, in this order:
   - **Your email**: "On since Nov 3 · checked 2 min ago" → "See my messages" (the list with My inbox, Scams we moved, Check first); stopped or lost: as `settings-and-onboarding.md` line 3.
   - **Your text messages**: with a paired Android phone "On, on Linda's phone" → "Change"; without: "Needs the Prudence app on your Android phone" → "Add my phone" (today's pairing code).
   - **Voice messages**: "Send one any time" → "Check a voice message" (Check something, voice); voicemail read by itself stays an idea.
   - **WhatsApp messages**: Coming soon ("Forward a message to Prudence and the answer comes back in the chat").
   - **Facebook and Messenger**: Coming soon ("A message or a Marketplace chat that feels wrong").
   - **Your phone calls**: Coming soon ("A warning before you call back a number from a scam message").
4. **Coming soon** rows are grey, have no button and one line of what they will do; tapping one does nothing. A row leaves Coming soon only when its feature is Built in `_product/spec.md`; the app reads the status from one table in the code, never from the spec file at run time.
5. **Check something** opens on three big choices before any form: "Take a screenshot and send it" (on a phone it opens the camera roll or the camera; on a computer, a file; the picture is read by Muse Spark and never kept, `check-something-else.md` line 2), "Paste the words" and "Send a voice message"; the email file sits behind "More ways". The same three choices are offered on an empty Today ("Nothing in your email needs you. Got something else? Take a screenshot of it.").
6. **Still unsure after a verdict?** Under every card that is Be careful or Scam, and under Safe on request ("I still have a doubt"), two buttons: "Ask Thomas" (the trusted person loop) and "Send it to Prudence": a person on the Prudence side or an automatic second look answers within a day, in the same plain words, and the answer lands on Today. Until it is built the button reads "Coming soon" and does nothing (`second-opinion.md`).
7. **Learn shows the game even at zero**: three empty stars on every lesson card, the badge row with the badges still to earn in grey, "Your first star is one minute away" instead of "0 of 8 lessons · 0 stars"; the rules of `micro-learning.md` (Gamification) do not change.
8. All of it in English and French, at the three text sizes, by keyboard and screen reader; a Coming soon row is announced as "coming soon, no action".

## What is connected, and where it shows
The rows of line 3 are the Settings rows of `settings-and-onboarding.md` (Your email, Your Android phone) plus the three Coming soon rows; no new onboarding step (a Coming soon row has nothing to ask).

## Design
Claude Design brief: `_product/design/2026-11-04-redesign/brief.md`, with the eight current screens at 390 px beside it. Agreed by: nobody yet (Hadrien for product, Vlad for the change).

## Demo path
None by default: the video is at its cap. If a slot opens, 3 s of Today's "What Prudence protects" list (email On, texts on her phone, three Coming soon) says the product is a platform, not an email filter.

## Out of scope
Building WhatsApp, Facebook or call protection (their own specs and ideas); the Send-to-Prudence back office (who answers, in how long: `second-opinion.md`); dark mode; a hamburger menu.

## Acceptance
- Not started. When built: `tests/menu.test.js` (no database): the rows for a senior with and without a phone, the Coming soon table matching the Built statuses in `_product/spec.md` (a test reads the spec table), every `protect_*` key in EN and FR with no technical word; manual: the canvas frames rebuilt at Normal, Larger and Largest, no horizontal scroll, VoiceOver; `node scripts/docs-check.mjs` 0 errors.

## Implementation pointers
`public/js/main.js` renderChrome (the links and the tab bar), `public/js/views/today.js` (the list under the greeting), `public/js/views/pages.js` renderCheck and renderSettings, `public/js/views/learn.js` (stars at zero), `public/js/i18n.js` (`protect_*`, `check_*`), `src/routes/*` unchanged.

## Open questions
- Does "Your text messages" show at all for a senior with an iPhone (the Android app is the only way today)? Proposal: yes, as "Needs an Android phone" with no button.
- Who answers "Send it to Prudence" before launch: the two of us by hand from the admin console, or Muse Spark with the whole life context and a slower, deeper pass?
- Does "See my messages" keep the three-list page (My inbox, Scams we moved, Check first) or become one list with a filter?
