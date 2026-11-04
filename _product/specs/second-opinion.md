# Second opinion: "Send it to Prudence"
Status: Idea · Raised by Vlad, 2026-10-27 · Discussed: 2026-11-04 (Vlad: the button ships as Coming soon in the menu round, `protection-menu.md` line 6) · Last updated: 2026-11-04

## Why
Many scams never reach the inbox the app watches: a letter, a phone call, a Facebook message. The senior's instinct ("something feels off") deserves a one-step outlet that answers either with the service or with a human they trust. The built "Check something" and "Ask my trusted person" features are the two halves; this idea makes "Ask" the front door.

## Behavior (proposals)
1. Anywhere, the senior can say "Something feels off? Ask." and send a screenshot, a photo of a letter, or forward an email to a Scam Shield address; they get the same plain verdict card back.
2. Three paths, chosen by the senior: automated (Muse Spark + the life context, seconds), the family (the trusted son or daughter sees exactly what was shared and answers Scam / Real / I'll call you), and Prudence itself: "Send it to Prudence" hands the message to a person on the Prudence side and/or a deeper automatic pass (the whole life context, the links followed, a slower model), who answer on Today within a day in the same plain words (Vlad, 2026-11-04).
3. A verdict that is not Safe, or a low-certainty one, offers the human path with one tap; the family member's answer replaces or confirms the card.
4. Forwarding to an address (e.g. ask@…) works without opening the app; the reply comes by email in the same plain words.
5. Nothing sent for a second opinion is stored beyond the verdict, and no human reads it unless the senior chose the human path (Privacy by default).

## Demo path (if built)
Senior photographs a paper letter about an "unpaid fine", taps Ask; the card says Be careful; one more tap sends it to the daughter, whose "It's a scam" lands on the senior's screen. Thirty seconds, two devices.

## Out of scope
Live chat with the family; a paid human review service; phone calls (see pressure-coach).

## Acceptance
- Not started. Reuses: /api/check/image and /api/check/text (built), /api/ask and the guardian loop (built). New: a forward-to address (inbound email parsing exists in src/google/eml.js), an "Ask" entry point on every screen, and the Android share target.
- Measured when built: time from "feels off" to an answer under 60 s on the automated path; under 10 minutes on the human path in a family test.

## Implementation pointers
src/routes/mail.js (/api/check/*, /api/ask), src/guardians.js alertGuardians, src/google/eml.js parseEml (inbound mail), android/.../VerdictActivity.kt (share target), public/js/views/pages.js renderCheck.

## Open questions
- Is this a new feature or a rename and repositioning of "Check something" + "Ask my trusted person" with a forward-to address added?
- Who receives the forward-to mailbox (Resend inbound, Gmail of the service)? It must not become a second copy of the senior's mail.
- Should the human path be available without any sign-in, for a senior who never connected Gmail?
