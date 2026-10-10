import test from 'node:test';
import assert from 'node:assert/strict';
import { createPlayout } from '../../public/js/core/playout.js';

const lesson = (over) => ({ id: 't', success: 'Well done.', ...over });

test('mate goal: checkmate within the limit wins', () => {
  const p = createPlayout(lesson({ fen: '6k1/5ppp/8/8/8/8/8/R5K1 w - - 0 1', goal: 'mate', moves: 2 }));
  assert.equal(p.playerColor, 'w');
  assert.equal(p.movesLeft(), 2);
  const r = p.playerMove('a1a8');
  assert.equal(r.result, 'won');
  assert.equal(r.message, 'Well done.');
  assert.equal(p.over, true);
  assert.equal(p.playerMove('g1h1').result, 'illegal');
});

test('mate goal: running out of moves loses', () => {
  const p = createPlayout(lesson({ fen: '6k1/5ppp/8/8/8/8/8/R5K1 w - - 0 1', goal: 'mate', moves: 1 }));
  const r = p.playerMove('a1a2');
  assert.equal(r.result, 'lost');
  assert.match(r.message, /Out of moves/);
});

test('mate goal: stalemate loses with an explanation', () => {
  const p2 = createPlayout(lesson({ fen: 'k7/8/2K5/8/8/8/8/1Q6 w - - 0 1', goal: 'mate', moves: 5 }));
  const s = p2.playerMove('b1b6');
  assert.equal(s.result, 'lost');
  assert.match(s.message, /Stalemate/);
});

test('moves alternate: the player cannot move on the opponent\'s turn and vice versa', () => {
  const p = createPlayout(lesson({ fen: '8/8/8/4k3/8/8/8/4K2Q w - - 0 1', goal: 'mate', moves: 10 }));
  assert.equal(p.opponentMove('e5e4').result, 'illegal');
  assert.equal(p.playerMove('h1h5').result, 'continue');
  assert.equal(p.playerMove('e1e2').result, 'illegal');
  assert.equal(p.opponentMove('e5e4').result, 'continue');
  assert.equal(p.movesLeft(), 9);
});

test('promote goal: the new piece must survive the reply', () => {
  const fen = '8/1P6/8/8/8/8/k7/2K5 w - - 0 1';
  const p = createPlayout(lesson({ fen, goal: 'promote', moves: 3 }));
  assert.equal(p.playerMove('b7b8q').result, 'continue');
  const r = p.opponentMove('a2a3');
  assert.equal(r.result, 'won');

  const q = createPlayout(lesson({ fen: 'r7/1P6/8/8/8/8/k7/2K5 w - - 0 1', goal: 'promote', moves: 1 }));
  assert.equal(q.playerMove('b7b8q').result, 'continue');
  const lost = q.opponentMove('a8b8');
  assert.equal(lost.result, 'lost');
  assert.match(lost.message, /captured/);
});

test('promote goal: no promotion within the limit loses', () => {
  const p = createPlayout(lesson({ fen: '8/8/1P6/8/8/8/k7/2K5 w - - 0 1', goal: 'promote', moves: 1 }));
  assert.equal(p.playerMove('b6b7').result, 'lost');
});

test('hold goal: surviving the move count wins', () => {
  const p = createPlayout(lesson({ fen: '4k3/8/8/8/8/8/4P3/4K3 b - - 0 1', goal: 'hold', moves: 1 }));
  assert.equal(p.playerColor, 'b');
  assert.equal(p.playerMove('e8d7').result, 'continue');
  assert.equal(p.opponentMove('e2e4').result, 'won');
});

test('hold goal: being mated loses, a draw wins', () => {
  const mated = createPlayout(lesson({ fen: '6k1/5ppp/8/8/8/8/n7/R5K1 b - - 0 1', goal: 'hold', moves: 3 }));
  assert.equal(mated.playerMove('a2c3').result, 'continue');
  const r = mated.opponentMove('a1a8');
  assert.equal(r.result, 'lost');
  assert.match(r.message, /mated/);

  const drawn = createPlayout(lesson({ fen: '8/8/8/4k3/4P3/8/8/K7 b - - 0 1', goal: 'hold', moves: 5 }));
  assert.equal(drawn.playerMove('e5e4').result, 'won'); // king v king: a draw, held
});

test('hold goal: an enemy promotion the player does not capture loses', () => {
  const q = createPlayout(lesson({ fen: '8/1P6/8/8/8/r7/6k1/2K5 b - - 0 1', goal: 'hold', moves: 5 }));
  assert.equal(q.playerMove('g2g3').result, 'continue');
  assert.equal(q.opponentMove('b7b8q').result, 'continue');
  const r = q.playerMove('g3g4');
  assert.equal(r.result, 'lost');
  assert.match(r.message, /promoted/);
});

test('hold goal: capturing the new queen at once keeps the game going', () => {
  const q = createPlayout(lesson({ fen: '8/1P6/8/8/8/8/1r4k1/3K4 b - - 0 1', goal: 'hold', moves: 5 }));
  assert.equal(q.playerMove('g2g3').result, 'continue');
  assert.equal(q.opponentMove('b7b8q').result, 'continue');
  assert.equal(q.playerMove('b2b8').result, 'continue');
  assert.equal(q.opponentMove('d1e2').result, 'continue');
});

test('reset restores the start', () => {
  const p = createPlayout(lesson({ fen: '6k1/5ppp/8/8/8/8/8/R5K1 w - - 0 1', goal: 'mate', moves: 2 }));
  p.playerMove('a1a8');
  p.reset();
  assert.equal(p.over, false);
  assert.equal(p.movesLeft(), 2);
  assert.equal(p.game.fen(), '6k1/5ppp/8/8/8/8/8/R5K1 w - - 0 1');
});

test('hold goal: promoting straight back after an enemy promotion keeps the game level', () => {
  const p = createPlayout(lesson({ fen: '8/2P5/8/K7/8/8/7p/k7 w - - 0 1', goal: 'hold', moves: 3 }));
  assert.equal(p.playerMove('a5b5').result, 'continue');
  assert.equal(p.opponentMove('h2h1q').result, 'continue');
  assert.equal(p.playerMove('c7c8q').result, 'continue');
});
