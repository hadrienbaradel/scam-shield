# Reversible mail actions
Status: Built (unverified live) · Last updated: 2026-10-27

## Why
A scam left in the inbox gets clicked at 9 pm; a real message hidden by mistake is worse. The app acts, but every action is visible, consented and undoable, and nothing is ever deleted.

## Behavior
1. A Safe message is left exactly as it is.
2. A "Be careful" message gets the orange "Scam Shield/Check first" label and stays in the inbox.
3. A "Scam" message gets the red "Scam Shield/Scam" label. It is moved out of the inbox (into the Scam Shield folder, visible in Gmail) only when the user chose "Move it out of my inbox" (the moment of consent is recorded); otherwise it is only labeled.
4. Even with consent, a scam verdict never moves mail from an authenticated sender the user already knows (a known sender, their provider's real address, a trusted contact), and never moves mail judged while the AI was unavailable.
5. The message page says what was done: "We moved this out of your inbox. It is safe in the Scam Shield folder." or "We added a Scam Shield label. It is still in your inbox."
6. "This is not a scam — put it back" returns the message to the inbox, removes the labels, and remembers the sender so it is recognised next time. "It's a scam — take it away" overrules a Be careful and files it in the Scam folder.
7. Scam Shield never sends, replies, trashes or deletes, and never touches Gmail's Spam or Trash; the Gmail client in the code has no such calls.
8. If the app crashes between deciding and acting, the action is finished on the next sync; nothing is left half-done.
9. "What Scam Shield did" in Settings lists every label, move and put-back with its time.

## Demo path
After the red card, switch to Gmail in another tab: the message sits under "Scam Shield/Scam", not in the inbox. Tap "Put it back" in Scam Shield; it reappears in the Gmail inbox. Ten seconds that prove "reversible".

## Out of scope
Auto-archiving Be careful mail; bulk actions; acting on mail older than the first 50; any action on the guardian's own mailbox.

## Acceptance
- Unit test "actions: what happens to a message for each verdict"; integration tests "moves the scam, leaves real mail alone, never trashes", "without recorded consent a scam is labeled, never moved; a crash mid-action is finished next sync", put-back restores and remembers the sender (tests/units.test.js, tests/integration.test.js).
- `npm run gate` on a live inbox: "nothing moved without the person's consent" PASS. Not yet run live.

## Implementation pointers
src/sync/actions.js (decideAction, applyDecision, putBack, fileAsScam, isProtectedSender), src/sync/worker.js (finishAction, reconcilePending), src/google/gmail.js (FORBIDDEN_LABELS, ensureLabels), migration 002_mail_safety.sql, src/routes/mail.js (put-back, file-as-scam).

## Open questions
- Default mode: label-only (current stored default after the security review) or move (what the onboarding copy recommends and the video wants)?
- Should "Check first" mail also be moved to its folder for users who ask for a calmer inbox?
- Put back sets "not a scam" feedback: do we use that signal anywhere beyond remembering the sender (e.g. tune rules, show the guardian)?
