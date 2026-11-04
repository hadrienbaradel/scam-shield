# Security

Prudence reads older people's email, so a security report matters more to us than any feature. It is a hackathon build (Oct 26 – Nov 4, 2026) by Hadrien Baradel and Vlad Zloteanu.

## Supported version

`main` only: fixes land there, and there are no maintained branches.

## Reporting a vulnerability

Report it privately through GitHub: the repository's **Security** tab, then **Report a vulnerability**. If that button is not there yet, open an issue titled "Security contact" with no details, and we will answer with a private channel. Please include:

- what is affected (file, route or screen) and the commit you tested;
- the steps to reproduce it and what an attacker gains;
- a proof on your own account or a local copy (`make install`, then `make server`), never on someone else's mail.

Leave real messages, tokens and personal data out of the report.

## What the code does today

- **Keys** are encrypted in `config/credentials.enc` (AES-256-GCM). `config/master.key` opens it, is git-ignored, and `make check`, so CI, fails if it is ever tracked (`_product/docs/secrets.md`). On Nov 1, 2026 gitleaks scanned the full git history: no key, password or token in any commit. Since Nov 4, CI runs gitleaks on every push and `npm audit`, which fails on a high or critical advisory (`_product/docs/infra.md`, CI).
- **Mail bodies are never stored**, nor pasted texts, screenshots or recordings: a check keeps its verdict, the Gmail ids and the sender's domain. The only message text kept is what the person chose to share with a trusted person. The Gmail client can label and move, never send, trash or delete (`src/google/gmail.js`).
- **The model** sees a message with its numbers, codes and names masked (screenshots and voice notes go as they are, since they must be read, and are not kept), in Standard mode only. Text that gives the AI orders, hidden text included, is scanned by Meta's Llama Prompt Guard 2 when its host's key is set (`lib/promptGuard/`), and a flagged message is never judged Safe.
- **Retention** (`src/jobs/retention.js`): checks and alerts 90 days, the audit log 180, the model cache 30, the guardian outbox 7. "Delete my account" stops Gmail push, revokes Google's grant and deletes every per-person row.
- **The web app** has a CSP with no inline script, an Origin check on every state-changing request, httpOnly SameSite session cookies and rate limits. Sessions, one-tap links and device tokens are stored only as SHA-256 hashes. Links are never opened to judge them, except shorteners or on request, and then through a connection that refuses private addresses.
- **Deployment**: containers with every port bound to localhost; the public reaches the app only through a Cloudflare tunnel, and administration goes over Tailscale (`_product/docs/ops.md`).

The details and the reasons are in `docs/ARCHITECTURE.md` (Security and privacy choices).

## Known limitations

- The `outbox` table has no owner column, so "Delete my account" leaves the copies of emails already sent to trusted people until their 7-day expiry (an open item in `_product/log.md`).
- The injection shield and the WhatsApp channel are tested in code but not yet against the live Prompt Guard hosts and the live WhatsApp Cloud API.
