# Evaluation - Iteration 001 (Slice 1)

## Evaluation Mode
**Achieved:** `playwright` (installed Google Chrome via `channel: 'chrome'`, desktop 1440x900, Pixel 7, 768x1024, 320x640). Throwaway scripts in /tmp/ev. Screenshots: `gan-harness/screenshots/`.

## Hard gates: ALL PASS
- `npm test`: 39/39 pass.
- `PW_CHANNEL=chrome npx playwright test --workers=2`: 26/26 pass (desktop + mobile).
- Traversal (curl --path-as-is): `/../package.json`, `/%2e%2e/package.json`, `/%2e%2e%2fpackage.json`, `/vendor/../../server/index.js`, `/..%2f..%2fetc/passwd`, `/%252e%252e/package.json`, `/vendor/%2e%2e/%2e%2e/package.json` all 404; backslash and NUL paths 400; POST 405. CSP, nosniff, frame-ancestors none, COOP, Referrer-Policy present.
- Console/page errors on `#/`, `#/play`, `#/train`, `#/play/local` at all 4 viewports: none.
- No illegal move accepted in any probe (castle through/out of check, pinned en passant, move after game over, review-mode input).
- Advertised modes usable; unbuilt modes are disabled "Coming soon" tiles that do not navigate (clicking online/computer stays on `#/play`).

## Rules probes (real UI)
- Stalemate (`7k/8/4Q1K1/8/8/8/8/8 w`, Qe6-f7): over, 1/2-1/2, "Draw by stalemate".
- Insufficient material by capture (Kxe2 knight): auto draw, reason `insufficient`.
- Fifty: claim disabled at halfmove 98/99, enabled at 100, game stays `playing`; claim gives "Draw by the fifty-move rule". 75-move auto-draws at 150. Mate delivered at halfmove 150 gives checkmate (mate wins).
- Underpromotion: r, b, q, n all produce the right piece.
- Pinned en passant (`8/8/8/K2pP2r/8/8/8/7k w - d6`): exd6 rejected, e5-e6 allowed.
- Check highlight (red king square) and "Black to move - check!" banner; last-move highlight present.
- Review: ArrowLeft/Home/ArrowRight/End work, input blocked in review, `data-review` toggles.
- Copy PGN/FEN via clipboard: PGN has proper headers, SAN, `*`; FEN start adds `[SetUp "1"][FEN ...]`. Resign: "White wins - Black resigned", controls disabled after end. Draw offer: own button disabled, opponent sees offer.
- Invalid FEN (empty board, `<script>`, 600-char tail): toast + start position fallback.

## Scores (Slice 1 applicable criteria; 3, 5, 7 N/A)
| # | Criterion | Weight | Score | Evidence |
|---|-----------|--------|-------|----------|
| 1 | Rules correctness | 20 | 9.0 | All probes above correct, reasons/results text correct. Deductions: illegal FEN (side not to move in check, e.g. `7k/8/5QK1/8/8/8/8/8 w`) is accepted; fivefold repetition not probed in UI (unit-covered). |
| 2 | Spec coverage (Slice 1) | 20 | 7.5 | Home->local in 2 clicks, all Slice 1 testids present, Coming soon handled cleanly. Deduction: all five computer cards show identical copy "Five personalities, from gentle to merciless." (`public/js/screens/home.js`) and are cramped/wrapped into 3 columns. |
| 4 | UX & visual design | 15 | 7.5 | Clean, coherent (serif headings, green accent), legal dots/check/last-move good, no horizontal scroll at 320/412/768/1440, modal has role=dialog, aria-modal, aria-labelledby, focus trap, focus on primary button, 3px focus outline. Deductions below. |
| 6 | Robustness | 10 | 7.0 | No errors, bad FEN handled, arrow keys ignored in modal. Not tested: corrupt localStorage (nothing persisted yet), workers (none). |

Weighted (renormalised over 65%): (9.0*20 + 7.5*20 + 7.5*15 + 7.0*10) / 65 = **7.9 / 10**

## Verdict: PASS (threshold 7.0; no applicable criterion below 5.0; hard gates clear)

## Top fixes (highest impact first)
1. Mobile game layout buries controls: on Pixel 7 (`mobile-game.png`) Resign/Draw/Claim/PGN are ~1000px below the fold, and on a 320px viewport tabbing to "Flip" scrolls the page 350px so the sticky header (36px board squares at y=9) overlaps/intercepts board taps (my click at f2 hit the header "Play" link and navigated away). Repro: viewport 320x640, open `#/play/local`, press Tab 3x, click board. Fix: make board+controls fit, add `scroll-margin-top` / `scroll-padding-top` equal to header height in `public/css/app.css`, consider a compact control bar under the board.
2. Empty-looking UI chrome in game screen: move list is a tall empty white box before the first move, player cards show nothing under the name (captured/material empty), feed shows only "New game". Repro: open `#/play/local` (`desktop-game.png`). Fix: placeholder text ("No moves yet"), collapse empty list, `public/js/ui/game-screen.js`.
3. Computer/Training tiles are placeholder-quality: five identical descriptions, narrow 3-col cards wrap titles to 3-4 lines ("Pro - Professor Hoot"). Repro: `#/play` (`desktop-play.png`). Fix: per-level one-line description, 1-col list or wider cards, `public/js/screens/home.js`.
4. `?fen=` accepts positions where the side not to move is in check (illegal). Repro: `#/play/local?fen=7k/8/5QK1/8/8/8/8/8 w - - 0 1` loads and play proceeds oddly. Fix: validate in `public/js/core/rules.js` FEN loader (reject if opponent king attacked).
5. Game-over modal is not dismissible with Escape (dialog count stays 1 after Esc); only "Review game" closes it. Repro: resign, press Esc. Fix: `dismissible: true` for game-over in `public/js/ui/game-screen.js`/`modal.js`. Also modal result title for draws reads "Draw" while the score font is oversized relative to reason; minor.

## Minor
- "Offer draw"/"New game" labels wrap to two lines in the control grid; a lone "New game" button leaves an orphan row (desktop and mobile).
- Pass & Play on mobile places board above the status banner, so "check!" banner is off-screen after a move.
