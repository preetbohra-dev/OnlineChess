import test from 'node:test';
import assert from 'node:assert/strict';
import { reviewGame, summarize, compactReview, expandReview, replay } from '../../public/js/core/review.js';
import { START_FEN } from '../../public/js/core/rules.js';

// Fool's mate: 1.f3 e5 2.g4 Qh4#. A fake engine that knows 2.g4 is a blunder.
const MOVES = ['f2f3', 'e7e5', 'g2g4', 'd8h4'];
const SCRIPT = [
  { bestmove: 'e2e4', lines: [{ score: { cp: 30 }, pv: ['e2e4'] }, { score: { cp: 20 }, pv: ['d2d4'] }] }, // before 1.f3 (White)
  { bestmove: 'e7e5', lines: [{ score: { cp: 40 }, pv: ['e7e5'] }, { score: { cp: 30 }, pv: ['d7d5'] }] }, // before 1...e5 (Black)
  { bestmove: 'e2e4', lines: [{ score: { cp: -60 }, pv: ['e2e4'] }, { score: { cp: -70 }, pv: ['b1c3'] }] }, // before 2.g4 (White)
  { bestmove: 'd8h4', lines: [{ score: { mate: 1 }, pv: ['d8h4'] }, { score: { cp: 200 }, pv: ['b8c6'] }] }, // before 2...Qh4# (Black)
];

function fakeSearch() {
  const calls = [];
  const search = async (fen, moves) => {
    calls.push(moves.length);
    return SCRIPT[moves.length] ?? null;
  };
  return { search, calls };
}

test('every move is graded with one search per position; a finished game needs no final search', async () => {
  const { search, calls } = fakeSearch();
  const progress = [];
  const r = await reviewGame({ startFen: START_FEN, moves: MOVES, search, onProgress: (d, t) => progress.push([d, t]) });
  assert.deepEqual(calls, [0, 1, 2, 3]);
  assert.deepEqual(r.moves.map((m) => m.grade), ['inaccuracy', 'best', 'blunder', 'great']);
  assert.deepEqual(r.moves.map((m) => m.san), ['f3', 'e5', 'g4', 'Qh4#']);
  assert.equal(r.evals.length, 5);
  assert.equal(r.evals[4], -10_000, 'Black mated White');
  assert.deepEqual(r.keyMoments, [3]);
  assert.equal(r.best.b, 4);
  assert.ok(r.accuracy.b > r.accuracy.w);
  assert.equal(r.counts.w.blunder, 1);
  assert.equal(progress.at(-1)[0], 4);
});

test('a cancelled search cancels the review', async () => {
  const r = await reviewGame({ startFen: START_FEN, moves: MOVES, search: async () => null });
  assert.equal(r, null);
});

test('the analysis has the shape the coach explanations use', async () => {
  const { search } = fakeSearch();
  const r = await reviewGame({ startFen: START_FEN, moves: MOVES, search });
  const g4 = r.moves[2].analysis;
  assert.equal(g4.bestMove, 'e2e4');
  assert.equal(g4.isBest, false);
  assert.equal(g4.refutation, 'd8h4');
  assert.equal(g4.playedCp, -9_990);
});

test('compact reviews round-trip and reject a mismatched game', async () => {
  const { search } = fakeSearch();
  const r = await reviewGame({ startFen: START_FEN, moves: MOVES, search });
  const compact = JSON.parse(JSON.stringify(compactReview(r)));
  const back = expandReview(compact, START_FEN, MOVES);
  assert.deepEqual(back.moves.map((m) => m.grade), r.moves.map((m) => m.grade));
  assert.equal(back.moves[2].analysis.refutation, 'd8h4');
  assert.deepEqual(back.accuracy, r.accuracy);
  assert.equal(expandReview(compact, START_FEN, MOVES.slice(0, 3)), null);
});

test('replay rejects illegal records', () => {
  assert.throws(() => replay(START_FEN, ['e2e5']));
});

test('summarize handles a side with no moves', () => {
  const s = summarize([{ ply: 1, color: 'w', grade: 'best', winPercentDrop: 0 }]);
  assert.equal(s.accuracy.b, null);
  assert.equal(s.accuracy.w, 100);
});
