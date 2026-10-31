# Scam Shield: 3-minute demo video plan

Rules that shape the video (see [../research/hackathon.md](../research/hackathon.md)): show only what was built during the event; judges score from the video (Demo 25%, and the top-5 final is decided by judges watching the videos live); public repo; due Wed Nov 4, 9:00 PM ET. Principle: **every pixel in the video is a feature built between the Oct 26 kickoff and submission**; anything older is left out or labeled on screen.

## Two cold-open options (0:00–0:20)
- **A. The 9 pm text.** A phone lights up on a kitchen table: "Your parcel is held. Pay €2.90 to release it." Narration: "Gmail blocks 99.9% of phishing. This one got through. Linda is 74, it is 9 pm, and nobody is awake to ask."
- **B. Reverse the roles (Vlad's frame).** A card with Meta's line from "The Future is for Everyone": "Will it be centralized and restricted to a few institutions, or will it be a tool that empowers everyone?" Narration: "Today the people using AI against seniors are the scammers: cloned grandchild voices, phishing with no typos. What if we reversed the roles and put the same AI on her side?" Cut to the phone. Sources for both claims are in [pitch.md](pitch.md).

## Storyboard
| Time | Scene | On screen | Narration (gist) | Criterion |
|---|---|---|---|---|
| 0:00–0:20 | Cold open A or B | Phone, kitchen, the scam message | The problem: one person, one evening | Impact |
| 0:20–0:50 | The verdict screen | Senior web app, 19px+ type, 64px buttons. Card: "Scam. This message says Chronopost. Your parcels come by Amazon Logistics. The link was registered 3 days ago." Buttons: Read aloud, Ask my trusted person, Put it back | "Scam Shield does not just say 'suspicious'. It judges the message against Linda's own life: her real orders, her carrier, her bank, the people she writes to." | Impact, Demo |
| 0:50–1:25 | How it knows | Split screen: the Gmail inbox gets the "Scam Shield/Check first" label live via push; the "What we know about you" panel (providers, orders, carriers, contacts, ticked breaches, each removable); then a 5-second engine diagram: detector evidence → Muse Spark (Standard mode, redacted input) → schema-checked JSON verdict with reasons and evidence → two-way guardrail. Raw JSON on screen for 4 seconds. Accuracy card: "500 held-back emails: phishing called Scam 32% → 79%; false Scam 0 of 250." | "Meta's Muse Spark reads the redacted message, her context and the detector's evidence, and answers in a fixed schema. It can neither clear a proven scam nor condemn a sender she knows." | Meta AI tooling, Technical depth |
| 1:25–1:55 | Ask my trusted person | Tap. Preview of exactly what is shared. The guardian's phone: an email with one-tap buttons Scam / Real / I'll call you. Tap "Scam". Linda's screen updates live. | "One tap shows a guardian only what she chose to share. The answer lands on her screen while she waits." | Demo, Impact |
| 1:55–2:20 | Texts on the phone | Android: "Hi Grandma, it's Ethan, new number, send $300 today" → on-device pre-screen → verdict "Be careful: a typed name is a claim; this is not Ethan's saved number." Then a WhatsApp screenshot is checked: Muse Spark reads the image. | "The Android companion screens texts on the phone and sends only risky ones. Screenshots and photos work too: read by Muse Spark, never stored." | Meta AI tooling, Demo |
| 2:20–2:40 | Safety and privacy | Four lines appear: never sends, trashes or deletes; Put it back undoes any move; mail bodies never stored; Standard mode only, nothing trains Meta's models; links are never opened to judge them. | "Built for a frightened 74-year-old at 9 pm: one decision per screen, reversible, private." | Technical depth |
| 2:40–3:00 | Close | Title, team, repo URL, "Built Oct 26 – Nov 4, 2026 with Muse Spark (Meta Model API)". | "Scam Shield judges every message against your life, and puts a person you trust one tap away." | Impact |

Timing rule: narration at about 140 words per minute means about 400 words in total; write it to the second and read it aloud with a stopwatch. Cut anything that pushes past 2:55.

## What must be on screen at least once
The Gmail inbox with labels moving by themselves; the senior's verdict card (the life-context sentence is the money shot); the guardian's phone answering; the Android SMS verdict; the Muse Spark JSON and the accuracy numbers; the "What we know about you" panel; the repo URL and the build-window statement.

## Preparation checklist
- [ ] Test Google account (Testing-mode OAuth client, test user added) with a **seeded inbox**: about ten genuine mails (an Amazon order, a bank statement, a friend's reply, a newsletter), three scams (fake carrier, fake bank debit, "it's Ethan"), one "Check first" case. Synthetic or redacted only; no real .eml in the repo.
- [ ] Test profile "Linda" (EN) or "Françoise" (FR) with context learned from the seeded mail; a guardian account on a second device with a real mailbox.
- [ ] Muse Spark key with credits claimed (by Nov 4, 9 PM ET), reasoning effort "low", cache warmed by running the demo messages once (the per-user cache makes replays instant).
- [ ] Android: a real phone or the emulator loaded with `testcases/sms_seed.json`; screen-record it separately.
- [ ] Screen recording at 1080p (QuickTime or OBS), browser zoom so the 19px type reads on a phone-sized video, cursor highlighted; no secrets, no real addresses, `.env` never on screen.
- [ ] Narration recorded separately (quiet room, one take per scene); captions burned in, large and high-contrast, because judges may watch muted; English only.
- [ ] Each scene recorded as its own clip; assemble, export, watch once on a phone and once muted.
- [ ] Upload (YouTube, unlisted or public), open the link logged-out, put the link in the README; post on X after submission for the Most Viral prize.
- [ ] Repo public, secret scan done, "Built during the hackathon" section in the README; open it logged-out.

## Fallback plan if live parts fail
| Failure | Fallback |
|---|---|
| Muse API slow or down | Replay the same messages (cache hit) or show the detector fallback honestly ("degraded verdict, Muse unavailable"); a pre-recorded clip of the scene as last resort |
| Gmail push does not fire | Polling backup or the manual "Check now"; cut the wait in editing |
| OAuth client not approved in time | `/#/demo` with the public examples, labeled "demo data" on screen; keep the real-Gmail clip for a later cut |
| Guardian email not delivered | The guardian answers on the dashboard; show the one-tap email from an earlier recording |
| Android build breaks | An emulator recording made on a good day; never show a crash |
| Over 3:00 | Reduce the privacy scene to one caption line and shorten the cold open; the life-context verdict and the guardian loop are never cut |
