# Meta glasses on Check ("Do you have Meta glasses?")
Status: Partial (every line built and walked in headless Chrome on the real model, 2026-11-04; never on a real phone or real glasses yet. Built after Vlad's phone walk, the VoiceOver pass and the reading check, `_product/docs/design.md`) · Raised by Vlad, 2026-11-04 · Last updated: 2026-11-04

## Why
A scam at the door or on paper happens away from the inbox. Someone who owns Ray-Ban Meta glasses gets one more way to reach Prudence, with hands and eyes free: show it a letter, let it hear the person in front of them, hear the answer in their ear. Nothing to install: the web app on the phone, the glasses as camera and headphones. The native app on Meta's toolkit stays in [glasses-companion.md](glasses-companion.md). Canvas: https://claude.ai/artifact/Bgzi1ykwujbxyGiPGA8ZUm

## Behavior
Check
1. **A fourth choice on Check**, under "Send a voice message": the glasses icon and "Do you have Meta glasses?". Once set up it reads "Use my Meta glasses". After "I don't have Meta glasses" it moves into More ways, as a row with "Set up my glasses". At French Largest the first three choices stay above the tab bar and the fourth takes one scroll (measured).
2. "Do you have Meta glasses?" opens Set up (`#/check/glasses/setup`); a pair already set up opens the glasses screen (`#/check/glasses`).

Set up: one thing per screen
3. **"Turn on your glasses":** a drawing from behind, as you put them on (the left arm on the left, "Left arm" and "Right arm" named on it, the touch strip dashed because it is on the outer side), with three numbered marks and three sentences at 19 px, so the gold button stays above the tab bar at Normal. 1 "The switch, inside the left arm. Slide it forward to turn them on." 2 "The button, on top of the right arm. Press it once to take a photo." 3 "The touch strip, on the side of the right arm. Tap to pause, slide to change the volume." Gold "They are on". Under it "They are new: help me install them" (unfolds three steps: install the Meta AI app; put the glasses in their case until its light blinks blue; in the app tap Glasses, then Add) and "I don't have Meta glasses" (saved, back to Check). "They are on" saves that there is a pair; one already tested stays tested.
4. **"Test the sound":** gold "Play a test sentence"; the phone says "Hello, this is Prudence. If you hear me in your glasses, you are ready." The sentence stays written on screen and the gold moves from Play to Yes. Then "Did you hear it in your glasses?" with "Yes, in my glasses" (saved as ready) and "No, it came from the phone" (one sentence: "Open your phone's Bluetooth settings, choose your glasses, then try again.", and "Try again").
5. **"Your glasses are ready":** a green check and the two choices of line 6.

The glasses screen (`#/check/glasses`)
6. **"Your Meta glasses":** gold "Someone is talking to me" ("Prudence listens. The answer comes in your glasses."), then "Show Prudence a letter or a screen" ("Take a photo with your glasses."), then the link "How do my glasses work?" (line 3).

Look (`#/check/glasses/look`)
7. **"Show Prudence a letter or a screen": three numbered sentences, then one button:** 1 "Look at the letter or the screen. Hold still." 2 "Press the button on top of the right arm once. Or say: Hey Meta, take a photo." 3 "Open the Meta AI app, so the photo reaches your phone." Gold "Choose my photo" runs the same picture check as Check. The verdict is the usual card, and its headline and next step are also spoken by themselves.
8. **"Without touching your phone"** shows only where Prudence really receives messages (the Page with its App Secret, the WhatsApp number with its token), never as a dead button. It sits under the main button, below the fold if it must. Messenger: "Say hello to Prudence once" (opens m.me), then "Then say:" and the words: "Hey Meta, send a photo to Hey Prudence on Messenger." WhatsApp: "Save Prudence in my contacts" (a contact card), then "Then say:" and "Hey Meta, send a photo to Prudence on WhatsApp." The answer comes back as a message in that app.

Listen (`#/check/glasses/listen`)
9. **Before it starts:** "The phone hears the person in front of you. Keep it in your hand or on the table. The answer comes in your glasses." Gold "Start listening". It never starts by itself, and it says "It cannot hear a phone call on this phone."
10. **Openly, in her own voice:** the glasses cannot announce it to the other person, so the screen shows in big letters, white on a navy card at 32 px, "An assistant is listening to help me. No recording is kept." (French: "Un assistant m'écoute pour m'aider. Aucun enregistrement n'est gardé.") with "Say this out loud." The phone speaks only "Prudence is listening. Tell them." Nothing is captured before that sentence ends. If the other person objects, Stop ends it.
11. **While listening:** that sentence, a calm navy bar on grey that moves only with the sound the phone hears (still when the person asked for less motion), gold "What do they want?", and "Stop". Only the last 45 seconds exist, in the phone's memory.
12. **"What do they want?"** turns the microphone off, sends those seconds, shows "Prudence is thinking…" with Stop, then the usual verdict card; the headline and the next step are spoken, at most two short sentences, and the card ends with gold "Keep listening" ("Ask <name>" is an outline on this screen only, so the screen keeps one gold verb). Nothing heard, or under about two seconds captured: "Prudence has not heard anyone yet. Wait until they have spoken, then tap again.", and it keeps listening.
13. **Stop, another screen, or the phone going to sleep while it listens** turn the microphone off and drop the audio at once ("Prudence stopped listening." and "Start listening"); so does a call or Siri taking the microphone. Once the microphone is off (Prudence thinking, the verdict), locking the phone changes nothing: the answer still comes and is spoken, and the microphone is never opened again on a hidden page. The screen is kept awake only while the microphone is open. The audio and the transcript are never stored; the verdict is kept like any check, as a "conversation" (not a voice message, so it does not earn the score's voice step), and can repeat a few of the person's words; it is never kept in the model's cache. What Prudence says stops when she leaves the screen.
14. **The phone's microphone, never the glasses':** the glasses' microphones are aimed at the wearer and barely hear the other person, so a Bluetooth microphone is passed over when the phone has its own. Any earphones or the loudspeaker work the same.
15. **No microphone allowed:** one plain sentence on how to allow it for this page, and "Try again"; a microphone that fails for another reason: "Prudence could not use the microphone. Close any other app using it, then try again." with "Try again"; a browser with no microphone says so, with no button.

Settings, welcome, score (`product-process.md`)
16. **Settings row "Meta glasses":** "Not set up" with "Set up my glasses"; "Ready" with "Use my glasses". Said no: "Not set up" too, so the change of mind is one tap.
17. **Welcome step:** "Do you have Meta glasses?" with Yes and No; Next without a choice saves nothing. Yes makes the score offer the test.
18. **Protection score:** counts only for someone who said they have a pair, and is on once they heard the test sentence in their glasses; its step is "Test my glasses". Without a pair it is never in the total, so the full score stays reachable.
19. English and French complete, the three text sizes, at 390 px, by keyboard and screen reader.

## Demo path
No scene in the Nov 4 video (Hadrien, Oct 31). Phone walk: Check → "Do you have Meta glasses?" → the drawing → "They are on" → "Play a test sentence" → "Yes, in my glasses" → "Someone is talking to me" → "Start listening" → a person reads "Your roof lost shingles. Two thousand, cash, today only." → "What do they want?" → the Be careful or Scam card, the answer in the ear → "Keep listening" → Stop.

## Out of scope
- The glasses camera through Meta's toolkit (a native app, Developer Mode, release 131 ends its camera sessions: `research/glasses/setup.md`) and "Hey Meta, open Prudence": [glasses-companion.md](glasses-companion.md).
- The glasses' own microphone, recording or remembering a conversation, listening in the background, identifying anyone, tone analysis.
- Calls on the same phone: the phone's system silences every app in a call.

## Acceptance
- Done, tests: `tests/glasses.test.js` (the status and `PATCH /api/me` carry the answer and refuse anything else; the channels that really receive; the contact card; the route records no audio or transcript; a Listen check is judged as a conversation) and `tests/glasses-view.test.js` (the Check choice in its three states; the ring buffer keeps only the last 45 seconds and encodes a valid 16 kHz WAV; the Bluetooth microphone is passed over; the listener with a fake microphone; the hands-free block hides without the App Secret or token; the score counts only with a pair; every string in EN and FR; AA contrast with the real tokens).
- Done, 2026-11-04, headless Chrome at 390 px with a fake microphone playing the spoken pitch on the real model: the walk above end to end at Normal and French Largest, a Be careful card from Muse Spark, the order microphone asked, let go, sentence, microphone reopened, off before anything is sent; no live track after Stop, another screen, the phone asleep, the page closing or the microphone going away; refused and missing microphone; Settings, the welcome step, the score; no CSP violation. Screenshots: `_product/design/2026-11-04-glasses/build/`.
- Done, review round 1 (2026-11-04, after merging main), the same walk, 129 of 129 checks on the real model: the phone locked while Prudence thinks, and the verdict still arrives and is spoken with no microphone open; the wake lock taken while listening and let go before anything is sent; a microphone held by another app says so with Try again; Ask from a Listen verdict names the speaker without empty brackets; the checks list says "conversation"; Look's answer stops on leaving the screen; a photographed Medicare letter's next step reads "Do nothing with this letter", no longer "Delete this text" (a letter photo keeps the channel `letter`, as Paste the words sends it). A call or Siri muting the microphone is covered only by `tests/glasses-view.test.js` with a fake track: headless Chrome cannot make one happen.
- Not done: on Vlad's phone with the glasses: the walk above; the sound in the glasses; the other person's words in the verdict; `speechSynthesis` on a real phone (the headless run proves each sentence was asked for at the right moment, not that anyone heard it). The VoiceOver pass and the reading check (`_product/docs/design.md`).

## Implementation pointers
- `public/js/views/glasses.js`: `renderGlassesScreen` (home, setup, look, listen), the one listening session, `spokenAnswer`, `glassesDrawing`, `handsFreeHtml`.
- `public/js/listen.js`: `createRing`, `resample`, `pickPhoneMic`, `phoneMicId`, `micProblem`, `createListener` (no words, no DOM); `public/js/audio.js`: `encodeWav`, shared with voice messages.
- `public/js/views/check.js`: the fourth choice and the More ways row; `run` takes `backHref`, `backKey`, `note`, `afterVerdict`, `cardEnd`; `pictureJob`, `stopCheck`.
- `public/js/protects.js`: `SCREENS`, the `glasses` row of `CRITERIA`, `hasGlasses`, `glassesChoice`, `glassesRow`, `handsFreeWays`; `public/js/main.js`: `DRAW`; `public/js/views/settings.js`: the `glasses` row; `public/js/views/pages.js`: the last step of `renderOnboarding`.
- `public/js/i18n.js`: `gl_*`, `ck_glasses*`, `onb_glasses_*`, `score_glasses*`; `public/js/ui.js`: the `glasses` icon, `speak(text, lang, onEnd)`, `unlockSpeech`; `public/styles.css`: the last section.
- `src/routes/account.js`: `user.glasses`, `messengerReceives`, `whatsappReceives` in `/api/status`, `PATCH /api/me`, `GET /prudence.vcf`; `src/routes/mail.js`: `context=conversation` on `/api/check/voice`; `lib/muse.js`: the `setting` line of the message block; `src/db/migrations/012_glasses.sql`: `users.glasses` (null, `none`, `have`, `ready`).

## Open questions
- Does "Hey Meta, send a photo to Hey Prudence on Messenger" reach a Page, or only people? Test on the pair; if not, line 8 keeps WhatsApp only.
- Does a glasses photo reach the phone's gallery by itself, or only after an import in Meta AI? Line 7's third sentence follows the answer.
- Does Safari on iPhone honour the phone microphone while the glasses are connected, and does speech reach the glasses right after the microphone stops?
- Legal: is the sentence said aloud enough where she lives (`research/glasses/platform.md` section 5)? Counsel before any public launch.
