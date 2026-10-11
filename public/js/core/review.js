// Post-game review: grade every move of a finished game with one engine search per position.
// Pure apart from the injected `search`, so it is tested with a fake engine.
//   search(startFen, uciMovesSoFar) -> Promise<{ bestmove, lines: [{ score, pv }] } | null>
//     (MultiPV 2, scores from the side to move; null = cancelled)
// Returns null when cancelled, else
//   { moves: [{ ply, color, san, uci, before, after, analysis, grade, winPercentDrop }],
//     evals: [white-POV centipawns for each position, 0..n],
//     accuracy: { w, b }, counts: { w: {grade: n}, b: {...} }, keyMoments: [ply], best: { w: ply|null, b } }
import { createGame } from './rules.js';
import { scoreToCp, classifyMove, moveAccuracy } from './classify.js';

const MATE_CP = 10_000;
const GRADES = ['great', 'best', 'excellent', 'good', 'inaccuracy', 'mistake', 'blunder'];
const BAD = new Set(['inaccuracy', 'mistake', 'blunder']);

// The game's moves replayed from its start: verbose moves with before/after FENs.
export function replay(startFen, ucis) {
  const game = createGame({ fen: startFen });
  for (const uci of ucis) {
    if (!game.move(uci).ok) throw new Error(`Illegal move ${uci} in game record`);
  }
  return game;
}

export async function reviewGame({ startFen, moves, search, onProgress = () => {} }) {
  const game = replay(startFen, moves);
  const history = game.history({ verbose: true });
  const finalStatus = game.status();

  // One search per position that still has moves to play.
  const results = [];
  for (let i = 0; i <= history.length; i++) {
    const last = i === history.length;
    if (last && finalStatus.over) { results.push(null); break; }
    const r = await search(startFen, moves.slice(0, i));
    if (!r) return null;
    results.push(r);
    onProgress(i + 1, history.length + 1);
  }

  const sideCp = (i) => (results[i]?.lines?.[0] ? scoreToCp(results[i].lines[0].score) : 0); // side to move at i
  const evals = history.map((m, i) => (m.color === 'w' ? 1 : -1) * sideCp(i));
  const terminal = finalStatus.over
    ? (finalStatus.reason === 'checkmate' ? (finalStatus.winner === 'w' ? MATE_CP : -MATE_CP) : 0)
    : (game.turn() === 'w' ? 1 : -1) * sideCp(history.length);
  evals.push(terminal);

  const out = history.map((m, i) => {
    const before = results[i];
    if (!before?.lines?.length) throw new Error(`The engine returned no evaluation for move ${i + 1}`);
    const [bestLine, secondLine = null] = before.lines;
    const bestCp = scoreToCp(bestLine.score);
    const secondCp = secondLine ? scoreToCp(secondLine.score) : null;
    const isBest = before.bestmove === m.uci;
    const next = results[i + 1];
    const lastMove = i === history.length - 1;
    let playedCp;
    if (lastMove && finalStatus.over) playedCp = finalStatus.reason === 'checkmate' ? MATE_CP : 0;
    else if (isBest) playedCp = bestCp;
    else playedCp = next?.lines?.[0] ? -scoreToCp(next.lines[0].score) : bestCp;
    const afterLine = next?.lines?.[0] ?? null;
    const analysis = {
      move: m.uci,
      bestMove: before.bestmove,
      bestLine,
      secondLine,
      afterLine,
      refutation: isBest ? null : next?.bestmove ?? null,
      isBest,
      bestCp,
      playedCp,
      classification: classifyMove({ bestCp, playedCp, secondCp, isBest }),
    };
    return {
      ply: i + 1,
      color: m.color,
      san: m.san,
      uci: m.uci,
      before: m.before,
      after: m.after,
      analysis,
      grade: analysis.classification.grade,
      winPercentDrop: analysis.classification.winPercentDrop,
    };
  });

  return { moves: out, evals, ...summarize(out) };
}

// Accuracy, grade counts, the biggest swings and each side's best move.
export function summarize(moves) {
  const accuracy = {};
  const counts = {};
  const best = {};
  for (const color of ['w', 'b']) {
    const mine = moves.filter((m) => m.color === color);
    accuracy[color] = mine.length ? Math.round(mine.reduce((s, m) => s + moveAccuracy(m.winPercentDrop), 0) / mine.length) : null;
    counts[color] = Object.fromEntries(GRADES.map((g) => [g, mine.filter((m) => m.grade === g).length]));
    // A "great find" first, else a best move that kept the biggest advantage.
    const great = mine.find((m) => m.grade === 'great');
    best[color] = great?.ply ?? null;
  }
  const keyMoments = moves
    .filter((m) => BAD.has(m.grade) && m.grade !== 'inaccuracy')
    .sort((a, b) => b.winPercentDrop - a.winPercentDrop)
    .slice(0, 3)
    .map((m) => m.ply)
    .sort((a, b) => a - b);
  return { accuracy, counts, keyMoments, best };
}

// A compact copy of a review for storage (drops FENs and long lines that can be recomputed).
export function compactReview(review) {
  const line = (l, n) => (l ? { score: l.score, pv: l.pv.slice(0, n) } : null);
  return {
    evals: review.evals,
    accuracy: review.accuracy,
    counts: review.counts,
    keyMoments: review.keyMoments,
    best: review.best,
    moves: review.moves.map((m) => ({
      ply: m.ply,
      grade: m.grade,
      winPercentDrop: m.winPercentDrop,
      a: {
        bestMove: m.analysis.bestMove,
        bestLine: line(m.analysis.bestLine, 6),
        secondLine: line(m.analysis.secondLine, 2),
        afterLine: line(m.analysis.afterLine, 3),
        refutation: m.analysis.refutation,
        isBest: m.analysis.isBest,
        bestCp: m.analysis.bestCp,
        playedCp: m.analysis.playedCp,
      },
    })),
  };
}

// Rebuild a full review from a stored compact one and the game record.
export function expandReview(compact, startFen, ucis) {
  const history = replay(startFen, ucis).history({ verbose: true });
  if (!compact || compact.moves?.length !== history.length) return null;
  // Stored data may be old or damaged: check the parts the screen relies on.
  const okPly = (p) => Number.isInteger(p) && p >= 1 && p <= history.length;
  if (!Array.isArray(compact.evals) || compact.evals.length !== history.length + 1) return null;
  if (!compact.accuracy || !compact.counts?.w || !compact.counts?.b || !Array.isArray(compact.keyMoments) || !compact.keyMoments.every(okPly)) return null;
  if (!compact.moves.every((c) => c?.a?.bestMove && c.a.bestLine && typeof c.grade === 'string')) return null;
  const moves = history.map((m, i) => {
    const c = compact.moves[i];
    const analysis = { move: m.uci, ...c.a, classification: { grade: c.grade, winPercentDrop: c.winPercentDrop, drop: c.winPercentDrop / 50 } };
    return { ply: i + 1, color: m.color, san: m.san, uci: m.uci, before: m.before, after: m.after, analysis, grade: c.grade, winPercentDrop: c.winPercentDrop };
  });
  return { moves, evals: compact.evals, accuracy: compact.accuracy, counts: compact.counts, keyMoments: compact.keyMoments, best: compact.best };
}
