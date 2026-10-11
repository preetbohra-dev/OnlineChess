import test from 'node:test';
import assert from 'node:assert/strict';
import { createGame } from '../../public/js/core/rules.js';
import { materialBalance, sanLine, materialSwing, hangingPieces, forkTargets, listPieces } from '../../public/js/core/tactics.js';

test('material balance from either side', () => {
  const g = createGame({ fen: '4k3/8/8/8/8/8/8/R3K3 w - - 0 1' });
  assert.equal(materialBalance(g, 'w'), 5);
  assert.equal(materialBalance(g, 'b'), -5);
});

test('SAN lines stop at the first illegal move', () => {
  assert.deepEqual(sanLine('rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1', ['e2e4', 'e7e5', 'g1f3'], 6), ['e4', 'e5', 'Nf3']);
  assert.deepEqual(sanLine('rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1', ['e2e4', 'e2e4'], 6), ['e4']);
});

test('material swing over a capture sequence', () => {
  // After 1.e4 e5 2.Nf3 Qg5?? Nxg5: White wins the queen.
  assert.equal(materialSwing('rnb1kbnr/pppp1ppp/8/4p1q1/4P3/5N2/PPPP1PPP/RNBQKB1R w KQkq - 2 3', ['f3g5'], 'w'), 9);
});

test('hanging pieces: attacked and undefended only', () => {
  const g = createGame({ fen: '4k3/8/8/3n4/8/8/8/3QK3 w - - 0 1' }); // Qd1 hits the lone knight on d5
  assert.deepEqual(hangingPieces(g, 'b'), [{ type: 'n', square: 'd5' }]);
  const defended = createGame({ fen: '4k3/8/4p3/3n4/8/8/8/3QK3 w - - 0 1' });
  assert.deepEqual(hangingPieces(defended, 'b'), []);
});

test('a knight forking king and rook', () => {
  const g = createGame({ fen: 'r3k3/2N5/8/8/8/8/8/4K3 b - - 0 1' });
  const targets = forkTargets(g, 'c7');
  assert.deepEqual(targets.map((t) => t.type).sort(), ['k', 'r']);
  assert.equal(listPieces(targets.sort((a, b) => (a.type === 'k' ? -1 : 1))), 'the king and rook');
});
