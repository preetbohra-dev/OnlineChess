import test from 'node:test';
import assert from 'node:assert/strict';
import { createStore, memoryBackend } from '../../public/js/store/storage.js';
import { loadProfile, recordEvent, resetProfile, trackProgress } from '../../public/js/store/profile.js';
import { bus } from '../../public/js/core/events.js';
import { DAILY_POOL, dailyPuzzle } from '../../public/js/core/daily.js';

const fresh = () => createStore({ backend: memoryBackend() });
const won = { over: true, winner: 'w', reason: 'checkmate', result: '1-0' };

test('events update the stored profile and are announced', () => {
  const store = fresh();
  const seen = [];
  const off = bus.on('profile:change', (c) => seen.push(c));
  recordEvent({ type: 'lesson' }, { store });
  off();
  assert.equal(loadProfile(store).lessons, 1);
  assert.equal(seen.length, 1);
  assert.equal(seen[0].xp, 25);
  resetProfile(store);
  assert.equal(loadProfile(store).xp, 0);
});

test('trackProgress turns app events into profile records, with the right colour per mode', () => {
  const store = fresh();
  const off = trackProgress({ store });
  bus.emit('game:end', { kind: 'bot', status: won, session: { kind: 'bot', playerColor: 'w', persona: { id: 'pro' } } });
  bus.emit('game:end', { kind: 'online', status: won, session: { kind: 'online', you: () => 'b' } });
  bus.emit('game:end', { kind: 'training', status: won, session: { kind: 'training', playerColor: 'w', summary: () => ({ accuracy: 80 }) } });
  bus.emit('game:end', { kind: 'local', status: won, session: { kind: 'local' } });
  bus.emit('opening:complete', { id: 'italian' });
  bus.emit('daily:solved', { day: '2026-10-11' });
  off();
  const p = loadProfile(store);
  assert.deepEqual(p.bots.pro, { w: 1, d: 0, l: 0, streak: 1, best: 1 });
  assert.deepEqual(p.online, { w: 0, d: 0, l: 1 });
  assert.equal(p.training.bestAccuracy, 80);
  assert.equal(p.games.played, 4);
  assert.equal(p.openings, 1);
  assert.equal(p.daily.streak, 1);
  // Unsubscribed: further events change nothing.
  bus.emit('opening:complete', { id: 'scotch' });
  assert.equal(loadProfile(store).openings, 1);
});

test('a game from a set-up position is practice: XP but no record', () => {
  const store = fresh();
  const off = trackProgress({ store });
  const rules = { history: () => [{ before: '6k1/5ppp/8/8/8/8/8/R5K1 w - - 0 1' }], fen: () => '' };
  bus.emit('game:end', { kind: 'bot', status: won, session: { kind: 'bot', playerColor: 'w', persona: { id: 'beyond' }, rules } });
  off();
  const p = loadProfile(store);
  assert.equal(p.bots.beyond, undefined);
  assert.equal(p.achievements['beat-beyond'], undefined);
  assert.equal(p.xp, 5);
});

test('a game that ends twice (takeback, then a new ending) is credited once', () => {
  const store = fresh();
  const off = trackProgress({ store });
  const session = { kind: 'training', playerColor: 'w', summary: () => ({ accuracy: 70 }) };
  bus.emit('game:end', { kind: 'training', status: won, session });
  bus.emit('game:end', { kind: 'training', status: won, session });
  off();
  assert.equal(loadProfile(store).training.games, 1);
  assert.equal(loadProfile(store).games.played, 1);
});

test('lessons finished before the profile existed count toward achievements', () => {
  const backend = memoryBackend();
  const store = createStore({ backend });
  store.set('lessons.completed', Array.from({ length: 10 }, (_, i) => `lesson-${i}`));
  const off = trackProgress({ store });
  off();
  const p = loadProfile(store);
  assert.equal(p.lessons, 10);
  assert.ok(p.achievements.student);
  assert.equal(p.xp, 0, 'catching up awards no XP');
  resetProfile(store);
  assert.ok(loadProfile(store).achievements.student, 'a reset re-syncs the counters');
});

test('a corrupt stored profile loads as a fresh one', () => {
  const backend = memoryBackend();
  backend.setItem('oc.v1.profile', '{not json');
  assert.equal(loadProfile(createStore({ backend })).xp, 0);
});

test('the daily puzzle is a real puzzle, the same all day, and changes from day to day', () => {
  assert.ok(DAILY_POOL.length >= 10);
  assert.ok(DAILY_POOL.every((l) => l.type === 'puzzle' && !l.rule));
  assert.equal(dailyPuzzle('2026-10-11').id, dailyPuzzle('2026-10-11').id);
  const week = new Set(['2026-10-11', '2026-10-12', '2026-10-13', '2026-10-14', '2026-10-15', '2026-10-16', '2026-10-17'].map((d) => dailyPuzzle(d).id));
  assert.equal(week.size, 7);
  const all = new Set();
  for (let i = 0; i < DAILY_POOL.length; i++) all.add(dailyPuzzle(`2026-01-${String(i + 1).padStart(2, '0')}`).id);
  assert.equal(all.size, DAILY_POOL.length, 'every puzzle comes round once per cycle');
});
