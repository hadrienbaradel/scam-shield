# Chrome extension ("Check this" in Gmail web and on any page)
Status: Planned · Last updated: 2026-10-27

## Why
Seniors read Gmail in the browser; a "Check this" button next to the open email, and on any suspicious page, meets them where the click happens. The docs list it as the next engineering item.

## Behavior
1. A "Check this with Scam Shield" button appears above the open email in Gmail web (unverified design) and in the browser toolbar on any page.
2. Tapping it sends the open message (or the page's visible text and address) to the user's Scam Shield server and shows the same verdict card in a side panel, with Read aloud and Ask my trusted person.
3. For a Gmail message that Scam Shield already checked, the panel shows the existing verdict instantly.
4. The extension stores nothing and uses the existing session (same origin cookies or a pairing token).

## Out of scope
Blocking pages, injecting warnings into every site, Firefox/Safari, Chrome Web Store review before the hackathon.

## Acceptance
- Not started: no code under the repo. Would reuse lib/ unchanged and src/routes/mail.js /api/check/text or /api/messages/:id/check.
- Demo-first test: can it be filmed in 10 seconds without a store listing (developer mode)?

## Implementation pointers
None yet. Candidate entry points: src/routes/mail.js (/api/check/text, /api/messages/:id), public/js/ui.js verdictCard (shared rendering), src/server.js CSP and Origin check (an extension origin would need an allowance).

## Open questions
- Build before Nov 4 or defer? It competes with the live-inbox gate, the video and the comprehension test.
- Is the Gmail-side button redundant with automatic scanning (every inbox mail is already checked)? The stronger case may be "any page" (a fake bank page) rather than Gmail.
- Origin check: an extension's requests do not come from the app origin; pairing token like the phone, or allow the extension id?
