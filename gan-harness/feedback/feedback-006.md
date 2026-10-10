# Evaluation - Iteration 006 (Slice 7: Lessons + Rules handbook)

## Evaluation Mode
**Achieved:** `playwright` (installed Chrome, desktop 1280x900 and Pixel 7). Lessons/handbook tested against a clean `git archive HEAD` (6503a23) copy on PORT=4390 (the working tree already contains uncommitted slice-8 files: pro.js, gm.js, modified lessons/index.js), PID killed. Scripts in /tmp/s6*.mjs, screenshots `gan-harness/screenshots/s6-*.png`.
Feedback-005 fixes 1-4 were verified from the commit diff only (not re-driven live, since Playwright could not run concurrently with the e2e gate).

## Hard gates
- `npm test`: 178/178 pass.
- e2e `PW_CHANNEL=chrome npm run test:e2e`: desktop 71 passed (11.0m), mobile 71 passed (2.6m), 0 failed. CAVEAT: it ran on the working tree, which includes slice-8 specs (slice8-pro-gm.spec.js), not pure HEAD.
- Illegal moves: none accepted in any lesson (illegal drops ignored, wrong-but-legal moves undone).
- Console/page errors: none on `#/`, `#/learn`, any of 19 lessons when played normally, `#/rules`, `#/rules?section=draws`, `#/train`, desktop and mobile.
  **FAIL, uncaught page errors on two ordinary lesson interactions** (see Critical 1). I treat this as the "uncaught error" gate, so the score is capped at 4.0.

## Lesson walk-through (HEAD: 19 lessons, not 20: 12 novice + 7 amateur; 4 read, 15 puzzles)
- All 15 puzzles solved in the browser by their main line; all 4 read lessons stepped to the end. Solved state shows "Solved!" and a Next-lesson button.
- Alternative line accepted: Qd1-h5+ in queen-fork. Under-promotion to rook gives "Good idea to promote - but a queen is the strongest choice here" (nice). Qb6 in the stalemate lesson gives a dedicated "Stalemate!" message (excellent). Multi-step wrong 2nd move is undone with "Not quite".
- Chess content check (I verified every FEN by hand): castling conditions (including that only d1/c1 must be safe), en passant ("only on the very next move"), stalemate, scholar's mate, back-rank mates, smothered mate, skewer, fork: all correct. Draw text (claim vs automatic: 3-fold claim / 5-fold auto, 50 claim / 75 auto) correct.
- Content nits:
  - amateur-pin: the e5 knight is also defended by the d6 pawn. f4 Kd7 fxe5 dxe5 wins N for P, not "wins it" cleanly. The scripted reply Kd7 also unpins the knight, which contradicts "cannot move". Choose a position where the knight is undefended.
  - "Win the black bishop with a queen move" accepts only Qa4+ and Qh5+. Reasonable, but prompts that say "queen check" (hint) are good.
  - Wrong-move feedback is generic ("Not quite. Try again - or use a hint.") for every wrong move except stalemate/promotion; no explanation of why (e.g. Rxe5+ dxe5 loses the exchange, or Black's reply to a non-check).
  - Hints do not escalate: every puzzle has one hint, and the second press repeats the same text. There is no "show the move" hint or arrow after the 2nd press.
  - Novice castling-check lesson: castling queenside is the only solution, which is fine; but kingside castling is rejected as an "illegal" drop with no message (feedback stays at the prompt).
  - Scripted replies are legal and natural (Kd7, Kf7), but always the same one; no variation.
- Persistence: `oc.v1.lessons.completed` in localStorage; hub shows "2/12", "3/7" and the cards get a check; survives reload; corrupt value does not crash. Read lessons are marked complete when the last step is reached (even by arrow-skipping) which is acceptable.
- Bad ids: `#/learn/nope` -> "Lesson not found" with link; `#/learn/__proto__` -> generic "Page not found" (fine).

## Rules handbook (`#/rules`, 9 sections with diagrams and Practise links)
Accurate against the FIDE Laws: castling, en passant, promotion ("regardless of pieces still on the board"), check/mate/stalemate, all draws (claim vs automatic, 75-move not if mate), time loss with the 6.9 exception worded correctly. Nits: threefold "claimed by the player to move" omits that the player intending to move may claim; no mention of dead-position / fivefold being mate-exempt, or of the touch-move rule (not enforced, so OK). TOC works (smooth scroll, URL stays `#/rules`; the `?section=` deep link does not scroll to the section on load; `#/rules?section=time` opens at the top). Mobile 412px: no horizontal scroll, readable (s6-m-_rules.png).

## Scores (openings trainer and slice 8+ N/A at HEAD; weights renormalised)
| # | Criterion | Wt | Score | Evidence |
|---|-----------|----|-------|----------|
| 1 | Rules correctness | 20 | 9.0 | No illegal move accepted; content and handbook correct; 178 unit tests, e2e green. |
| 2 | Spec coverage | 20 | 7.0 | Novice and Amateur lessons, puzzles and a handbook exist; Pro/GM/openings absent at HEAD (slice 8 pending). 19 lessons, not 20. |
| 3 | Training quality | 15 | 6.5 | Puzzles sound and alt lines accepted; generic wrong-move text, hint does not escalate, pin lesson flawed. Fixes 1-4 of feedback-005 present in code (banner() text, swing<200 "wins a pawn" cap, no "better" on good for novice/amateur, hanging-piece warning) but not live re-driven. |
| 4 | UX & visual design | 15 | 6.0 | A literal "null" is printed in every puzzle panel before a hint is used (s6-m-_learn_amateur-pin.png, s6-d-_learn_novice-castling.png). Focus is lost to BODY after each Next/Hint press. Otherwise a clean layout and mobile has no overflow. |
| 5 | Fun & retention | 10 | 6.5 | Check marks and per-track counters; no XP or toast on lesson completion; scripted reply has no animation variety. |
| 6 | Robustness & performance | 10 | 5.5 | Two uncaught exceptions (below); otherwise corrupt storage is tolerated. |
| 7 | Online & security | 10 | 9.0 | Not changed; e2e green. |

Raw weighted = (9*20 + 7*20 + 6.5*15 + 6*15 + 6.5*10 + 5.5*10 + 9*10)/100 = **7.2 / 10**. With the console-error gate failing, capped to **4.0**.

## Verdict: FAIL (gate cap 4.0; raw 7.2 would pass)

## Top fixes
1. **Uncaught exceptions in the lesson player timer** (`public/js/screens/learn.js`, `attempt()` setTimeout 450 ms).
   Repro A: `#/learn/amateur-knight-fork`, play Nd5-c7+, immediately navigate to `#/learn` -> `PE this.board.removeMarkers is not a function` and `Cannot read properties of undefined (reading 'position')`.
   Repro B: same move, click Restart within 450 ms -> `Cannot read properties of undefined (reading 'after')`, `invalid square null`, `no piece on null`.
   Fix: keep the timer id, `clearTimeout` it in the returned destroy function and in the Restart handler, reset `busy=false`, and guard `render()` with a destroyed flag.
2. **Literal "null" rendered in every unsolved puzzle panel** (`learn.js` `playPuzzle.render`: `hintsShown ? h(...) : null` is passed to `h()`, which stringifies null). Filter null/false children in `public/js/ui/dom.js` `h()` or build the children array conditionally. Repro: open any puzzle, look below the prompt.
3. **Focus is lost after each activation** (`panel.replaceChildren`): press Enter on Next or Hint and `document.activeElement` becomes BODY, so keyboard users must Tab from the top again. Update the panel in place, or re-focus the equivalent button after render. Also the `role=status` node is recreated on every render, so screen readers may not announce results; keep one persistent live region and change its text.
4. **Escalating hints and specific wrong-move feedback.** Add a second/third hint (the piece to move, then the target square or an arrow) to `hints` in `public/js/data/lessons/*.js`, and add optional per-lesson `wrongReplies` keyed by uci (e.g. Rxe5+ in amateur-pin) displayed by `puzzle.js` instead of the generic text.
5. **Fix `amateur-pin`**: the e5 knight is protected by the d6 pawn and the reply Kd7 breaks the pin; use an unprotected pinned piece and a reply that keeps the pin (`public/js/data/lessons/amateur.js`). Also make `#/rules?section=<id>` scroll to that section on load (`public/js/screens/rules.js`).
