Keywords: rubric, demo, technical depth, execution, video, score, polish
# Scoring higher on Demo (25%) and Technical Depth & Execution (20%) (review 2026-10-27)

What a judge sees in 180 seconds and in the repo, where we stand today, and what to change this week. Impact and Meta tooling are covered elsewhere and named only where a change serves them too. Rubric and rules: [hackathon.md](hackathon.md); strategy and plan: [how-to-win.md](how-to-win.md); storyboard: [../marketing/demo-plan.md](../marketing/demo-plan.md). Effort is in days for two developers with Claude Code agents; lift is an estimate on the 0–10 scale of each criterion.

## How these two items are judged (quotes)
- Demo, 25%: "whether the Project has a working, impressive demo, whether the product holds up live, and the quality of the demo video"; guide: "Is the demo video genuinely cool to watch?" and the video is judged "along with your code and live product" (hackathon.md).
- Technical Depth & Execution, 20%: "whether the engineering is sound and thoughtfully refined and the Project demonstrates real craft".
- Indie track lens: "creativity, technical ambition, and whether it works". Finalists are re-ranked by judges who "watch the video demos live", so the video is scored twice; a judge screening thousands of entries spends about five minutes per project (how-to-win.md).
- Translation: Demo is scored on what is seen working (real inbox, real phone, real guardian, real latency, no `degraded` card); Technical depth on what a reader can verify in five minutes (diagram, numbers, tests, CI, safety claims that point to code).

## Where we stand (today, honestly)
- No footage yet. On this checkout the demo runs detector-only: the credentials hold `TOKEN_ENC_KEY` only, the server prints "Muse Spark: NOT configured", and every demo card ends with "Judged by detector (Muse Spark not configured)", the exact "thin" look to avoid. Muse ran live on Hadrien's machine on Oct 26 (STATUS, 500-email evaluation).
- Demo mode lists 36 fixtures as "Example D1 · sms", "Example A1 · email": test ids on screen, no dates, no "What we know about you" panel, no Ask, no labels, no Put it back. The Android screenshots in `android/tools/` are good (28 sp headline, 72 dp buttons, answer landing from "Thomas").
- Never run live: Gmail scanning, life context, reversible actions (OAuth client still a console step); guardian email leaves the machine only with a Resend key (else `/dev/outbox`); one-tap links need a public HTTPS origin to open on a phone; Android is emulator-only; URLhaus key refused; screenshot check never exercised against the live model (specs). Nothing is deployed and the GitHub repo is private (checked with `gh repo view`).
- Repo signals a judge can verify, measured here: 203 tests pass in 12 s (`make test`), line coverage 89.1% (threshold 84), `make score` 36/36 detector-only, CI workflow with a Node job and an Android APK job (no run seen: unverified), encrypted credentials, strict CSP, allow-listed Gmail client, two-way guardrail, schema-checked verdicts, 30-day cache, circuit breaker.
- History a judge who "checks histories" sees: 41 commits, first one a 2,838-line "backbone" at 20:12 ET on Oct 26, then the multi-user server, the web app and the Android app land between 20:32 and 20:43, i.e. a whole product in 31 minutes. True or not, that reads as pre-existing code unless the README says how the day went (unverified: session work committed in batches that evening). The README still carries a bracketed question to Hadrien, a stale "Status (Oct 26)" section, no diagram, no commit links, and the PRD says 146 tests (203 today).

## Demo: recommendations (ordered)
| # | Recommendation | Lift | Effort | What changes on screen |
|---|---|---|---|---|
| D1 | Muse Spark on the recording machine: key set, cache warmed on the demo set, `reasoning_effort` low; never a `degraded` or "not configured" card | +2 Demo, +Meta | 0.25 d | Every card says "Checked by Meta's Muse Spark in 3.8 s"; JSON on screen is real |
| D2 | Real Gmail path on a seeded test inbox (OAuth client, test user, 10 genuine + 3 scams): a mail sent from another device turns red without reload; Gmail tab shows the label and the move; Put it back returns it | +2 Demo, +1 Tech | 1 d (Hadrien) | Push-fired pill, Gmail labels moving, undo in ten seconds; fallback is `/#/demo` labeled "demo data" |
| D3 | Guardian loop on two real devices: Resend key (free tier) and a tunnel (cloudflared or ngrok) so the one-tap email opens on the daughter's phone and the answer lands over SSE | +1.5 Demo, +Impact | 0.5 d | Phone email with three big buttons, confirm page, the senior's screen updating live |
| D4 | Demo-only public URL: demo mode plus paste-your-own-message without sign-in, rate-limited, key server-side, no Google scope needed (idea rows below; secret and data scan first) | +1 Demo ("holds up live"), finals insurance | 1 d (Vlad) | A URL on the end card a judge opens in ten seconds; also the live-final fallback |
| D5 | Claude Design pass on the three surfaces that appear on screen (rule in `_product/docs/design.md`): realistic demo inbox (names, dates, no fixture ids); "What Scam Shield knows about Linda" panel in demo; source line with model and latency; evidence chips on each reason (sender, link, your orders, breach); scam text behind "Show me anyway"; detector card first, Muse refines in ~4 s (existing ideas) | +1.5 Demo, +0.5 Tech | 1.5 d | The money shot looks like a product, not a fixture list; no dead air while Muse thinks |
| D6 | A senior on camera: one person reads the card and says what she would do (the PRD comprehension test, consent on file, synthetic message) | +1 Demo, +Impact | 0.5 d | 8-second clip at 2:40; the only moment with a face |
| D7 | Android on a real phone: sideload the CI debug APK, send the "Ethan, new number" text, film the notification and the amber screen | +0.5 Demo | 0.5 d | Real notification, not an emulator; else emulator clip labeled |
| D8 | Show one failure handled: the guardrail "two checks disagree" card, and "Muse unavailable: rules answered, nothing moved" for three seconds | +0.5 Demo, +0.5 Tech | 0.1 d | Craft instead of a hidden weakness |
| D9 | Production: 1080p, browser 125–150%, 2 s per state, captions burned in, narration recorded separately, no terminal, scene-by-scene clips, end at 2:57; rehearsal Nov 1 with `GET /v1/status`, recording Nov 2 | +1 Demo | 1 d | Readable on a phone, muted |

## Technical depth: recommendations (ordered)
| # | Recommendation | Lift | Effort | What the judge sees |
|---|---|---|---|---|
| T1 | Architecture diagram in the README and at 2:00 in the video: normalize → life context → link inspection (never opens links) → detector evidence → Muse Spark (redacted, strict schema) → two-way guardrail → verdict → label / move / alert; Android pre-screen and guardian loop as side branches | +2 Tech | 0.5 d | The whole pipeline in one glance; "beyond one chat call" |
| T2 | Provenance made exact: Hadrien's statement replaces the bracketed question; one sentence on how day one was committed (the 20:12–20:43 arrival); the two Oct 25 data points named; a Feature → commit → test table | DQ insurance, +1 Tech | 0.25 d | "Judges must be able to clearly identify what was created" is answered before it is asked |
| T3 | Evaluation front and center: the 500-email table with caveats in the README, `make score` and `make score-muse` output pasted with date and model id, the corpus kept out of the repo as today | +1.5 Tech | 0.5 d | Numbers a 10-day build rarely has, reproducible |
| T4 | Convert "Built (unverified live)" into verified: run `make gate` on the seeded inbox and paste its PASS report (no mail), run one live screenshot check and record its latency, run the APK on a phone once; update spec statuses | +1.5 Tech, +1 Demo | 1 d | "Does it work at all" answered with evidence |
| T5 | CI green and public: flip the repo public after the scans, confirm both Actions jobs pass (the Android job is unverified), badge renders, coverage 89% stated next to it, a tests map (what each suite proves) | +1 Tech | 0.25 d + fixes | Badge, run history, 203 tests |
| T6 | Claims → code → test table for safety and privacy: never send/trash/delete, Contributor refusal, redaction, injection-proof blocks, SSRF guard, GET-safe one-tap links, AES-GCM tokens, each with file and test name | +1 Tech | 0.25 d | Every claim checkable in a click |
| T7 | Repo hygiene a judge trips on: remove the stale "Status (Oct 26)" section, fix "146 tests", drop the deprecated `set-env.mjs` mention, test `make install && make server` from a clean clone, tag `video-cut` and `submitted`, never rewrite history | +0.5 Tech | 0.25 d | A README that matches the code |
| T8 | URLhaus: re-issue the free abuse.ch key or remove the claim from README and video; the status page already says "refused" | +0.25 Tech | 0.1 d | No claim the code cannot back |
| T9 | `make demo-precheck`: key present, `/v1/status`, Postgres up, cache warm, tunnel up, Resend configured; printed before every recording and the live final | +0.5 Tech, risk cut | 0.25 d | Operational craft; no failed live call on camera |

## A revised 180-second storyboard
| Time | Screen | Narration (gist) | Rubric |
|---|---|---|---|
| 0:00–0:07 | Phone on a kitchen table, scam text; the card already reads "Scam. Your parcels come by Amazon Logistics, not Chronopost." | None, then the title | Demo, Impact |
| 0:07–0:25 | Title card, two figures | "$7.7B lost by people 60+ in 2025. Gmail stops 99.9%; the rest lands at 9 pm. I built this for my own family." | Impact |
| 0:25–0:55 | Senior app connected to Gmail: a mail arrives, the pill turns red without reload, the card is read aloud; "What we know about Linda" 5 s | "It judges the message against her life: her orders, her carrier, her bank, the people she writes to." | Demo, Impact |
| 0:55–1:15 | Gmail tab: "Scam Shield/Scam" label, mail moved; back in the app, Put it back; the audit list | "It acts in Gmail, reversibly. Never sends, never trashes, never deletes." | Tech, Demo |
| 1:15–1:45 | Ask my trusted person: preview, the daughter's phone email, tap "It's a scam", confirm, the senior's screen updates live | "One tap shows her daughter only what she chose to share. The answer lands while she waits." | Demo, Impact |
| 1:45–2:00 | Real phone: "Hi Grandma, it's Ethan" text, notification, amber screen; 5 s of a WhatsApp screenshot read by Muse Spark | "Texts are screened on the phone; screenshots are read by Muse Spark, never stored." | Meta, Demo |
| 2:00–2:25 | Diagram, raw JSON 4 s, the guardrail line, numbers card: 32% → 81%, 0/250, median 4 s, 203 tests, CI green | "Muse Spark 1.3, Standard mode, strict schema, low reasoning effort, four seconds. It can neither clear a proven scam nor condemn a sender she knows." | Tech, Meta |
| 2:25–2:40 | Four privacy lines as captions; 3 s of "Muse unavailable: rules answered, nothing moved" | "Redacted before Meta sees it; bodies never stored; nothing trains Meta's models." | Tech |
| 2:40–2:50 | A senior reads the card on camera | "What would you do?" "Call my daughter." | Demo, Impact |
| 2:50–2:58 | End card: live URL, repo URL, "Built Oct 26 – Nov 4, 2026 by two people; first commit Oct 26, 20:12 ET" | One line from pitch.md | All |

## Repo presentation checklist
- README top: one-line differentiator next to the name, CI badge rendering (public repo), tests and coverage figures, the video link, the live demo URL, "Built during the hackathon" with the exact statement and a Feature → commit → test table (T2).
- "How it works": the diagram (T1), the Muse section (model id, Standard mode, schema, effort, latency, cache, breaker), the evaluation table with caveats (T3), the claims → code → test table (T6).
- Provenance line everywhere it is read: README, submission description, end card: "All code written Oct 26 – Nov 4, 2026; first commit Oct 26, 20:12 ET, after the kickoff; history never rewritten."
- Hygiene: stale sections and counts fixed (T7), no secrets or real mail (`git log -p` scan, `.runtime/` ignored, `.infra/**/_volumes/*` ignored as today), opened logged-out after the last commit, tags `video-cut` and `submitted`.

## Candidate ideas for the spec
| Idea | Where it came from | Discussed | One line | Details |
|---|---|---|---|---|
| Demo-only public URL | this review, 2026-10-27 | no | Demo mode and paste-your-own without sign-in at a public address, rate-limited, key server-side, no Google scope; a judge opens the live product in ten seconds and it is the live-final fallback. | — |
| Realistic demo inbox | this review, 2026-10-27 | no | Replace "Example D1 · sms" with sender names, dates and a short subject so the demo reads as Linda's inbox, not a fixture list; keep the ids in a tooltip. | — |
| "What Scam Shield knows about Linda" in demo mode | this review, 2026-10-27 | no | Show the seed profile's providers, orders, contacts and breaches next to the demo inbox, read-only, so the life-context claim is visible without sign-in. | — |
| Evidence chips on each reason | this review, 2026-10-27 | no | Each reason carries its `evidence` kind in plain words (the sender, the link, your orders, a breach, our rules) so the judge sees the pipeline on the card. | — |
| Pre-recording health check | this review, 2026-10-27 | no | `make demo-precheck`: model key and `/v1/status`, Postgres, warm cache, tunnel, email provider; run before every recording and the live final. | — |

## Sources
Rubric and guide wording as transcribed in [hackathon.md](hackathon.md) (Official Rules, participant guide); judging practice and winner patterns in [how-to-win.md](how-to-win.md). Measurements in this review (2026-10-27): `make test` (203 pass), `coverage/lcov.info` (89.1% lines), `make score` (36/36), `make secrets-keys` (names only), `gh repo view` (private), `git log`, `/api/status` and `/api/demo/check` on a local server.

## Proposed changes to how-to-win.md
- Plan rows: Oct 28 Hadrien: add "Muse key and Resend key on the recording machine; cache warmed on the demo set; abuse.ch key re-issued or dropped" (D1, T8). Oct 29 Vlad: replace the polish row with D5 (realistic demo inbox, knows-panel in demo, source line with model and latency, evidence chips, scam text behind a button, detector first) through a Claude Design pass. Oct 30 Vlad: "Demo-only public URL (D4) and `make demo-precheck` (T9); tunnel for guardian links (D3)". Oct 30 Hadrien: add "live Gmail path on the seeded inbox with label, move and Put it back; `make gate` PASS report saved" (D2, T4). Oct 31 Vlad: replace the README row with T1, T2, T3, T6 and T7 (diagram, exact provenance with the day-one commit timeline, evaluation table, claims → code → test table, stale sections removed). Oct 31 Hadrien: add "APK on a real phone, one live screenshot check recorded" (D7, T4). Nov 1 Vlad: add "both CI jobs green, `make install && make server` from a clean clone" (T5). Nov 2 Hadrien: add "show one handled failure (D8)".
- Video blueprint: replace the section with the storyboard above. Changed scenes: cold open shortened to 0:07 with the card already answering; a Gmail label / move / Put it back scene at 0:55–1:15; the phone scene cut to 15 s with the screenshot read inside it; the numbers card adds "203 tests, CI green"; the privacy scene shows one handled failure; the senior clip at 2:40; the end card carries the live URL and the first-commit time.
- "What judges actually reward": add "The guide says the video is judged along with the code and the live product: a demo-only public URL is part of the Demo score, not a nice-to-have."
- "Our position": add a row "Works on screen today: on a fresh checkout every demo card says 'Judged by detector (Muse Spark not configured)'; the recording machine must hold the key and a warm cache (D1)."
- "Risks and mitigations": add "6. History shape: the server, web app and Android app land within 31 minutes of the 20:12 ET backbone commit; without a README sentence on how day one was committed, a judge who checks histories reads it as pre-existing code (T2)." and "7. CI has never been seen green and the repo is private; flip public and confirm both jobs by Nov 1 (T5)."
- Pointer: "Demo and technical-depth review with effort and lift per recommendation: [score-demo-and-technical.md](score-demo-and-technical.md)."
