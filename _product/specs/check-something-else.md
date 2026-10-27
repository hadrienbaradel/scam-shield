# Check something else (pasted text, picture, email file)
Status: Built · Last updated: 2026-10-27

## Why
Scams arrive by text, WhatsApp, pop-up and letter too. The senior (or the family member sitting next to them) must be able to check anything in one place with the same verdict screen.

## Behavior
1. "Check something" lets the user paste the words of a text message, WhatsApp or email, say who sent it (name, number or address) and tap "Check this"; the same verdict card appears, with Read aloud and Ask my trusted person.
2. "Or send a picture of it": a screenshot or photo (PNG, JPEG, WebP, up to 8 MB) is read by Muse Spark, transcribed word for word without judging, then checked like text. The picture is never kept. If no message is found, the app says so.
3. "Or an email file": a `.eml` downloaded from any webmail is parsed in memory and checked exactly like a Gmail message; its authentication is trusted only if Gmail visibly received it. The file is never kept.
4. Pasted and pictured messages are never stored; only the verdict is kept, so "Ask my trusted person" sends what is on screen at that moment.
5. When Muse Spark is not switched on, the picture button is replaced by "Checking pictures needs Meta's Muse Spark… please paste the words instead"; text and `.eml` checks still work with the rule detector.
6. Each check is rate-limited per person (30 text, 10 picture, 20 file checks per minute).

## Demo path
Paste "USPS: your package is on hold. Pay a $1.99 redelivery fee" with a link, show the red card; or drop a screenshot of a bank text and show the transcription turning into a verdict (needs the Muse key).

## Out of scope
Voice notes (no transcription yet), QR codes inside pictures (not decoded), PDFs, browser extension "check this page", links pasted alone without text (works, but judged as a bare link).

## Acceptance
- Tests: pasted text checked without storing it; uploaded `.eml` checked and not stored; screenshot transcription sends the image and returns a checkable message (tests/integration.test.js, tests/muse.test.js, tests/units.test.js eml).
- Screenshot path exercised against the live model: unverified (docs mention screenshots work; no live number recorded).

## Implementation pointers
src/routes/mail.js (/api/check/text, /api/check/image, /api/check/eml, /api/ask with provided message), lib/muse.js extractFromImage (IMAGE_PROMPT, IMAGE_SCHEMA), src/google/eml.js parseEml, public/js/views/pages.js renderCheck.

## Open questions
- Should the guardian be able to check something on the senior's behalf from their own dashboard?
- Is the `.eml` path worth keeping in the UI for seniors, or is it a developer/tester tool (Gmail "Download message" is three menus deep)?
- Transcription in the model's language vs. the user's: a French screenshot checked by an English profile?
