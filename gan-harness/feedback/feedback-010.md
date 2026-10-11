# Evaluation - Iteration 010 (Plan 2, slices 11-20, commit 45ed515)

## Evaluation Mode
**Achieved:** `playwright` (installed Chrome, desktop 1280px and Pixel 7 / 360px, service workers allowed for the offline run). Served on PORT=4350 (stopped; PID verified gone). Full e2e and `npm test` not re-run (caller: 120/120). Not live-verified: a correct weekly puzzle answer and a finished weekly game (leaderboard stayed empty in my run: only a wrong answer was submitted), a real Rush game-over with a score (share card), Web Push delivery (Chrome blocked notification permission in the test context; `/api/push/key` answers with a VAPID key).

## Scores (whole app)
| Criterion | Wt | Score |
|---|---|---|
| Rules correctness | 20 | 9.0 |
| Spec coverage | 20 | 8.5 |
| Training quality | 15 | 7.5 |
| UX & visual design | 15 | 7.0 |
| Fun & retention | 10 | 8.0 |
| Robustness & performance | 10 | 7.0 |
| Online & security | 10 | 9.0 |

**Weighted total: 8.0 / 10 - PASS** (threshold 7.0, nothing under 5).
Hard gates: clear for online routes, no console error on any route while online. One gate-adjacent failure offline (issue 1); scored under Robustness rather than capping, because it only occurs with no network.

## Slices 11-20
- 11 Review: 8.5. Fool's mate reviewed in under 1 s; accuracy 38% vs 100%, key moment, blunder text "Better was e4 / This allows Qh4#", arrows, graph, Retry, `#/games` row "0-1 Reviewed". Review result is not deterministic (best move e3 in one run, e4 in the next).
- 12 Puzzles/Rush: 8.5. Library puzzles load, Black-to-move flips the board, solving gave +153, Skip gave -211 on a 933 puzzle at rating 1000 (harsh first swing). 16 theme links. Rush: 4 solved in a row, score and timer correct, 3 pips, relaxed/practice run "not counted". Daily `data-source=library`, also offline.
- 13 Campaign/cosmetics: 7.5. Six boards and two piece sets with locks, `data-board` set, Ocean board looks good. Campaign layout breaks at 360px (issue 3).
- 14 Quests/freezes: 8. Three quests with progress bars on dashboard and profile, freeze counter. Not driven to completion.
- 15 Weak spots: 7. Card created after review, due next day, wrong answer shows arrow and "comes back tomorrow". Answer list is flawed (issue 2).
- 16 Share/challenge: 8.5. Link text correct; accept goes to the right persona; all 5 bad links show "Challenge not found" (no XSS via `acc=<img>`); `rush=12` works.
- 17 Offline: 8. Valid manifest, apple icon, SW controls the page, 129 cached files; offline reload, puzzles, lessons, daily, bot setup and online setup page all load. Weekly fails (issue 1).
- 18 Accounts: 7.5. Register, sync to second context (puzzle stat arrived), sign out, errors for weak/common password and bad name. Error handling clears the form (issue 4). Sign-out leaves the account's progress on the device.
- 19 Reminders: 7.5. UI present only when signed in, time select, graceful "blocked" message, `/api/push/key` ok. Real delivery untestable here.
- 20 Weekly: 7.5. Guest sees the board plus sign-in invitation; signed in shows 10 rated tiles (795 to 2180), 3 games, wrong answer reveals best move "Qe8+", one attempt only; game opens a seeded position with `weekly=0&week=...`. Correct-answer and leaderboard fill not live-verified.

## Prioritised issues
### Critical
1. Offline weekly: unhandled rejection "Failed to fetch" and the page sits on "Loading…" forever. `public/js/screens/weekly.js:40-41` (`Promise.all([loadLeaderboard(), ...])`) and `public/js/store/weekly.js:7` (`call` has no try/catch) -> catch network errors in `call`, return `{ok:false, status:0}`, and show "Weekly challenge needs a connection".

### Major
2. Weak-spot cards can reject the move the review recommended and can hold duplicate answers: observed `"answers":["e2e4","e2e4"]` and a card that said "e4 is not it. The better move was e3" while the review of the same game said "Better was e4". `public/js/core/weakspots.js:19-27` -> dedupe `out`, skip `second` when equal to best, and accept any move within the "not a mistake" threshold of the best at answer time. Make the full-strength review analysis deterministic (single thread / fixed depth) so best move is stable.
3. Campaign at 360px: "Beyond Humans" text overlaps "Beat Magnus the Wizard to unlock", names wrap one word per line. `public/css/*.css:484-487` (`.campaign-stop`, `.stop-info`) -> stack the lock hint under the name at narrow widths (`flex-wrap`, hint `flex-basis:100%`).
4. Sign-in form wipes username and password after any error (`public/js/screens/profile.js:72-77`, `render()` rebuilds inputs). Keep the typed username (store values in variables or do not re-create the form); also the "password contains username" case reports "too easy to guess" instead of a specific message.
5. First rated puzzle skip costs 211 rating (1000 -> 789), which discourages new players. Cap the first-puzzle Glicko deviation effect or show "provisional" (`public/js/core/glicko2.js`, `store` puzzle stats).

### Minor
6. Daily page still shows a raw ISO date "Daily puzzle · 2026-10-11" (carried from 009).
7. Puzzle panel repeats "Black to move" twice plus "Find the best move" (`public/js/screens/puzzles.js`).
8. Mobile dashboard is 14 stacked cards (about 2000 px tall); hero cards first, retention cards far below the fold. Dashboard desktop leaves an orphan empty cell in the last row and a narrow rank card with wrapped "0W / 0D 0L".
9. Signing out keeps the previous account's progress on the device (shared-computer privacy); offer to clear it.
10. Offline `api/me` calls log console errors (`net::ERR_INTERNET_DISCONNECTED`) on every route.

## Come back tomorrow?
Yes, more than at 009: daily puzzle, weekly quests, puzzle rating, Rush, weak spots, campaign stars and a weekly leaderboard give real reasons to return, and the app works offline. What holds it back is polish: layout breaks at 360px in places, long dashboard, flaky weak-spot answers, and a leaderboard that is empty without users.
