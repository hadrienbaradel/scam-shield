Keywords: log, in progress, claim, done, to do, handoff, ask, interruption, pull --rebase

# Team log

What each of us is working on right now, what each of us still owes the other, and what got done. One row per item, one line each; newest first under Done. `scripts/session-brief.mjs` prints the rows that concern you at session start. The rules are in `CLAUDE.md` (Non-negotiables) and `_product/docs/product-process.md` (The team log).

Who = the person, plus the session label or agent name when several sessions run at once (`Vlad · research`, `Hadrien · video`).

## In progress

| Who | Since | Working on | Touches |
|---|---|---|---|
| Vlad · team-log | 2026-10-29 14:10 | The team log and the claim-first rule; session brief prints your rows | `_product/log.md`, `CLAUDE.md`, `_product/docs/product-process.md`, `_product/README.md`, `scripts/session-brief.mjs`, `tests/session-brief.test.js` |

## To do

| For | Item | Asked by | Since |
|---|---|---|---|
| Vlad | Send `config/master.key` to Hadrien over a private channel (never the repo, never a chat with an agent) | Hadrien | 2026-10-29 |
| Vlad | Baseten credits: claim them if not done | Hadrien | 2026-10-29 |
| Vlad | A public HTTPS URL or tunnel, so Thomas's one-tap link opens on a real phone (video 1:15–1:47) | Hadrien; script says Oct 30 | 2026-10-29 |
| Vlad | Real-phone Android install for the Ethan scene (video 1:15–1:47) | Hadrien; script says Oct 30 | 2026-10-29 |
| Vlad | WhatsApp "forward it to Prudence" bot, Hadrien's pick for the extra Meta scene (Cloud API test number, 5 phones, needs the public URL) | Hadrien | 2026-10-29 |
| Vlad | "Checked:" chips under the reasons on the V2 card (`public/js/views/today.js`); the reasoning summary on Thomas's view only if the Responses API returns one | Video script, Oct 29 | 2026-10-29 |
| Vlad | Diagram for the 2:05 scene: message → rules → Muse Spark → guardrail → card | Video script, Oct 31 | 2026-10-29 |
| Vlad | Point heyprudence.com at the live demo and settle the public repo name (org publication check first) | Video script, Oct 30 | 2026-10-29 |
| Vlad | Push the CI workflow from the local `ci-workflow` branch (needs a token with workflow scope); the numbers card says "CI green" | spec.md | 2026-10-27 |
| Vlad | Prompt Guard 2 without Groq (local inference), only if the Nov 1 rehearsal keeps that swap | Hadrien's note | 2026-10-29 |
| Hadrien | Add the public origin (the tunnel or heyprudence.com) to the OAuth client's redirect URIs in scam-shield-hb26 once Vlad posts it here | Vlad | 2026-10-29 |
| Hadrien | Say which beat the WhatsApp scene replaces (the script allows four Meta surfaces on screen) | Vlad | 2026-10-29 |
| Hadrien | Book 2–3 seniors (Trent Taylor), film Oct 31 | Video script | 2026-10-29 |
| Hadrien | Linda's demo Gmail seeded with the scenes' messages, act mode "move", Thomas's number saved | Video script, Before recording | 2026-10-29 |
| Hadrien | Record the narration (about 270 words) and the real voicemail | Video script | 2026-10-29 |
| Hadrien | Seeded 15 s "it's Ethan" voicemail in demo mode | Video script, Oct 29 | 2026-10-29 |
| Hadrien | Decide B2/B12: accept Scam from Muse or keep Be careful | spec.md open question 1 | 2026-10-27 |
| Hadrien | A working abuse.ch key (link checks stay Partial without it) | spec.md | 2026-10-27 |
| Both | Nov 1 rehearsal: decide the conditional swaps (Prompt Guard, reasoning summary, open weights) | Video script | 2026-10-29 |

## Done

- 2026-10-28 · Hadrien · "Call <name>" leads whenever a message uses a saved contact; rough cut v1 (2:41, local only) and its notes (95e68cc)
- 2026-10-28 · Hadrien · Product renamed to Prudence in the UI and Gmail labels (9561016); video script v1 with Linda (US) leading (ac35d19); heyprudence.com registered
- 2026-10-28 · Hadrien · Live Gmail on a real inbox: OAuth client in scam-shield-hb26, Vlad a test user; 50 mails → 47 safe, 3 be careful, 0 scam, all by Muse; newsletter false alarms and a Gmail quota problem fixed; `npm run gate` runs the report (6c97b56)
- 2026-10-28 · Hadrien · Merged vlad/product-first (024371a); the app warns without master.key instead of stopping
- 2026-10-28 · Vlad · Detection channels research: 62 options, 11 build sheets, 56-row gates table, 20 ideas in the spec (2e354a6, afe87cc)
- 2026-10-28 · Hadrien · Senior app V2: Today, one message at a time, Throw it away / Undo, ask the trusted person by text from the senior's own phone (e2d9471)
- 2026-10-27 · Hadrien · Voice-note check with Muse Voice Transcribe, `/api/check/voice` (35ff6e0); provenance answered by the organizers, building counts from Oct 26 12:24 PM ET (0952b93)
- 2026-10-27 · Vlad · Score reviews (Demo and Technical, Meta tooling), how-to-win plan, 11 ideas (merged ff52f25); product docs, pluggable LLM layer, DX, CI skeleton, encrypted credentials (merged 7a2bcaa)
