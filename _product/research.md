# Research index

What we looked up in order to decide: one file per topic in `_product/research/`, findings first, sources with their accessed date at the end, "(unverified)" on any claim not checked at the source.

| File | Keywords | What it answers |
|---|---|---|
| [research/feasibility.md](research/feasibility.md) | feasibility, technical questions, gmail, sms, voice, android, ios, real-time, pwa, api | 25 technical questions (Gmail limits and verification, real-time arrival, SMS and voice paths, app vs web, Meta API limits), each Open / Researched / Decided with a finding; the session-brief hook lists the open ones |
| [research/hackathon.md](research/hackathon.md) | hackathon, rules, judging, rubric, deadline, submission, prizes, cerebral valley | The event: dates (due Nov 4, 9:00 PM ET), tracks, the rubric verbatim (Impact 30, Meta AI tooling 25, Demo 25, Technical depth 20), prizes, what disqualifies, the submission checklist, lessons from past winners |
| [research/hackathon-other-teams.md](research/hackathon-other-teams.md) | hackathon, other teams, competition, indie track, scam checkers | Snapshot of about 60 competing repos on day 2: the direct scam and senior entries, what the field builds, threats and opportunities for Scam Shield |
| [research/meta-ai-stack.md](research/meta-ai-stack.md) | meta, muse spark, llama, llama api, llama guard | What Muse Spark is and costs, the Meta Model API (formats, limits, regions), the Llama line, what judges expect from "Use of Meta AI tooling", risks and fallbacks for the demo |
| [research/scam-market-stats.md](research/scam-market-stats.md) | market, fraud statistics, FTC, IC3, seniors, elder fraud | FTC and FBI IC3 figures for 2024 and 2025, losses by people 60+, email and SMS as channels, three lines for the video, with sources |

| [research/how-to-win.md](research/how-to-win.md) | hackathon, judging, winning, video, submission, strategy | What judges reward, winner patterns, our position, the day-by-day plan to Nov 4, video blueprint, provenance note |
| [research/score-demo-and-technical.md](research/score-demo-and-technical.md) | rubric, demo, technical depth, execution, video, score, polish | How Demo (25%) and Technical Depth (20%) are judged, where the video and repo stand, ordered recommendations with lift and effort, a revised 180-second storyboard, repo checklist, proposed edits to how-to-win.md |
## How to add research

1. `research/<topic>.md` opening with a `Keywords:` line, findings in the shortest form that supports a decision, a `## Sources` section with URL and accessed date; mark every claim not checked at the source "(unverified)".
2. Add one line to the table above (file, keywords, what it answers); `node scripts/docs-check.mjs` fails until the file is listed.
3. If a decision follows, carry it into `_product/spec.md` or the feature file; research never changes a status by itself (`_product/docs/product-process.md`).
