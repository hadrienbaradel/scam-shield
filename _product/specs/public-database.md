# Public database: scam library, suspect list, scam watch
Status: Planned · Raised by Vlad, 2026-11-04 · Decided by Vlad 2026-11-04 (build with subagents; plan: `docs/plans/2026-11-04-public-database.md`) · Last updated: 2026-11-04

## Why
Prudence judges a message against the senior's life; the other half of a good verdict is what scammers are doing this week. A public, openly licensed database of scam examples, the sites and numbers they use, and the breaches and new techniques behind them gives Prudence that "world context", gives the model its evaluation and few-shot material, gives the Learn tab its stories, and gives journalists, banks and other apps a reason to link to us. Nobody publishes one today (`_product/research/public-database.md`). Desktop, for people who work on scams, not for seniors.

## Behavior (proposals)
Library
1. A visitor browses scam examples by family (20 families: delivery, bank, government, tech support, family emergency, new number, romance, investment, prize, charity, job, rental, renewal, toll or fine, utility, account, sextortion, invoice, marketplace, health), by channel (email, text, chat, voice, letter), country and language; each entry shows the redacted message, the family, the brand impersonated, the lure, the ask, where and when it was first seen, its source and licence, and Prudence's verdict with its reasons.
2. Anyone submits an example through a form or a GitHub issue; what they submit is redacted (names, numbers, codes) by Muse Spark before anyone sees it, classified into a family, checked against duplicates, and published only after a reviewer approves it on the admin console; the submitter is told the outcome.
3. The library ships with a seed: the 37 demo cases, the 7 pattern cards, and a few hundred redacted, classified samples from the CC BY corpora and public-domain official sources listed in the research; the raw corpora never enter the repo.
4. Every entry is published under CC BY 4.0 as JSON in the public repo, and the whole library downloads as one file.
5. From the senior's side: under a Scam or Be careful verdict, a "Share this with Prudence's library" choice sends the redacted message, once, with her explicit tap; Settings shows "Shared with the library: 3 messages" and a "Stop sharing" line; the welcome asks nothing, because consent is given per message.
Suspect list
6. A visitor looks up a website, a sender address or a phone number and sees "reported N times, last seen <date>" with the library entries that used it; the count decays with time and a listing never says "scam" without an entry behind it; a private person's number is never listed on its own.
7. Anyone can contest a listing from the same page (a notice with the four DSA elements); the listing shows "contested" at once and a decision with its reason follows within 7 days; the operator and the contact point are named on the site.
Scam watch
8. Once a day a job reads the feeds (HIBP breaches, ransomware.live, the California AG list; IC3, CISA, NCSC, Europol, cybermalveillance; Krebs, BleepingComputer, The Record, Malwarebytes Labs, Google Threat Intelligence, Which?; Bluesky and Mastodon by keyword) and Muse Spark classifies each item as a breach (who, how many, which data, verified or claimed, country) or a technique (channel, family, brand, lure, ask, first seen, new or variant); X, LinkedIn and Reddit are not read.
9. An item becomes public only when a reviewer approves it on the admin console; "important" is explicit: a verified breach of 1M+ people or of credentials, bank, health or identity data, or a technique not seen before in the senior's country; approved items feed the pattern cards and Breach exposure.
10. The public page shows the week's approved breaches and techniques with the one thing a senior should do about each, in plain words, in English and French.

## Demo path
None for the Nov 4 video. Later: the library page with a family open, one entry and its verdict; the watch page with this week's breach and the line "that number is real, but it leaked in the X breach".

## Out of scope
Crowd-sourced bare numbers without evidence; a consumer app; the senior's own email checked against HIBP (Breach exposure, paid key); dark-web monitoring; scraping any site that forbids it; a separate database server at v0 (the repo is the database).

## Acceptance
- Schema tests on every entry (family, channel, licence, source, no unredacted personal data); the seed scores on `npm run score` like the 37 cases.
- A submission with a phone number in the body is published without it; a contested listing shows "contested" immediately.
- The watch job is covered like `src/jobs/threatfeed.js`: a feed item never becomes public on its own.

## Implementation pointers
src/jobs/threatfeed.js (SOURCES, parseFeed, runThreatFeed: extend), lib/patterns.js (cards from library entries), data/patterns/cards.json and testcases/cases.json (the seed), src/routes/admin.js and public/admin/views/cards.js (the review queue), lib/muse.js (redaction and classification prompts), scripts/eval-corpus.mjs (corpus intake), docs/PROVENANCE.md (licences).

## Open questions
- Who is the operator (person, association, company) named on the site for notices?
- Numbers in v1, or domains and sender addresses only until the notice process runs?
- Name and domain; GitHub Pages or the OVH server; CC BY 4.0 for all three parts, or ODbL for the suspect list?
- Who reviews weekly after the hackathon?
