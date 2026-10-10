import test from 'node:test';
import assert from 'node:assert/strict';
import { createPuzzle } from '../../public/js/core/puzzle.js';
import { lessonById } from '../../public/js/data/lessons/index.js';

test('a multi-move puzzle: right moves get the scripted reply, then success', () => {
  const p = createPuzzle(lessonById('amateur-knight-fork'));
  assert.equal(p.hintSquare(), 'd5');
  const first = p.tryMove('d5c7');
  assert.equal(first.result, 'correct');
  assert.equal(first.reply.san, 'Kd7');
  const last = p.tryMove('c7a8');
  assert.equal(last.result, 'solved');
  assert.equal(p.solved, true);
});

test('a wrong move is undone and can be retried', () => {
  const p = createPuzzle(lessonById('amateur-knight-fork'));
  const fen = p.game.fen();
  assert.equal(p.tryMove('d5b6').result, 'wrong');
  assert.equal(p.game.fen(), fen);
  assert.equal(p.tryMove('d5c7').result, 'correct');
});

test('illegal moves are ignored', () => {
  const p = createPuzzle(lessonById('novice-back-rank'));
  assert.equal(p.tryMove('a1h8').result, 'illegal');
});

test('mate puzzles accept any mating move and explain stalemate', () => {
  const p = createPuzzle(lessonById('novice-stalemate'));
  const stalemate = p.tryMove('b1b6');
  assert.equal(stalemate.result, 'wrong');
  assert.match(stalemate.message, /Stalemate/);
  assert.equal(p.tryMove('b1b7').result, 'solved');
});

test('equally good alternative lines are accepted', () => {
  const p = createPuzzle(lessonById('amateur-queen-fork'));
  assert.equal(p.tryMove('d1h5').result, 'correct');
  assert.equal(p.tryMove('h5h4').result, 'solved');
});

test('"any" goals accept any legal move; promotion nudges toward a queen', () => {
  assert.equal(createPuzzle(lessonById('novice-check')).tryMove('e1f2').result, 'solved');
  const promo = createPuzzle(lessonById('novice-promotion'));
  assert.match(promo.tryMove('e7e8n').message, /queen/);
  assert.equal(promo.tryMove('e7e8q').result, 'solved');
});
