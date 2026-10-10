# OnlineChess

Play, learn and train chess in the browser.

- **Normal Mode**
  - Against a person: on the same device (pass and play), or online through a share link.
  - Against the computer: five personas, from Novice to Beyond Humans. They taunt you when you blunder.
- **Training Mode**
  - A coach that grades every move and explains what was better and what you missed.
  - Lessons from beginner to grandmaster level.
  - An openings trainer and a rules handbook.

All FIDE Laws of Chess are enforced. That includes castling restrictions, en passant and promotion. It also covers threefold, fivefold, fifty and seventy-five move draws, insufficient material, and the timeout rule. See [docs/RULES-IMPL.md](docs/RULES-IMPL.md).

> Status: under active development. See [docs/PLAN.md](docs/PLAN.md) for the slice plan.
> Implemented so far: same-device play with the complete rules.

## Run

Requires Node.js 22 or newer.

```sh
npm install      # also copies browser dependencies into public/vendor
npm start        # http://localhost:3000
```

The app must be served over HTTP (`npm start`). Opening `public/index.html` directly from disk does not work.

Set `PORT=8080` to change the port. Set `HOST=0.0.0.0` to allow other devices on your network.

## Test

```sh
npm test                    # unit, rules (perft), server tests
PERFT_DEEP=1 npm test       # deeper perft node counts
npx playwright install chromium
npm run test:e2e            # browser tests, desktop + mobile
```

## Project layout

| Path | Contents |
|------|----------|
| `server/` | Node HTTP server: hardened static files (WebSocket rooms are coming) |
| `public/js/core/` | DOM-free game logic shared by the browser and the server |
| `public/js/ui/`, `public/js/screens/`, `public/js/sessions/` | Interface and game modes |
| `public/vendor/` | Third-party browser files copied by `scripts/vendor.mjs` (committed) |
| `tests/` | `node --test` suites and Playwright specs |

## License and credits

OnlineChess is licensed under the **GNU General Public License v3.0 or later** (see [LICENSE](LICENSE)). It will bundle the Stockfish chess engine, which is GPL-3.0.

Third-party components:

- [chess.js](https://github.com/jhlywa/chess.js): BSD-2-Clause
- [cm-chessboard](https://github.com/shaack/cm-chessboard): MIT
- [ws](https://github.com/websockets/ws): MIT
- [Stockfish](https://stockfishchess.org) via [stockfish.js](https://github.com/nmrugg/stockfish.js): GPL-3.0 (from Slice 3)
