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

## Not built yet (score N/A)

- Slices 3-4: computer personas and taunts.
- Slice 5: online play.
- Slices 6-9: training.
- Slice 10: retention.

## How to run for evaluation

- Start: `PORT=4300 node server/index.js` (stop it afterwards).
- Browser automation: the Playwright bundled Chromium is **not** installed. Use the installed Google Chrome:
  - Playwright tests: `channel: 'chrome'`, or `PW_CHANNEL=chrome npx playwright test`.
  - Ad-hoc scripts: `chromium.launch({ channel: 'chrome' })`.
- Existing checks:
  - `npm test` (unit + server)
  - `PW_CHANNEL=chrome npx playwright test --workers=2` (e2e, desktop + Pixel 7)
- Board squares are SVG `rect[data-square="e2"]`. Click the centre of the rect's bounding box. Pieces and markers ignore pointer events.
