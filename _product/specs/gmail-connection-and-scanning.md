# Gmail connection and scanning
Status: Built (unverified live) · Last updated: 2026-10-27

## Why
The senior should not have to forward anything: once connected, every new email is checked before they open it. The whole promise ("it knows your life") depends on reading the real inbox.

## Behavior
1. On the welcome page, the user taps "Protect my email" and signs in with Google; the consent asks for Gmail access (gmail.modify). If the Gmail box is left unticked, the app explains and asks again.
2. Right after sign-in, a 4-step welcome asks for a name and language, what to do with sure scams (move or label only), a trusted person to invite, and known data breaches.
3. On first connection the app says "Getting to know your mailbox"; it learns the life context from the last 180 days of mail and the people in Sent, then checks the latest 50 inbox messages.
4. From then on every new inbox message is checked within seconds when instant checks are on (Gmail push), and within two minutes otherwise (polling). The inbox header says "Up to date · last checked 2 min ago · New emails are checked within seconds."
5. Mail that comes back into the inbox (un-archived, out of spam) is checked too; mail the user sent is never checked.
6. If Google's access expires (7 days while the app is in Testing mode), a banner says "Please reconnect your Gmail" with a button; nothing else breaks.
7. The user can reconnect, sign out, or delete the account at any time; labels already in Gmail stay.
8. Two Scam Shield labels appear in Gmail: "Scam Shield/Scam" (red) and "Scam Shield/Check first" (orange). Nothing is ever sent, trashed or deleted from the mailbox.

## Demo path
Sign in as the demo senior on a test Gmail account; show the welcome steps in 10 s; send a prepared scam email to that account from another device; the verdict pill appears in the list without reloading, the message opens with its red card. (Needs the OAuth client and a test user; fallback: `/#/demo`.)

## Out of scope
Other mail providers (Outlook, iCloud, Orange); reading Sent bodies (only To/Cc headers); more than 100 test users before Google verification.

## Acceptance
- Integration suite on a fake Gmail: context learned, scam labeled and moved, real mail untouched, nothing trashed, crash mid-action finished on next sync, expired history rescanned (tests/integration.test.js).
- `npm run gate` after a real sign-in prints PASS on every gate (scope granted, backfill done, no sync error, nothing moved without consent, no pending action older than 10 min, Muse failures under 10%, labels exist). Not yet run on any real inbox.
- PRD gate still to run: 200 genuine emails from family inboxes with zero false Scam.

## Implementation pointers
src/routes/auth.js (PKCE sign-in, modes), src/google/oauth.js, src/google/gmail.js (allow-listed client, normalizeMessage, parseAuthResults), src/sync/worker.js (backfill, incremental, checkAndAct), src/google/pubsub.js + src/jobs/scheduler.js (push and poll), docs/GOOGLE_SETUP.md, scripts/inbox-gate.mjs.

## Open questions
- Who creates the OAuth consent screen and Web client (Hadrien, console step), and by when? The video cannot be filmed without it.
- First-run cost on a big mailbox: 300 messages read for context + 50 checked (Muse calls) — acceptable latency for the welcome screen?
- Test users must be added by hand in the Cloud Console: who are the three seniors for the comprehension test?
