# Scam Shield

**Senior-first scam protection that judges a message against the user's own life — their real orders, bank, carrier and known breaches. Built for the [Meta Global AI Developer Hackathon](https://dev.meta.ai/events/global-hackathon) (Oct 26 – Nov 4, 2026, Indie track, “Build for Your World”). Team: Hadrien (product) and Vlad (CTO). Full mapping in [docs/PRD.md](docs/PRD.md).**

Americans 60+ reported **$7.7 billion** lost to online fraud in 2025 (FBI IC3), up 59% in one year — the most of any age group. Gmail already blocks most phishing in bulk. What it does not do is explain, in words a frightened 74-year-old can act on at 9pm, *why* an email is dangerous and *what to do instead*. That is the gap Scam Shield fills.

## What it does

1. **Connects to your real Gmail** (read-only — it can never send, move or delete mail), or runs on a built-in demo inbox modelled on real IC3 scam patterns.
2. **Checks every email with deterministic rules first**: sender/brand mismatch, hidden link destinations, reply-to tricks, urgency and gift-card/wire/crypto lures, failed SPF/DKIM. Every flag points at something concrete in the email.
3. **Muse Spark explains it like a patient family member**: one huge verdict (“STOP. This looks like a scam.”), why in plain sentences, and exact next steps. No jargon, never “100% safe”.
4. **“Ask a trusted person”**: one tap prepares a calm safety note for a daughter, son or friend to review *before* the user clicks anything. Nothing is sent automatically.
5. **Built for 50+ eyes and hands**: 19px+ type, 64px buttons, high contrast, read-aloud verdicts, one decision per screen.

## Run it

```bash
npm start
# open http://localhost:3000
```

No keys needed: it starts on the demo inbox. Node 20+, zero dependencies.

## Connect real Gmail

1. [Google Cloud Console](https://console.cloud.google.com/) → create a project → enable the **Gmail API**.
2. APIs & Services → Credentials → **OAuth client ID** (Web application).
3. Authorized redirect URI: `http://localhost:3000/auth/google/callback`
4. Export the credentials and start:

```bash
export GOOGLE_CLIENT_ID="..."
export GOOGLE_CLIENT_SECRET="..."
npm start
```

Then click **Connect my Gmail**. Scope requested: `gmail.readonly` only. Tokens are stored locally in `.tokens.json` (gitignored) — a production version would use encrypted server-side storage and a full privacy review.

## Use Muse Spark (Meta Model API)

Grab your key/model from the hackathon portal, then:

```bash
export META_MODEL_API_KEY="..."
export META_MODEL_API_URL="..."   # chat-completions endpoint from the portal
export META_MODEL_NAME="..."      # Muse Spark model id from the portal
npm start
```

The rules engine always decides the verdict. Muse Spark only writes the explanation — if the API is unreachable, a built-in plain-language explainer takes over so the product never goes silent.

## Test

```bash
npm test          # schema, detector, safeguards + every A/B/C/D regression case
npm run score     # PRD pass-criteria report (A 100%, C zero false Scam)
```

The seed suite in [testcases/cases.json](testcases/cases.json) covers Hadrien's French cases (fake Bouygues, fake Société Générale, €69.90 IBAN debit, Chronopost SMS), US cases (USPS, tolls, SSA, Bitcoin ATM, fake Prime), AI-era cases (voice clone, new-number, QR-adjacent, romance thread, sextortion, recovery) and the legitimate mail we must never flag.

## Hackathon roadmap (to Nov 4)

- [x] Rules engine + plain-language explainer + demo inbox
- [x] Real Gmail OAuth (read-only) + trusted-contact note
- [ ] Live Muse Spark endpoint from the portal wired and tuned on real scam samples
- [ ] Forward-to-check address (forward any email, get the verdict back)
- [ ] SMS/WhatsApp delivery of the trusted-person note
- [ ] 5-user test with adults 65+, record the demo video on their words, not ours

## Honesty notes

- Detection is heuristic. The UI never claims an email is guaranteed safe.
- This is a hackathon build: no mail is stored server-side beyond the local token file, and pasted/demo emails never leave the machine except to the Meta Model API when you configure it.
