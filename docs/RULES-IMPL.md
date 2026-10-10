# FIDE rules → code → tests

Where each FIDE Law of Chess is enforced. The source of truth is `public/js/core/rules.js`. It wraps chess.js and is shared by the browser and the server.

| FIDE article | Rule | Enforced in | Tests |
|---|---|---|---|
| 3.1–3.8 | Piece movement, captures, check legality | chess.js move generation via `Game.move` / `legalMoves` | `tests/unit/perft.test.js` (5 reference positions) |
| 3.8.2 | Castling: not out of, through, or into check; rights lost after king/rook moves or rook capture | chess.js | `rules.test.js` castling cases; e2e `castling through check` |
| 3.7.d | En passant only on the immediate reply; illegal if it exposes the king | chess.js | `rules.test.js` en passant cases |
| 3.7.e | Promotion to Q, R, B or N, chosen by the player | `#resolve` returns `promotion-required` without a choice; UI promotion picker | `rules.test.js`, e2e `promotion` |
| 5.1.1 | Checkmate ends the game | `status()` | `rules.test.js` fool's mate |
| 5.2.1 | Stalemate is a draw | `status()` | `rules.test.js` |
| 5.2.2 | Dead position by material (K v K, K+minor v K, same-colour bishops) | `core/material.js isInsufficientMaterial` | `material.test.js` |
| 5.1.2 | Resignation | `resign(color)` | `rules.test.js`, e2e |
| 9.1 | Draw by agreement; an offer is declined when the opponent moves | `offerDraw` / `acceptDraw` / `declineDraw` | `rules.test.js`, e2e |
| 9.2 | Threefold repetition: **claim** | `claimableDraws` / `claimDraw('threefold')`. Repetition key = placement + side + castling + en-passant square only if a legal e.p. capture exists | `rules.test.js` |
| 9.3 | Fifty-move rule: **claim** at 100 half-moves | `claimDraw('fifty')` | `rules.test.js` |
| 9.6.1 | Fivefold repetition: **automatic** | `status()` | `rules.test.js` |
| 9.6.2 | Seventy-five-move rule: **automatic** (unless the last move mates) | `status()` checks mate first | `rules.test.js` |
| 6.9 | Flag fall loses, unless the opponent cannot possibly checkmate (then draw) | `flag(color)` + `core/material.js canPossiblyMate` | `material.test.js` |

## Deliberate simplifications

- **Claims.** A threefold or fifty-move claim is accepted when the condition holds on the board. FIDE's "claim by writing down the intended move" is not modelled.
- **Dead positions.** These are detected by material only. Blocked pawn fortresses are not detected.
- **Clocks (Slice 2).** The clock starts after White's first move. Fischer increment is added after each completed move.

chess.js's own `isDraw()` and `isGameOver()` are never used. They treat threefold repetition and the fifty-move rule as automatic, which FIDE does not.
