Keywords: hackathon, judging, winning, video, submission, strategy
# How to win the Meta Global AI Developer Hackathon with Scam Shield (researched 2026-10-27)

Rules, rubric and prizes: [hackathon.md](hackathon.md). The field: [hackathon-other-teams.md](hackathon-other-teams.md). Storyboard: [../marketing/demo-plan.md](../marketing/demo-plan.md); lines and answers: [../marketing/pitch.md](../marketing/pitch.md); Muse specifics: [meta-ai-stack.md](meta-ai-stack.md). This file adds how judging works in practice, what past winners did, where we stand, and the plan for the eight days left. Claims not confirmed on an organizer page are marked (unverified).

## What judges actually reward (with evidence)
- The rubric is Impact 30 / Meta tooling 25 / Demo 25 / Technical depth 20, scored 0–10 after a pass/fail gate; the top 5 per track are re-ranked by "final round Judges [who] will watch the video demos live and rank them using the same rubric" (Official Rules, via hackathon.md). The video decides twice: the cut and the final. The rules describe judges watching, not teams presenting; whether finalists speak on Nov 9 is unverified, so prepare a 60-second live intro anyway.
- Volume: Cerebral Valley's (CV) two virtual hackathons for Anthropic drew 227 and about 250 submissions from 500 selected builders (45–50% submit); this event accepted up to 20,000, so expect thousands of videos (unverified) judged Nov 4–8. MLH's guidance for online judging: "3 minute videos ... review their submission within 5 minutes and move on to the next project". Assume a judge decides in the first 20 seconds whether to keep paying attention, and reads the gallery one-liner before pressing play.
- Judges are not named (hackathon.md). In CV's Anthropic events the sponsor's own staff judged (six "Claude team judges" for Opus 4.7; finals "in front of" the Claude Code leads), so expect Meta MSL/DevRel engineers plus CV staff (inference, unverified). They know the model: one chat call behind a form will read as thin.
- Judges in their own words (Devpost): the demo video "gives the most amount of scope ... our first indicator of how much time was invested" (Richard Moot, Square); "Ambiguity is a red flag" and a slick video does not hide thin code on GitHub (Karen Bajza-Terlouw, Databricks); first check "does it work at all", then "It's all about that finished product" (Warren Marusiak, Atlassian); teams that bend an idea to fit the contest lose to teams who grasp the real problem, and she checks past submission histories (Maria Yarotska, NEAR).
- Indie lens on top of the rubric: "creativity, technical ambition, and whether it works" (event page); Startup is judged on "whether it holds up in production", has bigger prizes and may build on existing code if the new work is identified; Indie has no such clause (hackathon.md). "Whether it works" is checked on the video and the live product: a `degraded` verdict on screen costs Demo and Technical points at once.

## Patterns of winners (2024–2026)
1. Lived expertise, one concrete user: CV's Opus 4.6 winners were a personal-injury lawyer (CrossBeam, California permits), a father building for his 12-year-old (Elisa), a cardiologist (PostVisit.ai); Opus 4.7: a physician (MedKit), a micro-soldering technician (Wrench Board), a CS teacher (Maieutic). Anthropic's line: "the people closest to a problem can finally build the solution themselves". Hadrien's real A-set cases and Françoise's Bouygues story are exactly this.
2. The full three minutes, product on screen: all five Opus 4.6 winner videos run 176–180 s (CrossBeam 3:00, TARA 3:00, PostVisit 2:59, Conductr 2:59, Elisa 2:56), each a narrated walkthrough of the working product.
3. One non-obvious model capability, shown: OpenGlass ($20 glasses that describe what you see; Llama 3 SF 2024, 1st), Gripmind (Llama 3.2 Vision driving a robot arm; London 2024, 2nd), TARA (frame-by-frame dashcam appraisal to a PDF in one click). The guide literally asks for "capabilities that surprised even us".
4. Proof in numbers or in the world: CrossBeam "about 20 minutes" for a permit plan and a city weighing adoption; TARA "five hours" against 9–14 months; Compliance Wizards (LlamaCon 2025, 2nd, per hackathon.md) flagged fraud with evidence and a human answer. Our 32% to 81% with 0/250 false Scam is the same move.
5. Human in the loop and privacy by design placed: Pharmallama (on-device; London 3rd), Guardian (an agent that is "an extra check for doctors and nurses"; London 1st), Compliance Wizards (alerts the user answers). The guardian loop and Standard mode belong on screen, not only in the README.
6. Small teams, finished scope: winners were solo or pairs; nobody won with a platform. Five Built features shown well beat fifteen mentioned.
7. Reachable: PostVisit had a live site, CrossBeam and TARA public repos with real artefacts. A demo URL a judge can open in ten seconds (demo mode, no sign-in) is worth more than any extra feature.

## What loses
- Pre-existing or unclear work: "Failure to clearly identify your original contributions will result in immediate disqualification" (Official Rules). The 2013 Salesforce $1M hackathon controversy came from reuse that was not disclosed up front and judges who were never briefed on it; the review found the app mostly new and split the prize (press coverage). See Provenance.
- Slides and talking heads instead of the product; a quote card as a cold open is a slide (demo-plan option B).
- A rehashed idea: five "paste a message, get a verdict" checkers are already in the field (hackathon-other-teams.md), and Meta ships scam warnings in Messenger and WhatsApp. If the first 20 seconds say "AI detects scams", we are the fifth checker.
- "Doesn't work" on screen: a failed live call, a visible fallback, an inbox that does not update, a guardian answer that never lands. Judges forgive unfinished scope, not failures in the video.
- Thin Meta use: the Meta-tooling criterion is a quarter of the score and asks what went "beyond a basic integration".
- Over-scope and jargon: a Chrome extension, a sandbox and thirty ideas dilute three minutes; "RDAP" and "SSE" mean nothing to a judge, "registered three days ago" does.
- Process misses: private repo, secrets in history, video private or over 3:00, a teammate not listed, uploading in the last hour (Devpost: plan the video early; a past winner in hackathon.md: "it takes way longer than you think").

## Our position
| Pattern | Where we stand (spec.md statuses) | Gap to close |
|---|---|---|
| Lived expertise, one user | Hadrien's real cases, Linda/Françoise personas, senior-first UI: Built | One persona for the video (open question 4); one sentence of personal link in the cold open |
| Works on screen | Verdict engine, senior app, trusted person loop, demo mode, Check something else: Built. Gmail scanning, life context, reversible actions: Built (unverified live) | Live inbox run by Oct 30 or film demo mode labeled "demo data"; never a `degraded` card on screen |
| Non-obvious Meta capability | Screenshot reading, strict JSON with evidence, guardrail overruling the model, reasoning-effort tuning: Built | Make each visible: JSON on screen, "Muse Spark 1.3, 3.8 s" on the card, the guardrail line; plain-words source line (spec idea) |
| Proof | 500-email evaluation, 146 tests, 0/250 false Scam | Numbers in the video and README; one senior's filmed reaction (the PRD comprehension test, even with one person) |
| Reachable | Nothing deployed; repo private | Demo-only public URL (no Google sign-in, rate-limited, key server-side; needs the data scan STATUS asks for) and public repo by Nov 2 |
| Finished scope | 11 Built, 1 Partial, 3 Planned, 30 ideas | Freeze: no Chrome extension, no sandbox; Glimmer pre-screen only if done and verified by Nov 1, else not claimed |
| Provenance | README section exists; first commit imports 2,838 lines at 20:12 ET on day one | Exact statement from Hadrien and a written answer from CV (below) |

## The plan for the next 8 days
Recording done by Nov 2, submission on Nov 3, Nov 4 is a buffer. Times ET. One accountable owner per row.
| Day | Owner | Deliverable |
|---|---|---|
| Wed Oct 28 | Hadrien | OAuth client created; live Gmail run on one seeded test inbox, label-only; B2/B12 and the action default decided (open questions 1–2); provenance facts written down; $150 credits claimed |
| Wed Oct 28 | Vlad | Discord: intro in #intros, provenance question in #questions in writing; credits claimed; scope freeze noted in spec.md; `/v1/status` pre-check script; decision on live Gmail vs demo mode due Oct 29 (open question 3) |
| Thu Oct 29 | Hadrien | Video script v1 timed to the second (about 400 words), persona and cold open chosen (A); two or three seniors booked for a filmed read of one card |
| Thu Oct 29 | Vlad | Demo polish: detector verdict first, Muse refinement after (perceived wait); model name and latency on the card; plain-words source line; demo-mode paste check without sign-in |
| Fri Oct 30 | Vlad | Demo-only public deployment, rate-limited, secret-free; one precise Muse question in #office-hours (10–11 AM); Fireworks workshop only if Glimmer is still on the table |
| Fri Oct 30 | Hadrien | Rough cut: screen clips of every scene against the stopwatch; cut what pushes past 2:55; guardian device and seeded inbox ready |
| Sat Oct 31 | Vlad | README: "Built during the hackathon" finalized with one commit link per feature, architecture diagram, "How Muse Spark is used" section; run instructions tested from a clean clone |
| Sat Oct 31 | Hadrien | Senior comprehension clips filmed (consent on file); narration recorded, one take per scene, best microphone available |
| Sun Nov 1 | Vlad | Full dress rehearsal of the demo path with real Muse calls, cache warmed; code freeze tag `video-cut`; secret scan; `make check` green |
| Mon Nov 2 | Hadrien | Record every scene, assemble, burn captions, export; watch once on a phone and once muted; upload unlisted; only fixes the viewing shows |
| Tue Nov 3 | Hadrien | Submit on the CV platform with both members, repo URL, video URL, X post link; post on X and LinkedIn; confirm the entry displays |
| Tue Nov 3 | Vlad | Repo public and opened logged-out; video link in the README; tag `submitted`; no code changes after |
| Wed Nov 4 | Vlad | Buffer only: re-check the submission and credits before 9:00 PM; prepare the live-final version of the demo (Nov 9, 12:00 PM) |

## Video blueprint (3:00)
Build on demo-plan.md's storyboard with these changes, each from the evidence above:
- 0:00–0:08 product first, no card: the phone, the scam text, the verdict card already answering "Scam. This is not how Chronopost writes to you." Then the title. Cold open A, not B: a quote card is a slide, and judges decide in seconds.
- 0:08–0:30 the problem in one breath: $7.7B lost by people 60+ in 2025, Gmail stops 99.9%, "the 0.1% lands at 9 pm"; one sentence of Hadrien's personal link (Build for Your World).
- 0:30–1:05 the life-context verdict (the money shot), read aloud, 64 px buttons; the "What we know about you" panel for 6 s.
- 1:05–1:35 the guardian loop end to end on two devices, the answer landing live.
- 1:35–2:05 Gmail acting by itself (label, move, Put it back) or, in demo mode, the paste check and a screenshot read by Muse Spark; Android SMS on a real phone for 10 s at most (open question 5: yes, 10 s).
- 2:05–2:35 how it works: one diagram, the JSON on screen for 4 s, the guardrail line, the numbers card (32% to 81%, 0/250). Say "Muse Spark 1.3, Standard mode, strict schema, reasoning effort low, four seconds" out loud.
- 2:35–2:50 proof: a senior reading the card on camera, one sentence; the privacy lines as captions.
- 2:50–3:00 close: "Built Oct 26 – Nov 4, 2026 by two people", repo URL, one line from pitch.md.
Production: 1080p; browser at 125–150% so 19 px type reads on a phone; 2 s minimum per state; captions burned in (assume muted viewing); narration recorded separately; no terminal or editor on screen; YouTube unlisted, "not made for kids", tested logged-out; end at 2:57 or earlier.

## Visibility levers
- Discord: intro in #intros on Oct 28 with the differentiator in one line; one precise Muse question per day in #office-hours (weekdays 10–11 AM ET, Meta staff, text only), for example reasoning summaries on the Responses API or strict-schema limits; quote the answer in the README ("per Meta's office hours").
- Get a Meta engineer to look at `lib/muse.js` by posting measured numbers (thinking tokens by effort, latency, 0/250) as a question, not a pitch; numbers get replies and reposts, pitches do not.
- X on Nov 3: the video, tagging @MetaforDevs and @cerebral_valley; Most Viral ($20K) counts likes, reposts and comments until Nov 8; prepare a 30 s cut and three screenshots. Hadrien's LinkedIn reaches caregiver and senior-care networks (Impact, and voters).
- Community Vote ($10K) opens Nov 9: write the gallery one-liner and thumbnail for voters and judges alike ("judges every message against her own life; one tap brings her daughter"); line up family, friends and the filmed seniors' families to vote Nov 9–16.
- Submit on Nov 3, not Nov 4: Nov 3 is the "last full day for submission questions" (hackathon.md), and an early entry is visible to organizers before the rush.

## Provenance note (what to write where)
Facts: kickoff Oct 26, 12:00 PM ET; first commit d43ced6 at 20:12 ET the same day, 29 files / 2,838 lines, author date equals commit date, 24 more commits that evening; the PRD, system prompt and README in that commit are dated Oct 26. Two data points predate the kickoff: a pattern card `first_seen 2026-10-25` and a test case anonymized from a real email received Oct 25 (data, not code).
- README "Built during the hackathon" (exists, with a bracketed question for Hadrien): replace the question with his exact statement, for example "Everything in this repository was written on or after Oct 26, 2026, 12:00 PM ET; the first commit at 20:12 ET imports that afternoon's work (PRD, engine, tests); the history was never rewritten." If any part was written before noon, name it ("the detector rules in lib/detector.js were drafted on Oct 25") and keep it out of the video, or move to the Startup track, where prior code is allowed when the new work is identified. Add one commit link per feature and mention the two Oct 25 data points.
- Submission description: one line, "All code written Oct 26 – Nov 4, 2026 (first commit Oct 26, 20:12 ET, after the kickoff)"; video end card: "Built Oct 26 – Nov 4, 2026".
- Discord #questions, Oct 28, in writing: "Our first commit is Oct 26, 20:12 ET, after the kickoff, and imports that afternoon's work. Is anything more needed to make original contributions clear?" Keep the answer in hackathon.md.
- Never squash, rebase or re-date history; `git log` is the evidence.

## Risks and mitigations (top 5)
1. Disqualification on provenance: the note above, done by Oct 28; the video shows only listed features.
2. The live Gmail path is not ready: decide Oct 29; film demo mode labeled "demo data" rather than a flaky inbox; keep a Gmail clip for the live final if it works later.
3. Muse API slow, down or geo-blocked on recording day: `/v1/status` check, warmed cache (keyed by model and prompt version), reasoning effort low, OpenRouter base-URL fallback (meta-ai-stack.md); record scene by scene.
4. Video late or long: script Oct 29, rough cut Oct 30, record Nov 2, hard stop 2:57; the life-context verdict and the guardian loop are never cut.
5. "Fifth scam checker": the first 20 seconds show the life-context sentence and the guardian, never "AI detects scams"; the gallery one-liner says the same.

## Sources (accessed 2026-10-27)
- Official: https://cerebralvalley.ai/e/meta-ai-developer-hackathon ; https://dev.meta.ai/events/global-hackathon (Official Rules and guide wording as transcribed in hackathon.md)
- Past winners: https://claude.com/blog/meet-the-winners-of-our-built-with-opus-4-6-claude-code-hackathon (videos youtube.com/watch?v=jHwBkFSvyk0, rsUaz_QAK6o, V29UCOii2jE, GFCrXehS1DE, X6CqJoyj0kI; durations and dates read from the pages) ; https://www.edtechinnovationhub.com/news/a-doctor-a-carpenter-and-a-teacher-win-anthropics-global-opus-47-hackathon ; https://x.com/cerebral_valley/status/2026066211482857844 (13,000+ applicants, 500 selected, 227 projects, 6 finalists) ; https://gigazine.net/gsc_news/en/20260425-anthropic-hackathon ; https://ai.meta.com/blog/llama-3-hackathon-recap-cerebral-valley/ ; https://about.fb.com/news/2024/11/metas-llama-impact-hackathon-pioneering-ai-solutions-for-public-good/
- Judges' own words and video guidance: https://info.devpost.com/blog/hackathon-judging-tips ; https://info.devpost.com/blog/6-tips-for-making-a-hackathon-demo-video ; https://blog.mlh.com/should-your-hackathon-go-digital-03-10-2020 (3-minute videos, 5 minutes per project) ; https://aitinkerers.org/docs/public/video_production_guide.md ("Production quality does not affect your judging score")
- Provenance norms: https://guide.mlh.com/general-information/judging-and-submissions/rules-for-your-hackathon ("You may not work on your project before the event"; frameworks and AI use listed in a README) ; https://www.kqed.org/news/119294/salesforces-hackathon-scandal-secret-judging-favoritism-cheating ; https://www.pcworld.com/article/448833/salesforcecom-will-do-full-review-of-hackathon-after-controversy-benioff-says.html
- Secondary summaries consistent with the rules: https://reconscribe.com/meta-global-ai-developer-hackathon-2026/ ; https://madrobot.blog/2026/10/03/meta-global-ai-developer-hackathon-1-million-prizes-muse-model-api/ ; https://github.com/meta-ai-hackathon/meta-hack (participant-guide copy, unverified) ; https://nandigamharikrishna.substack.com/p/i-got-into-metas-1m-global-ai-developer
