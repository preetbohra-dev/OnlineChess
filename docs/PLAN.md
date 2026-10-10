# OnlineChess MVP — Implementation Plan

Produced by the ECC `orch-build-mvp` pipeline (Phase 2, `planner` agent). Size tier: **large**.

## 1. Intake

**Spec (user):** two modes. **Normal Mode**: Against Person / Against Computer (Novice, Amateur, Pro,
Grand Master, Beyond Humans); the computer taunts the player on blunders. **Training Mode**: learn chess,
openings, endgames ("closings") for every level from novice to Grand Master; after every move, explain
what could have been better and what the player missed. Fun, makes players come back. All rules and
regulations of chess.

**Locked decisions (user-approved)**
- Engine: Stockfish 19 lite-single WASM (GPL-3.0) in a Web Worker, so the repo is licensed GPL-3.0.
  Verified options: Threads 1, Hash, MultiPV 1-256, Skill Level 0-20, UCI_LimitStrength,
  UCI_Elo 1320-3190, UCI_ShowWDL, Move Overhead. Runs in Node too (used for real-engine tests).
- Against Person: same-device pass-and-play **and** online rooms via share link.
- Scope: full MVP, all slices, one `feat:` commit per slice after Gate 2.
- Stack: vanilla ES modules, no build step; Node `http` + `ws` server; `node --test` + Playwright.
- Reuse: `chess.js` 1.4.0 (BSD-2), `cm-chessboard` 8.15.3 (MIT), `ws` 8.x (MIT).
- Vendoring: `scripts/vendor.mjs` copies exact files from `node_modules` to `public/vendor/`
  (committed; drift caught by `vendor-sync.test.js`). The server has a single static root.
- Own promotion picker; hash routes; test hooks `?fen= ?tc= ?engine=fast ?seed=`;
  game root exposes `data-testid="game" data-fen data-status`.

**Out of scope:** accounts/auth/server persistence, matchmaking/spectators/ratings, free-text chat
(emotes only), variants, premoves, PGN import, cloud sync, i18n, deployment/TLS, multi-threaded
Stockfish, dead-position detection beyond material, FIDE "claim with intended move" (claims are
allowed when the condition holds on the current position), takebacks outside Training.

## 2. Layout

```
package.json  playwright.config.js  LICENSE  README.md  .gitignore
scripts/   vendor.mjs  verify-content.mjs  calibrate.mjs
server/    index.js  static.js  rooms.js  protocol.js  rate-limit.js
public/    index.html  css/  vendor/{chess.js,cm-chessboard,stockfish}/
  js/main.js router.js
  js/core/      rules material clock events classify tactics explain opening-detect xp achievements daily rng
  js/engine/    uci-engine uci-parse transport-worker personas book analysis
  js/sessions/  local bot online training lesson
  js/net/       online-client
  js/store/     storage settings progress profile
  js/ui/        board-view game-screen move-list player-card clock-view feed controls modal
                promotion-picker toast confetti sound coach-panel arrows
  js/screens/   home local-setup bot-setup online-lobby train-home coached-setup learn-hub
                lesson-player openings rules-handbook profile settings
  js/data/      personas taunts coach-phrases book openings eco-lite lessons/{novice,amateur,pro,gm}
                puzzles achievements rules-handbook
tests/ helpers/ unit/ engine/ content/ server/ e2e/
docs/  PLAN.md PROTOCOL.md ARCHITECTURE.md
gan-harness/ eval-rubric.md feedback/
```

**Core contracts (fixed in slices 1 and 3)**
- `core/rules.js` `createGame({fen})`: `legalMoves`, `move` returns `{ok, san, ...}` or
  `{ok:false, reason}`, `status()` (reasons: checkmate, stalemate, fivefold, seventyfive,
  insufficient, threefold-claim, fifty-claim, resign, agreement, timeout, timeout-vs-insufficient,
  abandon), `claimableDraws`, `claimDraw`, `resign`, `agreeDraw`, `flag`, `undo`, `history`, `fen`,
  `pgn`, `positionKey` (ep square only if an ep capture is legal). Never uses chess.js
  `isDraw()`/`isGameOver()` (they treat fifty-move and threefold as automatic).
- Session interface driven by `ui/game-screen.js`: `{rules, players, clocks?, canMove, submitMove,
  actions:{resign, offerDraw, acceptDraw, claimDraw, takeback?, hint?}, on(event, cb)}`.
- `core/events.js` bus: `game:end`, `lesson:complete`, `puzzle:solved`, `opening:mastered`.
- `engine/uci-engine.js`: option discovery, `go({fen, moves, movetime, depth, multipv})` returns
  `{bestmove, lines[]}`, `stop`, `newGame`, `terminate`; serialized queue, generation counter,
  watchdog restart.

## 3. Slices

Every slice: `npm test` green, its Playwright spec and all earlier specs green, no console errors.

| # | Slice | Size | Security trigger |
|---|-------|------|------------------|
| 1 | Scaffold + local pass-and-play with full FIDE rules (perft, castling, ep incl. pin, promotion, claim vs automatic draws, insufficient material), move-list review, resign/draw/claim, PGN/FEN copy, static server with CSP + traversal protection | L | yes (static server) |
| 2 | Clocks + time controls (increment, FIDE 6.9 timeout vs insufficient material), settings, WebAudio sounds, dark/light theme, animations | M | no |
| 3 | Against Computer: vendored Stockfish, UCI adapter (worker + Node transport), 5 personas, book moves, thinking indicator | L | no |
| 4 | Move classification (lichess win% thresholds) + persona taunts (specific, cooldown, no-repeat, toggle, stale guard) | M | no |
| 5 | Online rooms via share link: server-authoritative rules + clocks, resign/draw/claims/rematch/emotes, reconnect token, abandon timer; strict protocol validation, rate limits, Origin check, caps, crypto ids | L | **yes (main surface)** |
| 6 | Training coached game: grade, better move + arrow, missed tactics, what the move allowed, opening principles, threat warnings, level-adapted text, hint, takeback, accuracy summary | L | no |
| 7 | Learn hub + lesson player (read/puzzle), Novice + Amateur curriculum, rules handbook; engine-validated content | L | no |
| 8 | Pro + GM curriculum, playout lessons (K+Q, K+R, Lucena, Philidor, Saavedra, Réti, Greek gift, smothered mate) | M | no |
| 9 | Openings trainer (15 openings: walkthrough + quiz), opening detection badge, persona book | M | no |
| 10 | Retention: profile/XP/ranks, per-bot records + streaks, ~12 achievements, daily puzzle + streak, confetti, home dashboard, a11y pass, README | M | no |

**Key test anchors**
- Perft: start d1-4 (20/400/8902/197281), Kiwipete d1-3 (48/2039/97862), pos3 d1-4
  (14/191/2812/43238), pos4 d1-3 (6/264/9467), pos5 d1-3 (44/1486/62379).
- Rules: castling out of/through/into check, rights lost on king/rook move or rook capture; ep only
  immediately and illegal when horizontally pinned (`8/8/8/KPp4r/8/8/8/7k w - c6 0 2`); all four
  promotions; threefold and fifty are claims, fivefold and seventy-five are automatic (mate wins);
  insufficient material (K v K, KB v K, KN v K, same-colour bishops; not KB v KB opposite, not KNN v K);
  FIDE 6.9 (bare-king opponent draws, K+N vs flagged K+P loses, K+R vs K loses).
- Personas: Novice = Skill 0 + depth 1-2 + seeded weak MultiPV picks; Amateur Elo 1400 / 300 ms;
  Pro 1900 / 600 ms; GM 2600 / 1000 ms; Beyond Humans unlimited / 3000 ms; clamp to remaining/30
  when a clock runs.
- Classification: winning chances `2/(1+e^(-0.00368208*cp))-1`; drop >= 0.1 inaccuracy, >= 0.2
  mistake, >= 0.3 blunder. Accuracy `103.1668*e^(-0.04354*dWin%) - 3.1669`.
- Content: every lesson/puzzle/opening validated for legality and goal, plus a real-engine tier.
- Online: `move` carries expected `ply`; flag checked before a move applies; maxPayload 4 KB;
  20 msg/s; 8 connections/IP; 500 rooms; names `[\p{L}\p{N} _-]{1,20}` rendered via `textContent`;
  128-bit seat tokens compared in constant time.

**`data-testid` convention:** `mode-normal mode-training opt-local opt-online opt-computer game
status-banner move-list move-item clock-white clock-black btn-resign btn-offer-draw btn-accept-draw
btn-claim-draw btn-flip btn-copy-pgn btn-copy-fen btn-new-game btn-rematch btn-hint btn-takeback
game-over-modal game-result game-reason feed-item[data-kind] coach-grade arrow-best opening-name
promo-q|r|b|n`.

## 4. Risks

| Risk | Mitigation |
|------|-----------|
| Worker/WASM under file:// | Serve via `npm start`; detect `file:` and show a banner |
| WASM MIME / CSP | `application/wasm`; CSP `'wasm-unsafe-eval'`; tested |
| UCI_Elo floor 1320 | Novice via Skill 0 + weak MultiPV picks; `calibrate.mjs` ordering check |
| chess.js auto-draw semantics | Wrapper owns repetition/fifty logic; claim vs automatic tested |
| Wrong lesson content | Two-tier automated validation including the real engine |
| Stale async results | Generation counter + FEN tag; worker restart; Playwright rapid-takeback test |
| Mobile touch | `touch-action:none`, tap-to-move, Pixel 7 project |
| Online abuse | Schema, payload cap, rate limit, caps, GC, Origin check, crypto tokens, security review |
| GPL compliance | LICENSE, vendored Copying.txt, README credits |

## 5. Order and gates

Slices 1 to 10 in order. Slice 4 needs 3; 6 reuses 4; 8 needs 7; 9 replaces 3's book data;
10 consumes events emitted since 1. Slices 1 and 5 get `security-reviewer` at Gate 2.
Unbuilt modes show "Coming soon"; the evaluator scores only applicable criteria.
