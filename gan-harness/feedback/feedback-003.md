# Evaluation - Iteration 003 (Slice 3: Against the Computer)

## Evaluation Mode
**Achieved:** `playwright` (installed Chrome, desktop 1440x900 + Pixel 7). Own server on PORT=4340 (PID killed at end). Scripts in /tmp/ev3. Screenshots `gan-harness/screenshots/s3-*.png`.
Caveat: the working tree is already mid-Slice 4/5 (taunts analyser, online server files, `main.js` starts a second analysis engine). `__oc.engines` is therefore 2 on a bot game page (game engine + taunt analyser), 0 after leaving. Scored as found.

## Hard gates: ALL PASS
- `npm test`: 85/85. `PW_CHANNEL=chrome npx playwright test --workers=2`: 62/62 (no regressions in slices 1-2, slice 3 spec included).
- Traversal (`/../package.json`, `%2e%2e%2f`, `%2e%2e/`, `/vendor/../../server/index.js`): all 404. `.wasm` served `application/wasm`; `Copying.txt` served.
- Console errors / page errors: none on `#/`, `#/play`, `#/play/bot/new` (with/without/garbage persona), `#/play/bot` with bad persona/color/tc/seed/fen, at 1440 and 412 wide. No failed requests, no 4xx.
- No illegal bot move in ~10 full games (~250 bot replies; each result FEN checked against rules.js legal moves). No illegal player move accepted.

## Probe results
- Latency (reply time after my move, non-book, real settings): Novice ~280 ms (floor `minThinkMs` 350 incl. click), Amateur ~270-360, Pro ~520, GM ~1.1 s, Beyond ~2.9 s (budget 3 s). All within persona budget +1 s. `engine=fast`: ~270-285 ms. Novice not "beyond 3 s" at any point.
- No input while thinking: clicks and drags on own pieces, and on the bot's pieces, during "Deep Void is thinking..." leave `data-fen` unchanged. Banner shows "Black to move . Deep Void is thinking...".
- Bot never moved out of turn; resign while bot thinking: game ends `resign`, no late bot move applied.
- Bot first move as White (Deep Void) and as Black (`color=b`): both fine, board orientation `b` correct. Greeting in feed per persona, voice distinct (Hoot "Mind your weak squares", Void "CONNECTION ESTABLISHED. CALCULATING YOUR DEFEAT.").
- Mate vs bot: fool's mate -> modal "Deep Void wins / 0-1 / Black wins by checkmate", feed "GAME OVER. HUMANITY 0, VOID 1.". Random-vs-bot games end correctly (mate, insufficient, fivefold).
- Draw offer: bot declines with persona line + "Black declines the draw." Button stays enabled afterwards (fine).
- Timed: `tc=1+0` 38-move game, bot used ~13 s of 60 s, never flagged itself. At `tc=0.2+0` the bot flags at 0:00.0 (350 ms floor per move exceeds its budget); result shows "Draw - time ran out, but the opponent cannot checkmate" (correct per FIDE 6.9 in that position).
- Navigation mid-think: leaving 600 ms after my move -> `engines` 0 immediately, nothing fires in the next 4.5 s, no console errors.
- Invalid links: `tc=garbage`, `fen=garbage` give toasts; unknown persona silently falls back to Pip.

## Scores (training, online, retention N/A; weights renormalised over 75%)
| # | Criterion | Wt | Score | Evidence |
|---|-----------|----|-------|----------|
| 1 | Rules correctness | 20 | 9.0 | Bot games exercise mate, insufficient, fivefold, flag vs 6.9, resign; 85 unit tests + e2e green. |
| 2 | Spec coverage (built part: 5 levels) | 20 | 8.0 | 5 personas, colour, tc, setup, hooks (`engine=fast`, `seed`), Stockfish credit. Taunts N/A. |
| 4 | UX & visual design | 15 | 8.0 | Setup cards read well on both sizes (s3-desk-setup-beyond, s3-m-setup); game screen fits, no h-scroll, banner shows thinking. Desktop setup leaves right half empty; mobile persona grid orphans Deep Void. |
| 5 | Fun (personas/feed only) | 10 | 7.5 | Distinct avatars, voices, win/lose/draw lines. No sounds check for bot, no records/XP yet. |
| 6 | Robustness & performance | 10 | 8.0 | Latency in budget, worker terminated on nav, stale answers guarded via generation counter. Warning noise below. |

Weighted: (9.0*20 + 8.0*20 + 8.0*15 + 7.5*10 + 8.0*10) / 75 = **8.2 / 10**

## Verdict: PASS (threshold 7.0, no criterion < 5.0, gates clear)

## Top fixes
1. **Resignation gets a checkmate line.** Repro: `#/play/bot?persona=pro&color=w`, play 1.e4, resign while bot thinks -> feed shows "Checkmate. Class dismissed." (`botWins` used for any win). Fix in `public/js/sessions/bot-session.js` `changed()`: pick the line by `status.reason` (separate `botWinsResign`/`botWinsTime` pools in `public/js/data/personas.js`).
2. **cm-chessboard console warnings after fast play.** Repro: play fast moves (click-click right after bot reply) vs `engine=fast`; in ~50% of ~10 games `console.warn("invalid square null")` and `"no piece on null"` from `vendor/cm-chessboard/src/view/VisualMoveInput.js:186` (a deferred `setPieceVisibility(null)` after the move input is reset). Not an error but noisy; guard in `public/js/ui/board-view.js` by cancelling move input (`board.disableMoveInput()` / `enable`) on the bot's `change` before applying the position, or ignore when `fromSquare` is null.
3. **First click is lost right after load.** Repro: open `#/play/bot?persona=novice&color=w`, click e2 then e4 immediately after `[data-testid=game]` appears -> move not made (works after ~200 ms). Enable board input only after the board is mounted, or queue the click, `public/js/ui/game-screen.js` / `board-view.js`.
4. **Bot flags itself at very short controls.** `tc=0.2+0` (12 s): the 350 ms `minThinkMs` floor can exceed the bot's budget, so it flags on a won-for-it position. Use `min(minThinkMs, remaining/30)` in `bot-session.js` `botMove()`.
5. Polish: draw-offer reply took >1.3 s once under load (600 ms timer); show a "thinking about it" status. Unknown `persona=zzz` silently becomes Pip; toast it. Desktop setup page: right half empty, put colour/time beside the cards. Stale toasts stack when changing routes quickly.

## Not verified
- Novice weakness curve (does it hang pieces as advertised), Elo calibration, opening book length, Esc/keyboard on setup radios (inputs are visually hidden; Playwright cannot click the radio directly, labels work).
- One unreproduced flake: a fresh Chrome page timed out waiting for `[data-testid=game]` once in a 4-page loop (not seen in 6 reruns).
