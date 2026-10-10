# OnlineChess — Evaluator Rubric (Playwright mode)

Score each criterion 0-10. Weighted average must be >= 7.0 to PASS, and no applicable criterion
below 5.0. Criteria whose slice is not yet built are N/A; renormalize weights.
Run against `npm start` (Playwright webServer). Use `?engine=fast`, `?fen=`, `?seed=`, `page.clock`
as needed. Rely on `data-testid` hooks and `[data-testid=game][data-fen]`.

## Hard gates (any failure caps the total score at 4.0)
- `npm test` fails, or any earlier-slice e2e spec regresses.
- Any illegal move is accepted (local, bot, online, lesson).
- Uncaught console error or unhandled rejection on any main route.
- Static server serves a file outside `public/` (try `/../package.json`, `%2e%2e%2f`).
- App fails to load, or a mode advertised as available is unusable.

## Criteria
| # | Criterion | Weight | What to check |
|---|-----------|--------|---------------|
| 1 | Rules correctness | 20% | Castling restrictions, en passant (incl. pinned), all 4 promotions, mate/stalemate, threefold and fifty are claims (not automatic), fivefold and 75 are automatic (mate wins), insufficient-material auto-draw, resign, agreement, flag loss vs FIDE 6.9 draw, increment applied. Result and reason text correct. |
| 2 | Spec coverage | 20% | Normal: local pass-and-play, online share-link room, vs computer with 5 levels (Novice/Amateur/Pro/GM/Beyond Humans). Taunts on blunders. Training: feedback after EVERY move including "what was better" and "what you missed"; lessons Novice to GM including openings and endgames ("closings"); openings trainer; rules handbook. |
| 3 | Training quality | 15% | Coach grade sensible (blunder fixture flagged Blunder, book move not flagged), best-move arrow present, missed-tactic/threat text specific, Novice text plain (no evals) vs GM text with evals/PV, hint and takeback work, end summary shows accuracy, lesson solutions accepted including alternate mates. |
| 4 | UX & visual design | 15% | Any mode reachable from home in <= 3 clicks, readable layout, legal-move dots, last-move/check highlight, smooth animation, dark/light theme, mobile (Pixel 7) usable with tap-to-move, no horizontal scroll, no overlap. Screenshot each main screen. |
| 5 | Fun & retention | 10% | Distinct personas (name/avatar/voice), taunts witty, specific, not abusive and toggleable, sounds, confetti on win, XP/rank progress, per-bot records/streaks, achievement toasts, daily puzzle streak, all persisting across reload. |
| 6 | Robustness & performance | 10% | Bot reply within persona budget (+1 s), coach feedback within ~2 s at default depth, no stale taunt/coach after takeback/new game, UI responsive during analysis, workers terminated on navigation, corrupt localStorage does not crash. |
| 7 | Online multiplayer & security | 10% | Two contexts: create/join/sync/clocks/resign/draw/rematch/reconnect after reload; raw illegal, malformed or oversized ws frames rejected without crash; third joiner gets `room_full`; display names rendered as text (try `<img src=x onerror=alert(1)>`); security headers present (CSP, nosniff, frame-ancestors). |

## Score anchors (per criterion)
- 0-3: missing or broken; core flows fail.
- 4-6: present but partial, buggy, or confusing; notable gaps vs spec.
- 7-8: complete and correct for the slice; minor polish issues only.
- 9-10: complete, polished, delightful; edge cases handled; would make a player return.

## Output (`gan-harness/feedback/iteration-NN.md`)
- Per-criterion score with 1-3 evidence bullets (selector/assertion or screenshot path).
- Hard-gate results.
- Weighted total, PASS/FAIL.
- Top 3 highest-impact fixes, each with repro steps.
