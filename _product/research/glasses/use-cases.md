Keywords: glasses, ray-ban meta, use cases, listen, look, whisper, negotiation, doorstep, coach

# Prudence on your glasses: use cases
Written 2026-10-29 for Vlad's ask (glasses that listen, see the phone if wanted, advise, help negotiate). Builds on [meta-glasses-assistants.md](../detection-channels/meta-glasses-assistants.md) (DAT, Developer Mode, prices) and feasibility #9-#12 and #21; APIs, microphones, law and Meta's Acceptable Use Policy: see [platform.md](platform.md) for the rules. Spec: [glasses-companion.md](../../specs/glasses-companion.md).

## Concept
"Prudence on your glasses" is a second pair of eyes and ears that whispers one sentence when something smells wrong and is silent otherwise. Three verbs, each started by the senior: **Look** (one photo of a thing: a letter, a big pop-up on the computer, a contract, a QR sticker; never a face, never the phone's own screen, which the share sheet reads and the glasses camera cannot), **Listen** (the phone's microphone hears the person at the door or the counter; announced, nothing kept), **Ask** (her own words: "a man says my bank sent him for my card"). What runs where: the glasses are a camera, open-ear speakers and a capture LED, and no third-party code runs on them (for Listen and Ask they are plain Bluetooth headphones, so any earbuds work); the Android companion holds the microphone, the glasses session and the photo, speaks the answer and shows the card; the server transcribes with Muse Voice Transcribe, reads the picture and judges with Muse Spark against her own life (bank, carrier, orders, Ethan's number) behind the rule detector and guardrails, and keeps only the verdict. Every verb ends the same way: one short answer in the ear, the card on the phone, "Tell Thomas?".

## Decision
Follow platform.md's build order: Listen and Ask first (phone microphone, answer through the glasses as headphones, zero glasses code, 1.25 days, survives the Nov 1 cut), Look second (DAT camera, paper and big pop-ups only, hardware by Oct 30 or the phone camera), voice launch last. The doorstep is the video beat; the letter is a Look insert. Negotiation coaching stays out of the video. Ask is the underrated verb: only her own voice, no camera, the cheapest consent.

## Use cases for seniors, ranked
Rank = money at stake for people 60+ × what the glasses add over the phone × buildable on today's routes; false alarms push a case down. Each answer is at most two short lines (under about 3 s each); details wait on the card.
1. **A stranger at the door** (Listen + Ask). The bank's "courier" for her card (France) or for cash and gold (US: over $55M from May to December 2023, "many of whom are senior citizens", IC3), a "gas leak" agent, a storm roofer with a cash price for today, a charity, "your neighbour sent me". Hands busy, door open, eyes on the visitor: the moment the phone screen is worst.
   Ear: "Your bank never sends anyone for your card. Keep the door closed." / « Votre banque n'envoie jamais de coursier. Gardez la porte fermée. » Roofer: "Do not pay cash today. Ask for a written quote." / « Ne payez rien aujourd'hui. Demandez un devis écrit. »
   Phone: card with "Call my bank" (the number she already has) and "Ask Thomas"; Thomas gets two lines. False alarm medium (real meter readers and roofers), so every line is also right for a genuine visitor. Demo: the strongest Impact scene; needs an actor. By Nov 4: Yes (platform.md Build 1).
2. **A letter or bill at the kitchen table** (Look + Ask). A "final notice": a Medicare card "fee", impots or an ANTAI fine, a fake invoice; one photo at 30-60 cm, her question by voice.
   Ear: "This letter is not from Medicare. Do not call the number on it." / « Cette lettre ne vient pas de l'Assurance Maladie. N'appelez pas ce numéro. » The card adds "Your Medicare card is free" (FTC) / « La carte Vitale est gratuite » (`lib/brands.js`).
   Phone: red card, "Call Medicare" on the number she has, "Ask Thomas". False alarm low (real bills match her providers). Demo: the best scene per day of work, but the phone camera does it too. By Nov 4: Stretch on glasses (Look), Yes on the phone (`/api/check/image` already reads letters).
3. **A pop-up on the computer** (Look). Full-screen "virus, call Microsoft" with a siren; the screen is frozen, so no screenshot. Tech support is where people 60+ are most over-represented ($1.041B lost by 60+ in 2025, [scam-market-stats.md](../scam-market-stats.md)).
   Ear: "This warning is fake. Do not call; turn the computer off." / « Cet avertissement est faux. N'appelez pas, éteignez l'ordinateur. » Card: "Genuine Microsoft error messages never include a phone number to call" (Microsoft).
   Phone: Scam card with "How to turn it off". False alarm very low. Demo: 8 s, strong. By Nov 4: Stretch on glasses (big text only, platform.md), Yes with the phone camera.
4. **A scam call** (Ask). "Your bank's fraud team: move your money to a safe account", "Grandma, I'm in jail", "Medicare needs your number". No app hears a call on her own phone (feasibility #9), so she asks right after hanging up, before she acts.
   Ear: "Your bank never asks you to move money. Call the number on your card." / « Votre banque ne demande jamais de déplacer votre argent. Appelez le numéro de votre carte. » Grandchild: "Call Ethan on his own number first."
   Phone: Scam card, "Call Ethan" first (saved-contact rule). False alarm low (the asks are the signal). Demo: medium (the Ethan text scene tells it already). By Nov 4: Yes.
5. **Gift cards or cash on someone's instructions** (Look + Ask). At the checkout with $500 of Apple cards, at the bank counter or the ATM withdrawing cash "for the investigation".
   Ear: "Stop. Nobody real is paid in gift cards." / « Stop. Personne de sérieux ne se fait payer en cartes cadeaux. » Cash: "Banks and police never ask for cash. Talk to the teller." / « Ni la banque ni la police ne demandent d'espèces. Parlez au guichetier. »
   Phone: Scam card. False alarm: cards as presents are normal, so a photo never decides alone; "someone told me to" does. Demo: strong, needs a store. By Nov 4: Yes (`giftCard` rule exists).
6. **A sales pitch** (Listen; Look at the paper). Door-to-door energy, insulation, solar or insurance, a timeshare dinner, a car dealer's add-ons, "this price is only for today".
   Ear: "Do not sign today. A good offer will still be there tomorrow." / « Ne signez rien aujourd'hui. Une bonne offre sera encore là demain. » Card: France gives 14 days to withdraw from a door-to-door contract and bans any payment in the first 7, and since Aug 11, 2026 a contract from an unconsented phone canvass is void; the US gives 3 business days to cancel a door-to-door sale over $25 (FTC Cooling-Off Rule).
   Phone: Be careful card with "Leave me the offer in writing" shown big ([pressure-coach](../../specs/pressure-coach.md) behavior 3). False alarm high if it ever said Scam, so it stays Be careful unless a cash, code or transfer ask fires. By Nov 4: Yes (Listen), Stretch (Look).
7. **The small print, read aloud** (Look). A contract, an insurance renewal, an "investment" brochure, no reading glasses at hand.
   Ear: "It renews every year at 89 dollars. Cancelling costs 150." / « Renouvelé chaque année à 89 €. Résilier coûte 150 €. » Card: the text with the traps marked. False alarm low (it points, it does not judge). By Nov 4: Stretch (a contract prompt; extraction exists).
8. **A QR sticker on a parking meter or flyer** (Look). Fake stickers over meter codes (police warnings in the US and New Zealand, 2025-2026 (unverified)).
   Ear: "This code is a sticker. Pay with the city's app instead." / « Ce QR code est un autocollant. Payez avec l'appli de la ville. » False alarm medium (real codes exist). By Nov 4: Stretch (needs a QR decoder; Idea "QR code and logo spotting").
9. **A "wrong number" text** (no camera). The companion already pre-screens texts; the glasses only carry its read-aloud (`VerdictActivity` speaks on the media stream, so it should reach Bluetooth headphones (unverified on these glasses)).
   Ear: "A stranger's wrong-number text. Do not answer it." / « Un inconnu s'est trompé de numéro. Ne répondez pas. » Card: "this is how investment scams start". Demo low. By Nov 4: Yes (a test, not a build).

## Use cases for everyone
- **Car dealer.** Look at the window sticker or quote: "is this price normal?" (Muse Spark with `web_search`, sources named); Listen hears "the warranty is mandatory" and whispers "Extended warranties are optional. Ask for the out-the-door price in writing."
- **Rental viewing.** A deposit before the lease, a "landlord abroad", a transfer to a new account: "Do not pay before you sign and get the keys." / « Ne payez rien avant le bail et les clés. » Still scam protection.
- **Contractor quote.** Look at the quote: the usual range, then "Ask for the insurance certificate and the company number." / « Demandez l'attestation décennale et le SIRET. »
- **Salary, a rent renewal, a meeting.** "Am I being pressured?", "what should I ask next?": a general coach.
- **Where it stops.** The first three keep the scam frame (pressure, upfront payment, a new account: the detector's own rules), so they widen the audience without a new product. Salary and meetings make it a copilot: the goal becomes winning, the other side is not a criminal, the comparison is Cluely, and consent is harder (all-party states, see platform.md). For the hackathon that dilutes "one verdict for a senior": one pitch line at most ("the same pressure check works for anyone at a car dealer"), no scene; a "Coach" mode after Nov 4.

## Interaction model on glasses
- **Start.** The companion's big Listen, Look and Ask buttons (and its notification) work today without approval; while Listen runs, a single temple tap may reach the phone as play/pause for a "What do they want?" check (unverified, platform.md); "Hey Meta, start Prudence" needs the experimental voice launch on a Wearables Developer Center Beta channel (French unknown). "Hey Meta" and the capture button stay Meta's; Prudence never starts itself.
- **Consent.** Listen: she turns it on and says so, the phone says "Prudence is listening to help me. Nothing is kept." and shows it in big letters until Stop; the phone microphone has no light, so openness comes from words and the screen. Look: the capture LED lights for every camera use and cannot be disabled or covered. Rules: see platform.md.
- **Short answers.** A two-line maximum, verdict then one action; "Again" repeats, "Why?" gives one reason, the card waits on the phone; never a lecture; silent when nothing is wrong unless she asked. The glasses pause app audio during a camera stream, so the Look answer comes after the photo (platform.md).
- **Neutral words.** A visitor at 1 m may hear the open-ear speakers (unmeasured): "Ask for a written quote", never "he is a scammer".
- **Speed.** Tap to ear about 9-10 s on the batch route (3.3 s transcription and 5 s verdict measured Oct 27); 4-7 s only with the realtime relay (platform.md). The video prints the measured time.
- **HUD (Meta Ray-Ban Display).** A coloured dot and five words on the right lens, silent at the door, a Neural Band pinch for "Tell Thomas"; Meta opened the display to developers on May 14, 2026 (mobile SDK and web apps). Worth it later for hard-of-hearing seniors; not by Nov 4: $799 US, €899 France (unverified), not in hand, no display in the Mock Device Kit, and a one-eye panel is a hard read at 75. Audio stays primary.

## Precedents and competitors
| Product | What it does | Lesson for Prudence |
|---|---|---|
| Meta AI on the glasses | "Hey Meta, look and..." sends a photo to Meta's cloud, kept in the app's Chats; "call this phone number", "scan this QR code" | Generic and obliging: asked to, it dials the number on a fake letter. Prudence adds her life and the family, and keeps nothing |
| Live AI (Meta) | A continuous camera and microphone session, follow-ups without "Hey Meta", proactive tips "eventually" (v11, Dec 2024, US and Canada early access) | The always-watching model; Prudence wakes only on her tap |
| Conversation Focus (Meta) | Amplifies only the voice in front, on-device (early access US and Canada, Dec 2025); since July 2026 3 h a month free, 15 h on Meta One Premium at $20 a month | The glasses can single out the person in front, but a third-party app only gets a wearer-tuned microphone |
| Live translation, captions (Meta) | Speech between English and Spanish, French or Italian (Dec 2024); captions on the Display, English only, "face the speaker" | Captioning the other person is Meta's job; Prudence judges |
| Be My Eyes on Meta glasses | "Call a volunteer" hands-free, since Nov 2024 (unverified) | The precedent for "one tap brings a human": our Thomas |
| "Name Tag" (Meta, reported) | Face recognition for the glasses "as soon as" 2026, per the NYT (Feb 2026); no launch found | Prudence never identifies a face or a voice |
| Mentra | MentraOS captions and translation apps (a teleprompter (unverified)) on Even Realities G1/G2, Vuzix Z100 and the camera glasses Mentra Live; 1,000+ community apps; apps are moving from Mentra's cloud to the phone (roadmap of June 2026, SDK public in Sep 2026) | Our split: glasses for input and output, the phone does the work |
| Halo X | Always-on listening, a display that "tells you what to say", no indicator light, $249 (preorders Aug 2025) | The anti-pattern: covert, consent left to the buyer |
| I-XRAY | The Halo X founders' 2024 demo: Ray-Ban Meta livestream plus face search, strangers' names and addresses in seconds | Why faces stay out |
| Cluely | Desktop overlay that hears meetings and suggests answers, "Cheat on Everything" (Apr 2025), 5-90 s lags in tests, a meeting assistant by Nov 2025 | Help against the other side, sold as invisible: what Prudence is not |
| Brilliant Labs Halo | Display, bone conduction, a sensor used only for AI, no recording LED, open source, $299 preorder (Aug 2025); $399 launch Oct 27, 2026 (unverified) | Open hardware, a later port |
| Google Android XR | Audio and display glasses (partners Samsung, Warby Parker, Gentle Monster (unverified); no ship date found); Jetpack Projected brings phone apps to glasses (May 2026); XREAL Aura with Gemini "share your view", $1,099 (Oct 28, 2026) | The phone-projected pattern again: the port after Nov 4 |
| Negotiation coaches | Haggle (iOS, Apr 2026: prep, "live hints" in Pro) and shoppers typing dealer numbers into ChatGPT (both unverified) | Nothing listens live and coaches a buyer |
| Scam protection on glasses | Nothing found on 2026-10-29; the only "glasses safety" apps detect glasses nearby (Nearby Glasses, Feb 2026 (unverified)); a 2026 elder-scam review lists field trials of real-time help as a gap (unverified) | Open ground |

## A scam whisperer is not a meeting copilot
- Silence is the default: it speaks on a risk or when asked; a copilot talks all meeting.
- It brakes, it does not win: stop, do not pay, ask Thomas; never a script against the other side.
- It knows her life (bank, carrier, orders, Ethan's number), not a deck; and it keeps nothing, no "infinite memory".
- It is announced (spoken notice, LED) where Cluely and Halo X sell discretion; its errors are lopsided (a miss costs savings, a false alarm costs trust), hence Be careful before Scam, guardrails and the family.

## Other ideas
1. "Say that again?": when she taps Ask, Thomas gets the visitor's exact words (two transcript lines, the ask in bold), not a summary. By Nov 4: Yes, the voice route already returns the transcript.
2. "Read it all": after a Look, the whole letter read aloud for low vision. By Nov 4: Yes, `extractFromImage` already returns the body.
3. Stop line on code asks: "Hang up. Never give a code." within a second when a code, PIN or safe account comes up, before Muse answers. By Nov 4: Yes, `codeAsk` and `moveMoney` exist (with the Idea "Show the detector verdict first").
4. The glasses as plain headphones for what exists: the web voice check and Read it to me play in the glasses. By Nov 4: Yes, a test not a build.
5. Doorstep script: "Leave me the offer in writing. I never decide on the day." whispered and shown big. By Nov 4: Yes, it is pressure-coach behavior 3 as the next step.
6. "Speak for me": "Prudence, pause" makes the phone's loudspeaker tell the visitor "I check every offer with my family. Please leave it in writing." By Nov 4: Yes, phone speech only (AI disclosure: see platform.md).
7. Cooling-off countdown: a photographed door-to-door contract starts a reminder (France 14 days, no payment for 7; US 3 business days). By Nov 4: Stretch, date logic with nothing to film.
8. Courier rule: "someone will come to collect your card, cash or gold" (EN/FR) becomes a Scam signal for texts, transcripts and Asks. By Nov 4: Yes, one detector rule and tests.
9. Badge check without faces: a photo of a badge, van or flyer; Prudence reads only the company name and gives the number from her own bills. By Nov 4: Stretch, brand-to-provider matching is new.
10. Price check: a quote, a price tag or a window sticker; Muse Spark with `web_search` says whether it is in the usual range, with sources. By Nov 4: Stretch, the Responses API is unused so far (shared with "Investigate").
11. Family word: on a "grandchild in trouble" story, "Ask him for the family word." By Nov 4: Stretch, it stores a secret and needs an onboarding step.
12. Gift-card guard: a photo of the cards plus "they told me to" gives Scam and "Do not read the numbers to anyone." By Nov 4: Yes, the `giftCard` rule exists.
13. HUD verdict on Meta Ray-Ban Display. By Nov 4: No, not in hand and the Mock Device Kit has no display.
14. Skimmer spotting at the ATM. By Nov 4: No, overlays rarely show in a photo and false alarms would teach her to ignore Prudence.
15. "Prudence Coach" for salary, rent, cars and meetings. By Nov 4: No, a general copilot blurs the senior-first story.

## Demo storyboard (20 s)
| Time | On screen | Heard | Narrator |
|---|---|---|---|
| 0:00-0:04 | Linda's front door. Linda, in Ray-Ban Meta glasses, taps Listen; the phone in her hand shows "Prudence is listening to help me. Nothing is kept." | The phone, quietly, says the same | "Linda turns Prudence on, and it says so out loud." |
| 0:04-0:09 | A man in a hi-vis vest (actor) | "Ma'am, the storm took shingles off your roof. My crew can fix it today: two thousand, cash, today only." | (silence) |
| 0:09-0:16 | Linda: "One moment." She taps the phone (or her temple); cut on the wait, caption "9 s later" (the measured time); close on her face, the whisper captioned; 3 s on the phone: amber card "Be careful: a stranger wants cash today for work you did not ask for", "Leave me a written quote" shown big, "Ask Thomas" | In her ear: "Do not pay cash today. Ask for a written quote." | "Her phone hears the pitch. Muse Voice Transcribe writes it down, Muse Spark judges it, and the advice comes in her ear." |
| 0:16-0:20 | Linda: "Leave me a written quote. My grandson will call you." He walks off | | "Nothing is kept, and nobody is identified." |

Caption: "Ray-Ban Meta as headphones · Muse Voice Transcribe · Muse Spark · every voice a consenting actor". Slot: a Nov 1 rehearsal swap for 1:47-2:05 (the same Muse Voice Transcribe credit, live instead of a voicemail file); count Ray-Ban Meta against the four-Meta-surface cap with the WhatsApp scene. Look insert if the hardware runs: 5 s at the kitchen table, the LED blinks on a "Medicare final notice", "This letter is not from Medicare. Do not call the number on it." (adds the Muse Spark vision credit). French take: Françoise and the bank courier.
Fallback without glasses: the same doorstep take with one Bluetooth earbud (the narration drops "Ray-Ban Meta"), and the letter through the phone camera on `/api/check/image` (Built), read aloud by the phone.

## Sources
- Repo, read 2026-10-29: `_product/research/detection-channels/meta-glasses-assistants.md`, `_product/research/glasses/platform.md`, `_product/research/feasibility.md` (#9-#12, #21), `_product/research/scam-market-stats.md`, `src/routes/mail.js`, `src/routes/devices.js`, `lib/muse.js`, `lib/detector.js`, `lib/brands.js`.
- https://www.meta.com/blog/ray-ban-meta-v11-software-update-live-ai-translation-shazam/ (Live AI, live translation, 2024-12-16) accessed 2026-10-29
- https://www.uploadvr.com/meta-glasses-get-conversation-focus-early-access/ ; https://www.engadget.com/2205660/meta-rate-limits-smart-glasses-conversation-focus-feature/ (Conversation Focus, caps) accessed 2026-10-29
- https://www.meta.com/help/ai-glasses/23879220601763496/ (Display captions, English only) ; https://www.meta.com/en-gb/help/ai-glasses/718045509827730/ (look and, call this number, scan this QR code, cloud) accessed 2026-10-29
- https://engadget.com/2173297/meta-is-bringing-third-party-apps-and-games-to-its-display-glasses (Display for developers, 2026-05-14) ; https://pasqualepillitteri.it/fr/news/18059/meta-ray-ban-display-france-899-euros-13-octobre (€899, search summary only) accessed 2026-10-29
- https://techcrunch.com/2026/02/13/meta-plans-to-add-facial-recognition-to-its-smart-glasses-report-claims/ (Name Tag) ; https://techcrunch.com/2025/08/20/harvard-dropouts-to-launch-always-on-ai-smart-glasses-that-listen-and-record-every-conversation (Halo X, I-XRAY) accessed 2026-10-29
- https://mentraglass.com/blogs/blog/mentra-roadmap-update-moving-to-miniapps-on-the-phone ; https://docs.mentraglass.com/mentra-live/overview ; https://github.com/Mentra-Community ; https://play.google.com/store/apps/details?id=com.mentra.mentra (not readable) accessed 2026-10-29
- https://en.wikipedia.org/wiki/Cluely (Cluely) accessed 2026-10-29
- https://roadtovr.com/brilliant-labs-halo-smart-glasses-price-release-date/ ; https://natlawreview.com/press-releases/brilliant-labs-launches-halo-glasses-new-generation-privacy-first (2026 launch, search summary only) accessed 2026-10-29
- https://android-developers.googleblog.com/2026/05/android-xr-sdk-developer-preview-4-updates.html ; https://blog.google/products-and-platforms/platforms/android/xreal-aura/ ; https://campustechnology.com/articles/2026/05/22/google-unveils-android-xr-smart-glasses-powered-by-gemini-ai.aspx (partners, search summary only) accessed 2026-10-29
- https://www.bemyeyes.com/be-my-eyes-smartglasses/ (search summary only) ; https://www.malwarebytes.com/blog/news/2026/02/developer-creates-app-to-detect-nearby-smart-glasses (search summary only) accessed 2026-10-29
- https://appgoblin.info/apps/6761693793 (Haggle) ; https://www.dealereprocess.com/?p=74664 (ChatGPT at dealers), both search summaries only, accessed 2026-10-29
- https://ic3.gov/PSA/2024/PSA240129 (couriers) ; https://www.quechoisir.org/conseils-arnaque-comment-reperer-un-faux-conseiller-bancaire-n116534/ ("votre banque ne vous enverra jamais de coursier", 2026-08-18) accessed 2026-10-29
- https://support.microsoft.com/en-us/help/4054905/avoid-and-report-microsoft-technical-support-scams ; https://www.consumer.ftc.gov/consumer-alerts/2018/03/new-medicare-cards-coming-soon ("It's yours for free") accessed 2026-10-29
- https://www.ftc.gov/legal-library/browse/rules/cooling-period-sales-made-home-or-other-locations ; https://www.service-public.gouv.fr/particuliers/vosdroits/F23224 (door-to-door) ; https://www.service-public.gouv.fr/particuliers/vosdroits/F33267 (phone canvassing) accessed 2026-10-29
- https://www.wxyz.com/news/fake-qr-code-stickers-found-on-ann-arbor-parking-meters-police-warn-drivers-of-scam (search summary only) ; https://www.mdpi.com/2078-2489/17/11/1065 (elder-scam review, 403, unverified) accessed 2026-10-29
