# Life context ("What Scam Shield knows about you")
Status: Built (unverified live) · Last updated: 2026-10-27

## Why
"Your parcel comes by Amazon Logistics, not Chronopost" is a reason a 74-year-old understands instantly. The context is what makes the verdict personal, so it must be learned safely, be visible, and be correctable.

## Behavior
1. After connecting Gmail, Scam Shield learns, from genuine mail only, the companies that write to the user and the addresses they really use (bank, telecom, toll, health, retail, carriers), recent orders with their carrier and tracking number, paid subscriptions, and the people the user writes to (two or more emails in a year).
2. Only mail that passes Google's authentication and that the checker already judges safe can teach the context, so a scam can never plant a fake order or provider.
3. The user can tick well-known data breaches they were part of (Bouygues 2025, Free 2024, France Travail 2024, AT&T 2024, National Public Data 2024, Change Healthcare 2024, Ticketmaster 2024, "an old password"); with a HIBP key, breaches are looked up automatically (unverified).
4. Real personal data in a message (an IBAN, an old password) never proves it is genuine when a known breach leaked that data; the card says "that bank number is real, but it leaked in the Bouygues breach".
5. A parcel message is checked against real orders: a carrier that is not delivering anything to the user is called out. A bill from a company that is not one of the user's providers is called out.
6. A trusted contact is the saved email address or phone number, never a typed name: "Ethan Miller <other@gmail.com>" or "it's Ethan, new number" is a claim, and the safe step is calling the number the user already has. A trusted contact's real address asking for money, secrecy or codes is "Be careful: their account may be hacked".
7. Guardians (accepted trusted people) are trusted contacts automatically.
8. Settings shows every learned item (providers, orders, people, subscriptions, senders, breaches) with a Remove button; removed items stay removed after a rescan. "Look through my mailbox again" rebuilds (once per 10 minutes).
9. "This is not a scam — put it back" teaches the sender as known for next time.

## Demo path
Open Settings → "What Scam Shield knows about you" on the demo account for five seconds (providers, the Amazon order, the grandson), then open the Chronopost parcel scam: "Your real order is delivered by Amazon Logistics, not Chronopost."

## Out of scope
Contacts from Google Contacts or the phone; calendar; purchase history outside email; sharing the context with the guardian.

## Acceptance
- Unit tests: order extraction needs a carrier and recognises tracking formats; only authenticated, detector-safe mail teaches; correspondents need two mails; removed items stay removed (tests/units.test.js).
- Seed profiles data/profiles/linda.json and francoise.json drive the 36 scenario cases (A3b breach, A4/C4 carrier fit, B2 claimed contact).
- Live: never run on a real mailbox yet; a real 300-message scan should produce a context the user recognises as theirs (to verify with the first test senior).

## Implementation pointers
src/context/builder.js (buildContext, KNOWN_BREACHES, correspondents, hibpBreaches, withGuardians, forgetItem), lib/context.js (trustedContactFor, claimedContactFor, breachLeaking), src/routes/account.js (/api/context, forget, breaches, rebuild), public/js/views/pages.js renderSettings, src/sync/actions.js putBack.

## Open questions
- Phone numbers are never learned (contacts from Sent have none), so an SMS from a grandson's real number is only recognised if the user adds it: do we add a "their phone number" field to the trusted-person form?
- Breach list for launch: curated eight, HIBP (paid key), or both? Who maintains the curated list?
- Should the guardian be allowed to correct the senior's context (remove a wrong provider) on the senior's behalf?
