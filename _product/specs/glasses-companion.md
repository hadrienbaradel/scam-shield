# Glasses companion ("Prudence on your glasses")
Status: Idea · Raised by Vlad, 2026-10-29 · Discussed: no · Last updated: 2026-11-04

The web path (set up, a photo through the phone's gallery, Listen on the phone's microphone, nothing to install) shipped as [check-glasses.md](check-glasses.md). What stays here is the native app on Meta's toolkit; where the two differ, check-glasses.md is what shipped (the sentence said aloud is hers, not the phone's: the glasses cannot announce it to the other person).

## Why
The scams that cost seniors most happen away from the inbox: a stranger at the door, a letter at the kitchen table, a frozen computer screen, a call. With Prudence on her glasses she can keep her eyes on the visitor or the page and hear a short answer in her ear, judged against her own life like every other check. For the video it is a live, hands-free beat that names Muse Voice Transcribe and Muse Spark; use cases, precedents and the storyboard are in [research/glasses/use-cases.md](../research/glasses/use-cases.md).

## Behavior
1. The senior starts every check herself: Listen, Look or Ask in the Prudence phone app, a tap on the glasses' temple while Listen is on, or "Hey Meta, start Prudence" where Meta's voice launch works; Prudence never starts on its own.
2. Listen: when she turns it on, the phone says aloud "Prudence is listening to help me. Nothing is kept." and shows that sentence in big letters until she taps Stop or says "Stop".
3. While Listen is on, "What do they want?" (a tap on the phone or on the glasses' temple) checks the last 45 seconds of the conversation.
4. Look: the glasses take one photo of a page or a computer screen in front of her and the camera light blinks; a phone's own screen is checked through the share sheet instead.
5. Ask: she says what is happening in her own words ("a man says my bank sent him for my card") and gets the same kind of answer.
6. About ten seconds after her tap she hears, in her glasses or earbuds, at most two short sentences in English or French: the verdict, then one action ("Do not pay cash today. Ask for a written quote.").
7. The usual card (Safe, Be careful or Scam, the reasons, a call button with the number she already has, Ask Thomas) appears on the phone at the same time, with Read it to me.
8. "Again" repeats the answer and "Why?" gives the first reason; otherwise Prudence stays silent, including when nothing is wrong.
9. When a code, a PIN, gift cards, a "safe account" or a courier for her card or her cash comes up, the first thing she hears is the fixed stop line for that ask ("Never give a code.", "Your bank never sends anyone for your card.").
10. "Tell Thomas", said or tapped, sends the card through the trusted-person loop and she hears "Done"; nothing reaches the family otherwise.
11. Lines a visitor may overhear stay neutral ("Ask for a written quote", never "he is a scammer").
12. Never: audio, a photo or a transcript is kept after the answer (only the verdict, as for every check); nobody is identified by face or voice; Prudence never calls or messages a number it read; it never listens to a call on her own phone.
13. Without glasses, everything works with any Bluetooth earbuds or the phone's loudspeaker, and Look uses the phone camera.

## Demo path
1. Linda's front door: she taps Listen; the phone says and shows "Prudence is listening to help me. Nothing is kept."
2. A man in a hi-vis vest (actor): "The storm took shingles off your roof. Two thousand, cash, today only."
3. Linda: "One moment." She taps; after a cut captioned with the measured wait, she hears "Do not pay cash today. Ask for a written quote."; the phone shows the Be careful card with "Leave me a written quote" shown big.
4. Linda: "Leave me a written quote. My grandson will call you." He leaves.

Caption "Ray-Ban Meta as headphones · Muse Voice Transcribe · Muse Spark · every voice a consenting actor". Optional 5 s Look insert: a "Medicare final notice" at the kitchen table, the LED blinks, "This letter is not from Medicare. Do not call the number on it." Fallback: the same take with one earbud, and the letter through the phone camera.

## Out of scope
- Identifying anyone by face or voice, voice-clone detection, tone or emotion analysis.
- Hearing calls on the senior's own phone (the OS silences every app in a call, feasibility #9); a second device on speaker stays the pressure coach's route.
- Recording, archiving or "remembering" conversations; any capture Prudence starts by itself.
- Negotiation coaching for salary, rent or meetings, and acting on her behalf ([pressure-coach.md](pressure-coach.md) keeps "coach, not negotiate").
- The Meta Ray-Ban Display HUD, iOS, and any public release (glasses apps cannot be published yet).

## Acceptance
- Not started.
- Listen, earbuds first: a scripted doorstep pitch at 1 m gets the expected verdict in three takes; the tap-to-ear time is measured and shown on the card.
- Look: on the Mock Device Kit, a test letter fed with `setCapturedImage` gets the same verdict as `/api/check/image` on the same picture; on hardware the letter is legible at 30-60 cm and the answer plays after the stream stops.
- Tests: the device voice route returns a verdict and stores no audio or transcript; the stop line fires on code, gift card, safe account and courier phrases in EN and FR; the 45-second buffer is silent while Prudence speaks; nothing is captured before the announcement has played.

## Implementation pointers
- Build order and days: [research/glasses/platform.md](../research/glasses/platform.md) section 6 (Listen with zero glasses code, then Look on DAT, voice launch last).
- `src/routes/mail.js`: `/api/check/text`, `/api/check/image`, `/api/check/voice`, `/api/ask` (web session; there is no bare `/api/check`).
- `src/routes/devices.js`: `/api/devices/check` takes text only, so the companion needs a device-token voice route (and a photo one for Look); `/api/devices/ask` carries Tell Thomas.
- `lib/muse.js`: `transcribeVoice` (Muse Voice Transcribe) and `extractFromImage`, which maps `letter` and `web` to `sms` today (keep them so the card says "this letter"); a "live conversation" channel for the verdict prompt is new.
- `lib/detector.js`: `codeAsk`, `giftCard`, `moveMoney` feed the stop line; a courier-pickup rule (EN/FR) is new; the fast answer is the Idea "Show the detector verdict first".
- `android/.../VerdictActivity.kt` (TextToSpeech on the media stream), `net/ApiClient.kt`; new: a microphone foreground service with the 45-second buffer and a media session for the temple tap; a `glasses` package on DAT 1.0.1 (`mwdat-core`, `mwdat-camera`, `mwdat-mockdevice`) after a Kotlin 2.2 bump.
- Hardware, Developer Mode, Mock Device Kit and prices: [research/detection-channels/meta-glasses-assistants.md](../research/detection-channels/meta-glasses-assistants.md).

## Open questions
- Glasses in hand by Oct 30, and which pair films in Boston on Oct 31 while Vlad builds in Paris?
- Which beat does the doorstep scene replace (1:47-2:05?), and does Ray-Ban Meta count against the four-Meta-surface cap with the WhatsApp scene?
- Does a spoken "Yes" to "Tell Thomas?" count as her tap for sharing?
- Is "Nothing is kept" honest for 45 seconds of audio held in memory and sent to Meta for transcription, and does the spoken notice satisfy Massachusetts and France (platform.md section 5)?
- Is a $379-449 pair realistic for the target senior, or is Listen with earbuds the product and the glasses the premium version?
- French: the announcement, speech through the glasses and voice launch are untested.
