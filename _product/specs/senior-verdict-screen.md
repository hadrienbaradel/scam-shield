# Senior web app and verdict screen
Status: Built · Last updated: 2026-10-27

## Why
The explanation only helps if a frightened 74-year-old can read it at 9 pm: one screen, one verdict, big type, big buttons, and a voice.

## Behavior
1. The inbox lists the latest 30 messages read live from Gmail, each with a pill: Scam (red), Be careful (orange), Safe (green), Not checked yet, or "Put back by you". Two folders show "Scams we moved" and "Check first".
2. Opening a message shows, in this order: who sent it, the subject, any trusted-person answer, the verdict card (headline, one next step, certainty in words), "Why we say this" (1–3 reasons), what the real company never does, and then the message text itself. Message content is always shown as text, never rendered as HTML.
3. One tap reads the verdict aloud (headline, reasons, next step) in the user's language at a calm pace.
4. Under the card, at most two big actions: "Ask my trusted person" (when not Safe) and "Put it back" / "It's a scam — take it away" when relevant.
5. "Links in this message" lists what each link shows and where it really goes; "Where do the links really go?" follows redirects safely on request and shows the final site, its age in days and what the page shows.
6. Type is 19 px or larger with three sizes (Normal / Larger / Largest), buttons are 64 px tall, every screen works by keyboard and screen reader (focus moves to the new heading, live regions announce changes), and the whole app is in English or French.
7. Nothing on screen is ever stale: a late answer for a message the user has left is dropped; an action that fails shows an error instead of pretending it was saved; when the app cannot load it says so and offers Try again.
8. The footer on every page says: "Scam Shield is a helper, not a guarantee. If money is involved, always call the number on your card or statement — never a number from a message."
9. The welcome flow (4 steps) is shown once; the "Not checked yet" state offers "Check it now".

## Demo path
The whole video lives on this screen: the inbox with pills, one red card read aloud, one orange card with "Ask my trusted person", the answer arriving live. Set text size to Largest before filming.

## Out of scope
A native iOS/Android mail client; dark mode; languages beyond EN/FR; HTML rendering of emails; a Gmail-side add-on.

## Acceptance
- Front-end review fixes landed (no wrong-message race, keyboard and screen-reader pass, recovery screen) in commit e60f1af; strict CSP with no inline scripts (src/server.js).
- Verdict card uses only schema fields; unknown model fields never reach the UI (lib/schema.js pickVerdictFields).
- Still to do (PRD): a filmed comprehension test with three seniors ("what would you do now?" answered correctly in under 10 s).

## Implementation pointers
public/js/views/mail.js (inbox, reader, openAsk), public/js/ui.js (verdictCard, readAloud, pill), public/js/views/pages.js (landing, onboarding, check, people, settings), public/js/i18n.js (all strings), public/styles.css.

## Open questions
- Is "Judged by Muse Spark (muse-spark-1.3)" the right thing to show a senior (see verdict-engine)?
- Do we show the message text at all for a Scam, or hide it behind "Show me the message anyway" so the link cannot be tapped by reflex?
- The inbox shows 30 messages with no paging: enough for the demo; enough for a real mailbox?
