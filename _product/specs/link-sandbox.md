# Sandboxed link screenshot service
Status: Idea · Last updated: 2026-10-27

## Why
"The page behind the link copies your bank's login page" is the most convincing reason a senior can see, and today the card can only say what the HTML title and form fields suggest. The PRD calls for a headless browser in an isolated container; the code has a placeholder for it.

## Behavior
1. When the user taps "Where do the links really go?" (or for a Scam verdict in the background, to be decided), the final page is rendered in an isolated sandbox and a screenshot is attached to the card: "This is the page behind the link."
2. The sandbox never submits forms, never carries cookies or the user's address, refuses private networks, and the screenshot is kept only as long as the verdict (90 days) or not at all (to be decided).
3. Muse Spark may read the screenshot to say what the page imitates ("a copy of Société Générale's login page") without storing the image.
4. The visit happens at most once per site per check; a scammer learns only that one anonymous visitor opened the link.

## Out of scope
Blocking the page in the browser; scanning every link of every email in the background (cost, and it tips off scammers); attachments.

## Acceptance
- Not started. Would need: a container host (STATUS open decision "link sandbox hosting"), a screenshot store or none, a unit test with a fake sandbox, and a demo clip under 10 seconds.
- Existing pieces to reuse: redirect resolver with SSRF guard (src/links/resolver.js resolveLink), page description (describePage), image reading (lib/muse.js extractFromImage-style prompt).

## Implementation pointers
lib/linkInspector.js `fetchLandingPage` (null placeholder, "the live version swaps it for a sandboxed headless browser"), src/links/resolver.js (safe fetch, DNS pinning, BlockList), lib/detector.js `pageShows` rule, public/js/views/mail.js linkResult rendering.

## Open questions
- Where does the sandbox run (same Railway box, a separate container, a third-party screenshot API with its own privacy terms)?
- Is "asks for a password on a login form" (already built) enough for the video, making this a post-hackathon item?
- Does visiting the page on the user's behalf contradict "never tip off a scammer", or is one anonymous visit acceptable when the user asked?
