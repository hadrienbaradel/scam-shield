# Android SMS companion
Status: Built (emulator only) · Last updated: 2026-10-27

## Why
Most senior scams in the US arrive as texts (USPS, E-ZPass, "Hi Grandma"). The phone must catch them where they land, with the same plain verdict, while keeping ordinary texts on the phone.

## Behavior
1. The senior (or a family member) pairs the app once: the web page "My phone" shows an 8-character code and a QR code valid 10 minutes; the app connects and shows "Protecting Linda".
2. Every incoming text is screened on the phone. Only texts with a link, or a risk pattern (urgency, gift cards, crypto, a code request, a money request, "new number", a family emergency), are sent to Scam Shield; every other text never leaves the phone.
3. A risky text produces a high-priority notification "Scam alert" (neutral on the lock screen); tapping it opens one screen: red, amber or green, a headline in 28 pt, the reasons, one next step, and 72 dp buttons "Read it to me", "Ask my trusted person", OK. A Safe verdict produces no notification.
4. "Ask my trusted person" sends the shared card to the guardians; the screen polls and shows the answer when it arrives.
5. If the server is unreachable, the phone shows a local warning once ("This text has warning signs. Don't tap any link. Ask someone you trust.") and retries for about half an hour; the real verdict replaces the warning when it arrives.
6. Queued texts and stored verdicts are sealed with a key in the phone's secure hardware; at most 20 verdicts are kept, for 7 days; message bodies are never logged.
7. If the phone is removed on the web page, the app returns to pairing on its next call.
8. English and French follow the verdict's language.

## Demo path
On the emulator (or a real phone on the same Wi-Fi): send "E-ZPass: unpaid toll of $4.50, pay today" with a link; the notification pops, the red screen opens, "Read it to me" speaks. 20 seconds, filmed on the device.

## Out of scope
Play Store distribution (RECEIVE_SMS is restricted), iOS, WhatsApp or RCS messages, blocking or deleting texts, on-device AI (interface stub only), calls.

## Acceptance
- 5 JUnit files (docs: 64 tests, unverified here): pre-screen EN/FR, API JSON contract, AES-GCM sealing, retention, retry policy. Server side: "phone pairing, SMS check, ask, answers, revoked token" integration test passes.
- Runs end to end on the Android 35 emulator against the mock server and the real server (screenshots in android/tools/). QR scanning not exercised; no real phone tested; no senior has used it.

## Implementation pointers
android/app/src/main/java/com/scamshield/companion/ (prescreen/PreScreener.kt, sms/CheckSmsWorker.kt, VerdictActivity.kt, data/LocalCrypto.kt, net/ApiClient.kt), src/routes/devices.js (pair-code, pair, check, ask, answers), android/README.md (setup, contract), testcases/sms_seed.json.

## Open questions
- Is the phone worth demo time versus the paste-a-text path, given sideloading and the LAN requirement (HOST=0.0.0.0)?
- The grandson's real number is never known to the server unless typed: add phone numbers to trusted people so a text from the real Ethan comes out Safe?
- Pre-screen misses: a plain "call me back at this number" text with no link or keyword never leaves the phone. Acceptable for privacy?
