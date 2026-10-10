import test from 'node:test';
import assert from 'node:assert/strict';
import { createGame } from '../../public/js/core/rules.js';

// Reference node counts from https://www.chessprogramming.org/Perft_Results
const POSITIONS = [
  ['start', 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1', [20, 400, 8902, 197281]],
  ['kiwipete', 'r3k2r/p1ppqpb1/bn2pnp1/3PN3/1p2P3/2N2Q1p/PPPBBPPP/R3K2R w KQkq - 0 1', [48, 2039, 97862]],
  ['position 3', '8/2p5/3p4/KP5r/1R3p1k/8/4P1P1/8 w - - 0 1', [14, 191, 2812, 43238]],
  ['position 4', 'r3k2r/Pppp1ppp/1b3nbN/nP6/BBP1P3/q4N2/Pp1P2PP/R2Q1RK1 w kq - 0 1', [6, 264, 9467]],
  ['position 5', 'rnbq1k1r/pp1Pbppp/2p5/8/2B5/8/PPP1NnPP/RNBQK2R w KQ - 1 8', [44, 1486, 62379]],
];
const DEEP = process.env.PERFT_DEEP === '1';

for (const [name, fen, counts] of POSITIONS) {
  test(`perft ${name}`, () => {
    const game = createGame({ fen });
    const depths = DEEP ? counts.length : Math.min(counts.length, 3);
    for (let d = 1; d <= depths; d++) assert.equal(game.perft(d), counts[d - 1], `depth ${d}`);
    assert.equal(game.fen(), fen, 'perft leaves the position untouched');
  });
}
