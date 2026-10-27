# Link checks (age, redirects, blocklists)
Status: Partial · Last updated: 2026-10-27

## Why
The link is where the money goes. Judging it without opening it protects the user twice: a visit would tell the scammer the address is live, and a fake page must be named before it is tapped.

## Behavior
1. Every link in a message is judged by its real destination, never by the words on the button; "The button shows paypal.com but really leads to pay-pal-secure.top" is a reason on the card.
2. The address alone gives away traps without any visit: misspelt brands, a brand name on a free website-builder address, numbers-only hosts, risky endings (.top, .xyz…), machine-made names, an email address hidden inside the link ("made for one person").
3. The website's age is read from the public registry (RDAP) without visiting the link; a site created less than 30 days before the message was sent is a strong reason, "created the same day" the strongest.
4. Redirects are followed only for link shorteners, or when the user taps "Where do the links really go?"; then the final site, the sites passed through, the age of the final site and what the page shows (a login form, card fields) are reported. Passing through google.com or medium.com proves nothing.
5. Following a link is safe by construction: no cookies, no form ever submitted, 5 hops, 5 seconds, 256 KB, and private or internal addresses are refused before any request.
6. Known malware and phishing sites are checked against abuse.ch URLhaus (host name only, never the full link); a listed exact link or a Spamhaus-flagged host makes the verdict Scam even from a known sender. **Today the key is refused, so these lookups are off and the status page says "refused".**
7. Links to the user's own known brand domains are never looked up at all.

## Demo path
On a Scam card, tap "Where do the links really go?": "bit.ly/… really goes to chase-verify.bolt.host · 2 d · asks for a password on a login form". Five seconds, and it shows a live network check.

## Out of scope
Screenshots of the landing page (sandboxed browser; PRD P1), opening attachments, QR decoding, Google Safe Browsing (licence), training rules on abuse.ch data (licence).

## Acceptance
- Tests: private networks refused before any request (incl. IPv4-mapped IPv6); redirects followed to the final page and described; RDAP age, only unknown domains looked up; URLhaus gets host names only, shared hosts need the exact link (tests/units.test.js, tests/detector.test.js).
- Measured (bare link, no lookups): 300 OpenPhish URLs flagged 0.7% → 48% by address signals alone; remaining misses are number-only hosts, free hosting without sign-in words, shorteners.
- Blocked: a working ABUSECH_AUTH_KEY (current one returns unknown_auth_key). RDAP live lookups: unverified beyond unit tests with a fake fetch.

## Implementation pointers
src/links/resolver.js (registrationDate/domainAgeDays, resolveLink, describePage, urlhausHost, urlhausVerdict, inspectMessageLinks), lib/linkInspector.js (addressSignals, embeddedTarget, inspectLink), lib/detector.js link rules, src/routes/mail.js check with links:true.

## Open questions
- Get a valid abuse.ch key (Hadrien) or drop URLhaus from the demo story?
- Should the detector resolve shorteners during background sync (it does) given that a visit reveals the address is live?
- Is a sandboxed screenshot of the landing page worth building before Nov 4, or is "asks for a password on a login form" enough for the video?
