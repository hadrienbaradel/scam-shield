# Settings and onboarding (the welcome)
Status: Partial (the Settings screen built 2026-11-04 in the redesign round, `protection-menu.md`; the welcome flow still Planned) · Raised by Vlad, 2026-10-31 · Last updated: 2026-11-04

## Why
A frightened 70-year-old must see in one place, in plain words, everything Prudence is connected to and knows, and change any of it with one button; and the first sign-in must set up the few things that make Prudence useful (the email, a trusted person, the letters) one question at a time. Today the welcome is four form-like steps and Settings is a long page of controls: neither says what is connected, and Sign out sits in the top bar. On video it is the way into "What Prudence knows about you" (0:27–0:57).

## Behavior
Settings
1. **Settings from every screen.** A "Settings" button (gear and the word; "Réglages") sits at the top right of every signed-in screen, phone and computer; the four tabs do not change.
2. **One row per thing Prudence is connected to or knows: its name, its state in words (an icon and a word, never color alone) and one button with a verb.** Rows that do not apply are not shown (a trusted person who has no mailbox sees the reading rows, What Prudence keeps and Sign out).
3. **Your email:** "Connected since Oct 28", the Gmail address, when it was last checked; "Stop checking my email". Access lost: "Prudence cannot read your email right now" + "Connect Gmail again". Stopped: "Not checked since Oct 31" + "Check my email again".
4. **Turning protection off is never one tap and never silent.** "Stop checking my email", "Remove this phone" and "Delete my account" open a confirmation that says what stops and what stays ("Your emails and folders stay exactly where they are"), shows "If someone asked you to do this, on the phone or in a message, it is a scam. Hang up and call Thomas." (the trusted person's name, or "someone you trust"), and puts the button that keeps protection first. After a stop, Today says "Prudence is not checking your email" with "Check my email again", never "You are safe".
5. **Your trusted person:** name and relation, how they are reached ("By text at (617) 555-0142 and by email", or "By email only"), "Ready to help" or "Invitation sent on Oct 30"; "Change" opens My people. None: "No one yet" + "Add someone" (the welcome's step 2).
6. **Your mobile number** (only with the WhatsApp match, open question 1): the number + "Change"; none: "Not added yet" + "Add my number" (step 3).
7. **Your Android phone:** one row per paired phone, its name and "Last used 5 minutes ago" + "Remove this phone"; none: "No phone yet" + "Add a phone" (the pairing code, as My people shows it today).
8. **When a message is a scam:** "Moved to your Scam folder" or "Only marked in red" + "Change" (step 1's question). **Tell Thomas automatically:** "Off" or "On" in words + "Turn on" / "Turn off".
9. **Text size** (Normal, Larger, Largest) + "Change" (step 4). **Language** + one button named in the other language ("Français" / "English"). **Read aloud:** off by default + "Turn on"; when on, a verdict is read aloud as soon as its card opens; the Listen button stays on every card either way. These follow the account to every device.
10. **What Prudence knows about you** ("Learned from your own email: 3 companies, 2 orders, 4 people") + "Look": today's list with Remove, on its own screen. **What Prudence did** (the last action in plain words) + "Look": the list, in plain words in EN and FR.
11. **What Prudence keeps**, two sentences: "Prudence keeps its answer about each message for 90 days and what it learned about your life, never the words of your emails. No person reads your email: your trusted person sees only a message you choose to show them." + "Delete my account" (today's erase, behind line 4's confirmation).
12. **Sign out** is the last button of Settings and leaves the top bar.
13. A change shows on its row at once ("Saved") and can be changed back on the same row.

Welcome
14. **The first time** someone signs in to protect their email (never a trusted person, never the demo), a welcome comes before Today: one screen per step, "Step 1 of 4", Back and Listen at the top, one question, one main button; the language button stays in the top bar.
15. **Step 1, your email:** shown as done ("Your email is connected", the address, "Prudence never sends and never deletes"), with the one question it needs: "When Prudence is sure a message is a scam, what should it do?" "Move it to my Scam folder" (you can always put it back) or "Only mark it in red".
16. **Step 2:** "Who do you ask when something feels wrong?" Their first name, their mobile number (to text them), their email (for the invitation); "Invite Thomas". Someone already added: shown as done, "Next".
17. **Step 3:** "What is your mobile number?" "So Prudence knows it is you when you forward a WhatsApp message."; "Save my number" (only with the WhatsApp match, open question 1).
18. **Step 4:** "How big should the letters be?" Three big buttons, each drawn at its size; a tap applies it at once; "Keep this size".
19. **"You are protected"** ("Prudence veille sur vous"): what is on, with a tick; what was skipped, with a plain circle and "Add it any time in Settings"; what happens next ("When a message looks wrong, Today tells you in plain words, with one thing to do. Nothing is ever deleted."); "Go to Today".
20. **Every step can be skipped** ("Skip for now"): nothing is saved and its Settings row says "Not added yet" with its button. Leaving in the middle and coming back starts at step 1, steps already done shown as done.
21. **The welcome never comes back after "Go to Today"**, with one exception: when Prudence loses access to the email (not when the person stopped it), the next visit shows that one screen once ("Prudence cannot read your email right now", "Connect Gmail again", "Not now"), then Today with its banner.
22. A step's screen is the screen its Settings row opens for "Change": "Skip for now" in the welcome, "Back to Settings" in Settings.
23. All of it in English and French, at the three text sizes, by keyboard and screen reader (focus on each new heading, Listen reads the step, a saved change is announced).

## What is connected, and where it shows (the rule in `_product/docs/product-process.md`, applied)
| Capability | Settings row: state · action | Welcome |
|---|---|---|
| Gmail connection, reversible mail actions | Your email · Stop checking; When a message is a scam · Change | Step 1 |
| Trusted person loop | Your trusted person · Change; Tell Thomas automatically · Turn on/off | Step 2 |
| WhatsApp channel | Your mobile number · Add/Change (question 1); its own row: Idea "Save Prudence in WhatsApp" | Step 3 |
| Messenger channel (`messenger-channel.md` line 13) | Facebook and Messenger · Open Messenger (the Page's m.me link; a QR on a computer); Page not configured: the Coming soon row of `protection-menu.md` | None: nothing to ask; listed on "You are protected" under "Add it any time" |
| Android SMS companion | Your Android phone · Remove (none: Add a phone) | None: a relative installs the app |
| Senior screen | Text size · Change; Language · the other one; Read aloud · Turn on/off | Step 4; language in the top bar |
| Life context, privacy and account | What Prudence knows · Look; What Prudence did · Look; What Prudence keeps · Delete my account | None: learned from step 1's email |
| Breach lookup (`breach-exposure.md` lines 1, 2, 7) | Data breaches you were part of · "Not looked up yet" or "Looked up 2 minutes ago: your address is in 3 known breaches" + Look up my email address / Look up again, with the sentence saying what is sent | The breach step offers the same button under the checkboxes; Next skips it (nothing sent). The step stays in What Prudence knows after the redesign (Out of scope) |
| Check something else, micro-learning | None: a check keeps nothing; lesson stars go with Delete my account | None |
| Look closer (`investigate.md` line 10) | None: it reads, sends, keeps and reaches nothing new (the same registries, context and model as every check, only on a tap) | None |
| Developer sign-in | Your email: "Test mailbox on this computer", no Stop | The same steps when "Show the welcome steps" is ticked |

## Design (to agree before any code; Claude Design canvas: https://claude.ai/artifact/JKJAdCEd6pJQxUZDFSUJLY, private until shared)
Thirteen phone frames at 390 px, each with a text-size switch (Normal, Larger, Largest) in its Tweaks, French copy in a note beside each: Today with the Settings button; Settings at full length (Linda, number skipped); Réglages at Largest; What Prudence knows about you; Stop checking your email?; Today after a stop; the four welcome steps and "You are protected"; the lost-access screen; step 2 in French at Largest. Light only: the app has no dark mode (`specs/senior-verdict-screen.md`, Out of scope). Rows are white cards with a 44 px icon, the name, the state and one 64 px button; the Settings button is 64 px; the welcome borrows Learn's Back / Listen header and stepper.

## Demo path
Zero new seconds by default (the cut is at its 2:57 cap). Inside 0:27–0:57, the 5 s cut to "What Prudence knows about you" starts here: Linda taps Settings at the top right (1 s) → Settings: "Your email: Connected since Oct 28", "Thomas, your grandson: Ready to help" (2 s) → What Prudence knows about you → Look: her orders by Amazon Logistics and UPS, her bank, her people, each with Remove (2 s). If the Nov 1 rehearsal frees 8 s before 0:27: "Your email is connected", "Move it to my Scam folder" (3 s) → "Who do you ask when something feels wrong?", Thomas typed, "Invite Thomas" (3 s) → "You are protected" (2 s) → Today. Film at Largest, 390 × 844, on a fresh test Gmail or a local test person with "Show the welcome steps".

## Out of scope
New backend capabilities, filed as Ideas in `_product/spec.md`: WhatsApp knowing it is you, "Save Prudence in WhatsApp", telling the trusted person when protection is turned off, a trusted person reached by mobile number only, putting back an item removed from What Prudence knows. Also: redesigning My people and the pairing screen (Change and Add a phone open them as they are); dark mode; languages beyond EN/FR; a name editor (the name comes from Google; today's name step goes); the breach question (it stays in What Prudence knows); data export (an Idea already).

## Acceptance
- `tests/settings.test.js` (Postgres, mock LLM, skipped with a reason without it), named after the lines: the email row's facts (3); stopping stops Gmail push, revokes Google's access, keeps the account, people and verdicts, writes `gmail_stopped`, the poll and the push skip it, a new Google sign-in reconnects (3, 4); `PATCH /api/me` takes `readAloud` true or false and refuses anything else (9); a phone number saved in one shape, a malformed one refused with 400, empty clears it (6); Delete my account still erases every row, the new columns included (11).
- `tests/setup.test.js` (no database, no DOM): which rows show for a senior, a trusted person and a local test person (2); the welcome from a status: steps 1 to 4 then "You are protected" the first time, done steps shown as done, never after Go to Today, the one email screen when access is lost but not after a stop (14–21); every `settings_*` and `welcome_*` key in English and French, with no technical word (23).
- Manual, before Built: each canvas frame rebuilt at 390 × 844 at Normal, Larger and Largest, EN and FR, nothing cut, no horizontal scroll, the tab bar never over a button; keyboard only and VoiceOver; `/plan-design-review` on the canvas before the build and `/design-review` after (`_product/docs/design.md`); a reading check with one senior outside the team; `node scripts/docs-check.mjs` 0 errors; the lines that describe today's welcome and Settings move with it (`specs/senior-verdict-screen.md` 9, `specs/gmail-connection-and-scanning.md` 2, `specs/privacy-and-account.md` 4–5, `specs/life-context.md` 8).

## Implementation pointers
- Built as `public/js/views/settings.js` (the screens: Settings, people, phone, what Prudence knows, what it did, delete; pure helpers tested in `tests/settings-view.test.js`) and `public/js/protects.js` (the channel rows) on 2026-11-04; the plan below named `public/js/setup.js`.
- `public/js/setup.js` (new, no DOM): the one list of what Prudence is connected to or knows: each item's row (state words from `/api/status`, `/api/guardians`, `/api/devices`, `/api/context`, `/api/audit`), its welcome step if any, whether losing it brings the welcome back; Settings and the welcome both read it, so a new capability is one entry here.
- `public/js/views/settings.js` (new; `renderSettings` leaves `public/js/views/pages.js`): the rows, `#/settings/knows`, `#/settings/history`, `#/settings/stop`, line 4's confirmation.
- `public/js/views/welcome.js` (new; `renderOnboarding` leaves `pages.js`): the steps, their done states, Skip for now, Listen (`speak()` in `public/js/ui.js`).
- `public/js/main.js`: the Settings button on every signed-in screen, Sign out out of the top bar, the welcome route (`!u.onboarded`), the one email screen on `gmail.needsReconnect` (once per visit, in memory), the language button during the welcome. `public/js/views/today.js`: the "not checking" state; with Read aloud on, `readAloud(verdict)` when a card is painted.
- `public/js/i18n.js` (`settings_*`, `welcome_*`, `history_<event>`, EN and FR; the unused `onb_*` go), `public/styles.css` (`.set-row`, the stepper from `.learn-*`).
- `src/routes/account.js`: `/api/status` adds the mailbox address, `connectedAt`, `stopped`, `local`, `readAloud` (and `phone`); `PATCH /api/me` takes `readAloud` and `phone` (the guardians' `cleanPhone`, shared); `POST /api/gmail/stop` runs the Gmail stop and Google revoke that `DELETE /api/account` runs, marks the token row `revoked` without its tokens, audits `gmail_stopped`. `src/routes/auth.js`: the Google callback sets `connected_at` again.
- `src/routes/devices.js` and `src/routes/guardians.js`: unchanged. `src/jobs/scheduler.js`, `src/sync/worker.js`: confirm the poll and the push skip a `revoked` token.
- `src/db/migrations/008_settings.sql`: `users.read_aloud boolean NOT NULL DEFAULT false`, `users.phone text` (question 1), `gmail_state.connected_at timestamptz` filled from `users.created_at`. The welcome keeps `users.onboarded`: an `onboarded_at` column adds nothing the flow reads.

## Open questions (Vlad and Hadrien)
1. Your mobile number: nothing reads it yet (WhatsApp judges the message alone, `specs/whatsapp-channel.md` line 7). Ship step 3 and its row only with the Idea "WhatsApp knows it is you" (the reply then knows her orders and people), or now, kept for later? Recommendation: with the match or not at all (minimum data); without it the welcome asks three questions.
2. Step 1 keeps the one consent the security review asked for (move sure scams, or only mark them). Keep it there, or default to "only mark" and leave it to Settings (one question fewer, but the first page promises "Scams are labeled and moved to a Prudence folder")? Recommendation: keep it.
3. "Stop checking my email" is the one new server route (Delete my account's stop and revoke, the account kept) plus Today's "not checking" state. Keep it for Nov 4, or let Delete my account be the only way to stop? Recommendation: keep it; the email row needs an action.
4. Read aloud on speaks each verdict as soon as its card opens; off by default, because a phone that talks in a waiting room shares the verdict. Phone browsers may refuse to speak before a tap; the Listen button stays the way then. Off by default?
5. The word in the top bar: "Settings" / "Réglages" (what phones and the app already say) or "My account" / "Mon compte"?
6. Video: zero new seconds unless the rehearsal frees eight before 0:27 (Demo path). Hadrien's call.
