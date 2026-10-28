# Check something else (pasted text, picture, voice note, email file)
Status: Built · Last updated: 2026-10-28

## Why
Scams arrive by text, WhatsApp, pop-up and letter too. The senior (or the family member sitting next to them) must be able to check anything in one place with the same verdict screen.

## Behavior
1. "Check something" lets the user paste the words of a text message, WhatsApp or email, say who sent it (name, number or address) and tap "Check this"; the same verdict card appears, with Read aloud and Ask my trusted person.
2. "Or send a picture of it": a screenshot or photo (PNG, JPEG, WebP, up to 8 MB) is read by Muse Spark, transcribed word for word without judging, then checked like text. The picture is never kept. If no message is found, the app says so.
3. "Or an email file": a `.eml` downloaded from any webmail is parsed in memory and checked exactly like a Gmail message; its authentication is trusted only if Gmail visibly received it. The file is never kept.
4. "Or a voice message": a voicemail or voice note (any file the browser can play: m4a, mp3, ogg, wav) is converted on the device to 16 kHz mono 16-bit WAV (at most 4 minutes), sent once to Muse Voice Transcribe (`muse-voice-transcribe-1.0`, `POST /v1/asr/transcribe`), and the words are judged like a text from the channel "voice_transcript". The page shows "What the voice message says" under the verdict. Neither the recording nor the words are kept. No words heard: the app says so.
5. Pasted, pictured and spoken messages are never stored; only the verdict is kept, so "Ask my trusted person" sends what is on screen at that moment.
6. When Muse Spark is not switched on, the picture and voice buttons are replaced by "Checking pictures needs Meta's Muse Spark… please paste the words instead"; text and `.eml` checks still work with the rule detector.
7. Each check is rate-limited per person (30 text, 10 picture, 10 voice, 20 file checks per minute).

## Demo path
Paste "USPS: your package is on hold. Pay a $1.99 redelivery fee" with a link, show the red card; or drop a screenshot of a bank text and show the transcription turning into a verdict (needs the Muse key).

## Out of scope
Live phone calls (never listened to), QR codes inside pictures (not decoded), PDFs, browser extension "check this page", links pasted alone without text (works, but judged as a bare link).

## Acceptance
- Tests: pasted text checked without storing it; uploaded `.eml` checked and not stored; screenshot transcription sends the image and returns a checkable message (tests/integration.test.js, tests/muse.test.js, tests/units.test.js eml).
- Screenshot path exercised against the live model: unverified (docs mention screenshots work; no live number recorded).
- Voice: unit test of the exact Voice Transcribe request (tests/muse.test.js) and an HTTP test of /api/check/voice (no key → 503, not a WAV → 400, transcript judged, nothing stored) (tests/integration.test.js). Live, 2026-10-27: a synthetic "grandson in jail, buy gift cards" voicemail transcribed in 3.3 s and judged Scam by Muse Spark in 5 s. Browser conversion checked headless on a stereo 44.1 kHz file. Not yet tried in a signed-in browser (needs the OAuth client).

## Implementation pointers
src/routes/mail.js (/api/check/text, /api/check/image, /api/check/voice, /api/check/eml, /api/ask with provided message), lib/muse.js extractFromImage (IMAGE_PROMPT, IMAGE_SCHEMA) and transcribeVoice, public/js/audio.js toWav16k, src/google/eml.js parseEml, public/js/views/pages.js renderCheck.

## Open questions
- Should the guardian be able to check something on the senior's behalf from their own dashboard?
- Is the `.eml` path worth keeping in the UI for seniors, or is it a developer/tester tool (Gmail "Download message" is three menus deep)?
- Transcription in the model's language vs. the user's: a French screenshot checked by an English profile?
