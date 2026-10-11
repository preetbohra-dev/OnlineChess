import test from 'node:test';
import assert from 'node:assert/strict';
import { classifyMove, winChances, winPercent, moveAccuracy, scoreToCp } from '../../public/js/core/classify.js';

test('winning chances are symmetric and saturate', () => {
  assert.equal(winChances(0), 0);
  assert.ok(Math.abs(winChances(300) + winChances(-300)) < 1e-12);
  assert.ok(winChances(10_000) > 0.999);
  assert.equal(winPercent(0), 50);
});

test('mate scores convert to large centipawn values, sooner mates first', () => {
  assert.ok(scoreToCp({ mate: 1 }) > scoreToCp({ mate: 5 }));
  assert.ok(scoreToCp({ mate: 5 }) > 5_000);
  assert.ok(scoreToCp({ mate: -2 }) < -5_000);
  assert.equal(scoreToCp({ cp: 37 }), 37);
});

test('grades follow the lichess thresholds', () => {
  assert.equal(classifyMove({ bestCp: 30, playedCp: 30, isBest: true }).grade, 'best');
  assert.equal(classifyMove({ bestCp: 30, playedCp: 25 }).grade, 'excellent');
  assert.equal(classifyMove({ bestCp: 30, playedCp: -10 }).grade, 'good');
  assert.equal(classifyMove({ bestCp: 30, playedCp: -60 }).grade, 'inaccuracy');
  assert.equal(classifyMove({ bestCp: 30, playedCp: -120 }).grade, 'mistake');
  assert.equal(classifyMove({ bestCp: 30, playedCp: -900 }).grade, 'blunder');
});

test('threshold boundaries are inclusive', () => {
  // Find the played eval that drops exactly 0.3 from equality and check both sides of it.
  const cpForChances = (c) => Math.log((1 + c) / (1 - c)) / 0.00368208;
  const exact = cpForChances(-0.3);
  assert.equal(classifyMove({ bestCp: 0, playedCp: exact - 0.001 }).grade, 'blunder');
  assert.equal(classifyMove({ bestCp: 0, playedCp: exact + 0.5 }).grade, 'mistake');
});

test('losing a mate is a blunder; staying winning big is not', () => {
  assert.equal(classifyMove({ bestCp: scoreToCp({ mate: 2 }), playedCp: 50 }).grade, 'blunder');
  assert.notEqual(classifyMove({ bestCp: 1500, playedCp: 1100 }).grade, 'blunder', 'still totally winning');
});

test('the only good move is a great find', () => {
  assert.equal(classifyMove({ bestCp: 200, playedCp: 200, secondCp: -200, isBest: true }).grade, 'great');
  assert.equal(classifyMove({ bestCp: 200, playedCp: 200, secondCp: 180, isBest: true }).grade, 'best');
});

test('accuracy is 100 for a perfect move and falls with the win-percent drop', () => {
  assert.ok(moveAccuracy(0) > 99.9);
  assert.ok(moveAccuracy(10) < moveAccuracy(2));
  assert.equal(moveAccuracy(100), 0);
});
