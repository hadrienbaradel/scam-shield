# Micro-learning (gamified anti-scam lessons)
Status: Idea · Raised by Vlad, 2026-10-27 · Discussed: no · Last updated: 2026-10-27

## Why
The online world is a jungle, and a verdict teaches nothing for next time. Companies train employees with short, gamified security-awareness lessons (Elba, Riot); seniors deserve the same, built from the scams that actually reached them.

## Behavior (proposals)
1. After a Scam or Be careful verdict, the senior can take a one-minute lesson drawn from that very message: "This one said it was urgent. Rule: if it is urgent, verify through another channel."
2. Lessons are tiny (one rule, one example, one question), spoken aloud if wanted, and never shaming ("many careful people would have been fooled").
3. A gentle progress view: rules learned, scams spotted, a weekly "scam of the week" (ties in with the Muse Image idea), optional sharing with the trusted person ("Mom spotted the toll scam").
4. The trusted person can send a lesson ("Dad, read this one before you answer anything about your bank").
5. Lessons are generated from the verdict's reasons and the pattern cards, so the catalogue grows with the threat feed; a human reviews new lessons the way cards are reviewed.

## Demo path (if built)
After the red card: "Learn why in 1 minute" → one card, one question ("Your bank texts you a code and asks you to read it back. Do you?"), confetti on the right answer. Fifteen seconds.

## Out of scope
A full course; certificates; lessons for the guardian; leaderboards between seniors.

## Acceptance
- Not started. Inputs exist: verdict reasons (lib/schema.js), pattern cards (data/patterns, admin review), the "real company never does" sentences (lib/brands.js `never`).
- Measured when built: the three-senior comprehension test repeated after three lessons shows faster or more correct "what would you do now?" answers.

## Implementation pointers
lib/brands.js (`never` sentences), lib/patterns.js, src/routes/admin.js (review queue pattern to reuse), public/js/ui.js verdictCard (where the "Learn why" button would go), lib/muse.js museChat (lesson generation prompt).

## Open questions
- Do seniors want gamification, or a plain "one rule a week" by email? The comprehension test could ask.
- Who reviews generated lessons before a senior sees them?
- Is this demo-able in 15 seconds without feeling like a toy?
