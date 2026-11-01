Keywords: glasses, dat, sdk, quickstart, android studio, camera access sample, mock device kit, wearables developer center, release channel, testing, mcp

# Glasses app: developer account, SDK quickstart, deploy and test
Vlad's ask of 2026-11-01 (new Ray-Ban Meta, probably Gen 3 Wayfarer): account, first app, deploy, test. Read at the source on 2026-11-01 (DAT docs, FAQ, both SDK repos cloned, Maven Central, issues #172, #149, #266). Reset, pairing and the Developer Mode taps are in `setup.md`; platform limits stay in `platform.md`.

## 1. What "deploying on the glasses" means
- Our code runs only on the phone: the toolkit "extends iOS and Android mobile apps" and "the Meta AI app must be used to pair your glasses" (FAQ). The phone app registers with Meta AI, gets its per-device permissions there and opens sessions to the glasses through it.
- The glasses get only Meta's own "Device Access Toolkit app": the Developer Center builds one per version from its name, icon and permissions ("Use a version with a release channel only after its Device Access Toolkit app finishes building"). Its installation "fails if the device battery is below 10%" (known issues), and `DAT_APP_ON_THE_GLASSES_UPDATE_REQUIRED` means "Direct the user to the App Connections page in the Meta AI app".
- No third-party code runs on Ray-Ban Meta or Oakley Meta. Only Meta Ray-Ban Display takes our content: the DAT display API, or Web Apps that "run directly on Meta Ray-Ban Display glasses".
- So deploying means installing the APK on the phone and registering it with Meta AI, in Developer Mode or through a release channel.

## 2. Do we need a developer account?
- Not on our own glasses. Developer Mode needs no account and no credentials (iOS sample: "Developer Mode needs no credentials"). On Android, Meta's debugging skill uses `mwdat_application_id = 0` and `mwdat_client_token = 0`; the sample falls back to empty strings, and its comment asks for Developer Center credentials only "Without Developer Mode". Developer Mode keeps one third-party app registered at a time (Oct 28 notes). The FAQ presents the account as being "ready the moment submissions open".
- It is needed for three things: voice launch ("Hey Meta, open ..."), the Beta release channel that reaches other people's glasses (Hadrien in Boston, testers), and production credentials. Those are the Wearables Application ID and token under the project's Configuration, which we "Copy and paste ... into your iOS or Android application build".
- Sign-up: sign in with vladztools@gmail.com, never a Dolead account, business portfolio or organization. First log out of developers.meta.com (known issue). Sign up at https://wearables.developer.meta.com/, which sends you to Managed Meta Account (MMA) setup on work.meta.com. There, one admin creates the organization ("Use your company's official name for the organization") and invites members, who create or link an MMA. Then log in to the Developer Center with the MMA, which opens on "a default personal team".
- Gmail as the admin address is not documented. The #172 reporter set up an MMA as "an individual freelancer/personal developer" for a personal project, and only the two-factor step failed. Organization name: "Prudence" (our choice; nothing documented forbids it for a two-person team without a company). If work.meta.com refuses a consumer address, stop and tell Hadrien; do not use another address.
- Two-factor is a mandatory Work Meta checkpoint. For new accounts it reloads into a blank white page (#172, open). Meta, Oct 14: a server-side problem; "retry the Wearables Developer Center signup in a fresh browser session" and post the time on #172 if it is still blank. Keep building in Developer Mode meanwhile.
- Project: New project (name, description). Product listing: app name and icon (PNG or JPEG, at most 200×200, separate dark and light icons allowed). Permissions tab: camera, microphone and voice invocation, each with a justification "for Meta's internal review only" (no review gate seen, Oct 29 notes).
- Version: Distribute > Versions > Create new version (Major, Minor or Patch), then wait for "Ready" on the Distribution dashboard (10-30 min, Oct 28-29 notes). Versions made before DAT 1.0 do not work with 1.0 builds.
- Beta channel: it is created automatically, one per integration, and carries one version at a time. Distribute > Release channels > Beta > View > Version tab > Edit > pick the version > Save changes. Then Users tab > + Invite users > the email of each tester's personal Meta account ("A Managed Meta Account is not supported") > Send invites. The tester accepts the email (or at https://wearables.meta.com/invites). The tester cap shows on the Users tab.
- What the tester taps: Meta AI app > device menu > Settings > Release Channel, check that our channel is selected (the default once the invite is accepted), Confirm. The tester also needs our app on the phone: the APK, or TestFlight on iOS.
- Developer Mode off for release-channel testing: the docs are silent, and the Setup page says Developer Mode "also enables testing via invite-only release channels". Community reports say to switch it off when testing our own Beta build and voice launch (unverified). Propagation time is undocumented; issue reports say new settings take over an hour (Oct 29 notes).

## 3. SDK status on 2026-11-01
- Latest: 1.0.1 of 2026-10-09 on both CHANGELOGs (Android: HEVC buffer corruption and stream stutter fixed; iOS: "No developer-facing changes") and on Maven Central (`maven-metadata.xml`: release 1.0.1, updated 2026-10-09). Nothing newer. Both READMEs still say "developer preview".
- Android: Maven Central `com.meta.wearable:mwdat-core`, `-camera`, `-display`, `-inputs`, `-motion`, `-mockdevice` and `-speech`; "no access token or extra repository definition is required", so no GitHub Packages token. The 1.0.1 AARs declare minSdk 29 (Android 10), add `BLUETOOTH` and `BLUETOOTH_CONNECT` to the app's manifest, and ship native libraries for arm64-v8a, armeabi-v7a, x86 and x86_64 (core AAR 9 MB).
- The docs ask for Android 10+, Android Studio Flamingo+ and Kotlin 2.2+ ("the toolkit is compiled with Kotlin 2.2"). The CameraAccess sample needs more: Android Studio Narwhal 2025.1.1+, JDK 17+, Android SDK 36, AGP 8.11.1, Kotlin 2.2.21, Gradle 8.14.1, compileSdk and targetSdk 36, minSdk 31 (an Android 12+ phone) and Java 17.
- SDK 1.0.1 pairs with Meta AI V292 (Android and iOS) and firmware V128 on every listed model. Gen 3 is named nowhere: not in Setup, not in the version table, not in the FAQ ("New SKUs of these devices are supported as they become available"). Meta says Gen 3 works and shows up as `RAYBAN_META_OPTICS` (#316, Oct 29 notes).
- iOS: the Swift package is https://github.com/facebook/meta-wearables-dat-ios (File > Add Package Dependencies, 1.0.1); it needs iOS 17.2+, Xcode 26.4+ and Swift 6.3+. The App Store rejects these apps until Meta authorizes the bundle ID on its MFi Product Plan, and Meta will not do that yet (#266, Aug 10; still blocked after 1.0 per the Oct 13 comments on #149). Development builds from Xcode to Vlad's own iPhone are how the sample runs, and for test cohorts Meta says "use TestFlight for Apple distribution" (#149, Jun 18).

## 4. Android quickstart (CameraAccess sample)
1. Install Android Studio Narwhal or newer and add Android SDK Platform 36 in SDK Manager. The phone needs Android 12+ and Meta AI V292+, and the glasses need firmware V128+, paired, with Developer Mode on (`setup.md`). Use the phone in a supported country; France is one (Oct 28 notes).
2. Clone outside scam-shield and set the Developer Mode values:
   ```bash
   mkdir -p ~/wrk/pers/glasses-lab && cd ~/wrk/pers/glasses-lab
   git clone --depth 1 https://github.com/meta/meta-wearables-dat-android
   cd meta-wearables-dat-android/samples/CameraAccess
   printf 'mwdat_application_id=0\nmwdat_client_token=0\n' >> local.properties
   ```
3. In Android Studio, Open `samples/CameraAccess` (not the repo root), then File > Sync Project with Gradle Files. The manifest already maps those values to `com.meta.wearable.mwdat.APPLICATION_ID` and `CLIENT_TOKEN`, and declares the callback scheme `cameraaccess`.
4. On the phone, Settings > About phone > tap Build number 7 times, turn on Developer options > USB debugging, plug in and accept the RSA prompt. Then:
   ```bash
   export JAVA_HOME="/Applications/Android Studio.app/Contents/jbr/Contents/Home" ANDROID_HOME="$HOME/Library/Android/sdk"
   export PATH="$ANDROID_HOME/platform-tools:$PATH"
   adb devices                      # must say "device", not "unauthorized"
   ./gradlew installDebug           # or Run > Run 'app' in Android Studio
   adb shell am start -n com.meta.wearable.dat.externalsampleapps.cameraaccess/.MainActivity
   ```
5. Tap Connect. Meta AI opens; approve, and it comes back through `cameraaccess://`. Registration reaches `REGISTERED`, and the app appears under Meta AI settings > App connections > Developer mode apps. In our own code, register from a `ComponentActivity` that stays open until Meta AI returns, and never call `startRegistration()` while `REGISTERED` (#223, #192, Oct 29 notes).
6. With the glasses on, unfolded and worn, tap Start Session and answer the Meta AI camera prompt with "Allow always". Tap Preview to start the stream, then the capture button. The photo opens in the sample's preview screen; Share writes it to the app cache (`cache/images`) through a FileProvider and opens the share sheet. The code never writes to the gallery.
7. Without glasses (debug builds only): tap the ladybug icon on the right > Enable MockDeviceKit (the sample registers itself; Meta AI is not needed) > close the sheet > debug menu > Pair Ray-Ban Meta. On the card, switch on Power and Donned (Donned also unfolds; Unfolded is its own toggle). In the camera source picker, choose Video file (H.265 only on Android), Front or Back camera (needs the phone's CAMERA permission), or Select image (the still a capture returns). Then Start session > Preview. Our Oct 28 "PowerOn, Unfold, Don" are the API calls, not the button labels. A clip for the mock (our command, not Meta's):
   ```bash
   ffmpeg -i letter.mp4 -c:v libx265 -tag:v hvc1 -an letter-h265.mp4 && adb push letter-h265.mp4 /sdcard/Download/
   ```
   The mock should also run on an emulator (an API 31+ arm64 image on the Mac): the AARs ship x86 and arm native libraries, and the sample's instrumentation tests mention emulators (unverified).
- iOS in five lines: (1) Xcode 26.4+, an iPhone on iOS 17.2+ with Meta AI installed and Developer Mode on. (2) `git clone --depth 1 https://github.com/meta/meta-wearables-dat-ios` into `~/wrk/pers/glasses-lab` and open `samples/CameraAccess/CameraAccess.xcodeproj`.
  (3) Under Signing & Capabilities, pick your Apple team and your own bundle identifier. Leave `META_APP_ID` and `CLIENT_TOKEN` empty for Developer Mode (they feed the Info.plist `MWDAT` keys `MetaAppID` and `ClientToken`, next to `AppLinkURLScheme` `cameraaccess://` and `TeamID`).
  (4) Turn on the iPhone's Settings > Privacy & Security > Developer Mode (unverified), then Cmd+R. The sample's Hotspot and Wi-Fi-info entitlements may need a paid Apple team (unverified).
  (5) The flow is the same as on Android: Connect, Start Session, Preview, capture. The mock uses the same ladybug sheet and converts videos itself. Sending the app to the background ends the session.

## 5. Testing and debugging
- Logs: `adb logcat -v time --pid=$(adb shell pidof -s com.meta.wearable.dat.externalsampleapps.cameraaccess)` (the SDK is a library inside the app). The sample's tags are `CameraAccessMain`, `CameraAccess:CameraViewModel`, `MockDeviceKitViewModel`, `StreamingService`, `HevcDecoder` and `VideoCaptureHandler`. Meta's skill logs typed `DatResult` failures under `DATWearables`. The SDK's internal tags are undocumented.
- States: registration `UNAVAILABLE`, `REGISTERING`, `REGISTERED`, `UNREGISTERING`. Session `IDLE` > `STARTING` > `STARTED` > `PAUSED` > `STOPPING` > `STOPPED`; add the camera only at `STARTED` (earlier gives `SESSION_IDLE`), and `STOPPED` is terminal, so create a new session. Stream `STARTING` > `STARTED` > `STREAMING`, `PAUSED` on a temple tap, `CLOSED` terminal. `capturePhoto()` works only while `STREAMING`.
- `CAPABILITY_DENIED`: Meta gates some capabilities per user on its servers; this is routine, so show a fallback (Oct 29 notes).
- `INSUFFICIENT_SDK_VERSION` is terminal: rebuild on the current SDK.
- `DAT_APP_ON_THE_GLASSES_UPDATE_REQUIRED`: update from Meta AI > App Connections (the sample has "Update firmware" on Android and "Update app on glasses" on iOS). `DWA_OUT_OF_STU_RANGE` is only a warning.
- `SETUP_FAILED` (standalone photo start): retry once. `DEVICE_HEALTH_CRITICAL` is a capture error (Oct 28 notes); charging or cooling the glasses may clear it (unverified). There are also `STREAM_ERROR` and `CRITICAL_STREAM_ERROR`.
- Session never reaches `STARTED`: check registration and `Wearables.devices`, that the glasses are powered, unfolded and in range, and that Developer Mode is on. No camera after the V128 update: reboot the glasses (known issue).
- First hardware checks: the stream's size and rate (HIGH is 720×1280 at up to 30 fps, and it drops toward 15 fps, never lower, on a weak link: Oct 28 notes). Time the first frame after Preview (2-4 s, #356) and tap-to-photo (0.7-3 s, #260; both Oct 29 notes) with logcat timestamps. Hold a printed letter in 11-12 pt at 30, 45 and 60 cm and check every line in the photo on the phone, by a window and under kitchen light.
- Recover, in this order (Oct 29 notes):
  1. Toggle Developer Mode off and on, then force-stop Meta AI.
  2. In code, `startUnregistration()` then one `startRegistration()`, or one `Wearables.reset()` + `initialize()` (#192).
  3. Run `adb shell pm clear com.meta.wearable.dat.externalsampleapps.cameraaccess` and Connect again.
  4. Reinstall the DAT app on the glasses from App info (#214).
  5. Restart the glasses; on release 129 they also need a restart after an SCO link ends a session (#192, #206).

## 6. Working with Claude Code
- Meta documents the plugin, not a bare MCP line. Vlad runs these in his own terminal, best from `~/wrk/pers/glasses-lab`:
  ```bash
  claude plugin marketplace add meta/meta-wearables-dat-android
  claude plugin install mwdat-android@mwdat-android-marketplace
  # iOS: claude plugin marketplace add meta/meta-wearables-dat-ios ; claude plugin install mwdat-ios@mwdat-ios-marketplace
  ```
- The plugin adds 17 skills: setup, camera streaming and capture, session lifecycle, permissions and registration, MockDeviceKit testing, debugging, live debugging, voice invocations, speech, display, inputs, motion, audio, the sample guide, conventions and the docs MCP.
- It also connects the remote HTTP server `wearables` at https://mcp.developer.meta.com/wearables ("No separate MCP configuration is required"). Its tools are `search_dat_docs` and `search_webapps_docs`, 5 sections per search (`max_results` up to 10), and "Docs search doesn't need a token". Check that the plugin and `search_dat_docs` appear; if they do not, open a new session. The README still says `facebook/meta-wearables-dat-android`; the repo has moved to meta/, and both resolve.
- MCP only, without the plugin: `claude mcp add --transport http wearables https://mcp.developer.meta.com/wearables` is standard Claude Code syntax but appears nowhere on Meta's pages; Meta gives only the Cursor JSON (`"type": "http"` and that URL).
- `AGENTS.md` at each repo root is the portable fallback ("If your session was already running"), and `./install-skills.sh agents` copies it into a project. `samples/CameraAccess/.claude/settings.json` already gives Claude the sample's context. The live-debugging skill expects a local "DAT Inspector" MCP server, and none of the pages read explain how to set it up.

## 7. Path into our companion
- What DAT forces on `android/`:
  - minSdk goes from 26 to 29 (the AARs declare 29). Android 8-9 phones drop out, unless DAT lives in a `glasses` product flavor with its own minSdk 29 (unverified).
  - Kotlin goes from 2.1.0 to 2.2.x, and the Compose compiler plugin moves to the same version. Java 17 stays.
  - AGP 8.7.3 and compileSdk 35 can probably stay: the core AAR declares no minimum in AAR metadata, and the sample's AGP 8.11.1 and SDK 36 are its own choice. Whether Kotlin 2.2 supports AGP 8.7.3 and Gradle 8.11.1 is unverified.
  - The app must request `BLUETOOTH_CONNECT` at runtime on Android 12+. It needs the manifest placeholders, the two meta-data entries and a callback scheme (for example `prudence`) on the registering activity. The APK gains the native libraries.
- CI risk: the "Android debug APK" job runs `assembleDebug testDebugUnitTest` on JDK 17 at every push to main. The Kotlin bump can break the existing code's build, and a flavor doubles the build. Make the bump on a branch and run the same command locally before it reaches main.
- Order:
  1. The official sample in `~/wrk/pers/glasses-lab`, outside scam-shield: the mock first, then the real glasses with the section 5 measurements.
  2. `_product/specs/glasses-companion.md` moves from Idea. Hadrien decided on Oct 31 that the Nov 4 video has no glasses scene, so this comes after the video unless he reopens it.
  3. Only then a `glasses` package in the companion, claimed in `_product/log.md`. Installing the companion replaces the sample's Developer Mode registration.

## Gaps
- Whether work.meta.com accepts a gmail address for the MMA admin, and what "your company's official name" means for two people without a company.
- Whether Developer Mode must be off to test our own Beta build, and how long a new version or setting takes to reach the glasses.
- The tester cap per release channel, visible only on the Users tab after sign-in.
- Gen 3 in Meta's docs: absent from the FAQ, Setup and the version tables; Meta's #316 answer comes from the Oct 29 notes.
- Whether the Mock Device Kit runs on the emulator (inferred, not documented), and how to set up the local DAT Inspector MCP.
- Kotlin 2.2 on AGP 8.7.3 and Gradle 8.11.1, and DAT's transitive dependencies (its POM was not read in full).
- On iOS, whether a free Apple team can sign the sample with its entitlements; on Android, the SDK's own logcat tags.

## Sources
- DAT docs via the llms.txt index (Setup `getting-started-toolkit`, `groups/ai-assisted-development`, `ai-assisted-claude-code`, `ai-assisted-mcp`, `groups/manage-distribution`, `onboarding-and-organization-management`, `manage-projects`, `set-up-release-channels`): https://wearables.developer.meta.com/llms.txt?product=all&version=1.0&document=products/dat/sections/guides — accessed 2026-11-01
- Mock Device Kit, version dependencies, known issues: https://wearables.developer.meta.com/docs/develop/dat/mock-device-kit/ ; https://wearables.developer.meta.com/docs/version-dependencies/ ; https://wearables.developer.meta.com/docs/knownissues — accessed 2026-11-01
- FAQ: https://developers.meta.com/wearables/faq/ — accessed 2026-11-01
- Android SDK, cloned (README, CHANGELOG, `samples/CameraAccess` build files, manifest, sources and strings, `plugins/mwdat-android` skills and MCP config, `install-skills.sh`): https://github.com/meta/meta-wearables-dat-android — accessed 2026-11-01
- iOS SDK, cloned (README, CHANGELOG, `samples/CameraAccess` README, Info.plist and entitlements, AGENTS.md, getting-started skill): https://github.com/facebook/meta-wearables-dat-ios — accessed 2026-11-01
- Maven Central metadata and the 1.0.1 AARs (minSdk, ABIs, permissions): https://repo1.maven.org/maven2/com/meta/wearable/mwdat-core/maven-metadata.xml ; https://repo1.maven.org/maven2/com/meta/wearable/ — accessed 2026-11-01
- Issues: https://github.com/meta/meta-wearables-dat-android/issues/172 ; https://github.com/facebook/meta-wearables-dat-ios/issues/149 ; https://github.com/facebook/meta-wearables-dat-ios/issues/266 — accessed 2026-11-01
- Repo: `_product/research/detection-channels/meta-glasses-assistants.md` (Oct 28), `_product/research/glasses/platform.md` (Oct 29; issues #192, #206, #214, #223, #260, #316, #356), `android/app/build.gradle.kts`, `android/build.gradle.kts`, `android/app/src/main/AndroidManifest.xml`, `.github/workflows/ci.yml`, `_product/specs/glasses-companion.md` — read 2026-11-01
