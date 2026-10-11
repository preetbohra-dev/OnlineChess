# OnlineChess — Plan 2: reasons to come back

Follows the finished MVP (`docs/PLAN.md`, slices 1–10, merged in #2). Same pipeline: TDD per
slice, code review (plus security review where marked), evaluator scoring (pass 7.0), Gate 2
before each commit, then deploy. Work happens on `feat/retention`, merged to `main` by PR; the
live site deploys from `main`.

## 1. Goal

Players should have a reason to open the app every day and a reason to keep playing after a
game ends. Today XP unlocks nothing, the daily puzzle repeats every 13 days, games end with a
result screen and nothing else, and progress lives in one browser.

## 2. Locked decisions (user, 2026-10-11)

- All nine ideas are in scope.
- **Sign-in:** username + password. Passwords hashed with `node:crypto` scrypt; sessions in an
  HttpOnly, Secure, SameSite=Lax cookie. Guest play stays; a guest's local progress merges into
  the account on first sign-in. No email, so no password reset by email (an admin script can
  reset one).
- **Storage:** SQLite on this Mac with Node's built-in `node:sqlite` (no new dependency),
  database file outside the repo, nightly backup.
- **Tournaments:** a weekly asynchronous challenge with a leaderboard. No live arenas for now.
- **Reminders:** opt-in Web Push, sent in the evening if today's puzzle is unsolved.

New dependencies: `web-push` (MPL-2.0, compatible with GPL-3.0) for push encryption and VAPID.
New data: a curated subset of the Lichess puzzle database (CC0).

## 3. Slices

Client-only slices first (they work for guests), then the server slices.

| # | Slice | Size | Security review |
|---|---|---|---|
| 11 | Game review after every game | M | no |
| 12 | Puzzle library: rated puzzles, Puzzle Rush, a never-repeating daily | L | no |
| 13 | Campaign map with stars, Deep Void unlock, cosmetics unlocked by rank | M | no |
| 14 | Weekly quests and streak freeze | S | no |
| 15 | Weak spots: your own mistakes as spaced-repetition puzzles | M | no |
| 16 | Share cards and challenge links | S | no |
| 17 | Installable app (PWA) with offline play | M | no |
| 18 | Accounts, SQLite and cloud sync | L | **yes** |
| 19 | Web Push daily reminders | M | **yes** |
| 20 | Weekly challenge and leaderboard | M | **yes** |

### Slice 11 — Game review

- After every finished game (computer, coached, online, pass and play), the result window
  offers **Review**. The review analyses each move with a full-strength engine in the
  background, with a progress bar.
- The review shows:
  - an accuracy per side;
  - an evaluation graph;
  - grade counts;
  - the three biggest swings ("key moments");
  - your best move.
- Every move can be stepped through with the coach's explanation (reuses `explain.js`).
- **Retry from here** turns a mistake into a puzzle: find the better move.
- The last 50 finished games are kept locally (PGN plus metadata) and listed at `#/games`;
  `#/review/:id` opens one.
- Tests:
  - the analysis pipeline, with a fake engine and with real Stockfish;
  - storage limits and corrupt data;
  - e2e: finish a game, review it, retry a mistake.

### Slice 12 — Puzzle library

- A script (`scripts/puzzles.mjs`) streams the Lichess puzzle CSV and picks about 5,000
  puzzles. The choice is balanced across rating bands (400–2800) and common themes (fork, pin,
  mate in 1–3, endgame, and so on), and the result is a committed JSON file of about 1.5 MB.
  The CSV is not committed.
- Puzzle rating: Glicko-2 for the player, starting at 1000. Puzzles are served near the
  player's rating.
- `#/puzzles` lets you play rated puzzles, filter by theme, and see your rating graph.
- **Puzzle Rush** (`#/rush`): three minutes, three strikes; puzzles get harder as you go, and
  your best score is recorded.
- The daily puzzle comes from the library: deterministic per day and rating band, so it never
  repeats within a year.
- New achievements: puzzle rating milestones and Rush scores.
- Tests:
  - the curation script on a small fixture;
  - every bundled puzzle is legal and its solution is checked by chess.js;
  - Glicko-2 against published examples;
  - e2e for Rush.

### Slice 13 — Campaign and cosmetics

- `#/campaign` shows a map of opponents in order. Each opponent has up to three stars:
  - one for a win;
  - one for a win in under 40 moves;
  - one for a win without a blunder (graded by the review engine).
- Beating Magnus unlocks Deep Void. Locked opponents can still be played from Normal Mode
  without stars, so nobody is blocked.
- Cosmetics, unlocked by rank:
  - board themes (wood, marble, ocean, night);
  - the second piece set (`staunty`, already vendored);
  - a coloured highlight style.
- Cosmetics are chosen in Settings, with locked items shown along with the rank needed.
- Tests: star rules, unlock rules, and that a set-up position never earns stars.

### Slice 14 — Weekly quests and streak freeze

- Three quests each week, picked deterministically from a pool, e.g. "Beat Rookie Rex twice",
  "Solve 15 puzzles", "Review 3 games", "Practise 2 openings". Each pays XP.
- Finishing all three earns a **streak freeze**, which covers one missed daily (at most two
  held).
- Quests are shown on the home dashboard and the profile.
- Tests: quest progress from events, the weekly roll-over, and freeze use on a missed day.

### Slice 15 — Weak spots

- Mistakes and blunders found by reviews and coached games become cards: the position before
  the mistake, with the better move as the answer.
- A simple spaced-repetition schedule (1, 3, 7, 21 days). Wrong answers reset a card to day 1.
- `#/weak-spots` shows today's cards; the dashboard shows how many are due.
- Tests: card creation and dedupe, the schedule, and e2e for one card.

### Slice 16 — Share cards and challenge links

- After a win, or a new personal best in Rush or the campaign, **Share** draws a PNG card on a
  canvas: the final position, the opponent, the move count and the accuracy.
- The card is shared with the Web Share API, falling back to a download.
- A challenge link (`#/challenge?bot=grandmaster&...`) opens a game against the same opponent
  with a banner: "Your friend beat Magnus in 34 moves. Can you?"
- Tests: card rendering (canvas size, no errors), link parsing and validation.

### Slice 17 — Installable app

- A web app manifest and icons.
- A service worker caches the app shell, the vendored files and Stockfish (about 2 MB), so
  computer games, lessons, openings and puzzles work offline. Online play needs a connection.
- An install prompt is offered at a good moment, such as after a win or a solved daily.
- An update banner appears when a new version is deployed.
- Tests:
  - offline e2e (Playwright offline mode);
  - the service worker updates on a new version;
  - the cache budget.

### Slice 18 — Accounts, SQLite and cloud sync (security review)

- `node:sqlite` database with tables `users`, `sessions`, `profiles` and `games`, created by
  migrations at start-up. The file lives in `~/.jodhpur-studio/data/chess.db`, with a nightly
  `VACUUM INTO` backup that keeps 7.
- API:
  - `POST /api/register`
  - `POST /api/login`
  - `POST /api/logout`
  - `GET/PUT /api/profile`
  - `GET /api/me`
- API protections:
  - JSON only, with a small body limit;
  - same-origin check plus a required custom header (CSRF);
  - per-IP and per-account login rate limits, with lockout back-off;
  - constant-time comparisons.
- Usernames: 3–20 characters, `[a-z0-9_-]`, unique case-insensitively. Passwords: at least 10
  characters, checked against a small list of common passwords.
- Sync: lesson progress, opening progress, the profile, puzzle rating, campaign, quests, weak
  spots and the game list. The merge on sign-in and on every change works field by field:
  - counters take the maximum;
  - sets take the union;
  - achievements keep the earliest date;
  - ratings take the most recently updated.
  Sign-in on a second device pulls the account's state.
- Online play shows signed-in usernames.
- Admin script: reset a password, delete an account.
- Tests:
  - the API: happy paths, every validation error, rate limits, CSRF, session expiry;
  - the merge rules (property tests);
  - e2e: register, play, sign in from a second browser context, see the progress.

### Slice 19 — Web Push reminders (security review)

- VAPID keys are generated once and stored outside the repo (`~/.jodhpur-studio/secrets/`).
- Opt-in from the profile or after solving a daily. The subscription, with the time zone and a
  preferred hour (default 19:00), is stored for the account.
- A scheduler in the server checks every 10 minutes and sends "Your daily puzzle is waiting
  (🔥 5-day streak)" to subscribers whose local hour has come and whose daily is unsolved.
- At most one push per day. Expired subscriptions (404/410) are deleted.
- The service worker shows the notification, and a tap opens `#/daily`.
- Needs accounts, so the server knows whether today's puzzle is solved.
- Tests:
  - the scheduler with a fake clock;
  - payload and endpoint validation (only https push-service URLs, to avoid SSRF);
  - the unsubscribe path.

### Slice 20 — Weekly challenge and leaderboard (security review)

- Each week (Monday 00:00 UTC) the server publishes a challenge:
  - 10 rated puzzles from the library, the same for everyone;
  - 3 games from set positions against a fixed opponent.
- Puzzle answers are checked on the server, against solutions the client never receives
  until the challenge is answered. Game results come with the PGN; the server checks
  legality, that the game came from the challenge position, and that it ended properly.
- Bot moves cannot be verified, so game points are labelled "self-reported" and weigh less
  than puzzles.
- Leaderboard: the top 50 plus your own rank, by score then time. Last week's podium earns
  badges.
- Accounts only; guests see the leaderboard with a prompt to sign in.
- Tests: scoring, server-side puzzle verification, PGN checks, the weekly roll-over, rate
  limits, and leaderboard ordering.

## 4. Risks

- **Security:** the first stored user data and passwords, and the first outgoing requests
  (push). Slices 18–20 get the security reviewer, and are deployed only after it passes.
- **Data loss:** the database lives on this Mac, so there are nightly backups. Offering an
  off-machine backup copy is a later choice.
- **Bundle size:** puzzles about 1.5 MB, plus a cached engine. The puzzle JSON is loaded only
  on puzzle pages.
- **Cheating:** game results remain unverifiable without running engines on the server.
  Puzzles carry most of the leaderboard weight.
- **Scope:** 10 slices, the same size as the MVP. Each slice ships on its own, so this can
  stop after any slice.
