import test from 'node:test';
import assert from 'node:assert/strict';
import { createStore, memoryBackend } from '../../public/js/store/storage.js';
import { listGames, gameById, saveGame, attachReview, trackGames, savedGameId, MAX_GAMES } from '../../public/js/store/games.js';
import { bus } from '../../public/js/core/events.js';
import { createGame, START_FEN } from '../../public/js/core/rules.js';

const fresh = () => createStore({ backend: memoryBackend() });
const record = (id) => ({ id, date: '2026-10-11T10:00:00.000Z', kind: 'local', white: 'A', black: 'B', playerColor: null, result: '1-0', reason: 'resign', startFen: START_FEN, moves: ['e2e4'] });

test('games are kept newest first, capped, and invalid records are dropped', () => {
  const store = fresh();
  for (let i = 0; i < MAX_GAMES + 5; i++) saveGame(record(`game${String(i).padStart(4, '0')}`), store);
  const games = listGames(store);
  assert.equal(games.length, MAX_GAMES);
  assert.equal(games[0].id, `game${String(MAX_GAMES + 4).padStart(4, '0')}`);
  store.set('games', [record('ok0001'), { id: '../x', moves: [] }, { ...record('bad0001'), moves: ['zz'] }, { ...record('bad0002'), startFen: 'nope' }]);
  assert.deepEqual(listGames(store).map((g) => g.id), ['ok0001']);
  assert.ok(attachReview('ok0001', { accuracy: { w: 90, b: 80 } }, store));
  assert.equal(gameById('ok0001', store).review.accuracy.w, 90);
  assert.equal(attachReview('missing1', {}, store), false);
});

test('finished games are saved once per session, and a re-finished game replaces its record', () => {
  const store = fresh();
  const off = trackGames({ store });
  const rules = createGame();
  rules.move('e2e4');
  const session = { kind: 'bot', rules, playerColor: 'w', persona: { id: 'novice' }, players: { w: { name: 'You' }, b: { name: 'Pip' } } };
  bus.emit('game:end', { kind: 'bot', status: { result: '0-1', reason: 'resign' }, session });
  const id = savedGameId(session);
  assert.ok(id);
  rules.move('e7e5');
  bus.emit('game:end', { kind: 'bot', status: { result: '1-0', reason: 'resign' }, session });
  // An empty game is not saved.
  bus.emit('game:end', { kind: 'local', status: { result: '1-0', reason: 'resign' }, session: { kind: 'local', rules: createGame() } });
  off();
  const games = listGames(store);
  assert.equal(games.length, 1);
  assert.equal(savedGameId(session), id);
  assert.deepEqual(games[0].moves, ['e2e4', 'e7e5']);
  assert.equal(games[0].personaId, 'novice');
  assert.equal(games[0].black, 'Pip');
});

test('when storage is full, old cached reviews then old games make room for the new game', () => {
  // A backend that refuses writes over a size budget, like a full localStorage.
  const inner = memoryBackend();
  let budget = Infinity;
  const backend = { ...inner, setItem: (k, v) => { if (String(v).length > budget) throw new Error('QuotaExceededError'); inner.setItem(k, v); } };
  const store = createStore({ backend });
  const big = { accuracy: { w: 1, b: 1 }, blob: 'x'.repeat(2000) };
  for (let i = 0; i < 5; i++) saveGame({ ...record(`game000${i}`), review: big }, store);
  budget = String(inner.getItem('oc.v1.games')).length; // full now
  assert.ok(saveGame(record('newgame1'), store), 'the new game is stored');
  const games = listGames(store);
  assert.equal(games[0].id, 'newgame1');
  assert.ok(games.some((g) => !g.review), 'some old reviews were dropped');
  budget = 10; // nothing fits at all
  assert.equal(saveGame(record('newgame2'), store), null);
});
