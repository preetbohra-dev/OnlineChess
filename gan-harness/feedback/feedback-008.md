# Evaluation - Iteration 008 (Slices 7 and 8 re-evaluation, commit 2300f34)

## Evaluation Mode
**Achieved:** `playwright` (installed Chrome, desktop 1280x900 and Pixel 7). Served from a clean `git archive 2300f34` copy on PORT=4320 (PID stopped afterwards). `npm test` and the full e2e suite were NOT re-run by me (the caller reports 75/75 desktop and 75/75 mobile). Playout games were driven by a Node Stockfish (depth 16) choosing the player's moves, `?engine=fast`.

## Verification of previous issues
| Issue | Result |
|---|---|
| Uncaught errors: correct move then navigate away within 450 ms | FIXED. 0 page errors (timer cleared on destroy). |
| Same, Restart within 450 ms | FIXED. 0 errors, board and prompt reset. |
| Literal "null" in puzzle panel | FIXED. |
| Focus lost after Next/Hint/Restart | FIXED. activeElement stays on the button (after the final Next it moves to Back, acceptable). |
| Escalating hints + "Show the move" arrow | FIXED. Button relabels to "Show the move", an arrow is drawn on the board, hint piece highlighted. |
| Explained wrong moves | FIXED. Specific text (e.g. "puts your rook where it can simply be taken", "too slow", "gives your opponent time to defend"; Saavedra queen has a custom message; Greek gift h5 gets the check hint). |
| amateur-pin | NOT cleanly fixed, see Major 1. Defender removed, but a new flaw appeared. |
| `#/rules?section=` | FIXED. Scrolls on load and on hashchange (`castling` lands at top 72 px; `draws`/`time` scroll to page bottom because the page is short there). Unknown section is harmless. |
| Mobile lesson layout (Pixel 7) | FIXED. Board at y=142-522 of 839, panel directly below, no horizontal scroll, on puzzle, playout and read lessons. |
| Playout budgets/par/summary | FIXED. K+Q 10 (par 8), K+R 20 (par 16). Win text appends "Done in 7 moves - par is 8. Excellent technique!" or the try-quicker variant. Hold goal says "You held for N moves". |
| Queen captured loss message | FIXED. Qe4?? gives "Your queen was captured - without it there is no way to checkmate. Keep your pieces protected." |
| Opposition playout | IMPROVED. Now Ke4 vs Ke8 with pawn on e2 (kings must fight first), 12 moves. My plain-best-move engine driver ran out of moves (it shuffles; the repo test uses a pawn-push heuristic), so I could not confirm it live. |
| Greek gift text | FIXED. Softened to "Black can only stop it by giving up a lot of material". Hint 2 now says "Try moving the highlighted piece". |

## Regression / hard gates
- Console and page errors: 0 across all runs (desktop and mobile, lessons, playouts, rules).
- Illegal moves: none accepted. Playouts won live: K+Q (7 of 10, par 8), K+R (10 of 20, par 16), Lucena (12 of 15). Philidor and Reti were not completed by my driver (it stalled before the budget), so they were not re-verified here.
- Engines: no errors on leaving a playout.

## Scores
| Criterion | Wt | Score |
|---|---|---|
| Rules correctness | 20 | 9.0 |
| Spec coverage | 20 | 8.0 |
| Training quality | 15 | 7.0 |
| UX & visual design | 15 | 7.5 |
| Fun & retention | 10 | 6.5 |
| Robustness & performance | 10 | 8.5 |
| Online & security (unchanged) | 10 | 9.0 |

Weighted: (180 + 160 + 105 + 112.5 + 65 + 85 + 90) / 100 = **8.0 / 10**. Slice 7 alone ~7.8, Slice 8 alone ~8.1 (previous 7.6).

## Verdict: PASS (threshold 7.0, no criterion under 5, hard gates clear)

## Prioritised issues
### Major
1. **amateur-pin accepts only f4, but Rxe5+ simply wins the knight.** With the d6 pawn gone the knight on e5 is undefended, so Rxe5+ wins it at once. The puzzle rejects it with "Rxe5+ is not the strongest move here", which is false and teaches the wrong thing. The success text "Black has only one move to unpin" is also wrong (Kd7, Kf7, Kd8, Kf8 all unpin). `public/js/data/lessons/amateur.js` -> make the knight defended again by a piece that makes Rxe5+ lose material (and the pin visibly matter), or add Rxe5+ as an accepted alternative and reword.
### Minor
2. Opposition playout is not live-verified here, and an engine choosing the best move in the usual way does not finish inside 12 moves. Consider 14 moves, or a hint that says to push when the key square is gained.
3. Par is looser than real play (K+Q won in 7 vs par 8, K+R in 10 vs par 16), so "Excellent technique" appears almost always. Tighten par to about 7 and 12.
4. Panel shows an empty gap between "You play White against Stockfish" and "Moves left" (the live region element takes layout space). Collapse it.
5. Wrong-move text for unremarkable moves is still generic ("is not the strongest move here") in puzzles without a custom `wrong` entry.
6. Win feedback is still plain text (slice 10 retention scope).
