# Video additions: Learn, and Meta glasses to Prudence on Messenger

Proposal for Vlad, written 2026-11-04 at 19:50 CET (13:50 ET; the deadline is 21:00 ET, which is 03:00 CET). Nothing has been filmed yet. Both beats go against Hadrien's Oct 31 decisions ("no Learn beat", "no glasses scene for Nov 4", `_product/log.md`). His reason was the 2:57 cap. Variant A at 2:10 removes that reason for Learn, and a real round trip would be the reason to add the glasses. He agrees before anything is uploaded (the `Vlad · video-variants` row).

## 1. What is true now

| Piece | State | Source |
|---|---|---|
| Learn tab | Partial, live. Nine one-minute lessons in English and French, told as stories. The scammer texts under a borrowed name. Three "What do you do?" choices follow, he replies in his own voice, and a wrong pick plays out and then rewinds. Stars, a badge, and the rule to remember. The lessons are YAML written by the team: **no Meta model writes, reads or scores a lesson.** "Try it on a real one" opens a demo card checked by the real engine (Muse Spark). | `_product/specs/micro-learning.md`, `data/lessons/`, `public/js/views/learn.js` |
| Learn, being changed right now | The `Vlad · learn-chat` row (since 19:40, origin/main f1dd649). Prudence opens like a friend texting. One tap answers her (never right or wrong), she replies, then the scammer's text and "What do you do?" arrive. The lesson becomes one growing thread of bubbles, and all nine lessons are being rewritten. The lines quoted below are today's: check them on the take. | `_product/log.md` (origin) |
| Messenger channel | Partial. **It has never answered a live message.** Page "Hey Prudence" (`m.me/139962502991539`), app 974018515302637 Live, webhook verified through the laptop's quick tunnel on port 3001, `messages` subscribed. Missing: `MESSENGER_APP_SECRET`, so every delivery is refused (403) until it is set. Pictures are fetched from Meta's hosts and read by Muse Spark (tested against Meta's docs, not yet live). The reply has a verdict line, a headline, up to three reasons, one next step, and "Checked with Meta's Muse Spark". Before App Review, only accounts with a role on the app get a reply. | `_product/specs/messenger-channel.md`; Vlad's two Messenger rows in the log |
| Glasses on Check | Partial and deployed, but only walked in headless Chrome. Look sends a glasses photo through the gallery and speaks the answer in the glasses. Listen uses the phone's microphone. The app already tells people: "Hey Meta, send a photo to Hey Prudence on Messenger." (this shows once the App Secret is set). Whether that reaches a Page is the spec's first open question, still untested on the pair. | `_product/specs/check-glasses.md`; To do "Meta glasses, the walk on your phone" |
| Meta: a photo by voice | Documented for a **contact**: "Hey Meta, send a photo to [contact name]." on Messenger, once Messenger is connected in the Meta AI app (Device settings → Communication). The photo is sent as taken, with no preview. | [S1], [S2] |
| Meta: a Page as the target | **Not documented either way.** Meta's pages only say "contact" and "[name]". No release note mentions Pages or businesses (the latest is v26, June 29, 2026). Both community projects that send glasses messages to a bot used something else: a second personal account in a group chat (Mai), or a WhatsApp contact. That is a hint, not proof. | [S1]–[S4], [S6], [S7] |
| Meta: the reply read aloud | Documented for incoming Messenger messages: "Announce messages" or "Automatic message readout", per app, in the Meta AI app. Vanish mode blocks it, and Messenger needs its Bluetooth permission. Nothing is documented about a Page as the sender or about length limits. One report says long messages are not read aloud, and forum threads say readout is unreliable. | [S3], [S7], [S8] |

**In short:** our side of the round trip is built and waits on one key. Meta's side (a voice command aimed at a Page) is unknown. The beat is real tonight only if the test in section 5 passes. Otherwise use version V2 or V3 below, and never a mock-up.

## 2. Addition 1: Learn (8 s; 9 s at Hadrien's pace)

**Narration** (19 words, about 7 s at 160 words a minute), placed right after the USPS throw/undo:
> "And when she has a minute, Learn turns that trick into a story where she outsmarts the scammer herself."

Stand-alone line, for a place that does not follow the USPS scene (18 words):
> "Between scams, Learn: one-minute stories where she outsmarts the scammer herself. The joke is on him, never her."

The one idea: she makes the right move with her own hand, and the joke is never on her. The line has no "AI", no claim that lessons stop scams (the spec's Out of scope), and no numbers. Do not use the spec's caption "built from the scams that reach her": the lessons are not made from her inbox.

**Shot list** (phone screen at 390 px; every state on screen at least 2 s except the first tap)

| Time | Screen | Tap | What changes |
|---|---|---|---|
| 0.0–1.5 | Learn home: "Learn to spot them. One minute at a time.", first card "The $1.99 parcel trap" (Mr. Tiny Fee, three empty stars) | The card | The lesson opens |
| 1.5–4.0 | The thread. After the rewrite, Prudence's opener and the tapped answer sit at the top. Then Mr. Tiny Fee's bubble under the name "USPS" ("...A small fee of **$1.99** is due..."), and "What do you do?" with three big buttons | "Look it up myself in the USPS app." | The answer is chosen |
| 4.0–6.0 | "Well spotted!" and "You earned a star.", his reply (today: "Oh no. Not the app. Nobody checks the app. Fine. FINE."), confetti, the first star filling in | none | The star lands |
| 6.0–8.0 | Jump cut to the end screen: "Lesson finished!", three stars, the badge, "The rule to remember: Never pay a delivery fee from a link in a text...", with "Try it on a real one" visible | none | End of the beat |

Record the whole lesson in one take, getting all three choices right the first time (60–90 s raw). The editor keeps these four moments.

**Caption / side panel:** "Learn · one-minute stories · English and French" and "Never 'wrong', no timer, nothing taken away". Name Muse Spark only if the take shows "Try it on a real one" being tapped ("The real message is checked by Muse Spark"). Otherwise name no model.

**Preconditions**
- The learn-chat row has its Done line and is deployed (`/api/health` on heyprudence.com shows its sha), or the laptop server runs that commit. If it has not landed by 22:00 CET, film today's story screens instead: they are on main and live, so they are just as real.
- Use `https://heyprudence.com/#/demo/learn` in a fresh private window. No sign-in is needed, the stars start at zero, English comes from the language button, Chrome device mode is 390 × 844, and reduced motion must be off for the confetti. Sign-in on production fails (`redirect_uri_mismatch`, Hadrien's To do), and Vlad's VPN resolver does not find heyprudence.com: turn the VPN off or use `make server`.
- Text size: the demo can only show Normal, because text size is an account setting (`status.user.textScale`). Zoom in the edit, as the rough cut did. Largest needs Linda signed in on the laptop server (Settings → Text size), and her saved progress may not be at zero.
- Look: the demo bar has two tabs and the Nov 4 styling, while the rest of the cut shows the Nov 2–3 screens. That mismatch is why Hadrien left Ask Thomas out. The lesson is a screen on its own, so crop to it.
- Sound for Variant A if Hadrien does not record: the app's Listen on the reply step reads "Mr. Tiny Fee says: ..." in the browser voice, like the Norton read-aloud already in the cut. The confetti is silent.

## 3. Addition 2: Meta glasses → Prudence on Messenger (10 s)

| Version | What happens | Real tonight? | Label on screen |
|---|---|---|---|
| **V1, the pitch** | Vlad speaks to the glasses → the photo goes to the Page → Prudence replies in Messenger → the glasses read it, if they do | Only if step 5 of section 5 passes | "Filmed live · Prototype: our test accounts until Meta's App Review" |
| **V2, two taps** | "Hey Meta, take a photo." (documented) → Meta AI app → the photo → Share → Messenger → Hey Prudence → the reply | Yes, once steps 1–3 pass | "Photo from Meta glasses, shared to Prudence on Messenger · Prototype" |
| **V3, inside Prudence** | "Hey Meta, take a photo." → Check → Use my Meta glasses → Show Prudence a letter or a screen → Choose my photo → the card, with the answer spoken in the glasses | Deployed, never walked on a real phone. The photo must reach the phone's gallery (Meta AI app import) | "Photo from Meta glasses · answer in the glasses" |

**Narration** (17 words in two parts, with Vlad's own live voice in between):
- Before: "A scam on paper never reaches an inbox."
- Vlad, live, never re-voiced: "Hey Meta, send a photo to Hey Prudence on Messenger." (V2 and V3: "Hey Meta, take a photo.")
- After: "Muse Spark reads it and answers in the chat." (V3: "...answers in her glasses.")

**Shot list (V1)**

| Time | Shot | What changes |
|---|---|---|
| 0.0–2.5 | Second camera, over the shoulder: Vlad wears the glasses and looks at the printed notice on the kitchen table. Narration, part 1 | The setting |
| 2.5–5.0 | Same shot: Vlad says the command, the glasses' capture light blinks, and the words appear as a caption | The photo is taken |
| 5.0–6.0 | That same photo, full frame, with a white flash in: the glasses' point of view (taken from the Messenger thread or the Meta AI gallery) | What the glasses saw |
| 6.0–10.0 | Phone screen recording of the "Hey Prudence" thread: the photo on the right, the typing dots, then Prudence's reply. Zoom on the verdict line and "Checked with Meta's Muse Spark". Narration, part 2. If the glasses read the reply, the room sound of the take plays under this shot, captioned with the words read | Muse Spark's answer |

In V2, a 1 s sped-up Share on the phone replaces 2.5–5.0 after the "take a photo" command. In V3, the Prudence card replaces the Messenger thread.

**Caption:** "Meta glasses → Messenger → Muse Spark" plus the version's label. Quote only what the screen shows: the verdict wording is whatever Muse Spark answers on the take.

**Do not say:** "nothing is kept" (Meta's apps keep the photo and the chat; our spec's promise covers our server only). Do not call it "Prudence on your glasses" (the native companion is still an Idea). Do not say it "works for everyone" (only accounts with a role on the app, until App Review). Never add a voice in the edit to stand in for the glasses' readout.

**Filming preconditions**
- **Accounts.** The glasses are paired in the Meta AI app to the vladztools@gmail.com Meta account. Messenger is connected under Device settings → Communication with the Facebook account that administers app 974018515302637 (only accounts with a role get a reply). "Hey Prudence" is already in that account's chats (the "hello" of step 2).
- **Server.** The laptop instance on 3001 has the App Secret, and its quick tunnel stays up from the test to the last take. A new tunnel means a new callback URL in Meta's dashboard, which only Vlad can enter.
- **Phone.** Messenger readout is on (Meta AI app → Device settings → Communication → Messenger → Automatic message readout). Vanish mode is off in the Hey Prudence chat. Other notifications are silenced, but check that the Focus mode does not mute Messenger. Screen recording is ready.
- **Second camera.** The laptop webcam (QuickTime) or a second phone on a stand. Vlad is the only person on camera, or only hands and glasses are shown.
- **The object.** Print it on A4 at 24 pt or bigger. Use paper, not a phone screen: the glasses camera cannot read phone-size text (`_product/research/feasibility.md` #57). Nothing real on it: no city, plate, name, seal or phone number. The QR code points to an `.example` address, which never resolves:

```
PARKING VIOLATION NOTICE
Amount due: $45.00
Pay within 24 hours or the fine doubles.
Scan to pay now
[QR code: https://pay-parking.example/pay]
```
"Scan to pay" triggers the detector's scan-a-code rule (`qrAsk` in `lib/detector.js`), and "within 24 hours" triggers its urgency rule. Muse Spark reads the printed words; do not count on it decoding the QR. Alternate object: a "We missed you" delivery card ("Scan to reschedule, $1.99 fee"), which echoes the USPS cold open.
- **Files.** The webcam clip, the screen recording and the glasses photo stay outside the repo (the video project folder) and are never committed.

**If the live round trip fails:** step down from V1 to V2 to V3 at the first step that fails (section 5). If none of the three works by 23:00 CET (17:00 ET), cut the beat. A mock-up would break the organizers' "show the working product" rule, and judges notice.

## 4. Where they go

| | A "Founder" (2:10) | B "Narrator" (about 2:45) | C "Hook first" (about 2:40) |
|---|---|---|---|
| **Glasses: place** | After voicemail + Norton picture, before how it works: right after "pictures are read by Muse Spark" comes a picture from the glasses | Same place, after Norton and before the ad studio and how it works | After the Norton picture in the product part |
| **Glasses: length after** | 2:20, no cuts | 2:55, 3 s margin. If it runs long, trim the ad studio from 13 to 10 s, not this beat | 2:50, no cuts |
| **Glasses: voice** | Hadrien records the two lines (17 words, phone mic, -16 LUFS like Nov 3). Or no narration at all: Vlad's live command, the captions and the glasses' readout carry the beat | The ElevenLabs female narrator reads parts 1 and 2; the command stays in Vlad's voice | The ElevenLabs male narrator; same |
| **Learn: place** | After throw/undo, before Ethan: the parcel lesson closes the USPS story | Leave it out: it fits only by cutting the numbers or the ad studio (3:03 otherwise) | Leave it out (2:58 with both, no margin). If the glasses beat is cut, Learn takes its place with the stand-alone line |
| **Learn: voice** | Hadrien's line, or captions plus the app's Listen | ElevenLabs | ElevenLabs |
| **Recommendation** | Glasses (V1 or V2) yes. Learn yes if it lands by 22:00 CET: there is room | Glasses only, and only if filmed live | Glasses only, if live; Learn as the fallback beat |

**Why:** the jury scores Use of Meta AI tooling (25 %) and Demo (25 %: "a working, impressive demo", "genuinely cool to watch", `_product/research/hackathon.md`). A real glasses → Messenger → Muse Spark round trip scores on both, but only if it is real. Learn is the weaker beat for this jury: no Meta model on screen, a screen still being rewritten, and the newer styling. It adds a senior-first idea (Impact), so it belongs where there is room (A) and nowhere else.

**Flags**
- B with the ad studio and the glasses shows five Meta products (Muse Spark, Muse Voice Transcribe, Muse Image, Meta glasses, Messenger). That breaks the Oct 29 rule "never more than four Meta surfaces on screen" (`_product/marketing/video-script.md`). That rule was about clutter, and these sit in separate beats. Vlad's call.
- If the video shows the round trip live, the form text still says Messenger is "built, not yet live" (`_product/marketing/submission.md`). It has to match the video before submitting, along with the YouTube link and Hadrien's page.

## 5. What Vlad does, in order (about 20 minutes, then the takes)

Stop at the first step that fails and film the version it leaves you.
1. **App Secret** (your To do row, 3 min): `make secrets-set MESSENGER_APP_SECRET=...`, then the Messenger session restarts the 3001 instance. If this fails, Messenger is out tonight: film V3.
2. **First live message.** On the phone, from the vladztools Facebook account, send "hello" to `m.me/139962502991539`. A reply should come back within seconds. If not: V3.
3. **First live picture.** In the same thread, send a phone-camera photo of the printed notice. A Scam or Be careful reply means the picture path works. If not: V3. If the reply is Safe or "no message", change the object.
4. **Meta AI app.** Messenger connected under Communication, readout on, vanish mode off.
5. **The voice test.** Say "Hey Meta, send a photo to Hey Prudence on Messenger." The photo arriving in the thread plus a reply means V1. If Meta AI cannot find "Hey Prudence", try "...to Prudence on Messenger" once, then film V2. Either way, the answer settles the open question in `_product/specs/check-glasses.md` and `_product/specs/messenger-channel.md`: give it to the Messenger session to record.
6. **Readout.** If the glasses read the reply aloud, keep the room sound. If not, use captions only.
7. **Learn** (15 min, once learn-chat lands or by 22:00 CET with today's screens): the take described in section 2.

Go/no-go: the glasses take by 23:00 CET (17:00 ET), Learn by 22:00 CET. After that the time goes to the edit, Hadrien's OK, the new upload, and the form link.

## Sources

Accessed 2026-11-04. Meta's help pages were served in French to the fetcher (as in `_product/research/glasses/setup.md`). The English command wording comes from the en-gb page [S1].
- [S1] Meta Help, "How to share photos and videos with AI glasses": https://www.meta.com/en-gb/help/ai-glasses/683425686669295/. Gives "Hey Meta, send a photo to [contact name]." (Messenger) and "Hey Meta, send a photo on WhatsApp to [contact name]"; accounts must be connected in the Meta AI app; "you will not be able to preview or edit your media before sharing"; nothing on Pages.
- [S2] Meta Help, "Call and message using AI glasses": https://www.meta.com/help/ai-glasses/647079267216457/. "Send a message to [name]", optionally naming the app; the glasses announce messages and read them aloud.
- [S3] Meta Help, "How to set up message announcement and readout on AI glasses": https://www.meta.com/help/ai-glasses/493802475697609/. Device settings → Communication → Messenger → Announce messages / Automatic message readout; vanish mode blocks readout; Messenger needs its Bluetooth permission.
- [S4] Meta Help, AI glasses release notes: https://www.meta.com/help/ai-glasses/1809764829519902/. Latest v26 (June 29, 2026); sending a photo by voice to Instagram since v17 (July 2025); nothing on Pages or businesses.
- [S5] Meta, hands-free communication: https://www.meta.com/ai-glasses/hands-free-communication/. An audio cue tells you who is calling or writing.
- [S6] dcrebbin/meta-glasses-api ("Mai"): https://github.com/dcrebbin/meta-glasses-api. Needs an "Alternative Facebook/Messenger account" and a group chat that the glasses "become aware" of. It is a browser-extension hack, not the Messenger Platform, and not a route for us (inboxes through Meta's APIs only).
- [S7] J. Schrier, "Hacking Meta Rayban Glasses" (2024-07-18): https://jschrier.github.io/blog/2024/07/18/Hacking-Meta-Rayban-Glasses.html. Uses a WhatsApp contact as the bot; "when the assistant receives a sufficiently long whatsapp message, it does not read it aloud".
- [S8] Meta community forum, WhatsApp readout broken on Gen 2 (2026; seen only as a search snippet): https://communityforums.atmeta.com/discussions/ai-troubleshooting/whatsapp-message-readout-broken-on-ray-ban-meta-gen-2-after-v20-0--ios-26-2/1358106
- Could not be read: https://jovanovski.medium.com/3c804801447b (blocked by Cloudflare). A search snippet says it pairs voice messages with a custom app, a Page and a webhook; unverified.
