# Trusted person loop
Status: Built · Last updated: 2026-10-28

## Why
When the senior is unsure, the safest step is a human they trust, in one tap, without forwarding the email or reading a phone number out loud. The family member must see only what the senior chose to share.

## Behavior
1. The senior adds a trusted person with a name, email address and relation (in onboarding or on "My trusted people"); the person receives an invitation email and accepts by signing in with Google (sign-in only, no access to their own mail). The senior's page updates live to "Ready to help".
2. On any message that is not Safe (in the inbox, a pasted text, a screenshot or a phone text), "Ask my trusted person" opens a preview of exactly what will be shared: sender, subject, Scam Shield's headline and reasons, and, only if the senior ticks the box, the message text. The senior picks who gets it and sends.
3. The trusted person gets an email with three big buttons, "It's a scam / It's real / I'll call you", and sees the same card on their "People you protect" page. An email link only opens a confirmation page; the answer is recorded on the confirmation, so a mail scanner that opens links can never answer for them. Each link works once and expires after three days.
3b. **By text message (2026-10-28):** "Send a text to Thomas" opens the senior's own Messages app (or WhatsApp) with a short text already written ("Hi Thomas, can you check this for me? … Scam Shield says: … Tap to answer: <link>"); the senior presses Send, so it arrives from a number Thomas knows. Nothing is sent by Scam Shield and no SMS provider is involved (US carrier registration for business texts would take weeks). The link is the same one-tap answer page. The trusted person's mobile number is optional ("My people"); without it, Messages asks who to send to. Email stays available as "Send an email instead".
4. The answer appears on the senior's screen within seconds without reloading ("Thomas says: it's a scam. Delete it, don't reply."), with a toast, and is read on the message afterwards.
5. The senior cannot ask twice about the same message to the same person; at most 20 alerts a day leave the account ("Daily limit reached. Please call your trusted person instead.").
6. Optional "Tell my trusted person automatically about scams involving money" (off by default) sends the shared card without a tap when a verdict is Scam or Be careful and involves money, codes, threats or secrecy.
7. Removing a trusted person stops every pending link at once; they never see anything shared afterwards.
8. The guardian's own email is never read; signing in as a guardian asks for nothing beyond identity.

## Demo path
Senior taps "Ask my trusted person" on the orange card (preview visible, 3 s). Cut to the guardian's phone: email with three buttons, tap "It's a scam", confirm. Cut back: the senior's screen shows the answer live. Needs a Resend key for real email; without it, show the guardian dashboard instead of the email.

## Out of scope
Texts or WhatsApp sent by Scam Shield itself (the senior's phone sends them); push notifications to the guardian; a guardian acting on the senior's mailbox; more than one senior per screen beyond a list; chat between the two.

## Acceptance
- Integration test: invitation, one-tap answer (GET never answers, single use), answer reaches the senior over SSE; revoked guardian link stops working (tests/integration.test.js).
- Integration test: asking by text returns a ready-to-send text under 320 characters with the one-tap link, sends no email, and its link records the answer; mobile numbers are validated (tests/integration.test.js).
- Guardian emails are rendered with big plain buttons (src/notify/email.js); delivered copies are kept 7 days without the secret links.
- Measured: not yet tested with a real family pair.

## Implementation pointers
src/guardians.js (inviteGuardian, alertGuardians, answerAlert), src/routes/guardians.js (/invite/:token, /answer/:token, dashboard API), src/sync/worker.js sharedFrom, src/notify/email.js (Resend or /dev/outbox), src/notify/sse.js, public/js/views/mail.js openAsk, public/js/views/pages.js renderGuardian.

## Open questions
- Guardian channel for launch: email (built), web push, or WhatsApp? Email is slow for a 9 pm scam.
- Should auto-alert be on by default for money scams (protection) or off (privacy, current)?
- Does the guardian need the message text by default to answer well? Today it is opt-in per ask.
