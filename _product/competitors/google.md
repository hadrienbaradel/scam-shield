# Google: Gmail, Google Messages, Android Scam Detection, Chrome

Category: platform built-in. The largest overlap with Scam Shield (Gmail plus Android SMS).

## What it does
- Gmail: server-side AI filters that Google says "stop more than 99.9% of spam, phishing and malware" (Oct 2023), plus authentication rules for bulk senders. Warnings are banners with generic wording; nothing knows the user's bank, carrier or orders. Gemini mail summaries were shown vulnerable to hidden-text prompt injection that produced fake "call this number" security warnings (July 2025).
- Google Messages Scam Detection (March 2025): on-device model watches SMS/MMS/RCS threads from non-contacts and alerts mid-conversation; on by default; English, US/UK/CA at launch.
- "Enhanced protection mode" (announced Oct 14, 2026; opt-in; rolling out "in the coming weeks"): unknown-sender chats analysed by cloud Gemini inside Private AI Compute (Pixel 6+, Galaxy S24+, other AICore phones); on-device Gemini Nano link checks with live web signals (Pixel 10+, Galaxy S26, Z Fold/Flip 8); "link checkpoints" that add time and context before opening a link from an unsaved number (Android 6+). Chat-notification scam alerts on Pixel, coming to Xiaomi, OPPO, Motorola, vivo and others "later this year". Google says Phone plus Messages flag "more than 5 million suspected scam calls and texts" a month.
- Phone by Google: on-device call Scam Detection (Gemini Nano; shown at I/O 2024; inside Samsung's Phone app on Galaxy S26 since Feb 2026, US English); verified bank calls (Brazilian banks, Revolut; 3M+ spoofed calls ended since June 2026); call-forwarding protection (Dec 2026).
- Chrome: Gemini Nano in desktop Enhanced Protection flags scam pages (May 2025); Chrome on Android warns about spammy site notifications.

For whom: everyone, no senior mode. Channels: email, SMS/RCS, calls, web. Detection: server classifiers (Gmail), on-device LLM (Gemini Nano), cloud LLM (Private AI Compute), Safe Browsing reputation. Install: built in; the best features are opt-in and limited to recent flagships. Price: free.

## Strengths
- Scale and default-on; zero setup; mid-conversation alerts; "on device, inaccessible to Google" privacy story; link checkpoints.

## Weaknesses
- No personal context: it cannot say "this is not how your carrier writes to you".
- Explanations are labels; Gmail cannot be asked "why?"; no family or guardian loop.
- The strongest protections need a Pixel 10 or Galaxy S26 and an opt-in; iPhone users get none of it.
- Gmail's own AI surface (summaries) is a prompt-injection target.

## What Scam Shield can learn
- Copy the "checkpoint" idea: slow the user down with context before a tap (our one-decision screens already do this; make it visible for links).
- Judge the thread, not the message: the Android companion should score trajectory (the detector already has it).
- Say the privacy sentence in the demo the way Google does: no bodies stored, Standard mode only, no send/trash/delete.
- Expect "why not just Gmail?": answer with context, explanation, action and guardian, not catch rate.

## Links (accessed 2026-10-27)
- https://blog.google/products/gmail/gmail-security-authentication-spam-protection/
- https://blog.google/security/new-android-scam-protections/
- https://www.infosecurity-magazine.com/news/google-new-ai-scam-detection/ (March 2025 Messages launch)
- https://www.bleepingcomputer.com/news/security/android-gets-ai-defenses-against-messaging-scams-fake-calls/
- https://www.androidauthority.com/google-scam-detection-samsung-galaxy-s26-3643942/
- https://thehackernews.com/2025/05/google-rolls-out-on-device-ai.html (Chrome)
- https://www.bleepingcomputer.com/news/security/google-gemini-flaw-hijacks-email-summaries-for-phishing
