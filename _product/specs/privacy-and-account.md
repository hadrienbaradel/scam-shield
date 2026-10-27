# Privacy controls and account deletion
Status: Built · Last updated: 2026-10-27

## Why
Reading someone's Gmail is the most sensitive thing an app can do, and Google will audit it (restricted scope, CASA). The senior and the family must be able to see what is kept, who sees it, and erase it.

## Behavior
1. Message bodies are never stored. For each checked message the app keeps the Gmail id, the sender's website address, the verdict and reasons, for 90 days; the AI cache for 30 days; the audit trail for 180 days.
2. What leaves the server, and to whom, is listed on the Privacy page: Meta (redacted message + the relevant part of the context, Standard mode only), domain registries (the address only), abuse.ch (host name only), the trusted person (only what was shared). Nobody else; no advertising.
3. Google tokens are encrypted at rest; sessions, invitations, one-tap links and phone tokens exist only as hashes; the server listens on this machine only unless told otherwise.
4. Settings → "What Scam Shield did" lists every label, move, put-back, invitation and answer with its time.
5. Settings → "Delete my account" asks for one confirmation, then stops Gmail checks, revokes Scam Shield's access at Google, erases every row (verdicts, context, guardians, alerts, devices, cache) and signs the user out. Emails and labels in Gmail stay exactly where they are.
6. A guardian's sign-in grants no access to their own mail, and removing a guardian ends their access to anything shared.
7. Every browser write must come from the app's own origin; the AI is refused any Contributor-mode model id; a one-tap email link never answers by itself.

## Demo path
Two seconds on "What Scam Shield did" and the Delete button; mention "no email text is ever stored" in the voice-over. Likely a single sentence in the video.

## Out of scope
Google verification and CASA (planned), a public privacy policy at a real domain, data export, per-item retention settings.

## Acceptance
- Integration test "deleting the account erases every row"; unit tests for AES-GCM round trip and tamper detection; Origin enforcement and login-CSRF tests (tests/integration.test.js, tests/units.test.js).
- Privacy page (public/privacy.html) states the Google API Services User Data Policy Limited Use commitment.

## Implementation pointers
src/routes/account.js (DELETE /api/account, /api/audit), src/google/tokens.js revokeAndForget, src/crypto.js, src/jobs/retention.js, src/server.js (CSP, Origin check), public/privacy.html, lib/muse.js redactForModel/assertStandardMode.

## Open questions
- "Standard mode = model id without -contributor" is the code's reading of Meta's API; confirm with Meta's docs before claiming "nothing trains Meta's models" on camera.
- Do we need an export ("give me my data") for CASA, or only deletion?
- Who is the contact on the privacy page once the app leaves localhost?
