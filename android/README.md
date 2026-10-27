# Scam Shield — Android SMS companion

A sideloaded Android app that watches incoming texts for the senior. Texts that look risky are checked by the Scam Shield server, and the senior sees one big, plain-language verdict screen they can act on.

- **Privacy:** an on-device pre-screen decides what leaves the phone. Only texts with a link (`https://…` or a bare domain like `usps-redeliver.top`) or a risk pattern (urgency, gift cards, crypto, code request, money request, "new number") are sent to the server. Every other text stays on the phone.
- **Verdict screen:** headline ≥ 28sp, body ≥ 20sp, buttons 72dp, and one decision per screen. Red = scam, amber = be careful, green = safe. Actions: "Read it to me" (TextToSpeech at rate 0.9, French or US English), "Ask my trusted person" (then `/answers` is polled every 10 s), and OK.
- **Offline:** if the server is unreachable (or the phone is not paired), a local warning is shown instead: *"This text has warning signs. Don't tap any link. Ask someone you trust."* / *"Ce SMS présente des signes d'arnaque. N'appuyez sur aucun lien. Demandez à un proche."*
- **Languages:** EN and FR (`res/values`, `res/values-fr`). The Verdict screen follows `verdict.language`.

App id `com.scamshield.companion`, minSdk 26, target/compile SDK 35, Kotlin 2.1, Compose + Material 3, AGP 8.7.3, Gradle 8.11.1 (wrapper).

## Layout

```
app/src/main/java/com/scamshield/companion/
  prescreen/PreScreener.kt   PreScreener interface + RegexPreScreener (swap in an on-device model via PreScreeners.current)
  sms/SmsReceiver.kt         SMS_RECEIVED receiver, joins multipart PDUs, runs the pre-screen
  sms/CheckSmsWorker.kt      WorkManager job: POST /check off the main thread, notify or fall back
  net/ApiClient.kt           HttpURLConnection + org.json client for the 4 device endpoints
  net/Models.kt              contract models + parsers, QR payload parsing
  data/Session.kt            server + device token (token AES-GCM-encrypted with an Android Keystore key)
  data/CheckStore.kt         last 20 checks, so a notification can reopen its verdict
  notify/Notifier.kt         "Scam alerts" channel (high importance), neutral lock-screen version
  MainActivity.kt            pairing / home (permissions, last warning, disconnect)
  VerdictActivity.kt         verdict, read aloud, ask trusted person, answers polling
app/src/test/...             JUnit: pre-screen (EN/FR) + API JSON contract
app/src/debug/res/xml/network_security_config.xml   cleartext allowed (debug only)
app/src/main/res/xml/network_security_config.xml    cleartext forbidden (release)
tools/mock-server.mjs        zero-dependency Node 22 mock of the device API
```

## One-time setup (macOS, Apple Silicon, no sudo)

```bash
brew install openjdk@17 gradle
brew install --cask android-commandlinetools

export JAVA_HOME=/opt/homebrew/opt/openjdk@17
export ANDROID_HOME=/opt/homebrew/share/android-commandlinetools
export PATH="$JAVA_HOME/bin:$ANDROID_HOME/platform-tools:$ANDROID_HOME/emulator:$PATH"

yes | sdkmanager --sdk_root=$ANDROID_HOME --licenses
sdkmanager --sdk_root=$ANDROID_HOME "platform-tools" "platforms;android-35" "build-tools;35.0.0" \
  "emulator" "system-images;android-35;google_apis;arm64-v8a"

# Tell Gradle where the SDK is (this file is gitignored)
echo "sdk.dir=$ANDROID_HOME" > android/local.properties

# Emulator (the devices.xml error it prints is harmless)
echo no | avdmanager create avd -n scamshield35 -k "system-images;android-35;google_apis;arm64-v8a" -d pixel_6
```

Disk usage: about 5.7 GB SDK (3.8 GB of it the system image), 1.8 GB AVD, 1.2 GB Gradle cache, and 0.5 GB JDK + Gradle.

## Build and test

```bash
cd android
./gradlew test            # 33 JUnit tests: pre-screen EN/FR + API contract parsing
./gradlew assembleDebug   # -> app/build/outputs/apk/debug/app-debug.apk
```

`assembleRelease` builds an unsigned APK that forbids cleartext HTTP. Signing is not configured.

## Run end to end on the emulator

```bash
# 1. Mock device API (binds 127.0.0.1; uses 3000, or 3999 if 3000 is taken, e.g. by the real server)
node android/tools/mock-server.mjs          # prints the port; pairing code TEST1234

# 2. Headless emulator
emulator -avd scamshield35 -no-window -no-audio -no-boot-anim &
adb wait-for-device shell 'while [ "$(getprop sys.boot_completed)" != "1" ]; do sleep 2; done'

# 3. Install + grant permissions
adb install -r android/app/build/outputs/apk/debug/app-debug.apk
adb shell pm grant com.scamshield.companion android.permission.RECEIVE_SMS
adb shell pm grant com.scamshield.companion android.permission.POST_NOTIFICATIONS

# 4. Pair. Debug builds accept an auto-pair hook (ignored in release, BuildConfig.DEBUG):
adb shell am start -n com.scamshield.companion/.MainActivity \
  --es debug_server http://10.0.2.2:3999 --es debug_code TEST1234
#    ...or use the UI: type the code in "Pairing code", check "Server address", tap Connect.

# 5. Send a scam text and check the alert
adb emu sms send 5551234 'USPS: package on hold, pay $1.99 https://usps-redeliver.test'
adb shell dumpsys notification --noredact | grep -i scam
adb exec-out screencap -p > android/tools/screenshot-verdict.png

# 6. Clean up
adb emu kill
```

`10.0.2.2` is the Mac's localhost as seen from the emulator. For the real server use `http://10.0.2.2:3000`, which is the default in the pairing screen.

Mock-only helpers: `POST /__mock/revoke` (next device call gets 401, and the app returns to pairing), `POST /__mock/answer {"checkId","answer"}`, and `GET /__mock/log`. After `/ask`, "Thomas" answers `scam` automatically after 5 s (`ANSWER_DELAY_MS`). Texts containing `safe-example` get a `safe` verdict.

Handy logs: `adb logcat -s ScamShield ScamShieldSms ScamShieldCheck ScamShieldVerdict`. Message bodies are never logged.

## Server contract used (unchanged)

| Call | Auth | Body / query | 200 response |
|---|---|---|---|
| `POST /api/devices/pair` | none | `{"code","name"}` | `{"token","userName","locale"}` (400 `{"error"}`) |
| `POST /api/devices/check` | Bearer | `{"from","body","receivedAt"}` | `{"checkId","verdict":{…},"guardians":[{"id","name"}]}` |
| `POST /api/devices/ask` | Bearer | `{"checkId"}` | `{"sentTo":[…]}` |
| `GET /api/devices/answers` | Bearer | `?since=<ISO>` | `{"answers":[{"checkId","guardianName","answer","answeredAt"}]}` |

Any 401 clears the token and returns to the pairing screen. A `safe` verdict produces no notification. `receivedAt` is the phone's clock when the text arrived, in UTC with second precision (the SMS centre timestamp is unreliable). `since` is the check's `receivedAt` minus one day, and answers are filtered by `checkId` on the phone.

## Notes and limits

- Sideload only. `RECEIVE_SMS` is a restricted permission on Play, which is not a target here.
- QR pairing uses `zxing-android-embedded` with payload `{"v":1,"server":"…","code":"…"}`. Pasting that JSON into the code field also works. QR scanning was not exercised on the headless emulator.
- The regex pre-screen ports the server patterns and adds the French past tense `chang[eé] de num[eé]ro` to `newNumber`. Bare domains are matched against a TLD allow-list, so "thanks.me"-style typos do not ship harmless texts.
- Messages queued for a check sit briefly in WorkManager's private database. Backups and device transfer exclude the session, checks and that database.
