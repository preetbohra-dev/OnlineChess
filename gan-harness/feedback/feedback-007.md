# Evaluation — Iteration 007 (Slice 8: Pro and Grand Master tracks, Stockfish playouts)

## Evaluation Mode
**Achieved:** `playwright` (system Chrome, desktop 1280x900 and Pixel 7, own server on port 4310). The repo e2e spec `tests/e2e/slice8-pro-gm.spec.js` was run on port 4311 (desktop): 6/6 pass. The full earlier-slice suite and `npm test` were NOT re-run, so the regression gate is unverified.

## Scores (slice-8 scope; criteria renormalised to what is built)
| Criterion | Score | Weight | Note |
|---|---|---|---|
| Rules correctness | 8.5 | 20% | Playout state machine correct: mate, stalemate (explicit message), out of moves, mate against you. |
| Spec coverage | 8.0 | 20% | Both tracks, 5 playouts and 4 puzzles present. "vs Stockfish" labels and `playout-moves` correct. |
| Training quality | 7.5 | 15% | Real engine opposition, hints, restart work. Wording and learning-value gaps below. |
| UX & visual design | 6.5 | 15% | Mobile layout pushes the board below the fold. |
| Fun & retention | 6.5 | 10% | Playouts are satisfying but short. Win feedback is plain text only. |
| Robustness & performance | 8.5 | 10% | No console errors. Engines return to 0 on leaving. |
| Online multiplayer | N/A | - | Not touched. |

Weighted total (renormalised over the six scored criteria): **7.6 / 10 — PASS** (threshold 7.0, no criterion under 5).

## Test evidence
- #/learn shows Pro (0/7) and Grand Master (0/5) tracks. Playout cards carry a "VS STOCKFISH" tag. No horizontal scroll at 412 or 1280 px.
- Played to completion with the repo's Stockfish choosing my moves:
  - K+Q: won after 7 moves (budget 12).
  - K+R: won after 10 moves (budget 20).
  - Lucena: won after 13 moves.
  - Philidor: held all 15 moves.
  - Réti: held for 8 moves; Black queened, I queened, "Drawn!" shown.
- Losses:
  - Hanging the queen in K+Q gives "Draw — not enough material" (see issue 3).
  - Philidor, playing the worst moves: "Checkmate — you were mated".
  - Stalemate in `playout.js`: "Stalemate! ... Leave it a square." (checked with a node harness, not in the browser).
  - Out-of-moves path reviewed in `playout.js:76-77`, not exercised in the browser.
- Hints: first press gives text. Second press adds the second hint and one `.marker-hint`. An illegal click does not change the FEN or the budget. Restart restores 12 of 12 and the start FEN.
- `globalThis.__oc.engines` was 1 while a playout was open and 0 after leaving, in every run.
- Puzzles:
  - Greek gift: a wrong move gives "Not quite", the solution line is accepted.
  - Opposition: accepted.
  - Philidor's legacy and Saavedra (queen rejected, rook accepted): pass in the e2e spec.
- Zero page or console errors on desktop and mobile.

## Critical Issues
None.

## Major Issues
1. **Mobile playout puts the board below the fold.** On Pixel 7 the instruction card, moves counter, hint and buttons take about 1,000 CSS px before the board starts (see `/tmp/ev8/rook-m.png`). The player must scroll to move, then scroll back to read feedback. → Put the board first on narrow screens, or make the panel compact and sticky. Look at the `.lesson-panel` layout in `public/css`.
2. **The playouts barely test strong players.** With `?engine=fast` (depth 6), K+Q mate takes 7 moves of a 12-move budget and K+R takes 10 of 20. Wins arrive with no accuracy or efficiency feedback, so a Pro or GM player gets little from them. → Add a result summary (moves used, optimal count), a par/star rating, and tighter budgets, for example K+Q within 10 and K+R within 16.
3. **The loss message is wrong when you give away material.** After the queen is hung in K+Q mate, the lesson says "Draw — there is not enough material left to checkmate" (`playout.js:46`). That hides that the player blundered the queen. → Detect the player's material loss and say "You lost your queen".

## Minor Issues
1. **Hint 2 wording is unclear.** It reads "The highlighted piece has the engine's move", which sounds like the opponent's move. → Say "Try moving the highlighted piece".
2. **Greek gift success text overclaims.** "Mate on h7 can only be delayed" is too strong for a position where Black has Nd7 and ...Bxg5. The engine test only checks the first move. → Soften the wording, or validate the full line with Stockfish.
3. **`pro-opposition` is oversimplified.** It starts with the king already on the sixth rank, and the summary promises "opposition". Only two winning first moves are accepted. → Add a start where the opposition matters, such as Ke5 vs Ke7.
4. **Réti is a "hold" goal.** The text "Kg7–f6–e5" describes a line Stockfish may not play. A pass can be a K+Q vs K+Q draw, which does not teach the idea. → Judge by a draw reached through the diagonal king walk.
5. **Win feedback is plain text.** Slice 10 retention work is outstanding, so this is not scored down yet.

## What Improved
- Real engine-backed lessons are working end to end: the move budget, win/lose states, a restartable engine and no leaked engines.

## Screenshots
`/tmp/ev8/learn-d.png`, `/tmp/ev8/rook-m.png`, `/tmp/ev8/greek-d.png`, `/tmp/ev8/greek-m.png`, `/tmp/ev8/rook-d.png`.
