# Report upstream: "Make the world a better place"
Status: Idea · Raised by Vlad, 2026-10-27 · Discussed: no · Last updated: 2026-10-27

## Why
A confirmed scam caught for one senior is still spreading to thousands. The service already knows the domain, the links, the sender and the number; reporting them upstream on the senior's behalf, in one tap, turns every catch into a takedown signal. Today the schema has a `report` action that nothing produces, and there is no reporting flow.

## Behavior (proposals)
1. After a scam is confirmed (by the senior with "It's a scam", by a trusted contact's answer, or by a high-confidence Scam verdict), the card offers one tap: "Report this".
2. The report goes, as applicable, to: the domain and links (registrar and hosting abuse contacts, Google Safe Browsing, abuse.ch URLhaus, PhishTank, Netcraft); the sender (Gmail "report phishing", the impersonated brand's abuse address, e.g. phishing@…); the phone number (the carrier's spam reporting, the national SMS spam number: 33700 in France, 7726 in the US); the ad network when the scam arrived through an ad; the authorities (FTC in the US, Signal Spam or Pharos in France).
3. The senior sees what was reported and to whom, in plain words: "Reported to 4 places: the website's host, Google, your carrier, Signal Spam."
4. Reports are batched (one sending run, not one per tap) and never contain the senior's own data beyond the scam message itself: no name, no address, no life context; the senior's email address is not the reporter's.
5. Reports are kept in the audit list ("What Scam Shield did") so the senior and the family can see them.

## Demo path (if built)
The red card gains a "Reported to 4 places" badge after the tap; the audit list shows the four destinations. Five seconds.

## Out of scope
Takedown follow-up; legal complaints; reporting Be careful verdicts; reporting on behalf of the guardian's own inbox.

## Acceptance
- Not started. Each destination has its own API or email form, terms and rate limits (Safe Browsing and URLhaus submissions need accounts; 33700 and 7726 are SMS forwards from the phone; Gmail's report-phishing is not exposed by the Gmail API).
- Measured when built: a confirmed seed scam produces one batched report per destination with no personal data in it (test with a fake outbox); the badge count matches the audit entries.

## Implementation pointers
lib/schema.js (`report` action, unused), src/sync/actions.js fileAsScam and audit, src/guardians.js answerAlert (confirmation events), src/links/resolver.js (domains, hosts, URLhaus client), src/notify/email.js (outbound email for abuse addresses), android/.../CheckSmsWorker.kt (SMS forward to 33700 / 7726).

## Open questions
- Which destinations accept automated reports from a small service without a partnership (Safe Browsing, Netcraft, PhishTank)?
- Does reporting a link visit or reveal it to the scammer (see link-checks "never tip off")?
- Is the senior the reporter (their consent, their identity) or the service? Legal and privacy review needed before the first report leaves.
