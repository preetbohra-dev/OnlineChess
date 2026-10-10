import test from 'node:test';
import assert from 'node:assert/strict';
import { createGame } from '../../public/js/core/rules.js';
import { explainMove, explainThreat, formatEval } from '../../public/js/core/explain.js';

function play(fen, ...sans) {
  const g = createGame({ fen });
  let last;
  for (const san of sans) last = g.move(san);
  return { game: g, move: last, history: g.history({ verbose: true }) };
}

const AFTER_NF3 = 'rnbqkbnr/pppp1ppp/8/4p3/4P3/5N2/PPPP1PPP/RNBQKB1R b KQkq - 1 2';
const queenBlunder = {
  classification: { grade: 'blunder' },
  isBest: false,
  bestMove: 'b8c6',
  bestLine: { score: { cp: 20 }, pv: ['b8c6', 'f1b5'] },
  refutation: 'f3g5',
  afterLine: { score: { cp: 900 }, pv: ['f3g5'] },
  bestCp: 20,
  playedCp: -900,
};

test('a hung queen: grade, better move, and what it allowed, with arrows', () => {
  const { move, history } = play(AFTER_NF3, 'Qg5');
  const e = explainMove({ move, analysis: queenBlunder, level: 'amateur', history });
  assert.equal(e.grade, 'blunder');
  assert.equal(e.label, 'Blunder');
  assert.match(e.points.find((p) => p.kind === 'better').text, /^Better was Nc6/);
  assert.equal(e.points.find((p) => p.kind === 'allowed').text, 'This allows Nxg5, which wins your queen.');
  assert.deepEqual(e.arrows, [{ from: 'b8', to: 'c6', type: 'success' }, { from: 'f3', to: 'g5', type: 'danger' }]);
});

test('a missed mate in one is called out with the mating move', () => {
  const { move, history } = play('6k1/5ppp/8/8/8/8/8/R5K1 w - - 0 1', 'Rb1');
  const e = explainMove({
    move,
    history,
    level: 'novice',
    analysis: { classification: { grade: 'blunder' }, isBest: false, bestMove: 'a1a8', bestLine: { score: { mate: 1 }, pv: ['a1a8'] }, refutation: null, bestCp: 9_990, playedCp: 200 },
  });
  assert.equal(e.points.find((p) => p.kind === 'missed').text, 'You missed checkmate: Ra8#!');
  assert.match(e.points.find((p) => p.kind === 'better').text, /Ra8#, which is checkmate/);
});

test('novice explanations use no numbers; grandmaster ones show evaluations and the main line', () => {
  const { move, history } = play(AFTER_NF3, 'Qg5');
  const novice = explainMove({ move, analysis: queenBlunder, level: 'novice', history });
  const all = [novice.headline, ...novice.points.map((p) => p.text)].join(' ');
  assert.doesNotMatch(all.replace(/[a-h][1-8]/g, ''), /\d/, `no numbers for novices: ${all}`);
  const gm = explainMove({ move, analysis: queenBlunder, level: 'grandmaster', history });
  assert.match(gm.headline, /\+0\.2 → -9\.0 for you/);
  assert.match(gm.points.find((p) => p.kind === 'better').text, /Main line: Nc6 Bb5/);
});

test('beginner opening tips: early queen, knight on the rim, castling praise', () => {
  const start = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';
  const good = { classification: { grade: 'good' }, isBest: true, bestMove: '', bestLine: { score: { cp: 0 }, pv: [] }, bestCp: 0, playedCp: 0 };
  const queen = play(start, 'e4', 'e5', 'Qh5');
  assert.match(explainMove({ ...queen, analysis: good, level: 'novice' }).points.at(-1).text, /queen out early/);
  const rim = play(start, 'Na3');
  assert.match(explainMove({ ...rim, analysis: good, level: 'amateur' }).points.at(-1).text, /knight on the rim/);
  const castle = play(start, 'e4', 'e5', 'Nf3', 'Nc6', 'Bc4', 'Bc5', 'O-O');
  assert.match(explainMove({ ...castle, analysis: good, level: 'novice' }).points.at(-1).text, /Castling/);
  assert.equal(explainMove({ ...castle, analysis: good, level: 'pro' }).points.length, 0, 'no beginner tips for strong players');
});

test('threat warnings name the move and the prize', () => {
  const fen = '4k3/8/8/3n4/8/8/8/3QK3 b - - 0 1'; // Black to move; White threatens Qxd5
  const t = explainThreat({ fen, threat: { move: 'd1d5', san: 'Qxd5', mate: false, gainCp: 320 }, level: 'novice', opponentColor: 'w' });
  assert.equal(t.text, 'Watch out! White wants to play Qxd5 next and win your knight on d5.');
  assert.deepEqual(t.arrow, { from: 'd1', to: 'd5', type: 'warning' });
  assert.equal(explainThreat({ fen, threat: null, opponentColor: 'w' }), null);
});

test('evaluation formatting', () => {
  assert.equal(formatEval(85), '+0.8');
  assert.equal(formatEval(-230), '-2.3');
  assert.equal(formatEval(9_990), 'winning (mate)');
});

test('truthful: a recapturable trade is not "wins your knight"', () => {
  // 1.e4 e5 2.Nf3 Nc6 3.Nc3 Nf6 4.Bb5 Nd4?! — Nxd4 exd4 is just a trade.
  const { move, history } = play('r1bqkb1r/pppp1ppp/2n2n2/1B2p3/4P3/2N2N2/PPPP1PPP/R1BQK2R b KQkq - 5 4', 'Nd4');
  const e = explainMove({
    move, history, level: 'amateur',
    analysis: {
      classification: { grade: 'mistake' }, isBest: false, bestMove: 'f8c5',
      bestLine: { score: { cp: -20 }, pv: ['f8c5'] }, refutation: 'f3d4',
      afterLine: { score: { cp: 120 }, pv: ['f3d4', 'e5d4'] }, bestCp: -20, playedCp: -120,
    },
  });
  const allowed = e.points.find((p) => p.kind === 'allowed').text;
  assert.doesNotMatch(allowed, /wins your/, allowed);
});

test('truthful: forks need real targets on a safe square', async () => {
  const { forkTargets, listPieces } = await import('../../public/js/core/tactics.js');
  const pawns = createGame({ fen: '4k3/8/8/1p3p2/8/3B4/8/4K3 b - - 0 1' });
  assert.equal(forkTargets(pawns, 'd3').length, 0, 'loose pawns are never fork targets');
  const fork = createGame({ fen: 'r3k3/8/8/3B4/8/4K3/8/7r b - - 0 1' });
  const targets = forkTargets(fork, 'd5');
  assert.equal(listPieces(targets), 'the two rooks');
  const pawnTakes = createGame({ fen: 'r3k3/8/4p3/3B4/8/4K3/8/7r b - - 0 1' });
  assert.deepEqual(forkTargets(pawnTakes, 'd5'), [], 'a "fork" by a piece a pawn can take is no fork');
});

test('opening tips never contradict a good grade or a capture', () => {
  const start = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';
  const best = { classification: { grade: 'best' }, isBest: true, bestMove: '', bestLine: { score: { cp: 0 }, pv: [] }, bestCp: 0, playedCp: 0 };
  const queenTakes = play(start, 'e4', 'd5', 'exd5', 'Qxd5');
  const e = explainMove({ ...queenTakes, analysis: best, level: 'novice' });
  assert.ok(!e.points.some((p) => /queen out early/.test(p.text)), 'Qxd5 recapture is not scolded');
  const blunder = { ...best, classification: { grade: 'blunder' }, isBest: false };
  const develop = play(start, 'Nf3');
  assert.ok(!explainMove({ ...develop, analysis: { ...blunder, bestMove: 'e2e4', bestLine: { score: { cp: 30 }, pv: ['e2e4'] }, bestCp: 30, playedCp: -400 }, level: 'novice' })
    .points.some((p) => p.kind === 'praise'), 'no praise on a blunder');
});
