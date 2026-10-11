// Move analysis on its own full-strength engine instance (never the opponent's engine, whose
// strength is deliberately limited). Used for taunts now and the training coach later.
import { scoreToCp, classifyMove } from '../core/classify.js';
import { createGame, isValidFen } from '../core/rules.js';
import { sanLine } from '../core/tactics.js';

export const ANALYSIS_OPTIONS = [['UCI_LimitStrength', false], ['Skill Level', 20]];
const MATE_CP = 10_000;

// engine: Promise<UciEngine>. movetime per search (two searches per analysed move at most).
export function createAnalyzer(engine, { movetime = 200, depth } = {}) {
  const limits = depth ? { depth } : { movetime };

  return {
    // Drop queued and running searches (e.g. after a takeback); they resolve as cancelled.
    cancel() {
      Promise.resolve(engine).then((e) => e?.cancel?.()).catch(() => {});
    },

    // Best move in a position (for hints): { move, line } or null when cancelled.
    async bestMove({ startFen, moves = [] }) {
      const uci = await engine;
      const r = await uci.go({ fen: startFen, moves, multipv: 1, options: ANALYSIS_OPTIONS, ...limits });
      return r.stale || !r.bestmove ? null : { move: r.bestmove, line: r.lines[0] ?? null };
    },

    // What would the opponent do if they could move again right now? A "null move" search:
    // a threat is any move that gains at least `minGainCp` over the current evaluation.
    async analyzeThreat({ fen, minGainCp = 200 }) {
      const game = createGame({ fen });
      if (game.inCheck() || game.status().over) return null;
      const parts = fen.split(' ');
      parts[1] = parts[1] === 'w' ? 'b' : 'w';
      parts[3] = '-';
      const nullFen = parts.join(' ');
      if (!isValidFen(nullFen)) return null;
      const uci = await engine;
      const current = await uci.go({ fen, multipv: 1, options: ANALYSIS_OPTIONS, ...limits });
      if (current.stale || !current.lines.length) return null;
      const twice = await uci.go({ fen: nullFen, multipv: 1, options: ANALYSIS_OPTIONS, ...limits });
      if (twice.stale || !twice.bestmove || !twice.lines.length) return null;
      const base = -scoreToCp(current.lines[0].score); // opponent's view, player to move
      const gainCp = scoreToCp(twice.lines[0].score) - base;
      if (gainCp < minGainCp) return null;
      return { move: twice.bestmove, san: sanLine(nullFen, [twice.bestmove], 1)[0] ?? twice.bestmove, gainCp, mate: twice.lines[0].score.mate > 0 };
    },

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
