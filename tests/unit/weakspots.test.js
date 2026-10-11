import test from 'node:test';
import assert from 'node:assert/strict';
import { makeCard, cardsFromReview, addCards, dueCards, answerCard, isRight, answersFor, validCard, INTERVALS, MAX_CARDS } from '../../public/js/core/weakspots.js';

const FEN = 'rnbqkbnr/pppp1ppp/8/4p3/8/5P2/PPPPP1PP/RNBQKBNR w KQkq - 0 2'; // before 2.g4??
const card = () => makeCard({ fen: FEN, played: 'g4', answers: ['e2e4'], grade: 'blunder', source: 'game:x', day: '2026-10-11' });

test('a new card is due tomorrow; right answers walk the schedule to mastery', () => {
  let c = card();
  assert.equal(c.due, '2026-10-12');
  let day = '2026-10-12';
  for (let i = 1; i < INTERVALS.length; i++) {
    c = answerCard(c, true, day);
    assert.equal(c.step, i);
    assert.ok(c.due > day);
    day = c.due;
  }
  c = answerCard(c, true, day);
  assert.equal(c.mastered, true);
  assert.equal(dueCards([c], '2030-01-01').length, 0);
});

test('a wrong answer sends the card back to tomorrow', () => {
  let c = answerCard(card(), true, '2026-10-12');
  c = answerCard(c, false, '2026-10-15');
  assert.equal(c.step, 0);
  assert.equal(c.due, '2026-10-16');
  assert.equal(c.lapses, 1);
});

test('due cards, oldest first; duplicates are not added; the deck is capped', () => {
  const a = card();
  const b = makeCard({ fen: FEN.replace('5P2', '4P3'), played: 'x', answers: ['d2d4'], grade: 'mistake', source: 's', day: '2026-10-01' });
  let { deck, added } = addCards([], [a, b, a]);
  assert.equal(added, 2);
  assert.deepEqual(dueCards(deck, '2026-10-12').map((c) => c.id), [b.id, a.id]);
  assert.equal(dueCards(deck, '2026-10-01').length, 0);
  ({ deck } = addCards(Array.from({ length: MAX_CARDS }, (_, i) => ({ ...a, id: `x${i}` })), [b]));
  assert.equal(deck.length, MAX_CARDS);
  assert.equal(deck.at(-1).id, b.id);
});

test('answers: the best move, plus a second move that is nearly as good', () => {
  const near = { move: 'g2g4', bestMove: 'e2e4', bestCp: 30, secondLine: { score: { cp: 20 }, pv: ['d2d4'] } };
  assert.deepEqual(answersFor(near), ['e2e4', 'd2d4']);
  const far = { ...near, secondLine: { score: { cp: -300 }, pv: ['d2d4'] } };
  assert.deepEqual(answersFor(far), ['e2e4']);
  assert.ok(isRight(card(), 'e2e4'));
  assert.ok(!isRight(card(), 'g2g4'));
});

test('cards come from the player\'s mistakes in a review', () => {
  const review = { moves: [
    { color: 'w', grade: 'blunder', before: FEN, san: 'g4', analysis: { move: 'g2g4', bestMove: 'e2e4', bestCp: 30, secondLine: null } },
    { color: 'b', grade: 'blunder', before: FEN, san: 'x', analysis: { move: 'a', bestMove: 'e2e4', bestCp: 30 } },
    { color: 'w', grade: 'inaccuracy', before: FEN, san: 'y', analysis: { move: 'a', bestMove: 'e2e4', bestCp: 30 } },
  ] };
  const cards = cardsFromReview({ id: 'g1', playerColor: 'w' }, review, '2026-10-11');
  assert.equal(cards.length, 1);
  assert.equal(cards[0].played, 'g4');
});

test('stored cards are validated', () => {
  assert.ok(validCard(card()));
  assert.ok(!validCard({ ...card(), answers: ['e2e5'] }));
  assert.ok(!validCard({ ...card(), fen: 'nope' }));
  assert.ok(!validCard({ ...card(), due: 'tomorrow' }));
  assert.ok(validCard({ ...card(), due: null, mastered: true }));
});

test('one card per position; a mastered card returns when the mistake is made again; mastered cards are evicted first', () => {
  const a = card();
  const other = makeCard({ fen: FEN, played: 'g4', answers: ['d2d4'], grade: 'mistake', source: 'coach', day: '2026-10-11' });
  let { deck, added } = addCards([], [a, other]);
  assert.equal(added, 1, 'same position from review and coach');
  deck = [{ ...deck[0], mastered: true, due: null }];
  ({ deck, added } = addCards(deck, [makeCard({ fen: FEN, played: 'g4', answers: ['e2e4'], grade: 'blunder', source: 's', day: '2026-11-01' })]));
  assert.equal(added, 1);
  assert.equal(deck[0].mastered, false);
  assert.equal(deck[0].due, '2026-11-02');
  const full = Array.from({ length: MAX_CARDS }, (_, i) => ({ ...a, id: `c${i}`, mastered: i === 5 }));
  ({ deck } = addCards(full, [makeCard({ fen: FEN.replace('5P2', '4P3'), played: 'x', answers: ['d2d4'], grade: 'mistake', source: 's', day: '2026-10-11' })]));
  assert.equal(deck.length, MAX_CARDS);
  assert.ok(!deck.some((c) => c.id === 'c5'), 'the mastered card made room');
  assert.ok(deck.some((c) => c.id === 'c0'));
});
