# On-device pre-screen with Muse Glimmer
Status: Idea · Last updated: 2026-10-27

## Why
The Android app decides on the phone which texts leave it, with regular expressions today. A small on-device model would catch "call me back about your account" texts that have no link or keyword, and keep even more ordinary texts private. The PRD names Muse Glimmer; the runtime is undecided.

## Behavior
1. Incoming texts are scored on the phone by a small model; only texts the model finds risky are sent to Scam Shield, exactly as the regex gate does today.
2. The model runs on a mid-range Android phone within a second and without network; when it cannot load, the regex gate takes over unchanged.
3. The senior sees no difference except fewer missed texts; the privacy promise ("every other text stays on the phone") is unchanged.
4. The choice of gate (regex or model) is visible on the phone's home screen for testers.

## Out of scope
Judging texts fully on the phone (the verdict still needs the life context on the server); iOS; running the model for email.

## Acceptance
- Not started. The Kotlin interface exists (`PreScreener`, `PreScreeners.current`), so a model-backed implementation can be swapped in without touching the SMS receiver or the worker.
- Would need: a measured recall on testcases/sms_seed.json plus everyday texts, a latency budget on a mid-range device, and an APK size check.

## Implementation pointers
android/app/src/main/java/com/scamshield/companion/prescreen/PreScreener.kt (interface, `RegexPreScreener`, "Muse Glimmer, runtime TBD"), sms/SmsReceiver.kt (calls the gate), android/README.md (pre-screen rules).

## Open questions
- Which runtime (ExecuTorch, LiteRT, ONNX) ships Muse Glimmer on Android, and is the model licensed for this use?
- Is the regex gate's miss rate actually a problem for the demo, or is this post-hackathon by definition?
