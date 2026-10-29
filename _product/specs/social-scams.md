# Social and job-offer scams (LinkedIn recruiters, pig butchering)
Status: Idea · Raised by Vlad, 2026-10-29 · Discussed: no · Last updated: 2026-10-29

## Why
The costliest scams are conversations, not single messages: a stranger on LinkedIn, Instagram, a dating app or a "wrong number" text builds trust for days or weeks, moves the talk to WhatsApp or Telegram, then asks for a deposit, an ID scan, or to open a "hiring file" (crypto investment fraud was Americans' largest loss in 2025, $7.2B, FBI IC3). No platform sees the whole path; the person does. On video it is the moment Muse Spark reads a whole conversation and says what the scammer will ask next. Research: `research/social-scams.md`.

## Behavior
1. "Check something" gains "Or a conversation": the person pastes a chat or adds up to three screenshots (the chat, the profile, the app's "About this account" page) and gets one card judged on the whole conversation, never on the last message alone.
2. On WhatsApp, messages the same person forwards to Prudence within 3 seconds are judged together and get one reply.
3. When the conversation follows a known scam path (new friend then investment, fake recruiter, paid tasks, romance then money), the card says in plain words where it stands ("He wrote to you by mistake, moved you to WhatsApp and now shows you his profits") and what usually comes next ("Next he will ask you to put money on his app, then for a fee to take it out").
4. A first message from an unknown number that looks like a wrong number ("Hi, is this Mary?") gets Be careful: "Do not answer. This is how many investment scams start."
5. A profile screenshot is read for what the platform shows (when the account was made, the country it is based in, verification, followers, the job and company it claims); the card quotes only what is visible on it.
6. Before a verdict on a conversation, two big questions can be answered or skipped: "Did they write to you first?" and "Have you met them in person?"; the answers become reasons ("You have never met him") and live only in that verdict.
7. When the person is signed in, the card can use their life: "You have not applied to this company in the emails we read", "He is not one of your trusted people"; it never claims more than what it read.
8. A message that asks to paste a command (Terminal, PowerShell, the Run box), to install an "interview" or "trading" app from outside the app stores, or to pay a fee or tax before taking one's own money or earnings out is a Scam, whatever else it says.
9. A file forwarded on WhatsApp or chosen in "Or a file" (up to 25 MB) is checked without being opened: the card says what it really is ("a program dressed up as a PDF", "a locked archive with a program inside", "a shortcut that runs a command") and, when security companies already know it, that they flagged it.
10. The file is never opened, run, unpacked to disk, kept or uploaded; only its SHA-256 fingerprint is looked up on VirusTotal, and the card says "We did not open your file."
11. A link to a code project (GitHub, GitLab, Bitbucket) is read through the host's public API, never downloaded or installed; the card says what would run on install or when the folder opens in an editor.
12. A trading website or app pushed in the conversation is checked for its age, for links that bypass the app stores and, in France, against the AMF blacklist; a hit becomes a reason.
13. When a verdict involves money or investment, the first button is "Ask <trusted person> before you send anything", sent through the existing trusted-person loop with the stage summary.
14. Nothing is scraped: Prudence never opens LinkedIn, Instagram, Facebook or dating-app pages and judges only what the person shows it. Screenshots, photos and files are never stored; only the verdict is kept, as today.
15. A photo is never called fake from its look, and no face recognition is ever run.

## Demo path
Linda's phone, WhatsApp open on "Daniel" (he wrote to her "by mistake" on Instagram three weeks ago): "My uncle's app made me $8,400 this month. Start with $500, I will guide you." She selects his last messages, taps Forward, picks Prudence; seconds later one reply lands: "Scam. This is the 'new friend, then investment' trick: he wrote to you by mistake, moved you to WhatsApp and now shows you his profits. Next he will ask you to put money on his app, then for a fee to take it out. Do not send anything. Show this to Thomas." Narrator: "Meta's Muse Spark reads the whole conversation, not one message, and sees where it is going before the money moves." Optional 5 s: a developer forwards `Assignment.pdf.exe` (the harmless EICAR test file) and reads "Do not open this file. It is a program, not a PDF." Needs the WhatsApp test number, the tunnel and Linda's phone on the allowlist; fallback: the same chat pasted in Check something at phone width.

## Out of scope
Scraping, automating or signing in to LinkedIn, Instagram or Facebook; reading the person's messages through any API; running files or repos (no sandbox); uploading files to VirusTotal or any other service; face search (PimEyes and the like); Messenger, Telegram and Instagram channels (their own Ideas); the new-friend timeline, the photo web search and the LinkedIn chip in the Chrome extension (Ideas in the research file); reporting accounts to the platforms (`specs/report-upstream.md`).

## Acceptance
- `tests/social.test.js` (mock LLM): a pasted six-turn chat reaches `runCheck` as `threadHistory` and the card carries the stage and the next move (1, 3); three WhatsApp forwards within 3 s get one reply (2); a wrong-number opener is Be careful (4); a command-paste, a store-bypass app link and a withdrawal fee are Scam (8); a profile screenshot no longer answers 422 and the card quotes only facts present in the mock transcription (5); the two answers appear as reasons and nowhere in storage (6, 14).
- `tests/fileInspector.test.js`: `Offer.pdf.exe`, a zip holding an encrypted `.lnk`, an ISO and a `.docm` with `vbaProject.bin` are flagged; a plain PDF is not; the EICAR string built at run time gets the mocked VirusTotal answer; the client only ever calls `GET /files/{sha256}`; nothing is written to disk (9, 10).
- A fake GitHub API: `postinstall` and `.vscode/tasks.json` with `runOn: folderOpen` are flagged (11); an AMF list hit and a young domain become reasons (12).
- New seed cases in `testcases/cases.json` (pig-butchering arc, task scam, fake recruiter on WhatsApp, command-paste, wrong-number opener, a genuine recruiter) hold in `make score` with no new false Scam.
- Manual: the multi-forward live on the WhatsApp test number; the conversation card at phone width with text size Largest; the design agreed before the build (`_product/docs/design.md`).

## Implementation pointers
- `lib/muse.js`: `extractFromImage` gains chat and profile modes (messages with who and when; profile facts); `buildUserPrompt` already sends `thread_history`, add a `social_profile` block; bump `PROMPT_VERSION`.
- `prompts/scam-shield-system.md`: the four scam paths and "say what usually comes next"; never call a photo fake.
- `lib/detector.js`: opener, platform hop, investment talk, withdrawal fee, task words, command-paste and store-bypass signals; the thread rule beyond affection words; `RISKY_ATTACHMENT` extended, its reason worded per file type.
- `lib/schema.js`: scam types `job_offer`, `task_scam`, `investment_platform`, `malware_file`; evidence kinds `file` and `profile`, with their chips in `public/js/i18n.js`.
- `src/routes/mail.js`: `/api/check/text` accepts turns, `/api/check/image` up to three pictures, a new `/api/check/file` (multipart, in memory).
- `lib/fileInspector.js` (new): magic bytes, double extension, zip central directory with the encryption flag, LNK, ISO, script and macro flags, SHA-256; `src/links/virustotal.js` (new): rate-limited, cached `GET /api/v3/files/{sha256}`, key `VIRUSTOTAL_API_KEY` (`_product/docs/secrets.md`).
- `src/channels/whatsapp.js`: the `document` branch (today "I can only check texts, pictures and voice notes") and the 3 s grouping per sender.
- `src/links/resolver.js`, `lib/linkInspector.js`: store-bypass links; a daily AMF list job beside `src/jobs/threatfeed.js`; `src/links/repo.js` (new) for code projects.
- `src/context/builder.js`, `lib/context.js`: job applications learned from genuine mail, like orders.
- `public/js/views/pages.js` renderCheck ("Or a conversation", "Or a file", the two questions); `public/js/views/today.js` (the money-first Ask button); `data/lessons/en|fr/` (the wrong-number friend, the job that pays you to like videos).

## Open questions
- Stage and next move: new verdict fields (schema, cache key, UI, guardian view) or reasons only?
- VirusTotal's free API is non-commercial: fine for the hackathon; at launch a licence, MalwareBazaar (our abuse.ch key is refused) or local checks only?
- WhatsApp has no account matching yet, so the life-context lines (7) work only in the app; is that acceptable for the video?
- Does the developer persona (files, repos, command-paste) get 5 s of the video or only the README?
- Which part, if any, earns Planned before Nov 4: the conversation (1-4), the file (9-10) or "Who is this?" (5-6)?
