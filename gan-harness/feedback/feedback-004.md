# Evaluation - Iteration 004 (Slice 4 taunts + Slice 5 online)

## Evaluation Mode
**Achieved:** `playwright` (installed Chrome, desktop 1280/1440 + Pixel-size 412 touch context). Local server PORT=4360 (limits lifted) plus one default-limits server on 4362; both PIDs killed. Scripts in /tmp/s4. Screenshots `gan-harness/screenshots/s4-*.png`.

## Hard gates: ALL PASS
- `npm test` 140/140. Full e2e (`PW_CHANNEL=chrome --workers=2`): 90/90, none flaky.
- Traversal (`/../package.json`, `%2e%2e%2f`, `%2e%2e/`, `/vendor/../../server/index.js`, `..%2f`): all 404. CSP (frame-ancestors none), nosniff present.
- Console/page errors, failed requests, 4xx/warnings: none on `#/`, `#/play`, local, bot, `#/train`, `#/play/online/new`, `#/room/ABCDEF`, `#/room/x`; none across both-context online sessions or mobile.
- No illegal move accepted online (raw `e2e5` -> `illegal_move`, wrong `ply` -> `stale_ply`).

## Feedback-003 fix verification
- Neutral line on resign: FIXED. Resign vs Hoot -> "Class dismissed. Same time next week?" (no checkmate wording).
- Unknown persona notice / bot pause not costing clock: not re-tested in depth; no regressions in e2e.

## Slice 4 evidence
- Blunder fixture (pro, `...Qg5??`): bot replies Nxg5 and taunt "One should not leave a queen undefended on g5." appears ~0.7 s later; piece and square correct. Per persona: Pip "free queen? For me?", Rex "RAWR!", Wizard "mist. Mine now.", Void "QUEEN ON G5: UNDEFENDED. HARVESTING." Distinct voices, witty, not abusive (s4-blunder-taunt.png).
- Frequency: 12-move game vs Hoot with a deliberately loose opening produced exactly 1 taunt (accurate: hung Bc4). Not spammy; arguably slightly quiet.
- Stale: after resign, only the neutral line, no taunt; navigating to local/new game gives none. Toggle off: `__oc.engines` = 1 (no analyser), no taunts after the blunder.
- Not verified: "great move" praise, allowed-mate and missed-mate-in-1 triggers.

## Slice 5 evidence
- Server hostile inputs (Node `ws`): bad or missing Origin -> HTTP 403. Malformed JSON, `[]`, `null`, unknown type, extra field, `__proto__` type, binary frame, XSS name -> typed error codes, socket alive. 4.5 KB and 2 MB frames -> close 1009. 100-msg burst -> close 1008. Spoofed token -> `bad_token`. Third joiner -> `room_full`. Moving out of turn or the other colour's piece -> `not_your_turn`. HTTP still 200 afterwards.
- Default limits (one user): 5 rooms then `too_many_rooms`; 8 connections then HTTP 429. Sensible for one user, but the quotas are per IP (shared NAT could hit them).
- Two contexts, `tc-3+2`: invite link, join, orientation w/b, clocks idle until the first move then tick (2:58 both sides), moves sync, emote cooldown (5 clicks -> 1 emote), draw offer shown to opponent and decline works, threefold claim enabled only for the player on turn, rematch swaps colours, resign shows the same result on both sides, reload resumes seat and fen.
- Disconnect: opponent gets "disconnected" feed line plus "Opponent left. You can claim the win in 57s" with disabled Claim button (s4-takeover-old.png). Reconnect -> "is back".
- Unicode and punctuated name (`O'Brien-Zoë 7`) renders as text. Empty name blocked.
- Mobile 412px: create, join and tap-move work, no horizontal scroll (412/412), controls reachable (s4-m-game.png). The mobile order is banner, clock, board, emotes, controls, moves, feed; fine.

## Scores (training, retention N/A; weights renormalised over 75%)
| # | Criterion | Wt | Score | Evidence |
|---|-----------|----|-------|----------|
| 1 | Rules correctness | 20 | 9.0 | Server-authoritative moves, threefold claim, resign, agreement all correct online and local. |
| 2 | Spec coverage (built) | 20 | 8.5 | Local, bot x5, online room, taunts. Training N/A. |
| 4 | UX and visual design | 15 | 8.0 | Clean room UI, mobile fine. Gaps: no takeover notice, no join-time room check, `#/play/online` 404. |
| 5 | Fun (built) | 10 | 8.0 | Taunts accurate and in character, toggleable; sparse. No records/XP yet. |
| 6 | Robustness and performance | 10 | 8.5 | No stale taunts, workers freed, 0 console noise. |
| 7 | Online and security | 10 | 9.0 | Every hostile probe handled; limits sensible. |

Weighted: (9.0*20 + 8.5*20 + 8.0*15 + 8.0*10 + 8.5*10 + 9.0*10) / 85 = **8.6 / 10**

## Verdict: PASS (>= 7.0, nothing under 5, gates clear)

## Top fixes
1. **Second-tab takeover is silent on the old tab.** Repro: join a room, copy `sessionStorage['oc.room.<ID>']` into a second tab of the same context, open the room link. The old tab still looks live (banner "White to move", no "taken over" message, ws state unclear). Fix: send a `replaced` message or close code to the old socket and show a banner with a "Take back" button in `server/index.js` / `public/js/sessions/online-session.js` and `public/js/net/online-client.js`.
2. **Room link to a non-existent room shows the Join form first.** Repro: `#/room/ZZZZZZ` -> "Join game / Enter your name" and the error only comes after submit. Add a lightweight HTTP or ws `peek` so a missing or full room shows its state immediately (third joiner got "already has two players" only after typing a name). `public/js/screens/online.js`.
3. **Declined draw not announced to the offerer.** Repro: W offers draw, B clicks decline; W's feed ends at "White offers a draw." with no "declined" line (bot mode does say it). `public/js/sessions/online-session.js`.
4. **Taunts quiet in ordinary play.** 1 taunt in 12 moves of a loose game. Consider occasionally praising or teasing inaccuracies, but this is tuning, not a bug. `public/js/core/taunts.js`.
5. Polish: `#/play/online` returns "Page not found" (alias it to `/new`); the `too_many_rooms` / 429 messages were only checked at protocol level, so confirm they are shown readably in the UI.

## Not verified
- Flag fall online, 60 s abandon claim enabled state (button shown disabled at 57 s), fifty-move claim, mate-related taunts, great-move praise, second tab on mobile.
