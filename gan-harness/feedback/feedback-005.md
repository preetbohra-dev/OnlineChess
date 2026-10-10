# Evaluation - Iteration 005 (Slice 6 coached game + online fixes)

## Evaluation Mode
**Achieved:** `playwright` (installed Chrome; desktop 1280x900 and Pixel 7 emulation). Local server PORT=4380 (limits lifted), PID killed. Scripts in /tmp/s5. Screenshots `gan-harness/screenshots/s5-*.png`. Stockfish 19 (node_modules) was used to check claims independently.

## Hard gates
- `npm test`: 154/154 pass.
- e2e `PW_CHANNEL=chrome npm run test:e2e`: 64 passed, 0 failed, 0 flaky. CAVEAT: the run ended at 15.0 min (the globalTimeout), with other Playwright runs sharing the machine. Only one "passed" summary is in the log, so I cannot confirm the mobile project finished. Earlier iteration had 90 tests. Treat mobile e2e as UNVERIFIED, not failed.
- Console/page errors and warnings: none on `#/`, `#/play`, `#/play/local`, `#/train`, `#/train/coach`, `#/train/coach/play`, `#/play/online`, `#/play/online/new`, `#/room/ZZZZZZ`, nor during desktop and mobile coached games.
- Illegal moves: none accepted (illegal clicks ignored). Traversal not re-tested (no server change observed).

## Feedback-004 fix verification
1. Second-tab notice: not re-driven live (covered by the modified slice5 e2e, which passed on desktop).
2. `#/room/ZZZZZZ`: FIXED. Shows "That room does not exist any more. Rooms close after a while..." immediately, with a "Create a new game" action (s5-m-room-missing.png).
3. Declined-draw notice: not re-driven live (e2e desktop passed).
5. `#/play/online`: FIXED, opens the setup page ("Play a friend online").

## Training quality evidence
- **Every move gets feedback:** 10 of 10 played moves got a grade and a headline (e.g. "Nf3 · Excellent"). The one "no feedback" in my log was my script clicking during the bot's turn.
- **Truth of claims, verified by hand or with Stockfish:**
  - 1.e4 e5 2.Nf3 ...Qg5??: "allows Nxg5, which wins your queen" is true.
  - Fool's mate position, ...Nc6: "You missed checkmate: Qh4#!" is true, and the mate was delivered in the next run (accuracy 100%, "Black wins by checkmate").
  - `r3k3/p7/8/3N4/8/8/8/4K3 b`, ...a6: "allows Nc7+, which forks the king and rook" is true.
  - Bxf7+? "Kxf7 wins your bishop" is true. Novice Bg5 "Blunder... allows b5" matches SF (+0.65 to -2.49). GM Nd5 "Blunder (+0.1 to -2.7)" matches SF (-3.4 after exd5). Grades are sensible, with no false blunders in 20 graded moves.
  - Weak spot: "b5, which wins a pawn" understates what SF scores as a -2.5 swing. It is a tactic-label gap, not a falsehood.
- **Level voice:**
  - Novice: plain ("Ouch, that was a blunder."), no numbers, plus opening tips ("Develop knights and bishops first").
  - Amateur: names the tactic (fork).
  - Pro: adds evals ("Evaluation now -9.5 for you").
  - Grandmaster: eval transitions and "Main line: Nc6 d4 exd4 Nxd4 Nf6 Nxc6".
- **Latency (default depth):** 0.26 to 1.4 s from the move to the feedback appearing on desktop (0.29 to 0.45 s with `engine=fast`). Well inside the 2 s target. Bot replies take about 0.3 to 1.7 s.
- **Threat warning:** after d3 and ...b5 threats, the panel showed "Watch out! Black wants to play b5 next." (coach-threat). I saw one trigger in about 16 moves. Not clear whether the orange arrow rendered (screenshot s5-threat-novice.png).
- **Hint:** the first press shows 1 `.marker-hint`, the second shows 1 `.arrow-info`. Works.
- **Takeback:** 3 rapid clicks undid 6 plies exactly (back to 1.e4 e5), and the panel kept the e4 feedback (correct, no stale grade).
- **Blunder pause:** after a mistake the game pauses with "Try again / Continue". Bot does not reply until the user chooses. Good teaching flow, but see issue 1 below.
- **Summary:** `coach-summary` shows "Your accuracy: 100% | Great find: 1". Correct for a one-move game. Longer-game accuracy not cross-checked against lichess.
- **Mobile (Pixel 7):** the panel sits under the board at 380 px wide, readable. Scroll width equals viewport width (412/412). Hint, Undo and the other buttons are tappable. Tap-to-move works.

## Scores (lessons, openings, handbook and retention N/A; weights renormalised)
| # | Criterion | Wt | Score | Evidence |
|---|-----------|----|-------|----------|
| 1 | Rules correctness | 20 | 9.0 | No regressions, 154 unit tests pass, no illegal moves accepted in coached games. |
| 2 | Spec coverage (built) | 20 | 7.5 | Training is partly built: coached game works, but lessons, openings trainer and handbook are absent. "What was better" and "what you missed" are present on every graded move. |
| 3 | Training quality | 15 | 8.5 | Accurate, tiered, fast. Minus: the banner bug, threat is sparse, and "Better was a4" (move 5) is a poor suggestion for a "Good" move. |
| 4 | UX and visual design | 15 | 8.0 | Clean panel, clear arrows (red refutation, green better move). Banner bug below. |
| 5 | Fun (built) | 10 | 8.0 | Coach persona and praise ("Great find"). No XP or records yet. |
| 6 | Robustness and performance | 10 | 8.0 | Feedback under 1.5 s, no stale feedback. Deduction because the e2e suite hit the 15 min timeout. |
| 7 | Online and security | 10 | 9.0 | Room-missing message and `/play/online` fixed. Not re-attacked. |

Weighted: (9*20 + 7.5*20 + 8.5*15 + 8*15 + 8*10 + 8*10 + 9*10) / 100 = **8.3 / 10**

## Verdict: PASS (>= 7.0, nothing under 5, gates clear apart from the mobile e2e caveat)

## Top fixes
1. **Banner shows the wrong colour in the blunder pause.** Repro: `#/train/coach/play?level=amateur&color=b&fen=rnbqkbnr/pppp1ppp/8/4p3/4P3/5N2/PPPP1PPP/RNBQKB1R b KQkq - 1 2`, play d8-g5. The banner says "White to move . try that move again, or continue the game", but the player is Black and it is Black's move (s5-blunder-grandmaster-def.png, s5-m-coach-blunder.png). Fix the pause banner text in `public/js/sessions/training-session.js` (derive the colour from the pre-move turn or `inputColor()`).
2. **Tactic labels are understated.** After Bg5?, "b5, which wins a pawn" while the eval swing is about -2.5 (the bishop is attacked). Check the material calculation in `public/js/core/explain.js` / `tactics.js` and use the full static exchange or the PV material, not the first capture.
3. **"Better was a4" for a Good move in the opening.** Repro: novice game 1.e4 c6 2.Nf3 e6 3.Bc4 Qc7 4.Nc3 Nf6 5.Be3?? Suggestions below a threshold (about 0.2 pawns) should be suppressed or phrased as a style note at Novice/Amateur; the engine's tiny preference reads as a mistake.
4. **Threat warnings are rare.** One in about 16 moves, and only for pawn-attack threats. Confirm the orange `coach-threat` arrow is drawn and extend coverage to hanging pieces and forks after the opponent's move (`public/js/core/tactics.js`).
5. **e2e suite duration.** The desktop project alone took 15 min and was cut at the globalTimeout. Check the slow coach and online tests (the engine wake-up wait, 30 s timeouts) so the full suite finishes well inside the budget, and re-run mobile.

## Not verified
- Second-tab takeover and declined-draw notices live (relied on the e2e that passed on desktop).
- Mobile e2e completion; accuracy figures for long games against the lichess formula; Beyond Humans level; the arrow colour for threats.
