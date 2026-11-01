# Ideas to make the demo land (prioritized)

Impact and effort are judgments against the Nov 4 deadline. "Built" means in the repo today (see docs/STATUS.md); everything under "Feature ideas" is an idea, not built. Rules and rubric: [../research/hackathon.md](../research/hackathon.md).

## Demo and submission ideas
| # | Idea | Impact | Effort | Note |
|---|---|---|---|---|
| 1 | Open the video on the life-context verdict ("your parcels come by Amazon Logistics, not Chronopost"), not on "AI detects scams" | High | Low | The one sentence no other scam checker in the hackathon can say |
| 2 | "Built during the hackathon" section in the README: kickoff timestamp, commit range, feature list; show only those features | High | Low | Insurance against the new-work disqualification rule; the Indie track has no existing-code clause |
| 3 | Accuracy card in the video: 29% → 81% phishing called Scam, 1 false Scam in 17,291, median 6 s (18,849 held-back emails, prompt v4, Oct 31) | High | Low | Already measured; judges rarely see numbers from a 10-day build |
| 4 | Guardian loop filmed on two real devices with the live update | High | Medium | The most human moment; make sure email delivery works or use the dashboard path |
| 5 | Show Muse Spark doing non-obvious things: reads a screenshot, returns schema JSON with evidence, gets overruled by the guardrail, reasoning effort tuned | High | Low | "Use of Meta AI Tooling" is 25% and asks for capabilities "that surprised even us" |
| 6 | Make the repo public after a secret scan and a data scan; open it logged-out; add the video link | High | Low | Private today; a hard requirement |
| 7 | X post with the video right after submission; ask friends and caregiver or senior communities to engage until Nov 8 | Medium | Low | Most Viral Project $20K; needs an X account with some reach |
| 8 | Community vote campaign Nov 9–16 (one vote per verified account) | Medium | Low | $10K; prepare the list of people to ask before Nov 4 |
| 9 | Voice-note check through Muse Voice Transcribe (WhatsApp voice scams) | Medium | Medium | A second Meta model with a clear user story |
| 10 | Muse Glimmer on-device pre-screen in the Android slot | High | High | Qualifies for the $10K open-weights bonus only if it runs and the partner can verify; do not claim it unless shipped |
| 11 | A distinctive tagline next to the name, since "ScamShield Family" is in the same hackathon | Medium | Low | "Scam Shield: judges messages against your own life" on the title card, README and X post |
| 12 | French second-market beat (Bouygues IBAN notice), 10 seconds | Low | Low | Shows the context idea generalizes; the first thing to cut if over time |
| 13 | A real senior's reaction (the PRD's 3-senior comprehension test) as a 5-second clip | Medium | Medium | Only with consent and no personal data; synthetic messages on screen |

## Feature ideas from Vlad (ideas, not built; they would strengthen the narrative if shipped in time)
- **Second opinion**: from a screenshot, ask a trusted human (today's guardian loop) or ask the service itself, for example by checking the sender against the real company's published contact channels. Extends "Ask my trusted person" with "Ask the company".
- **Pressure coach**: "Is this a good offer? Am I being pressured?" A verdict mode for legitimate-looking but high-pressure messages (urgency, secrecy, gift cards, crypto) with a cool-down suggestion. Fits "what to do instead" without giving financial advice.
- **Micro-learning**: short gamified anti-scam lessons built from the week's pattern cards ("Scam of the week"), optionally illustrated with Muse Image. Keep it out of the video unless built; it is adjacent to the "AI for Education chatbot" anti-project, so frame it as practice on real patterns, not a tutor.
- **Breach exposure**: "which leaks included your data" (an HIBP lookup exists in settings today), surfaced as a reason in verdicts: "your IBAN was in the Bouygues leak, so a message showing it proves nothing".
- **Privacy by default**: "no human reads your mail" as a product promise and a screen: Standard mode, redaction before the model, bodies never stored, every learned item removable. Mostly built; needs the words and the screen.

## Risks and mitigations
| Risk | Mitigation |
|---|---|
| New-work rule: code older than the Oct 26 kickoff shown without labeling means disqualification at the judges' discretion | Label the build window in the README and the video; if any engine code predates kickoff, say so explicitly and show only post-kickoff features |
| Repo private or leaking secrets at submission | Secret and data scan, public flip, logged-out check, two days before the deadline |
| Google OAuth client or test users not ready, so no real-Gmail footage | Hadrien's console step this week; fallback `/#/demo` labeled as demo data |
| Muse Spark empty answers or latency (thinking-token budget) | Reasoning effort "low", 4,000 max tokens, cache warmed with the demo messages, detector fallback shown honestly |
| Video over 3 minutes or unreadable on a phone | Script to 2:50, large captions, watch it on a phone muted |
| Judges lump it with generic checkers | Ideas 1, 3 and 11; say "life context", "guardian", "reversible" in the first 30 seconds |
| Anti-project adjacency (health, education) | No medical, legal or financial advice anywhere; micro-learning only as practice on real patterns |
| Demo data privacy | Synthetic or redacted mail only; no real .eml in the repo; no real names on screen |
| Last-day crunch | Reserve Nov 3 for the video and the morning of Nov 4 for submission; the deadline is 03:00 Paris on Nov 5 |
