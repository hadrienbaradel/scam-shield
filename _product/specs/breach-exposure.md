# Breach exposure
Status: Idea · Raised by Vlad, 2026-10-27 · Discussed: no · Last updated: 2026-10-27

## Why
Scammers quote real data (an IBAN, a social-security number, an address) to look genuine. If the senior knows which breaches leaked their data, that "proof" loses its power. The life context already lets the senior tick eight known breaches and has an unexercised HIBP lookup; this idea makes exposure a first-class, senior-facing screen that also feeds lessons and verdicts.

## Behavior (proposals)
1. A "Your data out there" screen lists the breaches that included the senior's data: from Have I Been Pwned by email address, and from breach news they can confirm (the French tax site impots.gouv, health-data leaks, telecoms), with what leaked in plain words ("your bank account number and address").
2. Each entry says what it means: "An email that quotes your IBAN is not proof it comes from your bank."
3. The verdict uses it: a message quoting leaked data gets the reason "that number is real, but it leaked in the X breach" (already built for IBAN and old passwords; extended to social-security numbers, addresses, phone numbers, health data).
4. The list feeds micro-learning ("your details leaked from X; here is the scam that usually follows") and the threat feed (breach news becomes a candidate card with the brands and data types involved).
5. The senior can add or remove any entry; nothing is shared with the guardian unless the senior asks.

## Demo path (if built)
Settings → "Your data out there": Bouygues 2025 (IBAN, address). Then the €69.90 debit-notice scam: "That bank number is real, but it leaked in the Bouygues breach." Ten seconds; the breach is the story.

## Out of scope
Monitoring the dark web; identity-theft insurance; changing passwords for the user; scanning the senior's other accounts.

## Acceptance
- Partially covered today: eight curated breaches tickable in onboarding and settings; `hibpBreaches` with an API key (unverified); detector reasons for leaked IBAN and old password; A3b seed case passes.
- Not started: breach-news intake (impots.gouv, health data), the senior-facing exposure screen, extension to other data types, the link to lessons.
- Measured when built: the A3b case and a new impots.gouv/Ameli case explain the leaked data in the card; HIBP lookup verified live.

## Implementation pointers
src/context/builder.js (KNOWN_BREACHES, hibpBreaches), lib/context.js breachLeaking, lib/detector.js breach rule (IBAN / old password only today), lib/muse.js compactContext (breaches sent to the model), public/js/views/pages.js renderSettings (breach checkboxes), src/jobs/threatfeed.js (breach news as a source).

## Open questions
- HIBP needs a paid key and reveals the senior's email to a third party: acceptable, and who pays?
- Source of breach news: cybermalveillance.gouv.fr already feeds cards; is CNIL or a curated list enough for France, and what for the US?
- Should "what leaked" be shown to the trusted person to help them judge a message?
