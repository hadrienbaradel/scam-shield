Keywords: log, in progress, claim, done, to do, handoff, ask, interruption, pull --rebase

# Team log

What each of us is working on right now, what each of us still owes the other, and what got done. One row per item, one line each; newest first under Done. `scripts/session-brief.mjs` prints the rows that concern you at session start. The rules are in `CLAUDE.md` (Non-negotiables) and `_product/docs/product-process.md` (The team log).

Who = the person, plus the session label or agent name when several sessions run at once (`Vlad · research`, `Hadrien · video`).

## In progress

| Who | Since | Working on | Touches |
|---|---|---|---|
| Vlad · guide | 2026-10-29 14:39 | Walking the gates with Vlad in Chrome: Meta app + WhatsApp test number and token, Cloudflare tunnel, Baseten credits, master.key handoff | `_product/log.md` only (accounts, no code) |
| Vlad · whatsapp-channel | 2026-10-29 14:46 | WhatsApp Cloud API channel: webhook verify, text/image/audio/document in, verdict reply out; spec, keys by name, tests | `src/channels/whatsapp.js`, `src/routes/whatsapp.js`, `tests/whatsapp.test.js`, `_product/specs/whatsapp-channel.md`, `_product/spec.md` (one row, non-goal line), `_product/docs/secrets.md`, `config/credentials.example`, one line in `src/server.js` |
| Vlad · chips | 2026-10-29 14:39 | "Checked:" chips under each reason on the V2 card, EN/FR | `public/js/views/today.js`, `public/js/i18n.js`, `public/styles.css`, `_product/specs/senior-verdict-screen.md`, a test file |
| Vlad · learn | 2026-10-29 14:48 | Micro-learning: YAML lessons under data/lessons, a Learn tab (web + demo) with a gamified one-minute quiz, research on Elba, Riot, Phished and the awareness-training field | `_product/specs/micro-learning.md`, `_product/spec.md`, `_product/research/micro-learning.md`, `_product/competitors/*`, `data/lessons/`, `lib/lessons.js`, `src/routes/lessons.js`, `public/js/views/learn.js`, `public/learn.css`, `public/js/main.js`, `public/index.html`, `tests/lessons.test.js`, `package.json` (yaml) |
| Vlad · admin | 2026-10-29 14:52 | Admin console at `/admin/`, separate from the senior app: health checks per dependency, every background job with run history and Run now, all users with Gmail/sync state and counts, scam-report review moved there; built by subagents | `src/jobs/scheduler.js`, `src/jobs/retention.js`, `src/db/migrations/006_job_runs.sql`, `src/admin/*` (new), `src/routes/admin.js`, `src/notify/sse.js` (one export), `public/admin/*` (new), `tests/admin.test.js`, `tests/admin-jobs.test.js`, `tests/helpers/db.js` (truncate list), `_product/specs/admin-console.md`, `_product/spec.md` (one row), `_product/specs/threat-feed.md` (pointers), `_product/docs/dx.md`, `README.md` (one line) |
| Vlad · arch-doc | 2026-10-29 14:53 | Technical architecture doc (docs/ARCHITECTURE.md: pipeline, modules, data, LLM layer, choices and why; the pipeline diagram for the 2:05 scene), README link, CLAUDE.md row, docs-check rule that keeps it current | `docs/ARCHITECTURE.md`, `docs/diagrams/`, `README.md`, `CLAUDE.md`, `_product/docs/product-process.md` (one row), `scripts/docs-check.mjs`, `tests/docs-check.test.js` |
| Vlad · prompt-guard | 2026-10-29 14:53 | Injection shield with Llama Prompt Guard 2: hidden-text extraction, 512-token chunks, strong detector signal + guardrail (never Safe), EN/FR reason, providers Groq / HF / mock (local later), seed case, tests | `lib/promptGuard/`, the detector and guardrail code that composes the verdict, `testcases/`, `tests/promptGuard.test.js`, `_product/specs/prompt-guard.md`, `_product/spec.md` (one row), `_product/docs/llm.md` (one section), `config/credentials.example` (append), `_product/docs/secrets.md` (one line), `scripts/doctor.mjs` (optional key) |
| Vlad · voice-tests | 2026-10-29 14:53 | Voice check client behind lib/llm (transcribe capability: Meta unchanged, OpenAI-style Whisper, mock), WAV validation, route tests for /api/check/voice; the seeded demo voicemail stays Hadrien's row | `lib/llm/*`, `lib/muse.js` (transcribeVoice only), `src/routes/mail.js` (voice route only), `tests/voice.test.js`, `tests/muse.test.js` (voice test only), `_product/specs/check-something-else.md`, `_product/docs/llm.md` (capability row) |

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
| Vlad | Prompt Guard 2 without Groq (local inference), only if the Nov 1 rehearsal keeps that swap | Hadrien's note | 2026-10-29 |
| Hadrien | git.md now says both of us commit on main in small steps (claim first, pull --rebase); object here if you want branches and merges back | Vlad | 2026-10-29 |
| Hadrien | heyprudence.com already sits on Cloudflare nameservers: in that Cloudflare account create a Tunnel (Zero Trust → Networks → Tunnels) with public hostname `demo.heyprudence.com` → `http://localhost:3000`, and send Vlad the tunnel token privately (or add Vlad as a member of the account) | Vlad | 2026-10-29 |
| Hadrien | Add the public origin (the tunnel or heyprudence.com) to the OAuth client's redirect URIs in scam-shield-hb26 once Vlad posts it here | Vlad | 2026-10-29 |
| Hadrien | Say which beat the WhatsApp scene replaces (the script allows four Meta surfaces on screen) | Vlad | 2026-10-29 |
| Hadrien | Book 2–3 seniors (Trent Taylor), film Oct 31 | Video script | 2026-10-29 |
| Hadrien | Linda's demo Gmail seeded with the scenes' messages, act mode "move", Thomas's number saved | Video script, Before recording | 2026-10-29 |
| Hadrien | Record the narration (about 270 words) and the real voicemail | Video script | 2026-10-29 |
| Hadrien | Seeded 15 s "it's Ethan" voicemail in demo mode | Video script, Oct 29 | 2026-10-29 |
| Hadrien | Decide B2/B12: accept Scam from Muse or keep Be careful | spec.md open question 1 | 2026-10-27 |
| Hadrien | A working abuse.ch key (link checks stay Partial without it) | spec.md | 2026-10-27 |
| Hadrien | Run `node --env-file-if-exists=.env --import ./lib/credentials.js scripts/recheck-flagged.mjs` to take the Prudence label off the Cloudflare invoice and monbento.com (dry run says Safe) | Design review | 2026-10-29 |
| Both | Nov 1 rehearsal: decide the conditional swaps (Prompt Guard, reasoning summary, open weights) | Video script | 2026-10-29 |

## Done

- 2026-10-29 · Hadrien · Atkinson Hyperlegible Next self-hosted (SIL OFL, 25 KB, every app character covered; the screens were rendering in Verdana) (5b2a427); no gold halo on script-focused headings (a70d29a); rough cut v2 with the new card layout, `.runtime/video/prudence-rough-cut-v2.mp4` (local only, screens in `.runtime/video/shots-v2/`)
- 2026-10-29 · Hadrien · Design review + /codex plan challenge of the V2 app (report: ~/.gstack/projects/hadrienbaradel-scam-shield/designs/design-audit-20261028/): answer bar fixed outside the card, advice first (37cc3fd); each screen announced, late answers dropped, one action at a time, retry, no Safe without a verdict (7203b8e); visible focus ring (b728a07); Keep can be undone, POST /api/messages/:id/undo-keep (90841b4); Listen label, stable "2 of 3", no small print, honest Ask demo, compact FR/EN (583a5a2). `today.js` now draws every screen through `paint()`: Vlad, build the "Checked:" chips on top of it
- 2026-10-29 · Hadrien · Real Cloudflare invoice doubted with "you never received mail from this sender": Muse now gets what the history covers and a dated count of earlier mail from the same organisation (never trust), prompt v4; Muse sample 25 phishing / 50 legit: 84% Scam, 0 false Scam; dry-run re-check turns that invoice Safe (4934822). PayPal-user callback invoice locked as never "authentic" (372e229)
- 2026-10-29 · Vlad · Team log and the claim-first rule: `_product/log.md`, CLAUDE.md non-negotiables, product-process.md (The team log), git.md (both on main, pull --rebase); the session brief prints who is in progress and your to-do rows (4ac3206, 39c27e5, 167ea75 and the brief commit)
- 2026-10-29 · Vlad · CI was already on main (99c1cbf): every push runs make check, make score and the Android debug APK build; the spec row is now Built and the stale to-do is gone
- 2026-10-28 · Hadrien · "Call <name>" leads whenever a message uses a saved contact; rough cut v1 (2:41, local only) and its notes (95e68cc)
- 2026-10-28 · Hadrien · Product renamed to Prudence in the UI and Gmail labels (9561016); video script v1 with Linda (US) leading (ac35d19); heyprudence.com registered
- 2026-10-28 · Hadrien · Live Gmail on a real inbox: OAuth client in scam-shield-hb26, Vlad a test user; 50 mails → 47 safe, 3 be careful, 0 scam, all by Muse; newsletter false alarms and a Gmail quota problem fixed; `npm run gate` runs the report (6c97b56)
- 2026-10-28 · Hadrien · Merged vlad/product-first (024371a); the app warns without master.key instead of stopping
- 2026-10-28 · Vlad · Detection channels research: 62 options, 11 build sheets, 56-row gates table, 20 ideas in the spec (2e354a6, afe87cc)
- 2026-10-28 · Hadrien · Senior app V2: Today, one message at a time, Throw it away / Undo, ask the trusted person by text from the senior's own phone (e2d9471)
- 2026-10-27 · Hadrien · Voice-note check with Muse Voice Transcribe, `/api/check/voice` (35ff6e0); provenance answered by the organizers, building counts from Oct 26 12:24 PM ET (0952b93)
- 2026-10-27 · Vlad · Score reviews (Demo and Technical, Meta tooling), how-to-win plan, 11 ideas (merged ff52f25); product docs, pluggable LLM layer, DX, CI skeleton, encrypted credentials (merged 7a2bcaa)
