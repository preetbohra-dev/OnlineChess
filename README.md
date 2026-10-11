# OnlineChess

Play, learn and train chess in the browser — from your first game to grandmaster ideas.

- **Normal Mode**
  - Against a person: on the same device (pass and play), or online with a friend through a share link.
  - Against the computer: five opponents — Pip the Pawn (Novice), Rookie Rex (Amateur), Professor Hoot (Pro), Magnus the Wizard (Grand Master) and Deep Void (Beyond Humans). Each has its own personality and opening style, and they taunt you when you blunder.
- **Training Mode**
  - Coached games: a coach grades every move, explains what was better and what you missed, warns about threats, and lets you take a move back and try again.
  - Lessons on four levels: the rules and basic mates (Novice), tactics (Amateur), endgames played out against Stockfish (Pro), and famous combinations and studies (Grand Master).
  - An openings trainer: 15 classic openings, each explained move by move and practised from memory.
  - A rules handbook covering every FIDE rule.
  - Rated puzzles: about 5,000 real puzzles from the Lichess database, served near your puzzle rating (Glicko-2), with theme filters; and Puzzle Rush (three minutes, three strikes).
- **Game review** after every game: accuracy, an evaluation graph, key moments, and "retry" to find a better move where you went wrong.
- **Share and challenge**: share a win or a Puzzle Rush score as a picture with a link that challenges a friend to beat it.
- **Weak spots**: your own mistakes come back as puzzles on a spaced-repetition schedule until you have them mastered.
- **Progress**: XP and ranks, records against every computer opponent, a campaign with three stars per opponent, 22 achievements, weekly quests that earn streak freezes, board themes and piece sets unlocked by rank, a daily puzzle with a streak, and a home dashboard that shows what to do next.

All FIDE Laws of Chess are enforced. That includes castling restrictions, en passant and promotion. It also covers threefold, fivefold, fifty and seventy-five move draws, insufficient material, and the timeout rule. See [docs/RULES-IMPL.md](docs/RULES-IMPL.md).

It installs as an app (home screen or desktop) and works offline, except online play. The offline copy is versioned from the files the server sees at start-up, so restart the server after deploying new files.

Every game shows the opening being played. Progress is stored in the browser (localStorage); there are no accounts, so XP and achievements are a personal motivator rather than a verified rating. Only games from the standard starting position count toward records.

## Run

Requires Node.js 22 or newer.

```sh
npm install      # also copies browser dependencies into public/vendor
npm start        # http://localhost:3200
```

The app must be served over HTTP (`npm start`). Opening `public/index.html` directly from disk does not work.

Environment variables:

| Variable | Default | Purpose |
|----------|---------|---------|
| `PORT` | `3200` | HTTP port |
| `HOST` | `127.0.0.1` | Bind address; `0.0.0.0` allows other devices on your network |
| `ALLOWED_HOSTS` | (none) | Comma-separated host names, besides localhost, allowed to open online-play WebSockets. Set it to your public domain when deploying. |
| `ROOMS_PER_ADDRESS`, `ROOM_CREATES_PER_HOUR`, `WS_CONNECT_BURST`, `WS_CONNECTIONS_PER_ADDRESS` | see `server/index.js` | Abuse limits for online play |

Deployment notes: [docs/DEPLOY.md](docs/DEPLOY.md).

## Test

```sh
npm test                    # unit, rules (perft), content, server and engine tests
PERFT_DEEP=1 npm test       # deeper perft node counts
npm run test:e2e            # browser tests, desktop then mobile
```

The engine tests run the real Stockfish in Node. They check that every lesson puzzle's answer is the engine's choice, that every endgame lesson can be won (or held) against Stockfish, and that every move the openings trainer teaches is sound.

Browser tests use Playwright. If the bundled Chromium is not installed, run them with an installed Google Chrome: `PW_CHANNEL=chrome npm run test:e2e`.

## Project layout

| Path | Contents |
|------|----------|
| `server/` | Node HTTP server: hardened static files and WebSocket rooms for online play |
| `public/js/core/` | DOM-free logic shared by the browser and the server: rules, clocks, move grading, coaching, puzzles, playouts, openings, progression |
| `public/js/engine/` | Stockfish driver (UCI over a Web Worker), personas, opening book |
| `public/js/sessions/` | Game modes: pass and play, computer, online, coached |
| `public/js/screens/`, `public/js/ui/` | Pages and interface components |
| `public/js/data/` | Personas, taunts, lessons, openings, opening names, repertoires |
| `public/js/store/` | Local storage: settings, lesson and opening progress, profile |
| `public/vendor/` | Third-party browser files copied by `scripts/vendor.mjs` (committed) |
| `tests/` | `node --test` suites and Playwright specs |
| `docs/` | Plan, rules implementation notes, deployment |

## License and credits

OnlineChess is licensed under the **GNU General Public License v3.0 or later** (see [LICENSE](LICENSE)), because it bundles the Stockfish chess engine, which is GPL-3.0.

Third-party components:

- [chess.js](https://github.com/jhlywa/chess.js): BSD-2-Clause
- [cm-chessboard](https://github.com/shaack/cm-chessboard): MIT
- [ws](https://github.com/websockets/ws): MIT
- [Stockfish](https://stockfishchess.org) via [stockfish.js](https://github.com/nmrugg/stockfish.js): GPL-3.0
- App icons: `node scripts/icons.mjs` renders them from the knight logo (needs Playwright's Chrome).
- Puzzles: the [Lichess puzzle database](https://database.lichess.org/#puzzles), CC0. `npm run puzzles` rebuilds `public/data/puzzles.json` (needs the `zstd` command-line tool).
