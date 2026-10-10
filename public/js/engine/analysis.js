// Move analysis on its own full-strength engine instance (never the opponent's engine, whose
// strength is deliberately limited). Used for taunts now and the training coach later.
import { scoreToCp, classifyMove } from '../core/classify.js';

export const ANALYSIS_OPTIONS = [['UCI_LimitStrength', false], ['Skill Level', 20]];
const MATE_CP = 10_000;

// engine: Promise<UciEngine>. movetime per search (two searches per analysed move at most).
export function createAnalyzer(engine, { movetime = 200, depth } = {}) {
  const limits = depth ? { depth } : { movetime };

  return {
    // startFen + moves: the position before the move; move: its UCI; afterStatus: rules.status()
    // after it (a finished game needs no second search). Returns null when cancelled.
    async analyzeMove({ startFen, moves, move, afterStatus = null }) {
      const uci = await engine;
      const before = await uci.go({ fen: startFen, moves, multipv: 2, options: ANALYSIS_OPTIONS, ...limits });
      if (before.stale || !before.lines.length) return null;
      const [bestLine, secondLine = null] = before.lines;
      const bestCp = scoreToCp(bestLine.score);
      const secondCp = secondLine ? scoreToCp(secondLine.score) : null;
      const isBest = before.bestmove === move;

      let playedCp;
      let afterLine = null;
      let refutation = null;
      if (afterStatus?.over) {
        playedCp = afterStatus.reason === 'checkmate' ? MATE_CP : 0;
      } else if (isBest) {
        playedCp = bestCp;
      } else if (secondLine && secondLine.pv[0] === move) {
        playedCp = secondCp;
        refutation = secondLine.pv[1] ?? null;
        // Same shape as a real after-search line: the opponent's view of the position.
        if (secondLine.score.mate < 0) afterLine = { score: { mate: -secondLine.score.mate }, pv: secondLine.pv.slice(1) };
      } else {
        const after = await uci.go({ fen: startFen, moves: [...moves, move], multipv: 1, options: ANALYSIS_OPTIONS, ...limits });
        if (after.stale) return null;
        afterLine = after.lines[0] ?? null;
        playedCp = afterLine ? -scoreToCp(afterLine.score) : 0;
        refutation = after.bestmove;
      }

      return {
        move,
        bestMove: before.bestmove,
        bestLine,
        secondLine,
        afterLine,
        refutation,
        isBest,
        bestCp,
        playedCp,
        classification: classifyMove({ bestCp, playedCp, secondCp, isBest }),
      };
    },
  };
}
