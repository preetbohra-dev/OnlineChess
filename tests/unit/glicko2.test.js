import test from 'node:test';
import assert from 'node:assert/strict';
import { update, ratePuzzle, DEFAULT_RATING, MIN_RD } from '../../public/js/core/glicko2.js';

test('matches the worked example in Glickman\'s Glicko-2 paper', () => {
  const r = update({ rating: 1500, rd: 200, vol: 0.06 }, [
    { rating: 1400, rd: 30, score: 1 },
    { rating: 1550, rd: 100, score: 0 },
    { rating: 1700, rd: 300, score: 0 },
  ]);
  assert.ok(Math.abs(r.rating - 1464.06) < 0.1, String(r.rating));
  assert.ok(Math.abs(r.rd - 151.52) < 0.1, String(r.rd));
  assert.ok(Math.abs(r.vol - 0.05999) < 0.0001, String(r.vol));
});

test('no games only widens the deviation', () => {
  const r = update({ rating: 1500, rd: 50, vol: 0.06 }, []);
  assert.equal(r.rating, 1500);
  assert.ok(r.rd > 50);
});

test('solving a puzzle raises the rating, failing lowers it, harder puzzles count more', () => {
  const up = ratePuzzle(DEFAULT_RATING, 1000, true);
  const down = ratePuzzle(DEFAULT_RATING, 1000, false);
  assert.ok(up.rating > 1000 && down.rating < 1000);
  const hard = ratePuzzle(DEFAULT_RATING, 1600, true);
  assert.ok(hard.rating > up.rating);
  assert.ok(up.rd < DEFAULT_RATING.rd);
  let p = DEFAULT_RATING;
  for (let i = 0; i < 200; i++) p = ratePuzzle(p, p.rating, i % 2 === 0);
  assert.ok(p.rd >= MIN_RD, 'deviation never collapses');
  assert.ok(Math.abs(p.rating - 1000) < 150);
});

test('ratings stay within bounds and never become NaN', () => {
  const r = ratePuzzle({ rating: 3190, rd: 50, vol: 0.06 }, 3190, true);
  assert.ok(r.rating <= 3200);
  assert.ok(ratePuzzle({ rating: 150, rd: 50, vol: 0.06 }, 400, false).rating >= 100);
  // A broken input gives back the player unchanged rather than storing NaN.
  const player = { rating: 1000, rd: 50, vol: Infinity };
  assert.deepEqual(ratePuzzle(player, 1000, true), player);
});
