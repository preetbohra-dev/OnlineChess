# Google Play listing

Everything Play Console asks for, ready to paste. Images are in `store/play/` (rebuild with
`PW_CHANNEL=chrome node scripts/store-screenshots.mjs`). The iPhone listing comes later.

## App details

| Field | Value |
|---|---|
| App name | OnlineChess |
| Package | com.solankidigitaldrafts.chess |
| Default language | English (United States) |
| App or game | Game |
| Category | Board |
| Free or paid | Free |
| Contact email | preetbohra30@gmail.com |
| Website | https://chess.solankidigitaldrafts.com |
| Privacy policy | https://chess.solankidigitaldrafts.com/privacy.html |

**Short description** (80 characters max):

> Play chess with friends or the computer, and learn with a coach for every move.

**Full description** (4000 characters max):

> OnlineChess is chess that teaches while you play.
>
> PLAY
> • Five computer opponents, from Pip the Pawn (just learning) to Deep Void (full-strength Stockfish), each with their own personality.
> • Play a friend on the same phone, or online by sharing a link.
> • A campaign: beat each opponent in turn and earn up to three stars.
>
> LEARN
> • A coached game: after every move the coach says how good it was and why, and shows the better move on the board.
> • Lessons from the rules to grandmaster ideas, and an opening trainer for the main openings.
> • Review any finished game: see your best moves and your mistakes.
> • Weak spots: positions where you went wrong come back as puzzles until you get them right.
>
> PUZZLES
> • Thousands of rated puzzles from the Lichess database, a daily puzzle with a streak, and Puzzle Rush against the clock.
> • A weekly challenge with the same puzzles for everyone and a leaderboard.
>
> YOUR PROGRESS
> • XP, ranks, achievements and weekly quests. Unlock board themes and piece sets as you improve.
> • Play without an account: everything stays on your phone. Sign in to keep your progress on every device.
> • Most of the app works offline.
>
> No ads. No tracking. Free software: the source code is published under the GNU GPL v3 (the app includes the Stockfish engine).

## Graphics

| Asset | File | Size |
|---|---|---|
| App icon | `store/play/icon-512.png` | 512 × 512 |
| Feature graphic | `store/play/feature-graphic.png` | 1024 × 500 |
| Phone screenshots | `store/play/1-home.png` … `6-lesson.png` | 1080 × 1920 |

## App content (Policy → App content)

- **Privacy policy:** the URL above.
- **Ads:** No, the app does not contain ads.
- **App access:** All functionality is available without special access. (Accounts are optional
  and anyone can create one in the app; no invitation or payment.)
- **Content rating (IARC questionnaire):** category *Game*, board/puzzle. No violence, fear, sex,
  language, drugs, gambling. *Users can interact or exchange content:* Yes (online games with
  friends by link, usernames on a leaderboard; no chat). *Shares location:* No. *Digital
  purchases:* No. Expected rating: Everyone / PEGI 3.
- **Target audience:** 13 and over (the app is not designed for children; accounts are not meant
  for under-13s without a parent, as the privacy policy says).
- **News app:** No. **Government app:** No. **Financial features:** None. **Health:** No.
- **Data deletion:** Users can delete their account in the app (Profile → Delete account). Web
  link for deletion requests: https://chess.solankidigitaldrafts.com/support.html (email us).

### Data safety

Does the app collect or share user data? **Yes, collects; does not share.** All data is encrypted
in transit (HTTPS). Users can request deletion (in the app, or by email).

Collected only when the player creates an account (optional), for **App functionality** and
**Account management**, not shared, not used for ads or analytics:

| Data type (Play's names) | What it is |
|---|---|
| Personal info → User IDs | The username |
| App activity → Other user-generated content | Weekly challenge answers and results; reports of usernames |
| App activity → In-app actions | Synced progress: XP, ratings, saved games (moves), lessons, achievements |

Not collected: name, email, phone, location, contacts, photos, files, device IDs, payment info,
health, messages, web browsing, crash logs, diagnostics. IP addresses are used only in memory to
limit abuse and are not stored.

## Release

- Version 1.0.0 (versionCode 1). Build: see docs/APPS.md → "Release build".
- Release notes: "First release: play the computer or a friend, coached games, lessons, puzzles and a weekly challenge."
- Countries: all.
- New personal developer accounts must run a **closed test with at least 12 testers for 14 days**
  before production access is granted.
