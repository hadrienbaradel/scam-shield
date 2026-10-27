# Apple: iOS 26 call and message screening, iOS 27 Impersonation Risk Detection

Category: platform built-in. Matters because the PRD's share-sheet item is our only iPhone path: Apple allows third parties no background SMS reading beyond the SMS filter extension.

## What it does
- iOS 26 (Sept 2025). Call Screening: unknown callers are asked on-device for name and purpose before the phone rings, with a live transcript; or silence unknown callers to voicemail. Messages: optional "Unknown Senders" folder with "Mark as Known"; on-device spam folder; links in messages flagged as spam are deactivated; Report Spam; blocking a sender erases the thread. Mail: no scam detection described; Apple asks users to forward suspicious mail to reportphishing@apple.com.
- iOS 27 (Sept 2026). Impersonation Risk Detection: a system API. When a user pays or changes a password in a participating app (banks, payment apps), the app can ask iOS for a risk level (unknown / medium / high) computed on-device from interaction patterns, timing, context, basic sensor data and approximate call and email counts. Apple "never analyzes the content of your Photos, Messages, or Mail". Off by default; the app chooses the response; no system alert.
- 9to5Mac (June 2025): screening does not use Apple Intelligence to judge spam; the user still reads each call. Sinch: unknown-sender texts show no alert or preview, so a pharmacy or clinic texting a senior from a new number can go unseen.

For whom: all iPhone users. Channels: calls, SMS/iMessage, in-app payments. Detection: on-device heuristics, carrier spam feeds, no content LLM. Install: built in, mostly opt-in. Price: free.

## Strengths
- Privacy by design; links neutralised in spam; screening cuts call volume; a risk signal banks can use at the moment of payment.

## Weaknesses
- No email scam detection; no explanation of why a text is spam; the Unknown Senders folder hides legitimate mail; no family loop; content is never judged, so a convincing bank impersonation from a new number is just "unknown".
- Third-party apps on iOS can only filter SMS through the filter extension (no RCS, no iMessage), so companions like ours are weaker on iPhone than on Android.

## What Scam Shield can learn
- Render links inert in "Check first" verdicts, as iOS does in spam.
- "Mark as Known" equals our "Put it back teaches the sender": keep the trust gesture one tap.
- The iPhone entry point is the share sheet (PRD backlog) plus the Gmail watch; do not promise SMS parity on iPhone.
- Impersonation Risk Detection is a signal banks will use at the moment before money moves; our real_company_says text and guardian loop live at the same moment.

## Links (accessed 2026-10-27)
- https://www.apple.com/sg/newsroom/2025/10/apple-helps-safeguard-users-from-scams-and-fraud-while-protecting-personal-data/
- https://support.apple.com/127906 (Impersonation Risk Detection)
- https://9to5mac.com/2026/09/21/security-bite-ios-27-now-lets-apps-ask-your-iphone-if-youre-being-scammed/
- https://9to5mac.com/2025/06/13/security-bite-apples-new-ios-26-spam-tools-will-make-scammers-cry/
- https://community.sinch.com/t5/SMS/Apple-iOS-26-New-features-for-Messages-and-Calls-and-what-brands/m-p/18774
