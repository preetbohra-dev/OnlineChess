# The iPhone and Android apps

Both apps are [Capacitor](https://capacitorjs.com) shells around the same files as the website.
They carry `public/` inside the app (so everything except accounts, online play, reminders and
the weekly challenge works offline) and talk to `https://chess.solankidigitaldrafts.com` for the
rest, signing in with a bearer token (see `server/api.js`).

| | |
|---|---|
| App id | `com.solankidigitaldrafts.chess` (`capacitor.config.json`, `server/app-links.js`) |
| App files | `build/app-www/`, built by `scripts/app-www.mjs` from `public/` (not committed) |
| Android project | `android/` (Gradle) |
| iPhone project | `ios/App/App.xcodeproj` (Swift Package Manager) |
| Icons and splash | `scripts/app-icons.mjs` renders them into both projects |

## Building

After any change in `public/`:

```sh
npm run app:sync          # build/app-www, then copy it and the plugins into android/ and ios/
```

Android (needs Java 21 and the Android SDK; on this Mac: `brew install openjdk@21` and
`brew install --cask android-commandlinetools`, then `sdkmanager "platform-tools" "platforms;android-36" "build-tools;36.0.0"`):

```sh
export JAVA_HOME=/opt/homebrew/opt/openjdk@21 ANDROID_HOME=/opt/homebrew/share/android-commandlinetools
(cd android && ./gradlew assembleDebug)   # android/app/build/outputs/apk/debug/app-debug.apk
```

iPhone (needs Xcode): open `ios/App/App.xcodeproj` in Xcode, or for the simulator:

```sh
xcodebuild -project ios/App/App.xcodeproj -scheme App -destination 'generic/platform=iOS Simulator' CODE_SIGNING_ALLOWED=NO build
```

## Release build (Google Play)

The upload key lives outside the repository, in `~/.jodhpur-studio/secrets/`:

- `onlinechess-upload.jks`: the key store (alias `upload`)
- `onlinechess-upload.properties`: `storeFile`, `storePassword`, `keyAlias`, `keyPassword`

Keep a copy of both somewhere safe, such as a password manager. With Play App Signing,
Google signs the app for users, so a lost upload key can be reset in Play Console, but only
after a support request and a wait. `android/app/build.gradle` reads the properties file, or
the file named by `ANDROID_UPLOAD_PROPERTIES`, and signs the release with it.

```sh
npm run app:sync
(cd android && ./gradlew bundleRelease)   # android/app/build/outputs/bundle/release/app-release.aab
```

Raise `versionCode` (and `versionName`) in `android/app/build.gradle` for every upload.

## Inside the app

- `public/js/net/platform.js` tells the code it runs in an app (`isNativeApp()`), and points
  server calls, online play and shared links at the public site.
- `public/js/net/native.js` uses the plugins: haptics on moves, the share sheet, the Android back
  button, the splash screen and the status bar colour.
- The service worker, the install offer and Web Push reminders are off inside the apps.
- The app pages get their Content Security Policy from a `<meta>` tag added by `scripts/app-www.mjs`.

## Links that open the app

Android App Links and iOS Universal Links need values from the store accounts. Set them on the
live server and restart it:

- `ANDROID_CERT_SHA256`: the SHA-256 fingerprint of the app-signing certificate (Play Console →
  App integrity), comma-separated if there are several.
- `APPLE_TEAM_ID`: the 10-character team id (Apple Developer → Membership). The iPhone app also
  needs the Associated Domains capability `applinks:chess.solankidigitaldrafts.com`, added in Xcode
  once the project is signed with that team (store packaging, slice 26). Until then links open
  the website on iPhone.
- Android backups are off (`allowBackup="false"`): the app storage holds the sign-in token.
  Progress is kept by signing in, which syncs it to the account.
