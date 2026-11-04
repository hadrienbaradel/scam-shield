# What Prudence protects (the menu)
Status: Partial (design agreed by Vlad 2026-11-04, build started the same night) · Raised by Vlad, 2026-11-04 (his phone screenshot of the menu) · Last updated: 2026-11-04

## Why
On a phone the top of the app is a wall of links (Today, My email, Check something, Learn, My trusted people, Settings, Sign out) and it says nothing about what Prudence watches: only the email, while the product also checks texts, voice messages and pictures, and WhatsApp, Facebook and calls are on the way. A senior must see in one list what is protected, what needs one step from them, and what is coming, with no dead button anywhere. Design first (`_product/docs/design.md`): the brief and the current screens are in `_product/design/2026-11-04-redesign/`.

## Behavior
1. **One menu, five places.** On a phone the bar at the bottom has four tabs, Today, Check, Learn, Blocked (everything Prudence moved out of the inbox, each row with its red "Scam" pill and "Put it back"), and a Settings button (gear and the word) sits at the top right of every screen; Sign out lives at the end of Settings (`settings-and-onboarding.md`, lines 1 and 12). On a computer the same five are top links. "My email" leaves the menu: the message list ("My messages": one list with two chips, My inbox and Check first, the message that needs her first, back link to Today) opens from "See my messages" on Today's email row. "My people" leaves the tab bar and becomes the first row of Settings (Vlad, in the design session of 2026-11-04). The header keeps only the brand and the Settings button: the name, Sign out and the link wall are gone.
2. **"What Prudence protects"** is a list on Today, under the greeting, and the first section of Settings: one row per channel with its name, its state in words with an icon (never color alone) and at most one button with a verb.
3. The rows, in this order:
   - **Your email**: "On since Nov 3 · checked 2 min ago" → "See my messages" (the list with My inbox, Scams we moved, Check first); stopped or lost: as `settings-and-onboarding.md` line 3.
   - **Your text messages**: with a paired Android phone "On, on Linda's phone" → "Change"; without: "Needs the Prudence app on your Android phone" → "Add my phone" (today's pairing code).
   - **Voice messages**: "Send one any time" → "Check a voice message" (Check something, voice); voicemail read by itself stays an idea.
   - **WhatsApp messages**: Coming soon ("Forward a message to Prudence and the answer comes back in the chat").
   - **Facebook and Messenger**: with the Prudence Page configured (`messenger-channel.md` line 13), "Send any message to Prudence on Messenger" → "Open Messenger"; otherwise Coming soon ("A message or a Marketplace chat that feels wrong").
   - **Your phone calls**: Coming soon ("A warning before you call back a number from a scam message").
4. **Coming soon** rows are grey, have no button and one line of what they will do; tapping one does nothing. A row leaves Coming soon only when its feature is Built in `_product/spec.md`; the app reads the status from one table in the code, never from the spec file at run time.
5. **Check something** opens on three big choices before any form: "Take a screenshot and send it" (on a phone it opens the camera roll or the camera; on a computer, a file; the picture is read by Muse Spark and never kept, `check-something-else.md` line 2), "Paste the words" and "Send a voice message"; the email file sits behind "More ways". The same three choices are offered on an empty Today ("Nothing in your email needs you. Got something else? Take a screenshot of it.").
6. **Still unsure after a verdict?** Under every card that is Be careful or Scam, and under Safe on request ("I still have a doubt"), two buttons: "Ask Thomas" (the trusted person loop) and "Send it to Prudence": a person on the Prudence side or an automatic second look answers within a day, in the same plain words, and the answer lands on Today. Until it is built the button reads "Coming soon" and does nothing (`second-opinion.md`).
7. **Learn shows the game even at zero**: three empty stars on every lesson card, the badge row with the badges still to earn in grey, "Your first star is one minute away" instead of "0 of 8 lessons · 0 stars"; the rules of `micro-learning.md` (Gamification) do not change.
8. All of it in English and French, at the three text sizes, by keyboard and screen reader; a Coming soon row is announced as "coming soon, no action".

## What is connected, and where it shows
The rows of line 3 are the Settings rows of `settings-and-onboarding.md` (Your email, Your Android phone) plus the three Coming soon rows; no new onboarding step (a Coming soon row has nothing to ask).

## Design
Claude Design brief: `_product/design/2026-11-04-redesign/brief.md`, with the eight current screens at 390 px beside it. The canvas Vlad ran from it: `_product/design/2026-11-04-redesign/claude-design/` (`Prudence Redesign.dc.html`, nineteen frames 1a to 1s, plus the header, tab bar and "What Prudence protects" components; README there). Agreed by Vlad on 2026-11-04, with two changes he asked for in the session: Blocked as the fourth tab, My people in Settings. Hadrien: see the build, object in the log.

## Screens (the canvas frames and where each one lives)
- 1a, 1b, 1c, 1d · Today (`#/today`): greeting; the verdict card ("1 message needs you", gold "Look at it now") or the green all-clear ("Nothing in your email needs you · Checked 2 minutes ago") followed by the three Check choices; the "3 scams moved away this week" card with "See them" (opens Blocked); then "What Prudence protects". 1c is Largest, 1d French.
- 1e · My messages (`#/messages`): back link "Today", chips My inbox and Check first, rows with sender, subject or date, and the verdict pill with its icon.
- 1f · Blocked (`#/blocked`, fourth tab): the count sentence, one card per moved message with the red Scam pill and "Put it back".
- 1g, 1h · Check (`#/check`): "Show Prudence anything that worries you", the gold 120 px "Take a screenshot and send it" ("Opens your photos or your camera"), "Paste the words", "Send a voice message", the underlined "More ways" (the email file).
- 1i · Paste the words (`#/check/paste`): the box first, then "Who sent it?" and "Where did you get it?" as 64 px chips (a chosen chip turns navy with a check), gold "Check it".
- 1j, 1k · Screenshot (`#/check/photo`): "Choose from my photos" (gold) and "Take a photo now"; while it runs, a still ring, "Reading your picture…", "About a minute. You can put the phone down.", and "Stop".
- 1l, 1m, 1n · The verdict after a check: the V2 card (word, icon, headline, next step, reasons, Listen), then "Still unsure?" with the gold "Ask Thomas" and "Send it to Prudence" (flat grey with the Coming soon tag until built, 1m); on Safe the card ends with "Go back to Today" and the row unfolds from "I still have a doubt" (1n).
- 1o, 1p · Learn (`#/learn`): "Learn to spot them. One minute at a time.", the card "Your first star is one minute away" with the eight badges to earn in grey, "Lessons to try" with the first lesson as a big card (three empty stars, gold Start) and the others as rows; the lesson screen (1p) is unchanged apart from the header and the tab bar.
- 1q, 1r, 1s · Settings (`#/settings`): "What Prudence protects" first, then one white card per setting with a 44 px icon, the name, the state in words and one 64 px verb: My people (Change), When a message is a scam (two radio cards), Tell Thomas automatically (Turn on / Turn off), Text size (Make it larger / Back to normal), Language (Passer au français / Switch to English), Read aloud, What Prudence knows about you (Look), What Prudence did (Look), What Prudence keeps (Delete my account), then Sign out. "Delete your account?" is its own screen (`#/settings/delete`) with the gold "Keep my account" first (1s). The long lists (people and phone, what Prudence knows, what Prudence did) open behind their verb as their own screens under Settings.

## Demo path
None by default: the video is at its cap. If a slot opens, 3 s of Today's "What Prudence protects" list (email On, texts on her phone, three Coming soon) says the product is a platform, not an email filter.

## Out of scope
Building WhatsApp, Facebook or call protection (their own specs and ideas); the Send-to-Prudence back office (who answers, in how long: `second-opinion.md`); dark mode; a hamburger menu.

## Acceptance
- Not started. When built: `tests/menu.test.js` (no database): the rows for a senior with and without a phone, the Coming soon table matching the Built statuses in `_product/spec.md` (a test reads the spec table), every `protect_*` key in EN and FR with no technical word; manual: the canvas frames rebuilt at Normal, Larger and Largest, no horizontal scroll, VoiceOver; `node scripts/docs-check.mjs` 0 errors.

## Implementation pointers
`public/js/main.js` renderChrome (the header button, the tab bar, the routes `#/messages`, `#/blocked`, `#/check/*`, `#/settings/*`), `public/js/protects.js` (the channel table: key, status Built or Coming soon, state and verb per senior), `public/js/views/today.js` (the cards and the list under the greeting), `public/js/views/check.js` and `public/js/views/settings.js` (new, replacing renderCheck and renderSettings in `pages.js`), `public/js/views/mail.js` (My messages and Blocked), `public/js/views/learn.js` (the home at zero), `public/js/i18n.js` (`protect_*`, `check_*`, `set_*`), `public/styles.css` (row cards, chips, the grey Coming soon row), `src/routes/*` unchanged.

## Open questions
- Does "Your text messages" show at all for a senior with an iPhone (the Android app is the only way today)? Proposal: yes, as "Needs an Android phone" with no button.
- Who answers "Send it to Prudence" before launch: the two of us by hand from the admin console, or Muse Spark with the whole life context and a slower, deeper pass?
- Decided in the design (2026-11-04): "See my messages" is one list with two chips (My inbox, Check first); "Scams we moved" is the Blocked tab.
