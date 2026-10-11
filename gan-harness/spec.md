# OnlineChess — GAN harness spec

Full product spec and slice plan: [`docs/PLAN.md`](../docs/PLAN.md). Rubric: [`eval-rubric.md`](eval-rubric.md).

The evaluator scores **only the slices built so far**. Criteria for unbuilt slices are N/A and the remaining weights are renormalised. Unbuilt modes must show a "Coming soon" badge and must not be reachable as broken pages.

## Built so far

### Slice 1: scaffold + local pass-and-play with full FIDE rules

- `npm start` serves `public/` on `PORT` (default 3000).
- Home (`#/`) shows Normal Mode (`mode-normal`) and Training Mode (`mode-training`) tiles.
- Normal Mode (`#/play`):
  - Same device (`opt-local`) opens the game at `#/play/local`.
  - Online (`opt-online`) and computer levels (`opt-computer`) are "Coming soon".
- Training (`#/train`): every item is "Coming soon".
- Game screen (`[data-testid=game]` with `data-fen`, `data-status`, `data-result`, `data-reason`, `data-review`):
  - Board: click or drag moves, legal-move dots, last-move and check highlights, promotion picker (`promo-q|r|b|n`).
  - Status banner, player cards with captured pieces and material lead.
  - SAN move list (`move-item[data-ply]`). Clicking a move reviews that position; arrow keys, Home and End also navigate; `btn-live` returns to the live game.
  - Controls: `btn-resign` (confirmed by `btn-confirm`), `btn-offer-draw` → `btn-accept-draw` / `btn-decline-draw`. `btn-claim-draw` is enabled only when threefold or fifty applies.
  - More controls: `btn-flip`, `btn-copy-pgn`, `btn-copy-fen`, `btn-new-game`.
  - Game-over modal (`game-over-modal`, `game-result`, `game-reason`) with a one-line rule note.
- `?fen=` starts from a position. An invalid FEN shows a toast and falls back to the start position.
- Server: static files only, GET/HEAD, strict CSP and security headers, traversal-safe.

### Slice 2: clocks, time controls, settings, sound, theme

- Same device (`opt-local`) now opens a setup screen (`#/play/local/new`):
  - time-control chips (`tc-none`, `tc-1+0`, `tc-3+2`, `tc-5+0`, `tc-10+0`, `tc-15+10`, `tc-30+0`)
  - an auto-flip switch (`setup-autoflip`)
  - `btn-start` launches the game.
- `?tc=M+S` sets a time control directly. Decimal minutes are allowed, e.g. `0.05+0` = 3 s.
- Clocks:
  - `clock-w` and `clock-b` sit in the player cards. They show m:ss, and tenths under 10 s.
  - The running clock is highlighted; under 10 s it turns red and ticks.
  - No clock runs before the first move. Fischer increment is added after each move made on a running clock.
- Flag fall:
  - The flagged side loses ("X wins on time").
  - It is a draw when the opponent cannot possibly checkmate ("Draw — time ran out, but the opponent cannot checkmate", FIDE 6.9).
  - A move attempted after the flag falls is refused and the game ends on time.
- Settings dialog (header gear `btn-settings`, `settings-modal`):
  - theme (`theme-system|dark|light`) and animation speed (`animation-off|fast|normal`)
  - switches: `setting-sound`, `setting-showLegalMoves`, `setting-showCoordinates`, `setting-autoFlip`, `setting-taunts`
  - Settings persist in localStorage. Corrupt values fall back to defaults.
- Sounds:
  - Synthesised WebAudio sounds for move, capture, castle, check, game end, low-time ticks and draw offers.
  - The audio unlocks on the first user gesture.
  - `window.__oc.soundsPlayed` and `window.__oc.soundEnabled` are exposed for tests.
- Auto-flip: in pass and play, the board turns toward the player to move. `game[data-orientation]` shows which side is at the bottom.

### Slice 3: against the computer (Stockfish 19 lite WASM, 5 personas)

- Normal Mode lists 5 opponents (`opt-bot-novice|amateur|pro|grandmaster|beyond`). Each opens a setup screen at `#/play/bot/new?persona=` with:
  - persona cards `persona-<id>`
  - colour choice `color-w|random|b`
  - time-control chips
  - `btn-start`
- Game: `#/play/bot?persona=&color=&tc=`. Test hooks:
  - `engine=fast` caps search at 100 ms or depth 8
  - `seed=N` makes the Novice's random choices reproducible
- Personas:

  | Persona | Strength |
  |---|---|
  | Pip the Pawn (Novice) | Skill 0, depth 2, MultiPV 4, deliberately weaker picks |
  | Rookie Rex (Amateur) | Elo 1400, 300 ms |
  | Professor Hoot (Pro) | Elo 1900, 600 ms |
  | Magnus the Wizard (Grand Master) | Elo 2600, 1.2 s |
  | Deep Void (Beyond Humans) | Full strength, 3 s |

  - Thinking time is capped at 1/30 of the bot's remaining clock.
  - Personas that use the opening book play it for 4–14 plies.
- The bot greets you in the feed (`feed-item[data-kind=bot]`) and reacts to wins, losses and draws.
- Draw offers: the bot answers itself. It accepts only when it stands clearly worse or late in a dead-level game.
- When the bot stands worse, it claims any draw that is available.
- The banner shows "<persona> is thinking…" while it searches. You cannot move during that time or move its pieces.
- The engine runs in a Web Worker (`/vendor/stockfish/stockfish-19-lite-single.js` + `.wasm` served as `application/wasm`). It is terminated when you leave the route; `window.__oc.engines` counts live engines.
- The home page credits Stockfish (GPL v3, `/vendor/stockfish/Copying.txt`).

## Ports

- **Never use ports 3000 or 3200**:
  - 3000 is another live app (Tambola).
  - 3200 is the live chess site (launchd).
- Never `pkill`/`killall` node processes. Kill only the PID you started.

### Slice 4: move grading and taunts

- **Grading:** a second, full-strength Stockfish instance (only created when Settings → "Computer trash talk" is on) grades each of your moves. Grades use lichess win-chance thresholds:
  - inaccuracy at a drop of ≥ 0.1
  - mistake at ≥ 0.2
  - blunder at ≥ 0.3
  - "great" when the move was the only good one
- **Taunts:** `feed-item[data-kind=taunt]`, one voice per persona.
- **Triggers:**
  - hung piece: names the piece and square, only when material really drops
  - allowed mate
  - missed mate-in-1: names the move
  - blunder, mistake, sometimes an inaccuracy
  - grudging praise for great non-forced moves
  - the bot giving check
- **Pacing:** minor taunts have a cooldown, lines don't repeat within five, and blunders always get a reaction.
- **Never stale:** no taunt appears in a new game, after a later move, or after the game ends.

### Slice 5: online play via share link (server-authoritative)

- **Creating a room:**
  - Normal Mode → `opt-online` → `#/play/online/new`, with a name field (`online-name`), colour and time control.
  - `btn-create-room` opens `#/room/<ID>`. While waiting, it shows an invite link (`room-link`, `btn-copy-link`).
- **Joining:** the friend opens the link, enters a name and clicks `btn-join`.
- **The server owns everything:**
  - Rules: moves are validated with the shared rules module and carry the expected ply.
  - Clocks: the flag is checked by a timer and before every move.
  - Draws: offers and answers, plus threefold/fifty claims, which are allowed only on your own turn.
  - Resign, and rematch (`btn-rematch`, colours swap).
  - Emotes (`emote-*`) with a cooldown.
  - Abandonment: claim the win after a 60 s disconnect (`btn-claim-abandon`).
- **Reload/reconnect:** resumes the seat via a 128-bit token in sessionStorage. A second tab replaces the first.
- **WebSocket `/ws` hardening:**
  - Same-origin Origin check; 4 KB max frame.
  - Strict JSON schema (unknown types or fields rejected; names `[\p{L}\p{N} _'-]{1,20}`).
  - 20 msg/s token bucket (close 1008); 8 connections per address (CF-Connecting-IP trusted only from loopback); 500 rooms max.
  - Idle/finished room GC and heartbeat pings. Errors never include stack traces.

### Slice 6: Training — coached game

- **Setup:** Training (`#/train`) → `opt-coach` → `#/train/coach`. Pick a level (`level-novice|amateur|pro|grandmaster`) and a colour (`color-*`), then `btn-start`.
- **Game:** `#/train/coach/play?level=&color=`. The test hooks `engine=fast`, `seed`, `fen` are supported.
- **Opponent:** the persona matching the level. A separate full-strength coach engine analyses every player move.
- **Coach panel** (`coach-panel`):
  - a grade badge (`coach-grade`, with `data-grade` set to best/great/excellent/good/inaccuracy/mistake/blunder)
  - a headline
  - points (`li[data-kind]`):
    - better: the best move plus why
    - missed: a missed mate
    - allowed: the opponent's refutation and what it wins
    - warning: a piece left hanging
    - tip/praise: opening principles, Novice and Amateur only
- **Board arrows:**
  - green: the better move
  - red: the refutation
  - orange: the opponent's threat after their move (`coach-threat`)
  - blue: the hint
- **Explanations by level:**
  - Novice: plain words, no numbers
  - Amateur: names tactics
  - Pro: adds evaluations
  - Grandmaster: evaluations plus the engine's main line
- **Controls:**
  - `btn-hint`: the first press highlights a piece, the second shows the move
  - `btn-takeback`: undoes your move and the reply, and drops their feedback
- **Game-over summary:** your accuracy (`coach-accuracy`, lichess formula) and counts per grade.
- **Online fixes since iteration 4:**
  - The join page says up front when a room is missing or full.
  - A declined draw is announced.
  - A second-tab takeover is announced on the old tab.
  - `#/play/online` opens the setup.

### Slice 7: Training — lessons (Novice, Amateur) and the rules handbook

- **Hub:** Training → `opt-lessons` → `#/learn`. Tracks `track-<level>`, lesson cards `lesson-<id>` (class `done` once completed; progress saved in localStorage).
- **Lesson player:** `#/learn/<id>`.
  - Read lessons step through text and diagrams (`lesson-text`, `btn-prev`, `btn-next`, then `btn-next-lesson`).
  - Puzzles (`lesson-feedback`, `btn-lesson-hint`, `lesson-hint`, `btn-lesson-reset`) explain wrong moves, script the opponent's replies, and explain stalemate in mate puzzles.
- **Rules handbook:** `opt-rules` → `#/rules`, one section per rule (`rule-<id>`).

### Slice 8: Training — Pro and Grand Master tracks, playouts against Stockfish

- **New tracks:** `track-pro`, `track-grandmaster`.
  - Pro: opening principles, K+Q mate, K+R mate, the opposition, the rule of the square, Lucena, Philidor.
  - Grand Master: candidate moves, Philidor's legacy (smothered mate), the Greek gift, the Saavedra study (underpromotion), the Réti study.
- **Playout lessons** (card label "vs Stockfish"): the player plays a position out against full-strength Stockfish on its own worker.
  - Goals: `mate` (checkmate within N moves), `promote` (promote and keep the new piece through the reply), `hold` (survive N moves; an enemy promotion must be answered at once).
  - `playout-moves` shows "Moves left: x of N". `lesson-feedback` reports the result; the panel has `data-state` (playing/thinking/won/lost) and `data-fen`.
  - Hint: the first press shows text, the second also highlights the piece Stockfish would move.
  - Restart resets the position and the budget. Leaving the lesson stops the engine (`__oc.engines`).
  - Test hook: `?engine=fast` (depth 6).
- Every playout is validated in `tests/engine`: Stockfish playing the player's side reaches the goal against Stockfish.

### Slice 9: Training — openings trainer, opening names in games, bot repertoires

- **Hub:** Training → `opt-openings` → `#/openings`. Two groups, `openings-w` and `openings-b`, with 15 cards (`opening-<id>`; class `done` once a line has been practised to the end).
- **Trainer:** `#/openings/<id>` (`?mode=practice` opens the Practice tab). Tabs `tab-learn` / `tab-practice`.
  - Learn: the summary and key ideas, then every move of the line with a note (`opening-text`, `btn-prev`, `btn-next`, `btn-to-practice`). An arrow shows the next move.
  - Practice: play your side from memory; the other side replies from the line. A wrong move is refused; the first miss highlights the piece, the second shows an arrow. The end shows the number of mistakes, `btn-play-it-out` (continue the position against Rookie Rex) and `btn-next-opening`.
- **Opening badge** in every game (`opening-name`, e.g. "B10 · Caro-Kann Defence"), recognised by position so transpositions count; about 100 named openings. After the game, `opening-learn` links to the matching trainer opening. Copied PGN includes ECO and Opening headers.
- **Bot repertoires:** Pip (Novice) tries early queen attacks; Rex (Amateur) plays gambits and traps (Fried Liver, Evans, Stafford, Danish, King's Gambit); the stronger bots play the main lines of the trainer openings.
- Every taught move is engine-checked (no worse than Stockfish's best by more than 0.9 pawns).

### Slice 10: progress and retention

- **Profile** (`#/profile`, top-bar `nav-profile`): rank (`rank-name`, 8 ranks from Pawn to Legend), XP (`xp`) and a progress bar, overall stats, a record table per computer opponent (`record-<persona>`: W/D/L and best streak), the online record, 22 achievements (`ach-<id>`, `data-unlocked`), and a reset button (`btn-reset-profile`, confirmed).
- **XP:** wins against the computer by level (20/40/70/120/200; draws half, losses 5), online games 30/15/10, coached games 15 plus accuracy/5, lessons 25, openings 20, the daily puzzle 30 plus 5 per streak day (up to a week), pass and play 5.
- **Integrity:** games shorter than 8 moves each earn no XP or accuracy credit unless they end in checkmate; only games from the standard start position count toward records and achievements; a game from a set-up position (a `fen=` link, an opening played out) is practice and earns 5 XP.
- **Daily puzzle** (`#/daily`): one puzzle per day, rotating through the lesson puzzles; players below the Rook rank get Novice and Amateur puzzles. Solving it starts or extends the streak (`daily-streak`); a missed day resets it.
- **Home dashboard** (`dashboard`): rank and XP (`dash-profile`), today's puzzle and the streak (`dash-daily`, `dash-streak`), and the next unfinished lesson (`dash-continue`).
- **Celebrations:** "+N XP" toasts, achievement and rank-up toasts, and confetti for wins, unlocks, rank-ups and the daily puzzle (skipped with reduced motion; `__oc.confetti` counts bursts).
- **Accessibility:** progress bar with ARIA values, locked/unlocked state in text, records as a table with headers; no horizontal scroll at 360px.

### Slice 11: game review (Plan 2, docs/PLAN-2.md)

- Every finished game (computer, coached, online, pass and play) is saved locally; the last 50 are listed at `#/games` (rows `game-<id>`, with your accuracy once reviewed). The dashboard has a `dash-games` card.
- The result window has **Review game** (`btn-review`) → `#/review/<id>` (test hook `?engine=fast`).
- The review analyses every position with a full-strength engine (progress bar `review-progress`), then shows:
  - accuracy per side (`accuracy-w`, `accuracy-b`) with grade counts;
  - a clickable evaluation graph;
  - up to three key moments (`key-<ply>`);
  - a move list with grade marks (`rv-move-<ply>`, `data-grade`);
  - the coach's explanation of the selected move (`review-current`) with arrows;
  - navigation buttons (`rv-first/prev/next/last`) and the arrow keys.
- `review-panel` exposes `data-state` (analysing/ready/failed) and `data-ply`. Reviews are cached, so reopening is instant.
- **Retry** (`btn-retry`) on your inaccuracy, mistake or blunder: the board returns to the position before it; find a move that is not a mistake (judged by the engine) (`retry-feedback`), then `btn-retry-done`.

### Slice 12: puzzle library, rating and Puzzle Rush

- 4,900 puzzles from the Lichess puzzle database (CC0), rated 400–2799, in `public/data/puzzles.json` (built by `npm run puzzles`), loaded only on puzzle pages.
- **Rated puzzles** (`#/puzzles`, Training `opt-puzzles`, dashboard `dash-puzzles`):
  - Puzzles are served near your Glicko-2 puzzle rating (`puzzle-rating`, starting at 1000), never repeating the last 300.
  - The opponent's setup move plays first.
  - A wrong move counts the puzzle as missed (`rating-change` negative), but you may keep trying.
  - `btn-lesson-hint` gives one hint; `btn-solution` shows the answer and counts as missed. Then `btn-next-puzzle`.
  - Theme filter: `#/puzzles?theme=fork` (`theme-<id>` links).
  - `puzzle-panel` exposes `data-puzzle` (Lichess id) and `data-state`.
- **Puzzle Rush** (`#/rush`, `opt-rush`): 3 minutes (`?seconds=N` shortens it for tests), 3 strikes, and puzzles that get harder with each solve.
  - `btn-rush-start`, `rush-timer`, `rush-score`, `rush-strikes`, `rush-result`; best score `rush-best`.
  - `rush-panel` has `data-puzzle`.
- The **daily puzzle** now comes from the library: the same for everyone in a 400-point rating band, with no repeat within a year. `daily` has `data-source="library"`; lesson puzzles stand in when offline.
- XP: 5 per rated puzzle solved at the first try, and 2 per Rush point (maximum 60).
- New achievements: Puzzle addict (100 solved), Tactician (rating 1500), Tactical genius (2000), Rush hour (15), Lightning (25).

### Slice 13: campaign and cosmetics

- **Campaign** (`#/campaign`; Normal Mode `opt-campaign`; dashboard `dash-campaign`):
  - The five opponents in order (`stop-<persona>`, `data-unlocked`). Pip is open; beating an opponent opens the next.
  - Three stars each (`stars-<persona>`, aria-label "n of 3 stars"): a win, a win in 40 moves or fewer, and a win without a blunder. The third is awarded when the won game is reviewed, and the result window hints at it (`clean-star-hint`).
  - Stars count only against unlocked opponents and only for games from the standard start. Total: `campaign-total`.
  - Each new star gives 10 XP. Two new achievements: Rising star (5 stars) and Constellation (all 15). Star toasts and confetti.
- **Cosmetics** in Settings:
  - `setting-boardTheme` has six boards: Wood (the original, free), Tournament green (Knight), Marble (Bishop), Ocean (Rook), Night (Queen) and Royal gold (King).
  - `setting-pieceSet` has Staunty (free) and Classic (Bishop).
  - Locked items are shown disabled, with the rank that unlocks them. `<html data-board>` shows the active board. A locked choice (e.g. after a profile reset) falls back to the free one.
- Tall dialogs now scroll on short screens.

### Slice 14: weekly quests and streak freezes

- Three **weekly quests** (Monday to Sunday, local time), the same for everyone, picked from a pool of ten. Examples: beat Rookie Rex twice, win 3 games, win in 40 moves or fewer, solve 15 rated puzzles, score 10 in Rush, review 3 games, fix 3 mistakes with Retry, solve the daily on 5 days, play 2 coached games, play online.
  - Shown on the dashboard (`dash-quests`) and the profile; each quest is `quest-<id>` with `data-done` and a progress bar.
  - Each finished quest gives 30 XP and a toast.
- Finishing all three earns a **streak freeze** (at most two held, shown with 🧊). A freeze covers one missed day of the daily puzzle and is spent when the next puzzle is solved.
  - The daily page says when a freeze will cover the gap (`daily-streak`); a toast confirms when one is used.
  - Freezes are kept if the gap is too long to cover.

### Slice 15: weak spots (spaced repetition of your own mistakes)

- Mistakes and blunders become cards: from every reviewed game (your moves; both sides in pass and play) and from every move the coach grades in a coached game.
  - A card is the position before the mistake. Its answers are the engine's best move, plus the second-best when that is not itself an inaccuracy or worse.
- `#/weak-spots` (Training `opt-weakspots`; dashboard `dash-weakspots` shows how many are due) plays today's due cards.
  - `weakspot-feedback` says what you played and asks for a better move.
  - A right answer reschedules the card (1, 3, 7, then 21 days, then mastered); a wrong one shows the better move as an arrow and brings the card back tomorrow.
  - `weakspot-panel` has `data-state` (asking/right/wrong); `btn-next-card` and `btn-weakspots-done` move on. With nothing due: `weakspots-empty`.
- 3 XP per right answer. New achievement: Weak no more (10 cards mastered; 22 achievements in all).

### Slice 16: share cards and challenge links

- **Share** (`btn-share` in the result window after beating the computer from the start position; `btn-rush-share` after a counted Puzzle Rush with a score) draws a 1200×630 PNG card: the final position in your board colours, the result, the opponent and the opening.
  - The card is shared through the system share sheet where the browser supports files.
  - Otherwise the link alone is shared; failing that, the image is downloaded and the challenge text and link are copied.
  - `__oc.lastShare` records the last share for tests.
- **Challenge links** (`#/challenge?bot=<persona>&moves=N[&acc=P]` or `#/challenge?rush=N`):
  - `challenge-text` reads, for example, "Your friend beat Magnus the Wizard (Grand Master) in 34 moves. Can you?"
  - `btn-accept-challenge` opens the same opponent's setup, or Puzzle Rush.
  - Every value is validated; anything else shows "Challenge not found".

### Slice 17: installable app with offline play

- A web app manifest (`/manifest.webmanifest`, standalone, icons 192/512 and maskable) and an Apple touch icon; the app can be installed to the home screen or desktop.
- A service worker (`/sw.js`), generated by the server at start-up, caches every public file (about 4 MB, including Stockfish, the piece sprites and the puzzle library).
  - Computer games, coached games, lessons, openings, puzzles and the daily all work offline. Online play needs a connection.
  - The worker carries a version hash of the files, so every deploy is picked up. A banner (`update-banner`, `btn-update`) offers to reload into the new version.
- Installing:
  - The browser's install prompt is kept for an "Install the app" dashboard card (`dash-install`).
  - An install banner (`install-banner`) is offered at most once a week, after a win or a solved daily, where the browser supports installing.
- Test note: Playwright blocks service workers except in `tests/e2e/slice17-offline.spec.js`.

## Not built yet (score N/A)

- Plan 2 slices 18–20 (docs/PLAN-2.md).

## How to run for evaluation

- Start: `PORT=4300 node server/index.js` (stop it afterwards).
- Browser automation: the Playwright bundled Chromium is **not** installed. Use the installed Google Chrome:
  - Playwright tests: `channel: 'chrome'`, or `PW_CHANNEL=chrome npx playwright test`.
  - Ad-hoc scripts: `chromium.launch({ channel: 'chrome' })`.
- Existing checks:
  - `npm test` (unit + server)
  - `PW_CHANNEL=chrome npm run test:e2e` (desktop then Pixel 7; running both projects in one invocation can hang Chrome)
- Board squares are SVG `rect[data-square="e2"]`. Click the centre of the rect's bounding box. Pieces and markers ignore pointer events.
