# Threat feed and pattern cards
Status: Built (unverified live feeds) · Last updated: 2026-11-04

## Why
Scam campaigns change weekly (the €69.90 Bouygues debit, the E-ZPass toll text). Public alerts from IC3 and cybermalveillance.gouv.fr should reach the verdict the same day, but never let an unreviewed card condemn real mail.

## Behavior
1. A verdict can say "This matches a scam campaign reported this week" when an active pattern card matches the brand, channel and lure or red flags of the message; a brand name alone never matches (a real Bouygues bill does not match its own scam card).
2. Once a day, new alerts from the FBI IC3 and cybermalveillance.gouv.fr feeds are turned into candidate cards (by Muse Spark when switched on, otherwise a skeleton card from the brands named).
3. A candidate card can at most push a verdict to "Be careful" ("A similar scam has been reported, but it is not confirmed yet"); only a human on the admin page can make it active.
4. A card that lists a brand's real website address as a red flag is rejected automatically; cards with no sighting for 90 days retire.
5. The admin console's Scam reports page (`/admin/#/cards`, admins only; [admin-console.md](admin-console.md)) shows candidates with their source link, lets the reviewer edit the card JSON, approve or reject, and run the feed now.
6. Seven seed cards ship with the app (six active, one candidate) covering the PRD scenarios for France and the US.
7. The scam watch (`_product/specs/public-database.md`, lines 8 to 10; `src/jobs/scamwatch.js`) is a second daily job next to this one: it reads the feeds this one does not (Have I Been Pwned, IC3 industry alerts, CISA, NCSC, Europol, cybermalveillance's fiches réflexes, the security press, Which?, Mastodon #scam) with the same `parseFeed`, keeps its items in `watch_items` for its own review, and an approved technique becomes a candidate card here through `cardFromAlert` (`watch-<slug>`, never active on its own) unless this feed carded the same link already; the IC3 PSA and cybermalveillance alert feeds stay here and are not read twice.

## Demo path
Optional 5 seconds: the A3b verdict reason "This matches a scam campaign reported this week" and the admin page with a candidate card. Likely cut for time.

## Out of scope
Reddit or forum scraping, FTC feed (no working RSS found), automatic activation, sharing cards between users beyond the one server.

## Acceptance
- Tests: candidate card never pushes to scam on its own; a card flagging a brand's real domain is rejected; feed parser handles RSS and Atom; approving on the admin API makes a card active, admin-only (tests/detector.test.js, tests/units.test.js, tests/integration.test.js).
- Live fetch of the three feeds and Muse extraction of a real alert: unverified.

## Implementation pointers
src/jobs/threatfeed.js (SOURCES, parseFeed, runThreatFeed), lib/threatfeed.js, lib/patterns.js (matchCards, cardCap), lib/muse.js extractPatternCard, src/routes/admin.js, data/patterns/cards.json, public/admin/views/cards.js (the console page; public/js/views/pages.js renderAdmin is the senior app's older copy, to retire).

## Open questions
- Who reviews cards after the hackathon? A daily human step is a cost.
- Should card matches be shown to the senior with the source ("reported by the FBI on Oct 20")?
- Add Signal Spam / 33700 (FR) or Scamwatch as sources?
