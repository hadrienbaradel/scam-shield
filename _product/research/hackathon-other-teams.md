# Other teams in the Meta Global AI Developer Hackathon (snapshot 2026-10-27, day 2 of 10)

How this was gathered: GitHub search for repositories naming the event (about 60 found by Oct 27, 11:30 UTC), the `meta-hackathon` topic page, web search for posts and READMEs. The official gallery and community voting are switched off until Nov 9, so nothing is public on the CV platform yet. Every line is self-described by its team; almost all are solo Indie entries at scaffold or day-1 stage, none has a video yet. Treat all of it as "(unverified)". Rules and judging: [hackathon.md](hackathon.md). Strategy: [how-to-win.md](how-to-win.md).

## Direct competition: scams, fraud, security, seniors
| Project | One-liner (their words, shortened) | Track | Link |
|---|---|---|---|
| TrueTick | AI scam checker: share any suspicious message, screenshot, voice note or QR code and get a clear verdict; Muse Spark + SAM 3.1; FastAPI + installable web app; "in progress" | Indie, Build for Your World | https://github.com/moyososvbL/TrueTick |
| ScamShield Family | "AI scam bodyguard for families": message or screenshot in, plain-language explanation out, SAM 3.1 highlights suspicious areas; family alert before payment "coming"; local Python app | not stated | https://github.com/Arkeshak/scam-shield-family |
| Grandma Buddy | Voice companion for older adults living alone (check-ins, pill reminders, symptom log, family summaries) with a scam check: forward a text, email or photo, Muse Spark 1.3 returns a JSON verdict; Muse Voice Transcribe; demo promised for "Day 9" | Indie, Build for Your World | https://github.com/mousisite/grandma-buddy-hackathon |
| Krai-A beta | Thai anti-scam call agent: screens scam calls to elderly parents turn by turn and alerts relatives before money leaves; Muse Spark + Wonder + Voice; calls only; model calls in fallback until credits arrive | Indie, solo | https://github.com/ilGentEAcutoO/krai-a-beta |
| IsItLegit | "Forward a suspicious email. Get a verdict with the evidence." Phishing, invoice fraud and impersonation for small businesses; every claim cites a header, domain, rendered screenshot or invoice field; a contained browser walks login forms with canary values; supplier trust network; South African MSP; Cloudflare Workers; "day 0 of the build" | Startup | https://github.com/rizonetech/isitlegit |
| BillSaathi | Agent that verifies Indian bills and payment requests and catches scams before you pay | not stated | https://github.com/bharatvamsi34/billsaathi |
| Reflex | Two-speed triage of phishing reports: a local model first, a Meta agent for doubtful cases (French) | not stated | https://github.com/Aymiut/reflex |
| Before You Post | Privacy red-team agent: finds what your photos give away and removes it before you post | Indie | https://github.com/WhorideChicken/before-you-post |
| MAYA | Security agent that investigates owned sites with evidence-backed findings and human-approved fixes | not stated | https://github.com/hackers-dot/maya-hackathon |
| ForgeVigil | Cybersecurity system using autonomous agents on Muse models | not stated | https://github.com/billyrdavis1985-bot/ForgeVigil |
| TraceX | Blockchain forensics: traces crypto flows and suspicious transactions into evidence | not stated | https://github.com/ekumahost/TraceX |

## The wider field (sample of the ~60 repos)
| Project | One-liner | Link |
|---|---|---|
| Itemized | Checks funeral-home price lists against the FTC Funeral Rule | https://github.com/butchewing/itemized |
| BillRadar | Finds billing errors and missed financial assistance in family hospital bills | https://github.com/NadyKor15/billradar |
| CASER 2.0 | Federal court filings explained in plain English by "Atticus" | https://github.com/caser-legal/CASER-2.0 |
| Anyone Hear Me | Turns scattered disaster help requests (voice notes, photos, messages) into verified rescue tasks | https://github.com/msalihk/anyone-hear-me |
| WorldSpeak | Accessible English and Tamil communication | https://github.com/akilanpl/worldspeak |
| Krishok-Bondhu | Helper for farmers in rural Bangladesh, Muse Spark + SAM 3.1 | https://github.com/anhafdev/Krishok-Bondhu |
| Mi cultivo me habla | Plant-care assistant that gives crops a voice (Muse Spark, SAM 3.1, ElevenLabs) | https://github.com/somossoftgrama/mi-cultivo-me-habla |
| Film it, sell it | A shop films its showroom once; an AI seller on WhatsApp knows every product (Startup) | https://github.com/Fatdrfrog/meta-ai-hackathon |
| Vitrina, SellerChat, DapurStudio, Darflow | WhatsApp storefronts and concierges for sellers in Colombia, Indonesia, Morocco | https://github.com/alined-labs/vitrina |
| Night Shift | Overnight manager agent on Muse Spark: acts under your permissions, wakes you only on evidence | https://github.com/hrminator/night-shift |
| Muse-guard, Witness, Evidence-gated repair, sparkguard, PermitZero | A cluster of "make the coding agent prove it" and agent-firewall tools | https://github.com/jeshwanthsingh/muse-guard |
| Proof-Carrying Code | Python to Dafny with machine-checked proofs; Muse Spark + Glimmer | https://github.com/hosbe1/Proof-Carrying-Code-Meta-AI-Hackathon-2026 |
| Keyframe | Myst-style puzzle game where agents rebuild scenes with SAM 3.1 | https://github.com/lutic1/meta-hackathon-2026 |
| MemriPal | Study material anchored to photographed places, SAM 3.1 + Muse | https://github.com/KevinKbyte/MemriPal |
| Montivo, Shouldercut | Agent-first and voice-driven video editors on SAM 3.1 masks | https://github.com/bgaravelos/montivo |
| Readback | Catches readback errors between air-traffic controllers and pilots | https://github.com/ROHITCRAFTSYT/readback |
| RE:GOV | Agent that rebuilds legacy Philippine government sites (Spark, SAM 3.1, Muse Image) | https://github.com/rockyru/regov |
| Threshold | Accessibility survey of shop entrances from Mapillary street photos | https://github.com/edward321416-maker/threshold |
| Sira | An AI astronomer "built to be proven wrong in public" | https://github.com/Alehcs/sira |
| MERLIN, BLE-Jarvis, musez-home | Jarvis-style home and desk assistants | https://github.com/Darthfranco/MERLIN |

## What the field tells us
1. Volume: 20,000 accepted participants, so judges will screen thousands of 3-minute videos. Five or more "paste a message, get a verdict" scam checkers already exist in the Indie track; a generic checker is table stakes, not a differentiator.
2. None of the scam entries claims personal life context (real orders, carriers, bank, contacts, breaches), Gmail integration with automatic labeling, a guardian loop with a live answer, reversible mail actions, or an SMS companion. That is Scam Shield's open ground; say it in the first 30 seconds.
3. The most rigorous neighbor is IsItLegit (evidence-cited verdicts, sandboxed link visiting, supplier trust network), but it targets small businesses, sits in the Startup track, and was at "day 0" on Oct 27.
4. Grandma Buddy owns the "built for my grandmother" emotional frame and a senior-first voice UI; it also sits next to the "AI medical advice" anti-project (it says it gives none). Scam Shield should keep its own grandmother story concrete and stay away from health.
5. Name collision: "ScamShield Family" is in this hackathon, and a "ScamShield" exists in another 2026 hackathon. Keep the name if wanted, but always pair it with the differentiator ("judges messages against your own life") in the title card, README, video and X post.
6. Workshop themes shape the field: "verifiable agents" (Agents 102) produced many "prove it" tools, and "point a camera at X" (SAM 3.1) is everywhere. Evidence-backed, verifiable verdicts (schema, guardrails, measured accuracy) match what the Meta speakers are teaching.
7. Most entries are solo. A two-person team with product and CTO roles and a measured evaluation (500 held-back emails, 0 of 250 false Scam) is unusual at this stage.

## Threats and opportunities for Scam Shield
| Topic | Threat | Mitigation or opportunity |
|---|---|---|
| Sameness | A judge who has seen four scam checkers skips the fifth | Open on the life-context verdict ("your parcels come by Amazon Logistics, not Chronopost"), not on "AI detects scams" |
| New-work rule | Pre-event code shown without labeling is a disqualification risk; the Indie track has no "existing codebase" clause | A "Built during the hackathon" section in the README with the commit range and a feature list; the video shows only those features |
| Repo | Private today; must be public and secret-free by submission | Data scan, flip to public, verify logged-out (checklist in hackathon.md) |
| Rubric fit | "Use of Meta AI Tooling" (25%) rewards surprising capabilities, not one chat call | Show screenshot reading, schema-valid JSON with evidence, reasoning-effort tuning, the guardrail overruling the model; consider Muse Voice Transcribe for voice notes |
| Open-weights bonus | $10K for Glimmer or Spark Open builds; competitors (Proof-Carrying Code) already use Glimmer | Glimmer pre-screen in the Android slot only if it can be finished and verified; otherwise do not claim it |
| Virality | $20K Most Viral needs X engagement by Nov 8; $10K Community Vote needs voters Nov 9–16 | Senior protection resonates with families and caregiver communities; prepare the post and a voter list before Nov 4 |
| Health adjacency | Senior products drift toward "advice" anti-projects | No medical, legal or financial advice: "scam / be careful / real" and "what to do instead" only |

## Sources (accessed 2026-10-27)
GitHub search (`gh search repos "Meta Global AI Developer Hackathon"` plus scam, fraud, phishing, elderly, seniors queries filtered to repositories created after Oct 20); https://github.com/topics/meta-hackathon; the repositories linked above; https://thegenaimagazine.com/meta-global-ai-developer-hackathon-ideas-prizes (an idea list that names a senior care companion and a "scam shield" as likely themes); platform flags on https://cerebralvalley.ai/e/meta-ai-developer-hackathon/hackathon/gallery (gallery and voting disabled on Oct 27).
