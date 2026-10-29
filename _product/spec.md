# Scam Shield — Product Spec

**One-liner:** Scam Shield tells an older person, in plain words and within seconds, whether a message in their Gmail or on their phone is real *for them*, by checking it against their own life (their bank, their orders, the people they write to) with Meta's Muse Spark, and lets one tap bring in a trusted family member.

**Target user:** a senior (70+, US first, France second) who reads email in Gmail and texts on an Android phone, is frightened by official-looking messages, and wants one clear answer and one next step.
**Secondary user:** the trusted person (son, granddaughter, caregiver) who gets a one-tap "Scam / Real / I'll call you" request and only ever sees what the senior chose to share.
**Hackathon context:** Meta Global AI Developer Hackathon 2026 (Cerebral Valley), Indie track, "Build for Your World"; due Wednesday Nov 4, 2026, 9:00 PM ET with a 3-minute demo video, a public GitHub repo and every teammate registered. Team: Hadrien Baradel (product, built everything so far), Vlad Zloteanu (joining as CTO).

Last updated: 2026-10-29

## Principles
- Demo-first: every feature must be showable in the 3-minute video. If it cannot be shown, it is cut or deferred.
- Senior-first: one screen, one verdict, plain words. 19 px+ type, 64 px buttons, read aloud, no jargon ("website address", not "domain").
- It knows your life: the verdict is about *this* person's orders, providers and contacts, not about the message alone. Muse Spark judges meaning; the rule detector supplies facts and guardrails.
- Reverse the roles: scammers use AI against the vulnerable; this puts the same AI on the senior's side.
- Never destructive, always reversible: no send, no trash, no delete; label by default, move only with consent, "Put it back" undoes everything; nothing a model says can hide mail from someone the user knows.
- Privacy by default, minimum data: no human reads the senior's email unless the senior chooses to share one (for example with family for a second opinion); bodies are never stored, personal numbers are redacted before Meta sees them (Standard mode only), the guardian sees only what was shared, delete-my-account erases every row.

## Features
Statuses: **Idea** (raised, not decided) · **Planned** (decided, not started) · **Partial** (some behavior lines work) · **Built** (in the code and tested) · **Dropped** (decided against, reason kept). Ideas live in the table below the features.

| Feature | Status | One-line spec | Details |
|---|---|---|---|
| Gmail connection and scanning | Built (unverified live) | Sign in with Google once; every new inbox message is checked within seconds (push) or minutes (poll), the latest 50 on first run. | [specs/gmail-connection-and-scanning.md](specs/gmail-connection-and-scanning.md) |
| Verdict engine (rules + Muse Spark) | Built | One strict JSON verdict per message: Safe / Be careful / Scam, headline, up to three checkable reasons, one next step, in EN or FR; detector facts in, guardrails out. | [specs/verdict-engine.md](specs/verdict-engine.md) |
| Life context ("What Scam Shield knows about you") | Built (unverified live) | Learned from the user's own genuine mail: providers, orders and carriers, subscriptions, correspondents, breaches; every item visible and removable; a typed name never counts as a trusted contact. | [specs/life-context.md](specs/life-context.md) |
| Senior web app and verdict screen | Built | Mobile first (V2): "Today", then one message at a time with two big buttons (Throw it away / Ask, or Call the real person), optional slide, Undo; read aloud, EN/FR, three text sizes, keyboard and screen-reader access, 4-step onboarding; the two-pane inbox stays for testing. | [specs/senior-verdict-screen.md](specs/senior-verdict-screen.md) |
| Reversible mail actions | Built (unverified live) | Be careful → "Check first" label; Scam → "Scam" label and, only with consent, moved out of the inbox; Put it back / Take it away with one tap; never deleted. | [specs/reversible-mail-actions.md](specs/reversible-mail-actions.md) |
| Trusted person loop | Built | Invite a guardian by email; "Ask my trusted person" shows a preview of exactly what is shared, then sends it as a text from the senior's own phone (Messages or WhatsApp) or by email; the guardian answers Scam / Real / I'll call you by one-tap link or dashboard; the answer appears live on the senior's screen. | [specs/trusted-person-loop.md](specs/trusted-person-loop.md) |
| Check something else (text, picture, voice note, .eml) | Built | Paste a text or WhatsApp, upload a screenshot (read by Muse Spark, never stored), a voice note or voicemail (transcribed by Muse Voice Transcribe, never stored) or an email file; same verdict card, same Ask button. | [specs/check-something-else.md](specs/check-something-else.md) |
| Android SMS companion | Built (emulator only) | A paired Android app pre-screens incoming texts on the phone, sends only risky ones for a verdict, and shows one big red/amber/green screen with read-aloud and Ask. | [specs/android-sms-companion.md](specs/android-sms-companion.md) |
| Link checks (age, redirects, blocklists) | Partial | Links are judged without being opened: website age from the registry, address tricks, redirects followed only for shorteners or on request; URLhaus lookups exist but the key is refused. | [specs/link-checks.md](specs/link-checks.md) |
| Threat feed and pattern cards | Built (unverified live feeds) | Daily IC3 and cybermalveillance.gouv.fr alerts become candidate scam cards; only a human on the admin page can activate one; a candidate can never push a verdict to Scam. | [specs/threat-feed.md](specs/threat-feed.md) |
| Demo mode (public examples) | Built | `/#/demo` judges 36 seed messages for Linda (US) and Françoise (FR) with the real engine, no sign-in; the backbone of the video. | [specs/demo-mode.md](specs/demo-mode.md) |
| Privacy controls and account deletion | Built | No bodies stored, verdicts kept 90 days, encrypted Google tokens, an audit list of every action, "Delete my account" revokes Google access and erases every row. | [specs/privacy-and-account.md](specs/privacy-and-account.md) |
| Chrome extension ("Check this" in Gmail web) | Planned | Docs call it "next"; no code yet. | [specs/chrome-extension.md](specs/chrome-extension.md) |
| Public deployment and Google verification | Planned | Railway EU, OAuth verification, CASA, Resend for real guardian email; not before the hackathon. | [specs/public-deployment.md](specs/public-deployment.md) |
| CI workflow (tests + score on Postgres, Android tests + build) | Built | Every push runs `make check` and `make score` on Postgres and builds the Android debug APK (downloadable from the run) with its unit tests; green on main (Oct 29). | [specs/public-deployment.md](specs/public-deployment.md) |

## Ideas (not yet planned)
Discussed = a conversation between Hadrien and Vlad ("no", or date + with whom); being written in the PRD or STATUS does not count. A session can grep `| no |` to surface undiscussed ideas.

| Idea | Where it came from | Discussed | One line | Details |
|---|---|---|---|---|
| Second opinion: "Something feels off? Ask." | Vlad, 2026-10-27 | no | Send a screenshot or forward a message and get a verdict from the service or from a trusted human (son, daughter); two paths, automated and human-in-the-loop. | [specs/second-opinion.md](specs/second-opinion.md) |
| Pressure coach / "negotiate for me" | Vlad, 2026-10-27 | no | "Is this a good offer? Am I being pressured?" guidance, possibly from recorded audio (a call, a doorstep pitch) with real-time advice. | [specs/pressure-coach.md](specs/pressure-coach.md) |
| Micro-learning (gamified anti-scam lessons) | Vlad, 2026-10-27 | no | Short lessons the way Elba or Riot train employees ("if it is urgent, verify through another channel"), drawn from the senior's own flagged messages. | [specs/micro-learning.md](specs/micro-learning.md) |
| Breach exposure | Vlad, 2026-10-27 | no | Show which breaches included the senior's data (HIBP and breach news: impots.gouv, health data) and feed it into lessons and the verdict context. | [specs/breach-exposure.md](specs/breach-exposure.md) |
| Privacy by default | Vlad, 2026-10-27 | no | No human reads the senior's emails unless the senior chooses to share one (e.g. with family for a second opinion); now a Principle, to be reflected in every feature. | — |
| Report upstream: "Make the world a better place" | Vlad, 2026-10-27; code: schema action `report` is never produced | no | One tap "Report this" after a confirmed scam reports the links, sender, number, ad network and authorities (FTC, Signal Spam / Pharos, 33700 / 7726) on the senior's behalf, batched, with none of the senior's data; the card shows "Reported to 4 places". | [specs/report-upstream.md](specs/report-upstream.md) |
| Sandboxed link screenshot service | PRD not-yet-built; `lib/linkInspector.js` placeholder; PRD open decision (sandbox hosting) | no | A headless browser in an isolated container renders the landing page so the card can show the fake bank page. | [specs/link-sandbox.md](specs/link-sandbox.md) |
| On-device pre-screen with Muse Glimmer | PRD; `PreScreener.kt` stub ("runtime TBD"); PRD open decision (mid-range Android) | no | Replace the regex gate in the Android app with an on-device model so fewer texts leave the phone. | [specs/on-device-prescreen.md](specs/on-device-prescreen.md) |
| Voice-note check (Muse Voice Transcribe) | PRD | yes | Built 2026-10-27 (`35ff6e0`) as part of "Check something else"; remaining for the demo: a seeded 15 s "it's Ethan" voice note in demo mode. | [specs/check-something-else.md](specs/check-something-else.md) |
| QR code and logo spotting in screenshots (SAM 3.1 or a decoder) | PRD; STATUS "suggested next" | no | A scanned QR becomes a link for the link checks; today a "scan this code" sentence is only a Be careful signal. | — |
| iOS share-sheet check | PRD | no | Share a text or screenshot from an iPhone into Scam Shield. | — |
| "Scam of the week" image (Muse Image) | PRD | no | A weekly picture of the current scam for guardians and seniors. | — |
| FTC consumer alerts as a feed source | PRD; STATUS | no | Fourth threat-feed source; no working RSS URL found yet. | — |
| Real `.eml` import of Françoise's Gmail | PRD | no | Redacted real emails (`messages.import`) replace the synthetic A-case bodies. | — |
| Filmed comprehension test with three seniors | PRD | no | Three seniors read a card and say what they would do; the PRD's acceptance test for the senior screen. | — |
| Guardian channel beyond email (web push or WhatsApp) | PRD open decisions; STATUS | no | Email is slow for a 9 pm scam; a push or WhatsApp message would reach the family faster. | — |
| Automatic breach lookup for launch (HIBP vs curated list) | PRD open decisions; STATUS; `hibpBreaches` needs a paid key | no | Decide whether launch uses the curated eight breaches, HIBP, or both (see Breach exposure). | — |
| Close the detector's misses when Muse is unavailable | STATUS "suggested next" | no | Number-only hosts and free hosting without sign-in words still pass the rules alone. | — |
| Remaining Medium items from the Codex review | STATUS | no | Unlisted in the repo; needs the review notes. | — |
| Phone numbers for trusted people | This review (life-context, android specs) | no | Let the senior save a grandson's number so a text from the real number comes out Safe. | — |
| Hide the message text behind a button on a Scam card | This review (senior screen) | no | Prevent a reflex tap on the link while still allowing "show me anyway". | — |
| Guardian checks a message on the senior's behalf | This review (check-something-else) | no | "Check something" from the guardian dashboard. | — |
| Paste-your-own-message in demo mode without sign-in | This review (demo-mode) | no | Lets a judge or visitor try their own message in 10 seconds. | — |
| Plain-words source line on the card | This review (verdict-engine) | no | Replace "Judged by Muse Spark (muse-spark-1.3)" with words a senior understands. | — |
| Show the detector verdict first, refine with Muse | This review (verdict-engine) | no | Cuts the perceived wait from ~4 s to instant on the senior screen. | — |
| Show a matched campaign's source to the senior | This review (threat-feed) | no | "Reported by the FBI on Oct 20" next to the pattern reason. | — |
| Auto-alert guardians by default for money scams | This review (trusted-person-loop) | no | Protection for seniors who never tap "Ask", at the cost of sharing without a tap. | — |
| Move "Check first" mail to its own folder too | This review (reversible-mail-actions) | no | For users who want a calmer inbox; today Be careful mail only gets a label. | — |
| Data export ("give me my data") | This review (privacy) | no | May be required for CASA alongside deletion. | — |
| "Investigate": Muse Spark as a verifiable tool-using agent | research/score-meta-tooling.md, 2026-10-27 | no | On a Be careful card or in Check something else, Muse Spark calls website-age (RDAP), blocklist, life-context and pattern-card tools plus Meta web search; the card lists every check with its result and each reason cites one. | — |
| Reasoning summary for the guardian (Responses API) | research/score-meta-tooling.md, 2026-10-27 | no | The verdict call moves to the Responses API with `reasoning.summary: concise`; the optional summary (never raw thought) appears as "Why Scam Shield thinks so" on the guardian view and in the audit list. | — |
| Injection shield with Llama Prompt Guard 2 | research/score-meta-tooling.md, 2026-10-27 | no | Bodies and screenshot text are scanned in 512-token chunks; "malicious" becomes a strong detector signal with the reason "This message tried to trick the AI that checks your mail." | — |
| Open-weights mode (Muse Spark Open on Baseten) | research/score-meta-tooling.md, 2026-10-27 | no | One env switch runs the same engine, prompts and guardrails on Meta's open-weight model; `make score` numbers published side by side; the basis for a self-hosted edition and the open-weights bonus. | — |
| Faithfulness grader (Muse as judge) | research/score-meta-tooling.md, 2026-10-27 | no | A second Muse pass checks that every reason on the 500-email set cites a fact present in the inputs; the number goes on the accuracy card and in the README. | — |
| Read the attached invoice (PDF input) | research/score-meta-tooling.md, 2026-10-27 | no | A PDF attachment under a size cap is sent with the message so a fake invoice's bank account or amount becomes evidence; today only names and types are sent. | — |
| Demo-only public URL | research/score-demo-and-technical.md, 2026-10-27 | no | Demo mode and paste-your-own without sign-in at a public address, rate-limited, key server-side, no Google scope; a judge opens the live product in ten seconds and it is the live-final fallback. | — |
| Realistic demo inbox | research/score-demo-and-technical.md, 2026-10-27 | no | Replace "Example D1 · sms" with sender names, dates and a short subject so the demo reads as Linda's inbox, not a fixture list; keep the ids in a tooltip. | — |
| "What Scam Shield knows about Linda" in demo mode | research/score-demo-and-technical.md, 2026-10-27 | no | Show the seed profile's providers, orders, contacts and breaches next to the demo inbox, read-only, so the life-context claim is visible without sign-in. | — |
| Evidence chips on each reason | research/score-demo-and-technical.md, 2026-10-27 | no | Each reason carries its `evidence` kind in plain words (the sender, the link, your orders, a breach, our rules) so the judge sees the pipeline on the card. | — |
| Pre-recording health check | research/score-demo-and-technical.md, 2026-10-27 | no | `make demo-precheck`: model key and `/v1/status`, Postgres, warm cache, tunnel, email provider; run before every recording and the live final. | — |
| Forward-to-check@ mailbox | research/detection-channels.md, 2026-10-28 | no | From any mailbox or phone the senior forwards a mail to `check@` and gets the verdict mail back; 0.5 day on a polled Gmail mailbox (1-1.5 days with a branded Resend address); By Nov 4: Yes. | — |
| Gmail add-on card on web and phones | research/detection-channels.md, 2026-10-28 | no | Inside Gmail (web side panel, an icon at the end of the open message on phones) a card says "This is a scam" with "Ask my daughter"; Apps Script, 1.5-2 days; By Nov 4: Yes (second tester account Stretch). | — |
| Android notification access for RCS, WhatsApp and Messenger | research/detection-channels.md, 2026-10-28 | no | The companion reads message notifications (RCS, WhatsApp, Messenger, Telegram) after one toggle and pops the red screen on a money ask; 1.5-2 days; By Nov 4: Yes. | — |
| Android "Check with Scam Shield" in the text-selection menu and share sheet | research/detection-channels.md, 2026-10-28 | no | Select text in any app or share a screenshot to Scam Shield and get the card; 0.25 day plus 0.5-1 day, no permission; By Nov 4: Yes. | — |
| Android default assistant "long-press to ask about my screen" | research/detection-channels.md, 2026-10-28 | no | Holding the power button hands Muse Spark a screenshot and the text of the current app; 2-3 days, replaces Gemini on the phone; By Nov 4: Stretch. | — |
| Android link gate (default browser interstitial) | research/detection-channels.md, 2026-10-28 | no | Every tapped link from Messages, WhatsApp or Gmail is checked first: "Go back / Open anyway", then Chrome; 2 days (+0.5 Custom Tabs stub); By Nov 4: Stretch. | — |
| Android outgoing-call gate | research/detection-channels.md, 2026-10-28 | no | Dialing a number from a judged scam text shows a full-screen Stop card before it rings (`CallRedirectionService`, no audio); 1.5-2 days; By Nov 4: Stretch. | — |
| iPhone screenshot shortcut on Back Tap or Action Button | research/detection-channels.md, 2026-10-28 | no | "Something feels off? Double-tap the back": a Shortcut screenshots any app, posts it with the device token and speaks the verdict; no app, no developer account; 0.5-1 day; By Nov 4: Yes. | — |
| iPhone Message automation | research/detection-channels.md, 2026-10-28 | no | A Shortcuts automation posts every incoming SMS and iMessage (sender, text) to the device-check route and the phone speaks "Be careful"; 0.5-1 day, set up by a relative in about 10 taps; By Nov 4: Yes (iOS 26 behaviour to test on day 1). | — |
| Voicemail by itself (carrier voicemail-to-email read by the sync) | research/detection-channels.md, 2026-10-28 | no | Free, Orange and SFR mobile lines and Free, Bouygues, Fios, Xfinity and Ooma home lines email the voicemail; the Gmail sync transcribes and judges it with zero taps ("Message left on your home phone"); 1-2 days; By Nov 4: Stretch (mobile), Yes (landline, with a sample email). | — |
| Landline answering number on forward-on-no-answer | research/detection-channels.md, 2026-10-28 | no | Unanswered home-phone calls reach a Scam Shield number that asks who is calling, records, judges, reads a safe message and tells the relative; 2-3 days on Twilio (French number lead time); By Nov 4: Stretch. | — |
| Scare-page watcher in the browser extension | research/detection-channels.md, 2026-10-28 | no | The planned Chrome extension also watches any page: on a full-screen "your computer is infected, call this number" page it exits full-screen, covers the page with the verdict card read aloud and offers "Close this window"; 2.5-3 days plus 0.5 server; By Nov 4: Stretch. | — |
| NextDNS family denylist | research/detection-channels.md, 2026-10-28 | no | A confirmed scam host is pushed to the family's NextDNS profile so every device at home blocks it, iPhone included ("Blocked on every device at home"); 1 day plus 0.5 day of setup guide; By Nov 4: Yes. | — |
| WhatsApp "send it to Scam Shield" number | research/detection-channels.md, 2026-10-28 | no | Forward a message, image, PDF or voice note to a WhatsApp number and get the verdict in the chat (Cloud API test number, 5 phones); 2 days, needs the tunnel; By Nov 4: Stretch; today a non-goal ("WhatsApp only via paste/screenshot"). | — |
| Messenger bot | research/detection-channels.md, 2026-10-28 | no | A Facebook Page that answers forwarded Marketplace messages, images and audio with the verdict; 1.5 days for role holders, App Review plus Business Verification for the public; By Nov 4: Stretch. | — |
| Telegram bot | research/detection-channels.md, 2026-10-28 | no | A bot that judges forwarded photos, voice notes and documents, long polling with no public URL; the off-camera harness for every chat channel; 0.5-1 day; By Nov 4: Yes. | — |
| Phone hotline that speaks the verdict | research/detection-channels.md, 2026-10-28 | no | Dial one number, play the voicemail or read the letter after the beep, hear the verdict in French or English, press 2 to send it to the daughter; Twilio plus Muse Voice Transcribe; 1.5 days; By Nov 4: Stretch. | — |
| Meta glasses "look at the letter" | research/detection-channels.md, 2026-10-28 | no | On Ray-Ban Meta in Developer Mode the companion takes a photo from the glasses, Muse Spark reads the letter and the answer comes in the ear; 2 days (1 mock, 1 hardware), glasses in hand by Oct 30 or cut; By Nov 4: Stretch. | — |
| Siri and Alexa "ask" | research/detection-channels.md, 2026-10-28 | no | "Siri, is this a scam?" (a dictation shortcut, 0.5 day) and "Alexa, ask Scam Shield ..." (a custom skill with an Echo Show card, 1 day) speak the verdict on devices the senior already owns; By Nov 4: Yes. | — |
| "Protect this phone" checklist | research/detection-channels.md, 2026-10-28 | no | A guided page of the native settings a relative switches on (iOS 26 unknown callers and senders, Android 16 Advanced Protection, scam detection, Auto Blocker, Private DNS) with side effects and the install-first rule; 0.5 day of content; By Nov 4: Yes. | — |

## Dropped
- Legacy `/api/analyze` rules engine, explain layer and demo path (`lib/rules.js`, `lib/explain.js`, `lib/demo.js`): superseded by the detector + Muse Spark pipeline behind `/api/check` (commit 877a27d; restorable from d43ced6).
- Trusted-contact matching by display name: a typed name is a claim, only the saved address or number counts (commit e2ae428).
- Flagging mere mentions of gift cards, crypto or codes: the detector now flags asks, not keywords, so receipts and "we will never ask for your code" warnings are not scams (commit 9adcd29).
- Showing confidence as a percentage on the card: certainty is said in words, because the model cannot back a precise number (`public/js/ui.js`; the `confidence` string in `i18n.js` is unused).
- Google Safe Browsing / Web Risk: non-commercial licence only / paid. OPDB: paid licence. Hugging Face "IsThisSpam" model: no licence, and it detects spam, not scams (docs/STATUS.md licences).
- Reddit or forum scraping for the threat feed: official RSS/Atom feeds only (`src/jobs/threatfeed.js`). Tuning rules on abuse.ch URLhaus data: forbidden by its terms.

## Non-goals
- Filtering spam or marketing: the target is scams that cost people money, not newsletters (plain spam is excluded from the accuracy numbers on purpose).
- Replacing Gmail's own spam filter, or acting as a mail client: the app reads live from Gmail and only adds labels.
- Deleting, trashing, sending or replying to any mail, ever; moving mail from people or companies the user already knows.
- Contributor mode, fine-tuning or training anything on user mail.
- iOS, Play Store distribution, WhatsApp or voice calls as channels (the Android app is sideload-only; WhatsApp only via paste/screenshot).
- A public, multi-tenant service before Google verification and CASA (localhost and test users only until then).

## Open questions
1. B2/B12: Muse Spark calls "it's Ethan, new number, send $300" and the romance crypto ask **Scam**; the PRD expects **Be careful**. Accept Scam (the action "call them on the number you have" stays the same)? Owner: Hadrien.
2. Default action mode is label-only (post security review) while the onboarding copy calls "move" Recommended, and the video wants to show "moved out of the way" + Put it back. Which default do we ship and which do we film?
3. The demo depends on the live Gmail flow (OAuth client not yet created) and on guardian emails, which only leave the machine with a Resend key. Fallbacks: film `/#/demo` and `/dev/outbox`? Decide by Oct 29.
4. Decided 2026-10-28: **Linda (US, English)** leads the video; her trusted person is her grandson Thomas, the "new number" is Ethan; USPS and Amazon, not Chronopost ([marketing/video-script.md](marketing/video-script.md)).
5. Is the Android companion worth 30 seconds of a 3-minute video (sideload, emulator) versus the paste-a-text check that shows the same verdict screen?
6. Chrome extension before Nov 4: build it, or spend the days on the live-inbox gate, the video and the 3-senior comprehension test?
7. Answered 2026-10-27: the organizers (Discord #questions, confirmed by an organizer) count building from 12:24 PM ET on Oct 26; the first files are from 12:54 PM, so nothing predates the start ([../docs/PROVENANCE.md](../docs/PROVENANCE.md)). Remaining: the video opens with the one-line "pre-existing vs built this week" statement they require.
8. Which Idea, if any, earns a Planned slot before Nov 4: second opinion as a standalone entry point, the link sandbox, micro-learning from flagged messages, or none? Vlad's five ideas are undiscussed with Hadrien.
9. Decided 2026-10-28: the product is **Prudence**, tagline **"Ask twice"** (T-Mobile holds SCAMSHIELD; [research/naming.md](research/naming.md)). Store names: "Prudence: Is It a Scam?" / "Check with family first" (FR "Prudence : arnaque ou pas ?" / "Vérifiez avec un proche"). Rename the UI, Gmail labels, page titles, README and store copy before the video; code identifiers keep `scam-shield` until after Nov 4; the repo rename and a domain (heyprudence.app was free on Oct 27) are Hadrien's calls.
10. Decided 2026-10-28: the senior app is mobile first with the V2 layout ("Today", one message at a time, two big buttons, optional slide, Undo); desktop is for testing, the family and judges ([specs/senior-verdict-screen.md](specs/senior-verdict-screen.md)). The trusted-person request goes as a text from the senior's own phone, email stays available.

## How to change this spec
Change the spec first (`_product/spec.md` and the feature file under `_product/specs/`), then the code, then the tests. An Idea becomes Planned by a decision noted here, Partial when a behavior line works, Built when its Acceptance lines hold, Dropped with its reason kept; an Idea gets its own specs/ file only when it has more than one line of detail.
The full process, owners and review steps are in `_product/docs/product-process.md`.
