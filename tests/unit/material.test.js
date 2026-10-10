import test from 'node:test';
import assert from 'node:assert/strict';
import { createGame } from '../../public/js/core/rules.js';

const insufficient = (fen) => createGame({ fen }).status().reason === 'insufficient';
const canMate = (fen, color) => createGame({ fen }).canPossiblyMate(color);

test('automatic draw: no side can ever checkmate', () => {
  assert.ok(insufficient('k7/8/8/8/8/8/8/K7 w - - 0 1'), 'K v K');
  assert.ok(insufficient('k7/8/8/8/8/8/8/KB6 w - - 0 1'), 'KB v K');
  assert.ok(insufficient('k7/8/8/8/8/8/8/KN6 w - - 0 1'), 'KN v K');
  assert.ok(insufficient('kb6/8/8/8/8/8/8/K1B5 w - - 0 1'), 'KB v KB, same-colour bishops');
  assert.ok(insufficient('k7/8/8/8/8/2B5/1B6/K1B5 w - - 0 1'), 'several bishops all on dark squares');
});

test('not insufficient when a mate is still possible', () => {
  assert.ok(!insufficient('k7/8/8/8/8/8/8/KNN5 w - - 0 1'), 'KNN v K can be mated with help');
  assert.ok(!insufficient('kb6/8/8/8/8/8/8/KB6 w - - 0 1'), 'opposite-colour bishops');
  assert.ok(!insufficient('kn6/8/8/8/8/8/8/KB6 w - - 0 1'), 'KB v KN');
  assert.ok(!insufficient('k7/8/8/8/8/8/P7/K7 w - - 0 1'), 'a pawn can promote');
});

test('FIDE 6.9: can the opponent of a flagged player possibly checkmate?', () => {
  assert.equal(canMate('k7/8/8/8/8/8/8/K7 w - - 0 1', 'w'), false, 'bare king');
  assert.equal(canMate('k7/8/8/8/8/8/8/KN6 w - - 0 1', 'w'), false, 'K+N v bare K');
  assert.equal(canMate('k7/8/8/8/8/8/8/KB6 w - - 0 1', 'w'), false, 'K+B v bare K');
  assert.equal(canMate('7k/6p1/8/8/8/8/8/K1N5 w - - 0 1', 'w'), true, 'K+N v K+P: helpmate possible');
  assert.equal(canMate('kb6/8/8/8/8/8/8/K1B5 w - - 0 1', 'w'), false, 'same-colour bishops');
  assert.equal(canMate('kb6/8/8/8/8/8/8/KB6 w - - 0 1', 'w'), true, 'opposite-colour bishops');
  assert.equal(canMate('k7/8/8/8/8/8/8/K6R w - - 0 1', 'w'), true, 'K+R');
  assert.equal(canMate('k7/8/8/8/8/8/8/KNN5 w - - 0 1', 'w'), true, 'K+N+N');
  assert.equal(canMate('k6q/8/8/8/8/8/8/K7 w - - 0 1', 'w'), false, 'white has only a king');
  assert.equal(canMate('k6q/8/8/8/8/8/8/K7 w - - 0 1', 'b'), true);
});

test('flag applies FIDE 6.9', () => {
  const lost = createGame({ fen: 'k7/8/8/8/8/8/8/K6R w - - 0 1' });
  lost.flag('b');
  assert.deepEqual(lost.status(), { over: true, result: '1-0', winner: 'w', reason: 'timeout' });
  const drawn = createGame({ fen: 'k6q/8/8/8/8/8/8/K7 w - - 0 1' });
  drawn.flag('b');
  assert.deepEqual(drawn.status(), { over: true, result: '1/2-1/2', winner: null, reason: 'timeout-vs-insufficient' });
});
