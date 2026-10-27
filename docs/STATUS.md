# Scam Shield: status for Vlad (2026-10-27)

Where the project stands after the first build sprint (Oct 26–27), what has been measured, what was decided and why, and what is left before the hackathon deadline (**Nov 4, 9pm ET**). Product scope is in [PRD.md](PRD.md); setup in [../README.md](../README.md) and [GOOGLE_SETUP.md](GOOGLE_SETUP.md).

## TL;DR

- **A real multi-user app exists**: Google sign-in, Gmail sync (push via Pub/Sub plus polling), Muse Spark verdicts with a deterministic detector as evidence-gatherer, guardrail and fallback, the guardian loop, screenshot checks, a threat-feed review page, and an Android SMS companion. All local; nothing is deployed.
- **Muse Spark makes the difference**: on 500 held-back public emails, phishing called Scam went from **32% (rules alone) to 81%**, with **0 false Scam on 250 genuine emails**.
- **The rules alone are tuned for precision**: 0.3–0.4% false Scam on ~38k genuine public emails, catching about a third of phishing. They decide alone only when Muse is unavailable.
- **Not yet done**: the live test on a real Gmail inbox (needs the OAuth client from the Cloud Console; Hadrien is doing it), a working abuse.ch key, the CI workflow push, a Chrome extension.
- `npm test`: 146 passing. `npm run score`: 36/36 with the rules, 34/36 with Muse (see B2/B12 below).

## What is built

| Area | State | Where |
|---|---|---|
| Server | Fastify 5, Node 22 ESM, Postgres 14 (migrations 001–004), per-user rate limits, SSE for live updates | `src/server.js`, `src/routes/`, `src/db/` |
| Google | OAuth with state + PKCE + browser-bound cookie; refresh tokens AES-GCM encrypted; allow-listed Gmail client (no send/trash/delete endpoints reachable) | `src/google/`, `src/crypto.js` |
| Sync | History API (messageAdded + labelAdded), Pub/Sub pull subscription (no public URL), polling backup, advisory-lock leases per user, history-gap recovery | `src/sync/worker.js` |
| Mail actions | Label-only until the user consents to moving; intent written before the Gmail call and reconciled; nothing moved on a degraded verdict; "Put back" undoes | `src/sync/actions.js`, migration 002 |
| Engine | Detector (brands, look-alikes, auth, links, lures, contacts) → Muse Spark with evidence → two-way guardrail | `lib/` |
| Links | RDAP domain age (IANA bootstrap), redirect resolver with DNS pinning and a private-range BlockList, abuse.ch URLhaus lookups | `src/links/resolver.js`, `lib/linkInspector.js` |
| Guardians | Invite, preview of exactly what is shared, one-tap answer by link or dashboard, daily alert cap, revocable links | `src/guardians.js`, `src/routes/guardians.js` |
| Web app | Vanilla JS modules, no build, strict CSP; 19px+ type, 64px buttons, read aloud, EN/FR, keyboard and screen-reader pass | `public/` |
| Android | Kotlin/Compose SMS companion: on-device pre-screen, texts sealed at rest (Keystore AES-GCM), offline retry, 64 unit tests | `android/` |
| Threat feed | IC3 and cybermalveillance.gouv.fr alerts become *candidate* pattern cards; only human review activates them | `src/jobs/threatfeed.js`, `lib/threatfeed.js`, `#/admin` |

## How a message is judged

```
Gmail message ─► normalize (text, links, attachments, Gmail's own auth result)
              ─► personal context (providers, orders, contacts, breaches)
              ─► link inspection (RDAP age · URLhaus · redirects only on request or for shorteners)
              ─► detector: signals + preliminary verdict          (lib/detector.js)
              ─► Muse Spark: redacted message + compact context    (lib/muse.js)
                   + detector findings as <detector_evidence>
              ─► guardrails: the model cannot clear a proven scam,
                   nor condemn an authenticated sender the user knows
              ─► verdict (strict JSON schema) ─► label / move / alert guardian
```

Muse layer details worth knowing:
- `muse-spark-1.3`, **Standard mode only** (the code refuses `-contributor` ids, so nothing trains Meta's models).
- **It is a reasoning model**: thinking tokens count against `max_tokens`. At 900 it spent 898 thinking and returned nothing, so every live check silently fell back to the detector. Now `reasoning_effort: "low"` (env `META_MODEL_REASONING_EFFORT`), `max_tokens` 4000, 20 s deadline. Measured on one case: default effort ~2,950 thinking tokens / 11.5 s, low ~930 / 4.7 s, minimal ~280 / 2.8 s, same verdict.
- Before the model sees anything: IBANs, card numbers (Luhn), SSNs, French social-security numbers, codes, phones, email local parts and the user's name are replaced with labels. Contacts' names, addresses and numbers are never sent.
- All inputs go in as JSON blocks with `<`/`>` escaped (prompt-injection hardening). The answer must pass the schema and be in the user's language.
- Max 4 concurrent calls; circuit breaker (3 failures → 2 min pause); per-user DB cache (30 days) keyed on model + prompt version + system-prompt hash + input.

## Safety and privacy decisions (and why)

- **Scope `gmail.modify`, never send/trash/delete.** Label-only by default; moving needs explicit consent (timestamp stored).
- **Only Gmail's topmost `Authentication-Results`, aligned with the From domain, counts.** Headers further down can be forged. An uploaded .eml is unverified unless its first hop is mx.google.com.
- **A trusted contact is their saved address or phone number, never a typed name.** "Ethan Miller <anything@gmail.com>" or "it's Ethan, new number" is a claim. It used to be matched by name (fixed in `e2ae428`).
- **Links are never opened to judge them** unless the user asks or it is a shortener: visiting tells a scammer the address is live. URLhaus gets the host name only; the full link (which can carry the reader's address) is compared locally.
- **Mail bodies are never stored.** Verdicts, message ids and sender domains are kept for 90 days, the LLM cache for 30.
- **Local only.** No public deployment until Google verification and CASA are planned; any public deploy or public repo first needs the org's publication warning and a data scan.

## Measured accuracy

All public data lives in git-ignored `.runtime/eval/` and never enters the repo. "Phishing" means the phishing/fraud corpora only. **Plain spam is deliberately excluded: the target is scams that hurt people, not marketing.**

**Rules alone**: Zenodo 8339691 (CC-BY-4.0); tuning set Nazario + Nigerian Fraud + SpamAssassin + CEAS; held back: Nazario_5 + Enron.

| | Precision | Phishing called Scam | Genuine wrongly Scam |
|---|---|---|---|
| Tuning set (4,889 phishing / 21,399 genuine), before the work | 41.5% | 4.0% | 1.3% |
| Tuning set, now | 94.8% | 35.6% | 0.4% |
| Held back (1,558 / 17,291), never tuned on | 91.0% | 28.7% | 0.3% |

**Rules vs Muse on the same 500 held-back emails** (125 phishing, 250 genuine; 125 Enron spam not scored):

| | Rules alone | Muse Spark |
|---|---|---|
| Phishing called Scam | 32.0% | **80.8%** |
| Phishing flagged at all (Scam or Be careful) | 47.2% | **97.6%** |
| Genuine called Scam | 1 / 250 | **0 / 250** |
| Genuine marked Be careful | 0% | 8.4% (16 of the 21 are Enron rows with no sender, impossible in Gmail) |

About 4.0k tokens in and 0.9k out per email; median 4.0 s; 1 failed call in 299.

**Links alone** (300 URLs from the OpenPhish community feed, research use; bare link from an unknown sender, no lookups): flagged 0.7% → **48%**. Remaining misses: number-only hosts, free hosting without sign-in words, shorteners.

**Scenarios** (`testcases/cases.json`, the PRD's A/B/C/D sets): rules 36/36. Muse 34/36: it fixes B1, and calls **B2** ("Hi Grandma, it's Ethan, new number, send $300 today") and **B12** (romance contact asking $2,000 in crypto) Scam where the expected answer is Be careful. Both are textbook scams; Hadrien is deciding whether to accept Scam there.

Caveats: the tuning set is in-sample. 84% of Nazario bodies have their links stripped. The corpora are English from 2002–2017 with no auth headers or personal context, so live inboxes should do better on authentication and worse on modern lures. With 125 phishing emails, ±7 points on the Muse figure.

Scripts: `node scripts/eval-corpus.mjs [--muse --sample N] files…`, `node scripts/eval-urls.mjs urls.txt`, `npm run score [-- --muse]`. Muse answers are cached in `.runtime/eval/muse-cache.json`, so re-runs are free.

## Data sources and licences

| Source | Use | Licence position |
|---|---|---|
| Zenodo 8339691 phishing corpora | Evaluation and rule tuning | CC-BY-4.0 |
| OpenPhish community feed | Link evaluation only | Personal/research use; not shipped, not in the repo |
| OPDB (pyopdb) | Not used | Paid licence |
| abuse.ch URLhaus | Live lookups at check time | Free fair use for not-for-profit; **no training or tuning without Spamhaus written consent**; commercial use needs Spamhaus |
| abuse.ch Feodo / SSLBL / YARAify | Not yet used | CC0 |
| Google Safe Browsing | Not used | Non-commercial only; Web Risk is paid |
| HF "IsThisSpam" model | Not used | No model card or licence, and it detects spam, not scams |

## Bugs found the hard way (worth knowing when you read the code)

- **`domainOf` read any `@` as an email address**: `…/login?email=you@gmail.com` was judged as gmail.com and `https://paypal.com@evil.top/` as paypal.com. URLs are now parsed by host first (`9b09a2f`).
- **Trusted contacts matched by display name** (see above), which could yield Safe and told the user "this is really Ethan's address" when it wasn't (`e2ae428`).
- **Muse returned empty answers** because of the thinking-token budget (see above, `9a9d32e`).
- **New link rules raised false alarms from 0.4% to 2.3%**: newsletters carry `?email=` in unsubscribe links, and `finance.yahoo.com` looked like a Binance typo. Narrowed to email in the `#fragment`, owner-chosen labels only, and Google's own country sites and Alerts (`e84df63`).
- Earlier Codex review fixes: SSRF via IPv4-mapped IPv6, login CSRF, history gaps, wrong-message UI race (`950b970`, `6fbba2c`, `e60f1af`).

## Run it

```bash
npm install && npm run setup                    # .env with a fresh encryption key, DB migrated
node scripts/set-env.mjs META_MODEL_API_KEY=…   # keys go in by script, .env is never printed
npm start                                       # http://localhost:3000 (demo at /#/demo without Google keys)
npm test && npm run score                       # gate every push on both
npm run gate                                    # after a live Gmail sign-in: sync, verdicts, Muse vs fallback, Gmail actions
```

Env keys by name: `META_MODEL_API_KEY`, `META_MODEL_REASONING_EFFORT`, `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` (via `scripts/import-google-client.mjs`), `TOKEN_ENC_KEY`, `GMAIL_PUBSUB_TOPIC`, `GMAIL_PUBSUB_SUBSCRIPTION`, `ABUSECH_AUTH_KEY`, `HIBP_API_KEY`, `RESEND_API_KEY`, `ADMIN_EMAILS`.

## Open items

Before the demo (Nov 4):

| Item | Owner | Notes |
|---|---|---|
| OAuth consent screen + Web client in the Cloud Console | Hadrien | No CLI exists for External apps; steps in GOOGLE_SETUP.md |
| Live Gmail test, label-only, 50 latest mails, then `npm run gate` | Hadrien + Vlad | First real-inbox numbers; the PRD also wants a 200-genuine-mail false-alarm gate on family inboxes |
| abuse.ch key | Hadrien | The current key is refused by all three abuse.ch APIs (`unknown_auth_key`); the app switches lookups off and says so |
| B2/B12 expected answers | Hadrien | Accept Scam (Muse) or keep Be careful |
| Push the CI workflow | Vlad | Local branch `ci-workflow` (server tests + score on Postgres, Android tests + debug build); pushing needs a token with `workflow` scope |
| Demo script and video | Both | Show the guardian loop and Put back |

Suggested next for engineering:
- A Chrome extension (Gmail web and any page), reusing `lib/`.
- QR-code decoding in screenshot checks.
- Remaining Medium items from the Codex review.
- Closing the detector's misses where Muse is unavailable: number-only hosts and free hosting without sign-in words.
- Moving off localhost (Railway EU is the plan): Google verification for a restricted scope, a yearly CASA assessment, a public privacy policy.

## Where to start reading

1. `lib/detector.js`: what counts as evidence, and the verdict logic at the end.
2. `lib/muse.js`: redaction, prompt building, guardrails, breaker and cache.
3. `src/sync/worker.js` + `src/sync/actions.js`: what happens to a real inbox, and the safety rules around moving mail.
4. `src/links/resolver.js`: the SSRF guard and the URLhaus lookup.
5. `tests/`: real-mail regressions (`real-mail.test.js`) and the Postgres integration suite.

## History

25 commits on `main`, from the hackathon backbone (`d43ced6`) to the live-gate tooling (`5c03d3f`), roughly in this order: engine import and cleanup → multi-user server, Gmail sync and web app → Android companion → real-mail fixes (Société Générale, Xero job offers) → Codex review fixes (mail safety, security, sync robustness, front end) → public-corpus evaluation → link-address signals → URLhaus + Muse evaluation → Muse token fix → trusted-contact fix → Google setup tooling. Run `git log --oneline` for the full list.
