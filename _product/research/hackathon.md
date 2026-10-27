Keywords: hackathon, rules, judging, rubric, deadline, submission, prizes, cerebral valley
# Meta Global AI Developer Hackathon: rules, dates, judging, prizes (researched 2026-10-27)

Facts below come from the official event page and the Official Rules embedded in it (cerebralvalley.ai), from the participant guide (behind login; its text was verified through two participants' committed copies, which match the Official Rules wherever they overlap) and from the organizers' kickoff slide relayed by Hadrien. Everything else is marked "(unverified)". Strategy and the day-by-day plan: [how-to-win.md](how-to-win.md). Other teams: [hackathon-other-teams.md](hackathon-other-teams.md).

## The event in one paragraph
Hosted by Meta and Cerebral Valley (CV). Virtual, worldwide, free, capped at 20,000 accepted applicants. Ten days: kickoff Mon Oct 26, 12:00 PM ET; submissions due **Wed Nov 4, 9:00 PM ET** (Thu Nov 5, 03:00 Paris). $1,000,000 prize pool. Every accepted participant gets $150 in Meta Model API credits. Scam Shield is in the **Indie Developer track**, theme **"Build for Your World"**.

## Key dates (ET; the organizers may change them, changes are posted on the event page)
| When | What |
|---|---|
| Mon Oct 26, 12:00 PM | Kickoff livestream: overview, rules, prizes, judging, Meta speaker. The page header reads "Oct 26 at 12:00 PM – Nov 4 at 9:00 PM" |
| Oct 27 – Nov 4 | "Building period" per the guide. Workshops 12:00–1:00 PM: Oct 27 "Agents 101: Build a Multimodal AI Agent" (Suraj Subramanian), Oct 28 "Agents 102: Best Practices for Verifiable Agents" (Yash Khare), Oct 30 Muse open models on Fireworks (Sinan Ozdemir) |
| Weekdays 10–11 AM | Office hours: Meta staff answer by text in Discord #office-hours (no video) |
| Tue Nov 3 | Last full day for submission questions and technical troubleshooting |
| **Wed Nov 4, 9:00 PM** | **Submissions due on the CV platform; last moment to claim the $150 credits.** "Late submissions won't be considered" |
| Nov 5–8 | Judging, stages 1 and 2 |
| Mon Nov 9, 12:00 PM | Closing ceremony: top 10 announced (5 per track), live final round, winners revealed, community vote opens |
| About Nov 10 | Bonus prizes announced (Official Rules) |
| Mon Nov 16 | Community vote winner announced on Discord |

## Tracks and themes
- **Indie Developer track**: "Open to individual builders and students, teams of up to four (4)". Event page: "Judged on creativity, technical ambition, and whether it works." One track per project. A team appoints one Representative who submits and "shall identify all other team members in the project submission".
- Startup track: "Open to technical founders building a product", "Judged on technical execution and whether it holds up in production." Bigger prizes ($550K vs $400K); the rules let startups build on existing code if the new work is identified. The Indie track has no such clause.
- Themes, either track: **"Build for Your World. Bring Meta's models into your domain. Solve a problem you know firsthand, free up time and mental space, and make something possible that wasn't before."** and "Push the Frontier" (software, robotics, manufacturing, energy, materials, science).
- "Your project must incorporate Meta's models": Muse Spark series, Muse Wonder, Muse Image, Muse Voice Transcribe and SAM 3.1 through the Meta Model API; open weights Muse Glimmer and Muse Spark Open; the Muse Code coding agent. No specific model is mandated.

## Judging (Official Rules, weights verbatim)
Stage 1, pass/fail: the project "reasonably fits the theme and reasonably used Meta Model API and/or Meta's open-weight models to build the project in the Hackathon". Stage 2, each criterion scored 0–10:
| Weight | Criterion | Official wording |
|---|---|---|
| 30% | Impact | "the real-world potential of the Project, who benefits, how much it matters, whether it could become something people use, and whether it fits one of the problem statements" |
| 25% | Use of Meta AI Tooling | "how creatively the team used Meta's AI tooling, whether they went beyond a basic integration, and whether they surfaced unexpected capabilities" (guide: "capabilities that surprised even us") |
| 25% | Demo | "whether the Project has a working, impressive demo, whether the product holds up live, and the quality of the demo video" (guide: "Is the demo video genuinely cool to watch?") |
| 20% | Technical Depth & Execution | "whether the engineering is sound and thoughtfully refined and the Project demonstrates real craft" |
Stage 3: the top 5 per track reach a final round where "final round Judges will watch the video demos live and rank them using the same rubric". Judges' selections are final.

## Prizes
- Indie Developer, $400,000: 1st $150K, 2nd $100K, 3rd $75K, 4th $50K, 5th $25K. Startups, $550,000: $250K / $150K / $75K / $50K / $25K.
- Bonus, $50K across both tracks: **Most Viral Project $20K** (post the demo on X, submit the link on the platform; likes + reposts + comments until Nov 8 end of day), **Best Build on Meta Open Weight Models $10K** (Glimmer or Spark Open on own hardware or partner inference, verified by the partner), **Community Vote $10K** (gallery votes, one per verified account, announced Nov 16), Best Agentic Use-Case $5K, Best Creative Build $5K (Muse Image or Muse Wonder).
- Paid in USD by CV through Tremendous within 30 days of verification; W-8BEN for non-US winners; winners pay fees and taxes; a team states its split in writing.

## Rules that can disqualify
- **New work only**: "What you present at this Hackathon must have been built during the event. This should be clear in your submissions." "Your demo must only highlight the specific features, code, and functionality that you built during the Hackathon. Judges must be able to clearly identify what was created during the Hackathon. Failure to clearly identify your original contributions will result in immediate disqualification at Judges sole discretion." Safest reading: nothing from before the Oct 26, 12:00 PM ET kickoff; several participants count from Oct 27.
- **Public repo**: "Repositories must be public." Team max 4, solo allowed, one submission per team. `hadrienbaradel/scam-shield` is **private** as of Oct 27 (GitHub API and a logged-out request); STATUS.md requires a data scan before any publication.
- Banned: projects that "violate legal, ethical, or platform policies, use code, data, or assets you do not have the rights to". Sample anti-projects: AI medical advice, basic RAG apps, simple image analyzers, simple "AI for Education" chatbots, job-application screeners, nutrition coaches, personality analyzers, sports analyzers, "anything political or involving war". One participant's notes add "Streamlit apps and dashboards as the main feature" (unverified).
- IP: the entrant keeps ownership; the Organizers get "a perpetual, irrevocable, worldwide, royalty-free, and non-exclusive license" to use and publish the Submission, including in marketing; nothing shared is confidential. The Submission must be original work; open source may be included if its licenses are followed and the Submission "enhances or builds upon" it.
- Credits: each participant claims their own $150 through the form in the guide (nobody can claim for a teammate); a card must be on the account; set a spend limit. Partner credits are discretionary: Baseten $100 + 2M TPM (use `meta-models/muse-spark-open-1026`), Modal $100 (first 1,000), Fireworks $25 (shortlisted teams).

## Submission checklist (deadline Wed Nov 4, 9:00 PM ET)
From the organizers' kickoff slide, "Submit four things by Nov 4, 9:00 PM ET":
1. Submit on the CV platform, with every teammate (cerebralvalley.ai/e/meta-ai-developer-hackathon/hackathon/submit).
2. A 3-minute demo video: show only what your team built during the event; judges score from it.
3. A public GitHub repo: check that it opens in a logged-out browser before you submit.
4. Before the deadline: Wednesday, Nov 4 at 9:00 PM ET, don't wait for the last hour.
Guide wording: "a three minute demo video highlighting the specific features, code, and functionality you built during the Hackathon. This video will also be used as one of the primary artifacts Judges use to judge your project, along with your code and live product." One Representative submits; "double-check that your repository is accessible publicly, your video link is accessible, and everyone who worked on the project is listed". The form fields are behind login (unverified); expect title, tagline, description, track, theme, repo URL, video URL, team members, X post link (Most Viral). The platform config shows a 6-hour "grace period" setting; the guide says late entries are not considered, so ignore it.

## Lessons from past Meta and Cerebral Valley hackathon winners
- Winners build from lived expertise, which is the "Build for Your World" theme: CV's online Claude Code hackathons (Apr 2026, about 500 builders picked from roughly 20,000 applicants, unverified) were won by a former physician (Medkit), a former micro-soldering technician (Wrench Board), a personal-injury attorney (CrossBeam) and a cardiologist (PostVisit.ai); "four out of five winners were not professional developers". Lead with Hadrien's real cases and the measured numbers.
- Fraud with evidence and a human in the loop has placed before: Compliance Wizards took 2nd at the LlamaCon Hackathon (May 2025, 44 projects) with a risk model that flags fraud and emails alerts the user can answer by voice. OrgLens (1st) and Llama CCTV Operator (3rd) let people ask the model in plain language. Scam Shield's "reasons with evidence" and the guardian's one-tap answer sit in that line.
- "Surfaced capabilities that surprised even us" is in the rubric: the London Llama Impact winners (Guardian triage agent, Gripmind brain-signal robot arm, Pharmallama local pharmacist app) each showed one non-obvious model capability. Show Muse Spark reading a screenshot, returning schema-valid JSON with evidence, and being overruled by the guardrail.
- The video is the product: finalists are ranked by judges watching the videos live. A winner's advice: "It takes way longer than you think to produce a 3-minute video", "reserve that entire last day just for producing the demo."
- Privacy by design was rewarded (Pharmallama runs locally). Say "Standard mode: nothing trains Meta's models" and "mail bodies are never stored" out loud.

## What could not be verified
Submission form fields; the Discord server and its announcements; whether the kickoff recording defines "built during the event" more precisely than the guide; the full banned list beyond the samples; the exact kickoff time (the page says 12:00 PM "EST", the calendar entry is 17:00 UTC).

## Sources (all accessed 2026-10-27)
- Event page with Official Rules and Waiver embedded: https://cerebralvalley.ai/e/meta-ai-developer-hackathon and https://cerebralvalley.ai/e/meta-ai-developer-hackathon/waiver
- Participant guide (login only): https://cerebralvalley.ai/e/meta-ai-developer-hackathon/details; participants' copies: https://github.com/Darthfranco/MERLIN/blob/main/docs/sources/participant-guide.txt and https://github.com/meta-ai-hackathon/meta-hack/blob/main/info/event%20guide.md
- Meta event page: https://dev.meta.ai/events/global-hackathon; models and modes: https://dev.meta.ai/docs/models
- Past winners: https://ai.meta.com/blog/llamacon-hackathon/ ; https://about.fb.com/news/2024/11/metas-llama-impact-hackathon-pioneering-ai-solutions-for-public-good/ ; https://www.claude.com/blog/meet-the-winners-of-built-with-opus-4-7-claude-code-hackathon ; https://claude.com/blog/meet-the-winners-of-our-built-with-opus-4-6-claude-code-hackathon
- Third-party summaries, consistent with the above: https://aimagazine.blog/meta-opens-its-1m-global-ai-developer-hackathon-20000-seats-150-api-credits-each-and-applications-close-october-25/ ; https://vibecoderslife.com/post/meta-ai-developer-hackathon-2026 ; https://github.com/Sibusiso-K/Parallax/pull/1
