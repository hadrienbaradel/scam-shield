# Microsoft: Outlook.com, Defender, Edge

Category: platform built-in; the consumer side is thin.

## What it does
- Outlook / Outlook.com: a question mark replaces the sender photo when authentication fails; an "unverified sender" tag and warning ribbon reached Outlook mobile July-Oct 2025 (Microsoft 365 message center, organisation-framed; consumer rollout not confirmed); malicious mail goes to Junk. No plain-language explanation, no LLM verdict.
- Edge "scareware blocker": on-device ML spots fake-virus and tech-support full-screen pages, exits full screen, shows a snapshot and a warning; preview on Windows (announcement date reported as Nov 2024; sources conflict). The one Microsoft consumer feature aimed at the costliest senior scam type (tech support).
- Defender for Office 365 (enterprise only): agentic grading of user-reported phishing (late 2025), inbound prompt-injection screening (2026). Microsoft Defender app for Microsoft 365 Personal/Family: identity theft monitoring; no message scam checker found (unverified).
- Third parties fill the gap: Trend Micro's webmail extension, Hexa AI's Outlook add-in.

For whom: all Outlook and Edge users. Channels: email, web. Detection: authentication rules, reputation, Edge ML. Install: built in. Price: free.

## Strengths and weaknesses
- Strength: the scareware blocker breaks the scammer's screen takeover, the right instinct for seniors.
- Weakness: no consumer "is this a scam" check; warnings are icons; consumer Outlook.com lags Microsoft 365 business; no family loop.

## What Scam Shield can learn
- Give the person an exit, not a label: the verdict's action step should be as concrete as closing the fake page.
- Prompt injection in mail is now a vendor-level concern; we already treat it as a signal in lib/detector.js. Say so.

## Links (accessed 2026-10-27)
- https://support.microsoft.com/en-us/office/phishing-and-suspicious-behaviour-0d882ea5-eedc-4bed-aebc-079ffa1105a3
- https://mc.merill.net/message/MC1112452 (unverified sender banner)
- https://petri.com/microsoft-edges-scareware-blocker-preview/
- https://hackmag.com/news/edge-scareware
- https://o365reports.com/prompt-injection-protection-in-microsoft-defender-for-office-365/
