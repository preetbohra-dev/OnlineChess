# OnlineChess — Plan 3: iPhone and Android apps

Follows Plan 2 (`docs/PLAN-2.md`, slices 11–20) and the declutter (#5, #6). Same pipeline: TDD
per slice, code review (plus security review where marked), evaluator scoring (pass 7.0), Gate 2
before each commit. Work happens on `feat/apps`, merged to `main` by PR; the live site deploys
from `main`.

## 1. Goal

OnlineChess in the App Store and the Google Play Store, built from the same code as the website,
working offline for everything that does not need the server (computer opponents, puzzles,
lessons, openings, review), and passing both stores' review on the first or second try.

## 2. Locked decisions (user, 2026-10-13)

- **Capacitor for both apps** (MIT licence, compatible with GPL-3.0). The app ships the files in
  `public/` inside the app; it talks to `https://chess.solankidigitaldrafts.com` only for
  accounts, sync, online play, reminders and the weekly challenge.
- **Source code goes public before launch.** Stockfish is GPL-3.0, and the App Store's terms add
  restrictions the GPL does not allow unless the full source is offered openly. The repo becomes
  public just before the first store submission, after slice 21 removes the one secret it holds.
- **Build tools:** the user installs Xcode (Mac App Store, Apple ID). Java 21 (`openjdk@21`) and
  Google's Android command-line tools are installed with Homebrew. Installing the Android SDK
  packages requires accepting Google's SDK licence: the user accepts it (or tells Claude to).

## 3. What the stores require (and how we meet it)

| Requirement | Store | How |
|---|---|---|
| Not "just a website" (App Review 4.2) | Apple | Bundled app, works offline, haptics, native share sheet, native reminders |
| Delete your account inside the app | both | New "Delete account" in Profile (slice 22) |
| Privacy policy URL, support URL | both | `/privacy` and `/support` pages (slice 22) |
| Report / hide offensive usernames (UGC, guideline 1.2) | Apple | Username filter at sign-up, "Report" on the leaderboard, admin hide (slice 22) |
| Privacy labels / Data safety form | both | Drafted in `docs/STORE.md` from what the code actually collects (slice 26) |
| 12 testers for 14 days before production | Google (new personal accounts) | Closed test track as soon as slice 24 builds |
| Sign in with Apple | Apple | Not required: we offer no third-party sign-in |
| Payments | both | None |

## 4. Slices

| # | Slice | Size | Security review |
|---|---|---|---|
| 21 | Weekly pool out of the repo; repo ready to publish | S | yes |
| 22 | Store pages and safety: privacy, support, delete account, report usernames | M | yes |
| 23 | App sign-in and API access from the apps (tokens, CORS, origins) | M | yes |
| 24 | Capacitor shell: iOS + Android projects, icons, splash, back button, haptics, links | L | no |
| 25 | Native reminders: APNs (iOS) and FCM (Android) from our server | M | yes |
| 26 | Store packaging: signed builds, screenshots, listings, privacy answers | M | no |

### Slice 21 — weekly pool out of the repo

- The weekly challenge reads its pool from `WEEKLY_POOL_FILE` (default
  `~/.jodhpur-studio/data/weekly-puzzles.json`), outside the repo.
- A fresh pool is generated from a new disjoint sample (`scripts/puzzles.mjs --slot 2`), so the
  old pool in git history no longer matters and history needs no rewrite. Already-started weeks
  keep working: the current week is recomputed from the new pool only from the next Monday.
- Tests use a small fixture pool. A scan (secrets, keys, personal paths, emails) runs over the
  tree and the history; findings are fixed before the repo goes public.
- `LICENSE` (GPL-3.0), `README` with build steps, and a "Source code" link in the app footer.

### Slice 22 — store pages and safety

- `/privacy` and `/support` pages, linked from the footer and Settings.
- Profile → Account → "Delete account": asks for the password, deletes the user, sessions,
  synced state, push subscriptions and challenge entries (all `ON DELETE CASCADE`), signs out,
  keeps on-device progress unless the player also chooses to clear it.
- Usernames: a blocklist check at sign-up and rename; a "Report" button on leaderboard rows
  (rate-limited, stored server-side); `scripts/admin.mjs hide <username>` hides a user from
  leaderboards.

### Slice 23 — app sign-in and API access

- Inside an app the page origin is `capacitor://localhost` (iOS) or `https://localhost`
  (Android), so session cookies to our domain are third-party and unreliable (iOS blocks them).
- Apps sign in to `POST /api/login?client=app` and receive a session token in the response body
  (same session table, same expiry); they send it as `Authorization: Bearer …`. The token is
  kept in the app's sandboxed storage (security review: acceptable for a revocable 30-day
  session; a Keychain/Keystore plugin is a later hardening step). App pages never use cookies.
- CORS on `/api/*` for exactly those two app origins, no wildcard; the CSRF rule becomes
  "same-origin or app origin, plus `X-OC-Request`". The WebSocket origin check accepts the two
  app origins. Browsers keep using cookies, unchanged.
- The client gets one `apiBase()`: empty on the website, the live URL inside the apps.

### Slice 24 — Capacitor shell

- `@capacitor/core`, `cli`, `ios`, `android`, plus `app`, `haptics`, `share`, `splash-screen`,
  `status-bar`, `preferences`. `npm run app:sync` copies `public/` into both projects.
- The service worker is not registered inside the apps (the app files are already local); the
  "Install the app" chip is hidden there.
- App icon and splash from the existing icon; Android back button walks the hash routes and exits
  from home; haptics on moves and captures; the native share sheet for share cards.
- Challenge and game links open the app when installed: `/.well-known/assetlinks.json` (Android
  App Links) and `/.well-known/apple-app-site-association` (iOS Universal Links), served by our
  server.
- Builds: `android/` with Gradle from the terminal; `ios/` with `xcodebuild` once Xcode is in.
- Every existing e2e test still passes on the website; new unit tests cover the platform switch.

### Slice 25 — native reminders

- `@capacitor/push-notifications`: the app asks permission and registers its device token with
  `POST /api/push/native` (platform, token, time zone, hour), stored next to the Web Push
  subscriptions.
- The reminder scheduler sends through APNs (HTTP/2 with a `.p8` token key, `node:http2`, no new
  dependency) and FCM HTTP v1 (service-account JWT signed with `node:crypto`). Keys live in
  `~/.jodhpur-studio/secrets/`, never in the repo. Dry-run mode for tests, as with Web Push.
- Needs from the user: an APNs key from the Apple developer account and a Firebase project for
  FCM.

### Slice 26 — store packaging

- Android: an upload keystore in `~/.jodhpur-studio/secrets/` (backed up — losing it blocks
  updates), a signed `.aab` with Play App Signing.
- iOS: archive and upload to App Store Connect with `xcodebuild` and the user's team.
- Screenshots for each required device size, generated with Playwright from the real app pages.
- `docs/STORE.md`: listing text, keywords, age rating answers, Apple privacy labels and Google
  Data safety answers, review notes (a demo account for reviewers).

## 5. What only the user can do

- Join the Apple Developer Program ($99/year) and install Xcode.
- Open a Google Play Console account ($25 once, ID check) and invite 12 testers for 14 days.
- Create the APNs key and the Firebase project (slice 25), sign into App Store Connect in Xcode.
- Make the GitHub repo public (after slice 21), submit the apps, answer reviewer questions.

## 6. Order and timing

Slices 21–23 change the website and server, and ship to the live site like earlier slices.
Slice 24 can start on Android as soon as the Android SDK is installed; the iOS half waits for
Xcode. The Google 14-day test can start right after slice 24, in parallel with 25–26.
