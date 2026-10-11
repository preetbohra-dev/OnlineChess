import test from 'node:test';
import assert from 'node:assert/strict';
import { createStore, memoryBackend } from '../../public/js/store/storage.js';
import { loadDeck, addToDeck, dueToday, answer, trackWeakSpots } from '../../public/js/store/weakspots.js';
import { saveGame, attachReview } from '../../public/js/store/games.js';
import { compactReview, reviewGame } from '../../public/js/core/review.js';
import { makeCard } from '../../public/js/core/weakspots.js';
import { bus } from '../../public/js/core/events.js';
import { START_FEN } from '../../public/js/core/rules.js';

const fresh = () => createStore({ backend: memoryBackend() });
const FEN = 'rnbqkbnr/pppp1ppp/8/4p3/8/5P2/PPPPP1PP/RNBQKBNR w KQkq - 0 2';

test('cards are stored, due, answered and announced', () => {
  const store = fresh();
  assert.equal(addToDeck([makeCard({ fen: FEN, played: 'g4', answers: ['e2e4'], grade: 'blunder', source: 's', day: '2026-10-11' })], store), 1);
  assert.equal(addToDeck([makeCard({ fen: FEN, played: 'g4', answers: ['e2e4'], grade: 'blunder', source: 's', day: '2026-10-11' })], store), 0, 'duplicate');
  assert.equal(dueToday(store, '2026-10-11').length, 0);
  const [card] = dueToday(store, '2026-10-12');
  const seen = [];
  const off = bus.on('weakspot:answered', (e) => seen.push(e));
  const after = answer(card.id, true, { store, today: '2026-10-12' });
  off();
  assert.equal(after.due, '2026-10-15');
  assert.equal(seen[0].right, true);
  assert.equal(answer(card.id, true, { store, today: '2026-10-12' }), null, 'a second answer the same day (another tab) is ignored');
  store.set('weakspots', [{ junk: true }, ...loadDeck(store)]);
  assert.equal(loadDeck(store).length, 1);
});

test('a reviewed game and a coach grade add cards', async () => {
  const store = fresh();
  const off = trackWeakSpots({ store });
  const moves = ['f2f3', 'e7e5', 'g2g4', 'd8h4'];
  const SCRIPT = [
    { bestmove: 'e2e4', lines: [{ score: { cp: 30 }, pv: ['e2e4'] }] },
    { bestmove: 'e7e5', lines: [{ score: { cp: 40 }, pv: ['e7e5'] }] },
    { bestmove: 'e2e4', lines: [{ score: { cp: -60 }, pv: ['e2e4'] }] },
    { bestmove: 'd8h4', lines: [{ score: { mate: 1 }, pv: ['d8h4'] }] },
  ];
  const review = await reviewGame({ startFen: START_FEN, moves, search: async (f, m) => SCRIPT[m.length] });
  saveGame({ id: 'wsgame01', date: '2026-10-11T00:00:00Z', kind: 'bot', white: 'You', black: 'Pip', playerColor: 'w', personaId: 'novice', result: '0-1', reason: 'checkmate', startFen: START_FEN, moves }, store);
  attachReview('wsgame01', compactReview(review), store);
  bus.emit('game:reviewed', { id: 'wsgame01' });
  bus.emit('coach:graded', { grade: 'mistake', before: START_FEN, san: 'a4', analysis: { move: 'a2a4', bestMove: 'e2e4', bestCp: 30, secondLine: null } });
  bus.emit('coach:graded', { grade: 'good', before: START_FEN, san: 'd4', analysis: { move: 'd2d4', bestMove: 'e2e4', bestCp: 30 } });
  off();
  const deck = loadDeck(store);
  assert.equal(deck.length, 2);
  assert.ok(deck.some((c) => c.played === 'g4' && c.answers.includes('e2e4')));
  assert.ok(deck.some((c) => c.source === 'coach'));
});
