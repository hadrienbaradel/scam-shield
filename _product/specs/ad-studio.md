# Ad studio: Meta AI makes our Facebook ads, a person approves them
Status: Partial (built Nov 4 on `vlad/ads`: ideas, photos and their check, prompt edits, the console, the Facebook adapter, landing variants; left: the first real publish on the Hey Prudence ad account) · Raised by Vlad, 2026-11-04 · Decided by Vlad 2026-11-04 15:50 (the full loop: ideas, photos checked by Muse Spark, prompt edits, approval publishes on Facebook, landing variants; Facebook only for now)

## Why
Prudence needs adult children to find it, and an ad is the fastest way. Meta's models can do the work: Muse Spark writes the idea, Muse Image makes the photo, Muse Spark looks at the photo and asks for a fix. A person still decides what goes out under Prudence's name. For the hackathon this shows a third Meta model (Muse Image) and two Meta models checking each other, and it ends on Meta's own ads platform.

## Behavior
1. **Where.** `/admin/#/ads`, a page of the admin console, admins only (the console's sign-in and checks). It reads no mailbox, no verdict and no person's data: it only knows what Prudence is. So it has no Settings entry, onboarding step or protection-score criterion, because it reaches nothing of the person's.
2. **New ideas.** An admin types an optional brief (for example "adult children worried about a parent's email") and picks how many ideas (1 to 4). Muse Spark writes each idea: a headline (40 characters at most), the main text (125 at most), a description, a button from Facebook's list (Learn more or Sign up), a photo brief, and the landing variant's headline and opening line.
3. **Only true words.** Muse Spark writes from a fixed fact sheet (`prompts/ad-studio.md`: what Prudence does, the measured numbers and their source). An idea is refused and written again once if it has any of these:
   - a number that is not in the fact sheet;
   - a brand from Prudence's brand list;
   - a quote attributed to a person;
   - "guaranteed", a price or a fear line.
   The refusal is checked in code, not left to the model.
4. **The photo, checked by a second model.** Muse Image makes each idea's photo (4:5, for the Facebook feed). Muse Spark then looks at it against a checklist:
   - no letters or words, no logo, no readable screen;
   - natural hands, eyes and faces, nothing duplicated or floating;
   - the people and the scene of the brief;
   - nothing frightening or shaming.

   When something is wrong, Muse Spark writes one fix and Muse Image edits the photo once, then Muse Spark checks again. The card says what happened in one line ("Checked by Muse Spark: fixed a second pair of glasses on the table", or "1 problem left: a word on the mug"). A photo is never approved by a model.
5. **Edit with a prompt.** Every idea has one box ("make the mother smile", "shorter headline", "evening light"). Muse Spark reads the instruction with the current words and photo, then rewrites the words it concerns. When the photo must change, it writes the instruction for Muse Image, and the photo check runs again. Line 3 applies to the new words. Every version is kept, and Undo brings back the one before.
6. **Approve and publish.** One button carries the spend: "Publish on Facebook · $5 a day · 7 days". It creates one ad set with one ad, the photo and the words, in the one Prudence campaign (created on the first publish, then reused). The ad is shown to adults 35 to 64 in the United States, in the Facebook feed, and links to its landing variant. The card then shows Meta's review state in words (In review, Active, Rejected with Meta's reason, Paused), the ad's number and a link to Ads Manager. Pause stops it at once and Resume restarts it. Reject sets the idea aside with a reason. Nothing reaches Facebook without an admin's click, and a second click while publishing creates nothing more.
7. **Landing variant.** Each idea has its own address, `heyprudence.com/a/<code>`: the live landing page, with its headline and opening line replaced by the idea's. These are plain text in their two places, never HTML written by a model, and the English page only. The rest of the page is unchanged. Before publishing, an admin opens it from the card (Preview).
8. **Counts without a tracker.** The variant counts its visits and its early-access requests on our server, with no cookie, no pixel and no script from Facebook. Link previewers and robots are not counted, and the `fbclid` Facebook adds to the address is never stored. Each card shows them ("312 visits · 4 requests"), and the early-access request keeps which variant it came from.
9. **Models and networks can change.**
   - Photos go through `lib/llm` (`IMAGE_PROVIDER`: `meta` = Muse Image, the default; `openai` for any OpenAI-style images endpoint; `mock`).
   - Words and checks go through `complete` (Muse Spark by default, any provider with images in).
   - Ad networks sit behind one adapter: Facebook is built; Snapchat and Google Demand Gen are Ideas.
   - Each card names the models that made it ("Muse Image 1.0 · checked by Muse Spark 1.3").
10. **Missing keys, plain words.** Without `META_MODEL_API_KEY`, New ideas says so. Without the Facebook keys, Publish names the missing key and nothing leaves. A token never appears on the page, in a log line or in an error. The page shows today's photos and their cost ("9 photos today · $0.09").

## Demo path
About 15 s for a recut, filmed on the console:
1. Ads → New ideas, 3 ideas: three cards fill with Muse Image photos, each with its "Checked by Muse Spark" line (one shows a fix).
2. Type "make the mother smile, warmer light" in one card's box: the photo and the headline change.
3. Publish on Facebook: "In review · ad 1202…".
4. Open its variant: heyprudence.com with the ad's headline.

## Out of scope
- Video ads: Meta's Model API has no video generation model; an uploaded video can come later.
- Snapchat and Google Demand Gen (Ideas).
- Instagram, Audience Network and Messenger placements; carousels.
- A/B tests beyond one variant per ad, audiences beyond the fixed one, automatic budget changes.
- French ads, a Meta Pixel or the Conversions API.

## Acceptance
- `tests/llm-images.test.js`: Muse Image and OpenAI-style request shapes for generating and editing, errors, the mock.
- `tests/ads-studio.test.js`: the idea schema and the line 3 refusals; the photo check with a fix and one retry; the edit by prompt; models named.
- `tests/ads-check.test.js`: the check script's report, keys by name, never a token.
- `tests/ads-landing.test.js`: the variant's rendering and escaping, `/` unchanged, the route and its counts, early-access attribution.
- `tests/ads-facebook.test.js`: the Marketing API calls in order (image upload, campaign once, ad set, creative, ad), budget and targeting, review states, pause and resume, missing keys, no token in an error.
- `tests/ads-routes.test.js` (Postgres): admins only; versions and Undo; publishing once; the variant page escapes its text, 404s an unpublished code for visitors, counts visits but not robots, and attributes an early-access request.
- Manual: one real ad on the Hey Prudence ad account, its number in the log's Done line.

## Implementation pointers
- `lib/llm/` (images: `generateImage`, `editImage`).
- `lib/ads/` (ideas, photo check, prompt edits, guardrails, `networks/facebook.js`).
- `prompts/ad-studio.md`.
- `src/ads/store.js`, `src/routes/ads.js`, `src/routes/adLanding.js`, `src/db/migrations/012_ads.sql`.
- `public/admin/views/ads.js`, `scripts/ads-check.mjs`.
- Plan and interfaces: `docs/plans/2026-11-04-ad-studio.md`.

## Open questions
- Vlad's gate: an ad account in the Hey Prudence business portfolio with a card, and a system-user token with `ads_management` (log, To do). Meta's docs suggest no App Review for our own ad account (unverified until the first publish).
- How long Meta's ad review takes for a new account (unknown); the video can show "In review".
- Whether the ad should say its photo was made with Meta AI (Meta labels its own in-app tools; for uploaded photos it reads C2PA data when present).
