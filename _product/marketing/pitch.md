# Scam Shield: pitch material

## Positioning statement
For people over 60 and the families who worry about them, Scam Shield is a scam guard for Gmail and texts that judges every message against the user's own life: their real orders, carrier, bank, known breaches and the people they write to. Unlike spam filters and generic "is this a scam?" checkers, it explains in words a frightened 74-year-old can act on at 9 pm, acts reversibly in the inbox, and puts a trusted person one tap away.

## Candidate opening frame: "reverse the roles" (from Vlad)
Meta's campaign "The Future is for Everyone" (meta.com/thefutureisforeveryone, signed "– Mark", dated August 10, 2026) asks: "Will it be centralized and restricted to a few institutions, or will it be a tool that empowers everyone?" and promises "Everyone will have an exceptionally capable personal agent that understands you, your goals, and everything you care about."
Today the people already using AI against the most vulnerable are the scammers:
- Voice clones. FBI alert I-120324-PSA (Dec 3, 2024): "Criminals generate short audio clips containing a loved one's voice to impersonate a close relative in a crisis situation, asking for immediate financial assistance or demanding a ransom." Its advice: "Create a secret word or phrase with your family to verify their identity." FBI releases on the 2025 IC3 report count 22,000+ AI-related complaints and about $893M lost, with cloned-voice "distress" scams above $5M (figures from FBI releases, not checked in the report PDF).
- AI-written phishing. FBI, same alert: "Criminals use AI-generated text to appear believable to a reader in furtherance of social engineering, spear phishing, and financial fraud schemes". KnowBe4 found AI involvement in 82.6% of the phishing emails it analyzed (Phishing Threat Trends Report, March 2025; 86% in the 2026 edition; vendor data). Harvard Business Review (May 2024; Heiding, Schneier, Vishwanath): automating phishing with LLMs "reduces the costs of phishing attacks by more than 95% while achieving equal or greater success rates."
"What if we reversed the roles?" Scam Shield puts the same class of model, Meta's Muse Spark, on the senior's side: a personal agent that knows her life and reads every message before she does.

## 30-second pitch
"Americans over 60 reported $7.7 billion lost to online fraud last year. Gmail already blocks 99.9% of phishing; the 0.1% that gets through is the dangerous part, and nobody explains it to a 74-year-old at 9 pm. Scam Shield connects to her Gmail and her texts and judges each message against her own life: her real orders and carrier, her bank, the breaches she was in, the people she writes to. Meta's Muse Spark writes the verdict in words she can act on, with evidence. Scams leave the inbox, reversibly; doubtful ones get 'Ask my trusted person': one tap, answered live by her daughter. On 500 held-back emails, Muse Spark took phishing caught from 32% to 79%, with zero false scams on 250 genuine mails."

## 2-minute pitch (four beats)
1. Problem (25 s): the stats below; "the filter removes the bulk; what remains is personal, polite and urgent, and the victim is alone".
2. Insight (25 s): generic checkers judge a message in isolation. A message is only a scam relative to a life: "your parcel comes by Amazon Logistics, not Chronopost"; "this is Ethan's name, not Ethan's number"; "your real IBAN leaked in the Bouygues breach, so showing it proves nothing".
3. Product (45 s): Google sign-in; context learned from genuine mail, visible and removable; the detector gathers evidence; Muse Spark (Standard mode, redacted input, fixed JSON schema) writes the verdict; two-way guardrail; labels and reversible moves; guardian loop with a one-tap answer; Android SMS companion; screenshot checks. Built for 60+: 19px+ type, 64px buttons, read aloud, EN/FR.
4. Proof and ask (25 s): the accuracy numbers; 146 tests; privacy rules in code; "built in ten days with Muse Spark"; the ask: try it with your parents.

## Why now (stats with sources)
- FBI IC3 2025 Annual Report (Apr 2026): people 60+ filed 201,000+ complaints (+37%) and lost $7.7B (+59%); phishing/spoofing was their most reported crime type (48,000+ complaints, per FBI releases). All ages: $20.9B.
- FTC, "Protecting Older Consumers 2025–2026" (Oct 19, 2026): adults 60+ reported about $3B lost in 2025, up from about $600M in 2020; the FTC says the true cost "could be as high as $119.5 billion".
- Google has claimed since 2017 that Gmail blocks 99.9% of spam, phishing and malware; the remainder is what reaches inboxes.
- France: the Bouygues Telecom breach (Aug 2025) exposed 6.4M customers' data including IBANs; fake €69.90 debit notices later reused the real IBAN in scam waves (journaldeleconomie.fr; the PRD dates the waves to 2026, unverified).

## The Meta angle
Muse Spark 1.3 through the Meta Model API: multimodal (reads screenshots and photos of messages), 1M-token context, structured output enforced by our schema, reasoning effort tuned per request ("low", after measuring about 2,950 thinking tokens at the default), no tools by design so nothing it says can act on the mailbox. Standard mode only: Meta's docs say "In Standard mode, your content is not used to train Meta models", and the code refuses any `-contributor` model id before a request leaves. Measured, not promised: 18,849 held-back public emails, 81% phishing called Scam vs 29% rules-only, 1 genuine email in 17,291 called Scam (an advance-fee letter the corpus labels genuine), median 6 s. Candidates if time allows: Muse Voice Transcribe for voice notes, Muse Glimmer on-device pre-screen on Android (open-weights bonus).

## The senior-first angle
One decision per screen, 19px+ type with a size setting, 64px buttons, read aloud, EN/FR. No jargon: "Scam", "Be careful", "Real", then "what to do instead" and "what the real company says". Reversible by design ("Put it back"); never sends, trashes or deletes. The guardian sees only what the senior chose to share. Everything learned about the user is listed and removable; "Delete my account" erases every row.

## The differentiator: it judges messages against the user's own life
A generic checker reads one message. Scam Shield reads it against the providers she really uses and the addresses they write from, her recent orders and carriers, her subscriptions, her saved contacts (a typed name is a claim, not the person) and the breaches she ticked. That is how it can say "this is not how Amazon writes to you", and why it has 0 false Scam on genuine mail: authenticated mail from someone she knows is never moved.

## Five memorable lines
1. "Gmail stops 99.9%. We are built for the 0.1% that lands at 9 pm."
2. "A message is only a scam relative to a life. We know hers."
3. "A typed name is a claim, not the person."
4. "Scammers already use frontier AI against seniors. We reversed the roles."
5. "Never sends, never trashes, never deletes. Put it back undoes everything."

## Likely judge questions, with answers
- Doesn't Gmail already do this? It filters in bulk and silently. We explain, check against her life, and act reversibly; 0 of 250 genuine mails were called Scam, because authenticated known senders are never moved.
- Why a frontier model instead of rules? Rules alone call under a third of phishing Scam at 0.3% false alarms; Muse Spark with the detector's evidence calls 81% Scam and flags 99%, with one genuine email in 17,291 called Scam (18,849 held-back public emails). The rules stay as guardrail and fallback.
- Do you read my mail? The model sees a redacted message (IBANs, cards, codes, names replaced) plus a compact context; bodies are never stored; Standard mode means nothing trains Meta's models; no human reads anything.
- What stops a prompt injection hidden in the mail? Inputs go in as escaped JSON blocks; injection attempts count as a scam signal; the output must pass a strict schema; the guardrail can overrule the model both ways.
- What was built during the hackathon? Answer with the README's "Built during the hackathon" section (commit range, feature list) and show only that in the video.
- How is this different from the other scam checkers in the hackathon? Life context, Gmail automation with reversible actions, the guardian loop, SMS on the phone, measured accuracy. The others check a pasted message in isolation.
- What about phone calls and voice clones? Out of scope for the demo; the Android companion covers texts; voice notes are a candidate through Muse Voice Transcribe.
- How do seniors adopt it? A child sets it up in five minutes (Google sign-in, invite a guardian); the senior sees one screen.
- Business model? Family subscription, or distribution through banks, insurers and telcos; not the point of the demo.
- Is labeling my Gmail allowed? Scope gmail.modify, label-only until the user consents to moving; Google verification and CASA are planned after the hackathon.

## Sources (accessed 2026-10-27)
https://www.meta.com/thefutureisforeveryone/ ; https://www.ic3.gov/PSA/2024/PSA241203 ; https://www.ic3.gov/AnnualReport/Reports/2025_IC3Report.pdf ; https://www.fbi.gov/news/press-releases/cryptocurrency-and-ai-scams-bilk-americans-of-billions ; https://www.aarp.org/money/scams-fraud/fbi-ftc-report-2025-losses.html ; https://www.ftc.gov/node/338049 ; https://www.knowbe4.com/hubfs/Phishing-Threat-Trends-2025_Report.pdf ; https://www.knowbe4.com/press/knowbe4-research-finds-86-of-phishing-attacks-are-ai-driven ; https://hbr.org/2024/05/ai-will-increase-the-quantity-and-quality-of-phishing-scams ; https://workspace.google.com/blog/product-announcements/keeping-your-company-data-safe-new-security-updates-gmail ; https://www.journaldeleconomie.fr/arnaque-les-clients-bouygues-telecom-cibles-par-les-criminels/ ; https://www.securityweek.com/french-telecom-firm-bouygues-says-data-breach-affects-6-4m-customers/ ; https://dev.meta.ai/docs/models
