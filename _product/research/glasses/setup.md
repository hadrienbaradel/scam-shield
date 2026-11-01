Keywords: glasses, setup, factory reset, pairing, meta ai app, meta account, firmware, developer mode, bluetooth headphones

# Glasses setup: from the box to Developer Mode
Vlad's pair (most likely a Ray-Ban Meta Gen 3 Wayfarer, clear lenses, from Boulanger) came already paired to another account. This takes it to the Meta account of vladztools@gmail.com, current firmware and Developer Mode. Checked 2026-11-01 against Meta's help pages (served in French; English labels are translations, French in brackets), the DAT 1.0 docs and both SDK issue trackers. It extends `platform.md` section 1 (Oct 29).

## 1. Which pair is it
- The box names the line, generation and style, for example "Ray-Ban Meta Gen 3 Wayfarer". Keep the box and the receipt for the 15-day return (unverified).
- Firmware: Meta AI app > Devices tab (glasses icon at the bottom) > the glasses > gear (Device settings) > General > About > Version (DAT setup page). Meta's help pages reach Device settings through "Glasses" (Lunettes) at the top right instead; the layout differs by app version.
- The toolkit reports a Gen 3 as `RAYBAN_META_OPTICS` (Meta, Android #316). The DAT setup page and the FAQ still list only Gen 1 and Gen 2, plus "New SKUs of these devices are supported as they become available" (FAQ).
- The name the Meta AI app shows for a Gen 3 is not documented (unverified).

## 2. Factory reset
- Meta's steps cover every Ray-Ban Meta and Oakley Meta, Gen 2, Gen 3 and HSTN alike. Only Meta Ray-Ban Display resets differently.
  1. Take the glasses out of the case. They must be charged and switched on (switch on the left arm, slid toward the front).
  2. Fold both arms.
  3. Arms folded, press the capture button five times. The LED turns orange.
  4. Press and hold the capture button. Release it when the LED flashes.
- Meta gives no hold time, no final LED colour and no success message; third-party guides disagree on the colour (unverified). Sign it worked: back in the case, the case LED blinks blue for pairing and the app offers the pair as new (unverified).
- A reset deletes every photo and video on the glasses and restores the original settings. The pair must then be paired again in the Meta AI app.
- The charging case has its own reset, only if it misbehaves: glasses out, hold the button on the back of the case for more than 16 seconds.
- Old account: Meta says only that glasses paired to another account need a factory reset before anyone else pairs them. If the old owner's phone is at hand, unpair there first: Glasses > Device settings > the glasses > General > Unpair glasses > Unpair, then "Forget" in Bluetooth. Whether a reset alone also clears the old account's server-side link is not documented (unverified).
- Before any return (Boulanger allows 15 days): unpair in our app, factory reset, check the blue blink.

## 3. Pairing to the right account
- Install or update the Meta AI app from Google Play or the App Store. The toolkit needs Meta AI V292 or later on both platforms.
- The glasses need a Meta account. The app creates one from an email address, an Instagram account or a Facebook account. Email is a route of its own; Facebook or Instagram can be linked later in Accounts Center, which Meta is renaming "Meta Account". One Meta account per email, age 13 or more, password of 8 or more characters, real name optional.
- Sign in with the Meta account of vladztools@gmail.com. If none exists, create it in the app by the email route with that address. If the app says the address already has an account, sign in instead. Never use Facebook, Instagram or another address.
- Messenger calls and Instagram sharing need a Facebook or Instagram account; the demo needs neither (unverified).
- Android: location services must be on (Meta). Allow Bluetooth ("Nearby devices"), location and notifications when asked (unverified).
- Pairing (Meta): glasses out of the case, switch on, back into the case pressing gently on top so the bridge touches the charging contact. The case LED blinking blue means pairing mode; if it does not start, hold the button on the back of the case for at least 5 seconds. In the app: Glasses (Lunettes, top right) > Add (Ajouter, top right), then follow the screens.
- Firmware: installing updates needs Wi-Fi (Meta). Approve the update the app offers during setup and leave the glasses in the case until it ends (unverified). Meta gives no battery level or duration: keep the case on a charger, plan 20-40 minutes (unverified).
- Later updates: Glasses > Device settings > the glasses > Update (Mise à jour): an "Automatic updates" toggle and a "Check" button (Meta).
- Versions: the Meta AI app version sits under Settings > App Info; the glasses version under General > About > Version. The version-dependencies page (Nov 1) still says SDK 1.0.1 = Meta AI V292 and glasses V128 on every model, 1.0.0 = V290 / V128; no newer SDK or minimum. Field versions on Oct 30: Meta AI 296.2.0.26.165 (Android), glasses releases 129.0.1.23.378 and 131.0.0.0.0 (Android #227). Meta's public release notes stop at "v26" (June 29, 2026), another numbering than the 12x release in About.
- Settings for later: Developer Mode under Settings > App Info (section 4); App connections > Developer mode apps lists our app; camera access is granted per app, then confirmed per pair with "Allow once" or "Allow always" (Oct 28 notes); "Hey Meta" and media import are in Device settings (unverified). LED meanings: Glasses > "See all" next to "Learn and explore" > Gestures and LEDs > Notification LED.
- Before filming: the capture LED blinks briefly for a photo and keeps blinking during a video; covering or tampering with it disables the camera (Meta privacy page). Since April 2025 voice interactions are stored by default, with no opt-out of storage, and can be deleted in the app's privacy settings (unverified).

## 4. Developer Mode
- Taps (DAT setup page, Nov 1, same on Android and iOS): Meta AI app > Settings > App Info > tap the App version number five times > switch Developer Mode on > Enable. After its first registration our app appears under Meta AI settings > App connections > Developer mode apps.
- Oct 28 notes add: one third-party app registered at a time, the mode belongs to each linked pair, app or firmware updates can clear it. The setup page read Nov 1 says none of this.
- "Error opening link" (Meta AI 294, Android #214): no new report on the first page of recently updated Android issues (Nov 1). The platform.md workaround stands: toggle off and on, reinstall the glasses' DAT app from App info, force-stop Meta AI, clear our app's storage. #227 (Oct 30) runs Developer Mode sessions on Meta AI 296.2.0.26.165 with release 129.
- Missing iOS toggle (#310, #325; server fix Oct 6): no new report on the iOS tracker's first page. If it is missing, update the app and retry later.
- Release 129 ends a DAT session whenever the glasses see a call, an HFP/SCO link included (#192, #206). Meta, Oct 20 (iOS #332): a firmware update that "turns off the rule ending DAT sessions during a call" is "now rolling out to Ray-Ban Meta", gradually; the release "will move past 129.0.0.197.378"; no app or SDK change needed. #206 is still open (last activity Oct 16). Nobody has yet confirmed HFP and a DAT session coexisting on the new release (unverified).
- New since Oct 29: on release 131.0.0.0.0 every DAT 1.0.0 camera session ends with SESSION_ENDED_BY_DEVICE while starting, HFP off; the same build works on 129.0.1.23.378; no Meta reply (Android #227, Oct 30). Our companion uses 1.0.1, untested on 131 (unverified). iOS #356 (Oct 22): a Gen 2 on 129.0.1.23.378 reaches streaming but gets no video frames.
- After any glasses update, restart them (switch off, then on) before testing: the v128 update broke capture until a reboot (platform.md). A restart keeps the pairing and unimported media (unverified).
- Once the first DAT loop works, switch "Automatic updates" off until Nov 4 so no release lands between rehearsal and recording. If 131 arrives and sessions die, film the phone-camera fallback.

## 5. The glasses as plain Bluetooth headphones
- Meta: even when the glasses are not paired to the Meta AI app, they play audio from a phone connected by Bluetooth. The "Forget" step of Meta's unpair page shows that app pairing also adds them to the phone's Bluetooth list.
- The speaker is plain A2DP stereo; the DAT docs list "Music, media playback, TTS" (Oct 28 notes). So media audio and text-to-speech from any app play through the glasses on Android and iOS, with no toolkit and no Developer Mode: enough for "Listen".
- No Meta setting to switch. Android: in the glasses' Bluetooth details, "Media audio" stays on (unverified). iOS: the output picker in Control Center shows the glasses (unverified).
- Limits: opening the glasses' microphone (HFP) drops output to mono call quality (platform.md); during a DAT camera stream the glasses pause app audio (Meta, iOS #358).
- One-minute test: play a podcast or a YouTube clip and hear it in the glasses, not the phone. Then Android: Settings > Accessibility > Text-to-speech output > Play; iOS: Settings > Accessibility > Spoken Content > Speak Selection on, select a text, Speak (both paths unverified).

## 6. Checklist: from box to Developer Mode
1. Glasses in the case, case on a USB-C charger; read the box label (5 min).
2. If the old owner's phone is at hand: unpair there, "Forget" in Bluetooth (3 min).
3. Factory reset: on, arms folded, five presses (orange), hold until it flashes (2 min).
4. Install or update the Meta AI app; App version 292 or later (3 min).
5. Sign in with the Meta account of vladztools@gmail.com, or create it by the email route (5 min).
6. Android: location on; allow Nearby devices and notifications (1 min).
7. Pair: switch on, back in the case, blue blink, Glasses > Add (5 min).
8. Accept the firmware update on Wi-Fi, glasses in the case (20-40 min, unverified).
9. Restart the glasses; General > About > Version 128 or later; note the release string (2 min).
10. Developer Mode: Settings > App Info > five taps on App version > on > Enable (1 min); headphones test of section 5 (1 min); "Automatic updates" off after the first working DAT run.
Total: about 50-70 minutes, most of it the update.

## Sources
- Meta help: factory reset https://www.meta.com/help/ai-glasses/814846737027479/ ; pair and unpair https://www.meta.com/help/ai-glasses/268269592726432/ ; Meta account https://www.meta.com/help/ai-glasses/268464909446763/ ; update https://www.meta.com/help/ai-glasses/3487248634876136/ ; how to use (Bluetooth audio, location, Wi-Fi) https://www.meta.com/help/ai-glasses/289032793766239/ ; notification LED https://www.meta.com/help/ai-glasses/757215899749677/ ; release notes https://www.meta.com/help/ai-glasses/1809764829519902/ ; getting started https://www.meta.com/help/ai-glasses/152708087872544/ ; privacy https://www.meta.com/gb/ai-glasses/privacy/ — accessed 2026-11-01
- DAT: guides index https://wearables.developer.meta.com/llms.txt?product=all&version=1.0&document=products/dat/sections/guides ; setup https://wearables.developer.meta.com/llms.txt?product=all&version=1.0&document=products/dat/sections/guides/getting-started-toolkit ; versions https://wearables.developer.meta.com/docs/develop/dat/version-dependencies/ ; FAQ https://developers.meta.com/wearables/faq — accessed 2026-11-01
- Trackers: https://github.com/meta/meta-wearables-dat-android/issues (sorted by update) ; https://github.com/meta/meta-wearables-dat-android/issues/227 ; https://github.com/facebook/meta-wearables-dat-ios/issues (sorted by update) ; https://github.com/facebook/meta-wearables-dat-ios/issues/332 — accessed 2026-11-01
- Search snippets only (unverified: reset colours, restart, social features, account rename): https://www.framesandfeatures.com/how-to/factory-reset-meta-glasses/ ; https://www.meta.com/help/ai-glasses/905490264519056/ ; https://www.meta.com/ai-glasses/social/ ; https://petapixel.com/2026/04/24/meta-announces-one-login-for-facebook-instagram-and-ai-smart-glasses/ — accessed 2026-11-01
