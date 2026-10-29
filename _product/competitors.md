# Scam Shield: competitive landscape

Researched 2026-10-27 for the Meta Global AI Developer Hackathon entry (deadline Nov 4, 2026). One file per major competitor under competitors/, minor ones grouped by category. "(unverified)" marks claims without a primary source. Market statistics with sources live in [research/scam-market-stats.md](research/scam-market-stats.md).

## Landscape

| Name | Category | Channels | For whom | Approach | Price | Detail |
|---|---|---|---|---|---|---|
| Gmail | platform | email | all | server-side ML ("99.9%" claim), auth rules, banners | free | [google](competitors/google.md) |
| Google Messages, Phone, Android (Oct 2026 "Enhanced protection") | platform | SMS/RCS, calls, links | Android; new features need Pixel 10 / Galaxy S26 | on-device Gemini Nano; opt-in cloud Gemini in Private AI Compute | free | [google](competitors/google.md) |
| Apple iOS 26 / iOS 27 | platform | calls, SMS/iMessage, in-app payment risk API | iPhone | on-device heuristics, no content LLM | free | [apple](competitors/apple.md) |
| Meta WhatsApp Scam Alert, Messenger | platform | WhatsApp, Messenger, Facebook | all (beta, opt-in) | on-device ML; AI review of shared chats | free | [meta](competitors/meta.md) |
| Microsoft Outlook.com, Edge | platform | email, web | all | sender-auth warnings; Edge ML scareware blocker | free | [microsoft](competitors/microsoft.md) |
| T-Mobile Scam Shield | carrier | calls | T-Mobile lines | number reputation, network block | free; Premium $4/line/mo | [t-mobile](competitors/t-mobile-scam-shield.md) |
| AT&T ActiveArmor, Verizon Call Filter | carrier | calls (texts claimed) | subscribers | reputation | free; $7 / about $3 per mo | [t-mobile](competitors/t-mobile-scam-shield.md) |
| Bitdefender Scamio (+ Scam Copilot) | AV vendor | paste, screenshot, link, QR via web, WhatsApp, Messenger; suites add email, SMS | consumers | rules + case base + AI chat | free; suites about $50/yr | [bitdefender](competitors/bitdefender-scamio.md) |
| Norton Genie, Scam Protection | AV vendor | SMS, web, email (Pro), calls (Pro), video | consumers | LLM + reputation | app free; Norton 360 $95-190/yr | [norton](competitors/norton-genie.md) |
| McAfee Scam Detector | AV vendor | SMS, email (Gmail, Microsoft, Yahoo), video, links | consumers | ML; on-device deepfake | bundled in core plans | [mcafee](competitors/mcafee-scam-detector.md) |
| Malwarebytes Scam Guard | AV vendor | text, DM, email, image, link | consumers | AI chat + community reports | free in app | [vendors-other](competitors/security-vendors-other.md) |
| Avast Scam Guardian | AV vendor | web, messages, email (Pro), calls (mobile Pro) | consumers | AI | free; Pro bundled | [vendors-other](competitors/security-vendors-other.md) |
| Aura, LifeLock | identity | calls (AI assistant), identity monitoring | families | monitoring + reputation | $12-32/mo | [vendors-other](competitors/security-vendors-other.md) |
| F-Secure, Guardio, Trend Micro ScamCheck, Surfshark | AV vendor | SMS, web, Gmail widgets | consumers | AI checkers | free tiers; $5-35/mo | [vendors-other](competitors/security-vendors-other.md) |
| Carefull | senior finance | bank transactions; ScamCheck for text, email, mail | 55+ and caregivers; banks | behavioural ML; trusted contacts | $29.99/mo | [carefull](competitors/carefull.md) |
| EverSafe | senior finance | financial accounts | seniors, advisors | behavioural profile; advocates | about $7.49-21/mo | [eversafe](competitors/eversafe.md) |
| AARP Fraud Watch Network | nonprofit | phone helpline, email/SMS alerts, map | 50+ | humans, community | free | [aarp](competitors/aarp-fraud-watch.md) |
| Truecaller | call/SMS | calls, SMS, web Scam Checker | mass market, India first | crowd reputation, AI voice scan | free; Premium about $9.99/mo | [call-blockers](competitors/call-blockers.md) |
| Hiya AI Phone | call | live calls, deepfake voice | consumers, carriers | voice ML | $9.99/mo | [call-blockers](competitors/call-blockers.md) |
| Nomorobo, RoboKiller | call/SMS | calls, texts | consumers | reputation, audio fingerprint | about $4.99/mo | [call-blockers](competitors/call-blockers.md) |
| SeniorShield | senior startup | email and SMS screenshots, lessons | senior-housing residents | LLM | n/a | [senior-startups](competitors/senior-startups.md) |
| Scammer Guardian | senior startup | calls | adult children of 65+ | GPT-4o voice agent; guardian SMS | from $29/mo | [senior-startups](competitors/senior-startups.md) |
| SeniorSafe (Sentien), Jortty, Shield Seniors | senior startup | calls; forwarded email, screenshots | seniors | cloud AI + humans; LLM | n/a; free tier + $19.99/mo | [senior-startups](competitors/senior-startups.md) |
| Scamnetic KnowScam | AI startup | email, SMS/RCS, QR, links, images, paper mail; ID checks | bank customers | proprietary ML | $7.99/mo via bank | [ai-startups](competitors/ai-startups.md) |
| ScamAdviser | web reputation | websites | consumers, businesses | 40+ feeds trust score | free | [ai-startups](competitors/ai-startups.md) |
| Catch (Gmail add-on) | AI startup | Gmail, attachments | Gmail users | AI; off-Google processing (inferred) | paid, 30-day trial | [ai-startups](competitors/ai-startups.md) |
| Small LLM checkers (TrustScan, Mail P.I., RealCheck, Scam Doctor) | AI startup | email, paste, screenshots | consumers | LLM | free to low | [ai-startups](competitors/ai-startups.md) |
| Generic chatbots (ChatGPT, Gemini, Meta AI) | general AI | paste anything | everyone | LLM without context | free | [ai-startups](competitors/ai-startups.md) |
| Open-source (MailCheck, Llama-3 LoRA, Gemma screenshot checker) | OSS | email, URL, SMS | developers | LLM/ML | free | [open-source](competitors/open-source.md) |
| Awareness-training vendors (Riot, Elba, Phished, Hoxhunt, KnowBe4...) | awareness training | Slack, Teams, Google Chat, email, web; simulated phishing | employees, bought by employers | story-first micro-lessons, simulations, risk scores, leaderboards | Riot $6.89/employee/mo; others on quote | [awareness-training](competitors/security-awareness-training.md) |
| Senior scam education (AARP Fraud Watch quizzes, Scam Spotter, Take Five, Cyber-Seniors) | nonprofit, public education | web quizzes, print, webinars, talks | 50+ and families | short rule sets, quizzes with an explanation after each answer, volunteers | free | [awareness-training](competitors/security-awareness-training.md) |

## Takeaways

1. Detection is a commodity. Every platform and every AV brand shipped a free "is this a scam?" check between 2023 and 2026, and Google, Meta and Apple now run detection on the device by default or opt-in. A pitch built on catch rate loses on day one.
2. Nobody judges a message against the person's life. Carefull and EverSafe do it for money (after it moves); no one does it for email or texts. The wedge in the PRD is intact.
3. Explanations are thin everywhere: "Scam Likely", "unverified sender", a red badge. Senior-readable reasons, "what the real company would say", "what to do instead" and read-aloud are rare; Norton's follow-up Q&A and SeniorShield's next steps are the nearest.
4. A consent-based family loop exists only in money monitoring (Carefull Trusted Contacts, EverSafe Advocates) and one call blocker (Scammer Guardian's SMS to the adult child). On messages it is open.
5. Calls are the costliest channel for people 80+ and are owned for free by carriers, Google, Apple and Hiya. Stay out; recommend the built-in screener in onboarding.
6. Platform risk is real on Android: Google's Oct 2026 opt-in cloud analysis of unknown-sender chats and Gemini Nano link checks overlap the companion app. Differentiate on context, explanation, guardian, Gmail, and iPhone users, who get none of it.
7. Privacy is the selling language of 2026 ("on device", "inaccessible to Google", "never analyzes Messages or Mail"). Our equivalents are concrete: no bodies stored, Standard mode only, no send, trash or delete, delete my account.
8. Demand and buyer are proven: 2Life's pilot logged 682 checks from about 100 residents, 60% of whom had already been scammed; the buyer is the adult child, at $7-30 a month. Free and open is a differentiator against the $29.99 tier.

## Positioning gaps Scam Shield can own

- Personal life context: providers and the addresses they really write from, orders and carriers, subscriptions, correspondents, known breaches ("your parcel comes by Amazon Logistics, not Chronopost").
- Senior-first UX: 19px+ type, 64px buttons, one decision per screen, read aloud, EN/FR. Competitors offer badges, chat boxes and right-click menus.
- Family loop with consent: the guardian sees only what the senior shares, answers in one tap, and the answer appears live on the senior's screen.
- Acts in the inbox, reversibly: labels, move, "Put it back" that teaches the sender. Vendors flag; platforms filter silently.
- One place for Gmail, SMS (Android companion) and anything pasted or photographed (WhatsApp, letters).
- Free, open, and auditable safety rules in the code (no send, trash or delete; Standard mode enforced).

## Naming conflict

"Scam Shield" is T-Mobile's anti-scam brand since July 2020 (free Scam ID and Scam Block, Premium $4/line, shown with ® on T-Mobile's pages; registry record not retrieved, unverified) and "ScamShield" is Singapore's government anti-scam app since Nov 2020. Severity: HIGH for any public US launch (no SEO, store takedown risk, cease-and-desist, judge confusion). Acceptable for the hackathon only as a declared working title. Candidates, not yet cleared: Second Opinion, Lantern, Kinsafe, Trustline, Inbox Guardian. Details and sources: [competitors/t-mobile-scam-shield.md](competitors/t-mobile-scam-shield.md).

## Market statistics

FTC Consumer Sentinel 2024 and 2025, FBI IC3 2024 and 2025, the age-60+ figures, scam types and channel data, each with a source URL: [research/scam-market-stats.md](research/scam-market-stats.md).
