# Evaluation - Iteration 009 (Slices 9 and 10, whole MVP, commit cc7b562)

## Evaluation Mode
**Achieved:** `playwright` (installed Chrome, desktop 1280x900 and Pixel 7 / 360px). Served on PORT=4340 (stopped afterwards). Own scripts plus `E2E_PORT=4341 PW_CHANNEL=chrome npx playwright test --project=desktop slice9 slice10` = 13/13 pass. Full e2e and `npm test` not re-run (caller: 88/88). Not live-verified: a real full win vs a bot from the start position (Pip defends Scholar's mate), so the win toast, confetti and achievement on a real win were checked only via code and the daily/lesson paths (confetti counter, toasts and rank-up toast observed there).

## Hard gates
Clear. 0 console/page errors across all my runs (hub, 15 trainer lines, bots, daily, profile, coach, corrupt storage). Corrupt and malformed `oc.v1.profile` values load a clean dashboard/profile without crashing. No illegal move accepted in trainer or games.

## Scores
| Criterion | Wt | Score |
|---|---|---|
| Rules correctness | 20 | 9.0 |
| Spec coverage | 20 | 8.5 |
| Training quality | 15 | 7.5 |
| UX & visual design | 15 | 7.5 |
| Fun & retention | 10 | 7.0 |
| Robustness & performance | 10 | 8.5 |
| Online & security (unchanged) | 10 | 9.0 |

**Weighted total: 8.2 / 10 - PASS** (threshold 7.0, no criterion under 5).
**Slice 9 alone: ~8.2** (spec 9, training 8, UX 8, robustness 8.5). **Slice 10 alone: ~7.4** (spec 8.5, fun 7, UX 7, robustness 7, integrity/economy drags it).

## Slice 9 findings (verified)
- Hub: 15 cards (7 White, 8 Black), ECO/level/summary, no overflow at 360px or Pixel 7.
- Practice: all 15 lines completed by playing the stored moves (first-miss highlight, second-miss arrow confirmed on Italian: "a3 is playable ... Try again" then arrow). "Line complete with 2 mistakes" count correct. "Play it out vs Rookie Rex" and "Next opening" / "All openings" (last) present; +20 XP toast once.
- Badge: transposition 1.Nf3 Nf6 2.c4 e6 3.d4 b6 shows "A04 Reti" until 3...b6, then "E12 Queen's Indian Defence". Copied PGN carries `[Opening "Queen's Indian Defence"] [ECO "E12"]`; a fen= game carries SetUp/FEN and no opening headers. Names/ECO codes I reviewed in opening-names.js and openings.js are accurate.
- Repertoires: Pip (18 runs sampled) plays Bc4 then Qh5 (even Qxf7# when allowed), 1.d4 e5 2.dxe5 lines; Rex steers to Ng5 (Fried Liver prep) and 1.d4 e5 gambits; Hoot plays Scotch/Italian/Ruy Berlin and (as seen) 1.d4 e5 2.e3 / 2.c3 vs the Englund, mildly passive. 

## Slice 10 findings (verified)
- Dashboard: fresh (Pawn, 0 XP, daily puzzle, continue lesson), updates after progress.
- Daily with a mocked clock: day1 +25 lesson +30 daily, streak 1; next day streak 2 (+35); same-day re-solve gives no XP/confetti; day 3 unlocks "Habit forming" and rank-up to Knight with toasts and confetti; skipping days resets streak to 1 and keeps best 3.
- fen= games: bot win from a mate-in-one fen = +5 XP, no confetti, record stays "-". Takeback: Undo is disabled once a coached game has ended (no reopen path found), and `credited` WeakSet guards re-ending, so no double count observed.
- 360px: no horizontal scroll on /, profile, daily, openings, trainer, local, coach. Progress bar has role/aria values; locked state is text "(locked)"; records are a real table with th headers.

## Prioritised issues
### Major
1. **XP farming via coached resign.** Resigning after two coached moves earned +33 XP (15 + 89%/5) and a "Black wins - White resigned" loss; accuracy from one or two moves can reach 90% and unlock "Sharp eye". `public/js/core/progression.js:145-149` (also `public/js/store/profile.js:59-67`) -> require a minimum number of player moves (e.g. 10) for accuracy XP and `bestAccuracy`; zero XP for resigned games under N moves.
2. **Pass-and-play XP is farmable.** 3 instant 2-move resigns = +15 XP; `progression.js:131` -> award 5 XP only when the game reached e.g. 10 plies, or cap per day.
3. **Daily puzzle difficulty is unscaled.** First-ever daily for a new profile (2026-10-11) was "Philidor's legacy" (GM level); `public/js/core/daily.js:11-16` -> weight by player's rank or lessons completed. Also the daily solve also completes the lesson, so a solve pays lesson +25 and daily +30 (two toasts) - `public/js/screens/learn.js:66`; fine but inflates XP.
4. **Wrong-move text claims "is playable" for every miss**, even blunders (Qh5??, f3). `public/js/screens/openings.js:139` -> check with the existing engine/classifier or say "is not the book move".
### Minor
5. Stale coach panel text "Make your move - I'll tell you how it went." after a game has ended (coach lost by mate on first move, no end modal). `public/js/sessions/training-session.js:204` -> show result/summary when `rules` is over.
6. Illegal move in the trainer gives no feedback (re-render only) `openings.js:135`.
7. Daily page shows raw ISO date in crumb ("Daily puzzle . 2026-10-16"); `learn.js` renderDaily.
8. Profile is plain text: stat lines "Games: 0 . Won 0 ..." and a dry table; no per-rank art, no streak flame on profile, no goal teaser ("3 XP to Knight!"). `public/js/screens/profile.js`. Records table has no `<caption>`.
9. Toast stack of "+25 XP / +30 XP" overlays page content (covers achievement cards on profile); stack should auto-clear and not obscure content on mobile.
10. Takeback-after-finish reopen path in coach is unreachable in my tests, so the credit-once rule means a loss followed by takeback and win would count only the first ending (`profile.js:55-59`); acceptable but undocumented.

## Fun and "come back" factor
Good bones: five personas with voice (Pip's "I won?!", "Did I WIN?"), taunts, ranks, daily streak with bonus, 14 achievements, confetti and toasts, openings with ticks, bot repertoires that feel different. Weakness: rewards are thin visually (no animated XP bar, profile page text-only), the economy is exploitable, and the win celebration could not be seen on a genuine game here. Score 7.0.

## Suggestions
1. Add minimum-length rule to every XP source (issues 1-2).
2. Rank-aware daily selection (3).
3. Make profile a small dashboard with rank badge, streak flame, next-reward hints.
