# OnlineChess — Plan 4: easy sign-up (email and Google)

Follows Plan 3 (`docs/PLAN-3.md`). Same pipeline: TDD per slice, code review plus security review
(every slice here touches accounts), evaluator scoring (pass 7.0), auto-commit per slice, ask
before merging and deploying. Work happens on `feat/easy-signup`.

## 1. Goal

Signing up should take one tap or one email, and an account should be recoverable. Today an
account is a username and a password: no email, so no reset, and no "Continue with Google".

The user dropped Microsoft sign-in on 2026-10-13: email or Google, and Apple later.

## 2. Locked decisions (user, 2026-10-13)

- **Email accounts, both ways:** email + password (with a confirmation email and "forgot
  password"), or a sign-in link with no password. The email carries a link and a 6-digit code, so
  it also works inside the apps (type the code).
- **Emails are sent with Resend** (free tier, 3,000 a month) through its HTTPS API, with no new
  dependency. Sent from `chess.solankidigitaldrafts.com`, with SPF and DKIM records in Cloudflare.
- **Google sign-in now; Sign in with Apple later**, when the Apple Developer account is bought.
  Apple requires it in the iPhone app once Google is offered there. No Microsoft sign-in.
- **Old username + password accounts are kept.** There are no new username sign-ups. Existing
  players can still sign in, and are asked to add an email or link Google so they keep
  their progress.
- **The username stays as the public display name** (leaderboard). New accounts get one suggested
  from the email or provider name, which they can change. The name filter still applies.

## 3. How it fits together

- **Accounts:** `users` gains `email` (unique, optional for legacy accounts) and
  `email_verified_at`. Password-less accounts store a marker that no password matches.
  A new `identities` table links `(provider, subject)` to a user. A new `email_tokens` table holds
  hashed one-time links and codes for verification, sign-in and reset, each short-lived and
  single-use.
- **Google:** OpenID Connect authorization-code flow with PKCE, run by our server
  (`/auth/google/start` → provider → `/auth/google/callback`). ID tokens are checked against the
  provider's published keys with `node:crypto`. An account is linked by email only when the
  provider says the email is verified.
- **Inside the apps:** Google refuses sign-in inside an app's web view. The app therefore opens
  the phone's browser (`@capacitor/browser`). After sign-in the server hands back a one-time code
  through the app's own link scheme (`com.solankidigitaldrafts.chess://auth`), and the app
  exchanges the code, with a secret only it knows, for its session token.
- **Abuse limits:** emails per address and per inbox per hour; codes allow a few tries and then
  expire; sign-in responses never reveal whether an email has an account.

## 4. Slices

| # | Slice | Size | Security review |
|---|---|---|---|
| 27 | Email sending: Resend client, templates, domain records, limits, dry run for tests | S | yes |
| 28 | Email accounts: sign up, confirm, sign in by password or link/code, forgot password, change email | L | yes |
| 29 | Google sign-in on the website, account linking | M | yes |
| 30 | Google sign-in inside the apps (system browser, one-time code) | M | yes |
| 31 | Old accounts: no new username sign-ups, "add an email" prompt, privacy policy and Play Data safety update | S | yes |
| 32 | Sign in with Apple (when the Apple Developer account exists) | M | yes |

## 5. What only the user can do

- **Resend:** create the account, add the domain, and add the DNS records it shows in Cloudflare
  (or give Claude a Cloudflare API token limited to that zone's DNS).
- **Google Cloud:** create a project, set up the OAuth consent screen (app name, support email,
  privacy policy URL), and create a "Web application" OAuth client with the redirect URI
  `https://chess.solankidigitaldrafts.com/auth/google/callback`.
- **Store the keys:** put the Resend key and the Google client ID and secret into
  `~/.jodhpur-studio/secrets/` with a one-line command Claude provides. Claude cannot write
  secrets.

## 6. Order

Slices 27–29 change the website and server and can ship to the live site one by one. Slice 30
needs a new app build. The Play closed test can start with that build (version 1.0.0 has not been
uploaded yet), so testers see the new sign-up from day one.

## 7. Security requirements for email sign-in (from the slice 27 review)

- Tokens: 32 random bytes, base64url; codes: 6 digits from `crypto.randomInt`. Only SHA-256
  hashes are stored. Expiry 15 minutes (sign-in) or 24 hours (confirm). Single use: claimed with
  an atomic `UPDATE … WHERE used_at IS NULL`.
- A code is bound to the email it was sent to. Five wrong tries and it is void; also count tries
  per email, not only per network address.
- The same answer, at the same speed, whether or not an email has an account. Sending happens in
  the background. Signing up with an email that already has an account sends that inbox a
  "you already have an account" email instead of an error.
- Opening a link (GET) shows a "Sign in" page and changes nothing; the token is used on POST, so
  link scanners in mail systems cannot use it up. Pages with tokens send `Referrer-Policy:
  no-referrer` and remove the token from the address bar.
- Each sign-in creates a new session. Resetting a password ends every other session. Other
  outstanding links are void after a successful sign-in or reset.
- The inbox limit is a cool-down, never a lock-out: earlier codes keep working, and password and
  Google sign-in never depend on email limits.
- `MAIL=dry` (keeping emails in memory) is for tests only and is refused when the server runs on
  its live port with real hosts.
