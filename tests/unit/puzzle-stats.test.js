import test from 'node:test';
import assert from 'node:assert/strict';
import { createStore, memoryBackend } from '../../public/js/store/storage.js';
import { loadPuzzleStats, recordPuzzle, recordRush, markSeen, loadLibrary, pinDaily } from '../../public/js/store/puzzle-stats.js';
import { bus } from '../../public/js/core/events.js';

const fresh = () => createStore({ backend: memoryBackend() });

test('rated attempts move the rating, count results, remember recent puzzles and announce', () => {
  const store = fresh();
  const seen = [];
  const off = bus.on('puzzle:result', (e) => seen.push(e));
  const a = recordPuzzle({ id: 'p1', rating: 1200 }, true, { store });
  const b = recordPuzzle({ id: 'p2', rating: 900 }, false, { store });
  off();
  assert.ok(a.change > 0 && b.change < 0);
  const s = loadPuzzleStats(store);
  assert.equal(s.solved, 1);
  assert.equal(s.failed, 1);
  assert.deepEqual(s.recent, ['p1', 'p2']);
  assert.equal(s.history.length, 2);
  assert.equal(seen.length, 2);
  markSeen('p1', store);
  assert.deepEqual(loadPuzzleStats(store).recent, ['p2', 'p1']);
});

test('Rush keeps the best score', () => {
  const store = fresh();
  assert.equal(recordRush(7, store).best, true);
  assert.equal(recordRush(5, store).best, false);
  assert.equal(loadPuzzleStats(store).rushBest, 7);
  assert.equal(loadPuzzleStats(store).rushRuns, 2);
});

test('damaged stats load as defaults within bounds', () => {
  const store = fresh();
  store.set('puzzles', { rating: 'x', rd: -5, recent: [1, 'ok'], history: [[1], ['d', 1000]], rushBest: -2 });
  const s = loadPuzzleStats(store);
  assert.equal(s.rating, 1000);
  assert.equal(s.rd, 30);
  assert.deepEqual(s.recent, ['ok']);
  assert.equal(s.history.length, 1);
  assert.equal(s.rushBest, 0);
});

test('the library is fetched once, and a failed fetch can be retried', async () => {
  let calls = 0;
  const failing = async () => { calls++; return { ok: false, status: 500 }; };
  await assert.rejects(loadLibrary(failing));
  const ok = async () => { calls++; return { ok: true, json: async () => ({ puzzles: [['a']] }) }; };
  assert.deepEqual(await loadLibrary(ok), [['a']]);
  assert.deepEqual(await loadLibrary(ok), [['a']]);
  assert.equal(calls, 2);
});

test('the daily puzzle is pinned for the day, whatever happens to the rating', () => {
  const store = fresh();
  const picks = [];
  const choose = (rating) => { picks.push(rating); return `d${rating}`; };
  assert.equal(pinDaily('2026-10-11', choose, store), 'd1000');
  recordPuzzle({ id: 'x', rating: 2500 }, true, { store });
  assert.equal(pinDaily('2026-10-11', choose, store), 'd1000');
  assert.notEqual(pinDaily('2026-10-12', choose, store), 'd1000');
  assert.equal(picks.length, 2);
});
