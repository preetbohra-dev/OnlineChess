// Turns engine analysis of one move into coaching: a grade, what was better, what was missed,
// what the move allowed, and an opening tip — worded for the player's level.
//   novice: plain words, no numbers · amateur: names tactics · pro: adds evaluations
//   grandmaster: evaluations plus the engine's main line
import { createGame, otherColor } from './rules.js';
import { GRADE_LABEL } from './classify.js';
import { sanLine, materialSwing, forkTargets, hangingPieces, listPieces, PIECE_NAME, VALUE as VALUE_OF } from './tactics.js';

export const LEVELS = ['novice', 'amateur', 'pro', 'grandmaster'];
const BAD = new Set(['inaccuracy', 'mistake', 'blunder']);
const COLOR = { w: 'White', b: 'Black' };

const HEADLINES = {
  great: { plain: 'Brilliant — that was the only good move!', expert: 'Great find: the only move that holds the advantage.' },
  best: { plain: 'Best move! Exactly what a strong player would play.', expert: 'Best move.' },
  excellent: { plain: 'Excellent move!', expert: 'Excellent — practically as good as the best move.' },
  good: { plain: 'Good move.', expert: 'Good, though slightly better was available.' },
  inaccuracy: { plain: 'Hmm, a small slip.', expert: 'Inaccuracy.' },
  mistake: { plain: 'Careful — that was a mistake.', expert: 'Mistake.' },
  blunder: { plain: 'Ouch — that was a blunder.', expert: 'Blunder.' },
};

// Evaluations are always from the player's point of view ("+1.2 for you").
export function formatEval(cp) {
  if (Math.abs(cp) >= 5_000) return cp > 0 ? 'winning (mate)' : 'losing (mate)';
  const pawns = cp / 100;
  return `${pawns > 0 ? '+' : ''}${pawns.toFixed(1)}`;
}
const forYou = (cp) => `${formatEval(cp)} for you`;

function sanOf(fen, uci) {
  return sanLine(fen, [uci], 1)[0] ?? uci;
}

// What a candidate move achieves, as a verb phrase ("wins a knight", "forks the king and rook").
// swingCp: how much better the best move is than the one played (caps "wins a pawn" claims).
function describeIdea(fen, line, level, swingCp = 0) {
  const uci = line.pv[0];
  if (line.score?.mate > 0) return line.score.mate === 1 ? 'is checkmate' : `forces checkmate in ${line.score.mate}`;
  const mover = createGame({ fen }).turn();
  const gain = materialSwing(fen, line.pv, mover, 6);
  const after = createGame({ fen });
  const r = after.move(uci);
  if (!r.ok) return '';
  const fork = forkTargets(after, r.to);
  if (fork.length >= 2) return level === 'novice' ? `attacks ${listPieces(fork)} at the same time` : `forks ${listPieces(fork)}`;
  if (gain >= 3) return `wins material (about ${gain} pawns' worth)`;
  if (gain >= 1) return swingCp < 200 ? 'wins a pawn' : 'wins material';
  if (r.captured) return `takes the ${PIECE_NAME[r.captured]}`;
  if (r.san.includes('+')) return 'gives check and keeps the initiative';
  if (r.flags.includes('k') || r.flags.includes('q')) return 'castles your king to safety';
  return '';
}

// Opening-principle tips for beginners (first ten moves of each side). Never contradicts the
// grade: no warnings on captures, checks or best moves, no praise on mistakes.
function openingTip(move, history, playerColor, grade) {
  const goodMove = grade === 'best' || grade === 'great' || grade === 'excellent';
  const forcing = Boolean(move.captured) || /[+#]$/.test(move.san);
  const tip = rawOpeningTip(move, history, playerColor);
  if (!tip) return null;
  if (tip.kind === 'tip' && (goodMove || forcing)) return null;
  if (tip.kind === 'praise' && (grade === 'mistake' || grade === 'blunder')) return null;
  return tip;
}

function rawOpeningTip(move, history, playerColor) {
  const mine = history.filter((m) => m.color === playerColor);
  const moveNumber = mine.length;
  if (moveNumber > 10) return null;
  const earlier = mine.slice(0, -1);
  const minorsOut = earlier.filter((m) => m.piece === 'n' || m.piece === 'b').length;
  if (move.flags.includes('k') || move.flags.includes('q')) return { kind: 'praise', text: 'Castling tucks your king away and connects your rooks.' };
  if (move.piece === 'q' && moveNumber <= 5 && minorsOut < 2) return { kind: 'tip', text: 'Bringing the queen out early lets your opponent chase it while developing. Develop knights and bishops first.' };
  if (move.piece === 'k' && moveNumber <= 10) return { kind: 'tip', text: 'Moving the king early gives up castling and leaves it exposed.' };
  if ((move.piece === 'n' || move.piece === 'b') && earlier.some((m) => m.to === move.from && m.piece === move.piece) && moveNumber <= 8) {
    return { kind: 'tip', text: 'Try not to move the same piece twice in the opening — bring a new piece into play instead.' };
  }
  if (move.piece === 'n' && /^[ah]/.test(move.to)) return { kind: 'tip', text: 'A knight on the rim is dim: knights are strongest near the centre.' };
  if (move.piece === 'p' && ['e4', 'd4', 'e5', 'd5'].includes(move.to) && moveNumber <= 3) return { kind: 'praise', text: 'Central pawns claim space — a classic opening idea.' };
  if ((move.piece === 'n' || move.piece === 'b') && /[18]$/.test(move.from) && moveNumber <= 8) return { kind: 'praise', text: 'Good: developing a piece toward the centre.' };
  if (moveNumber >= 9 && !mine.some((m) => m.flags.includes('k') || m.flags.includes('q'))) {
    const king = createGame({ fen: move.after }).board().flat().find((p) => p?.type === 'k' && p.color === playerColor);
    if (king && /^[def]/.test(king.square)) return { kind: 'tip', text: 'Your king is still in the centre — think about castling soon.' };
  }
  return null;
}

// move: rules.move() result (with before/after FEN) · analysis: engine/analysis.js result
// history: verbose moves up to and including `move`.
export function explainMove({ move, analysis, level = 'amateur', history = [move] }) {
  const { grade } = analysis.classification;
  const plain = level === 'novice' || level === 'amateur';
  const numbers = level === 'pro' || level === 'grandmaster';
  const points = [];
  const arrows = [];

  let headline = HEADLINES[grade][plain ? 'plain' : 'expert'];
  if (level === 'grandmaster') headline += ` (${formatEval(analysis.bestCp)} → ${forYou(analysis.playedCp)})`;
  else if (level === 'pro' && BAD.has(grade)) headline += ` Evaluation now ${forYou(analysis.playedCp)}.`;

  const bestSan = sanOf(move.before, analysis.bestMove);
  const mateAvailable = analysis.bestLine?.score?.mate > 0;

  // What was better.
  // Beginners only hear about better moves when theirs was actually a slip.
  if (!analysis.isBest && (BAD.has(grade) || (grade === 'good' && numbers))) {
    const idea = describeIdea(move.before, analysis.bestLine, level, analysis.bestCp - analysis.playedCp);
    let text = `Better was ${bestSan}${idea ? `, which ${idea}` : ''}.`;
    if (level === 'grandmaster') text += ` Main line: ${sanLine(move.before, analysis.bestLine.pv, 6).join(' ')}`;
    else if (level === 'pro') text += ` (${forYou(analysis.bestCp)})`;
    points.push({ kind: 'better', text });
    arrows.push({ from: analysis.bestMove.slice(0, 2), to: analysis.bestMove.slice(2, 4), type: 'success' });
  }

  // What was missed (the "better" line already names a mate in several moves, so only mate-in-one
  // gets its own call-out).
  if (mateAvailable && analysis.bestLine.score.mate === 1 && !analysis.isBest && analysis.playedCp < 5_000) {
    const n = analysis.bestLine.score.mate;
    points.push({ kind: 'missed', text: n === 1 ? `You missed checkmate: ${bestSan}#!`.replace('##', '#') : `You missed a forced checkmate in ${n}, starting with ${bestSan}.` });
  }

  // What the move allowed.
  if ((grade === 'mistake' || grade === 'blunder') && analysis.refutation) {
    const refSan = sanOf(move.after, analysis.refutation);
    const them = otherColor(move.color);
    let consequence;
    if (analysis.afterLine?.score?.mate > 0) {
      consequence = analysis.afterLine.score.mate === 1 ? 'is checkmate' : `leads to checkmate in ${analysis.afterLine.score.mate}`;
    } else {
      const after = createGame({ fen: move.after });
      const target = after.get(analysis.refutation.slice(2, 4));
      const r = after.move(analysis.refutation);
      const fork = r.ok ? forkTargets(after, r.to) : [];
      // "Wins your knight" only when the material really goes: follow the engine's line.
      const line = analysis.afterLine?.pv?.length ? analysis.afterLine.pv : [analysis.refutation];
      const lost = -materialSwing(move.after, line, move.color, 6);
      if (target && target.color === move.color && target.type !== 'p' && lost >= Math.min(3, VALUE_OF[target.type])) consequence = `wins your ${PIECE_NAME[target.type]}`;
      else if (fork.length >= 2) consequence = `${level === 'novice' ? 'attacks' : 'forks'} ${listPieces(fork)}`;
      else if (lost >= 1) consequence = lost >= 3 ? 'wins material' : 'wins a pawn';
      else consequence = numbers ? `gives ${COLOR[them]} the advantage (${forYou(analysis.playedCp)})` : 'gives your opponent the upper hand';
    }
    points.push({ kind: 'allowed', text: `This allows ${refSan}, which ${consequence}.`.replace('which and', 'and') });
    arrows.push({ from: analysis.refutation.slice(0, 2), to: analysis.refutation.slice(2, 4), type: 'danger' });
  }

  // Pieces left hanging (beginners), unless the refutation covered it or the move was a good one
  // (a deliberate trade or sacrifice).
  if (plain && !points.some((p) => p.kind === 'allowed') && !['best', 'great', 'excellent'].includes(grade)) {
    const hanging = hangingPieces(createGame({ fen: move.after }), move.color).filter((p) => p.type !== 'p');
    if (hanging.length) {
      const p = hanging[0];
      points.push({ kind: 'warning', text: `Watch your ${PIECE_NAME[p.type]} on ${p.square}: it is attacked and nothing defends it.` });
    }
  }

  // Opening principles for beginners.
  if (plain) {
    const tip = openingTip(move, history, move.color, grade);
    if (tip) points.push(tip);
  }

  return { grade, label: GRADE_LABEL[grade], headline, points, arrows, bestSan, ply: history.length };
}

// After the opponent moves: what do they threaten? threat: engine/analysis.js analyzeThreat result.
export function explainThreat({ fen, threat, level = 'amateur', opponentColor }) {
  if (!threat) return null;
  const square = threat.move.slice(2, 4);
  const target = createGame({ fen }).get(square);
  // Name the prize only when the gain is about the piece's worth (not a defended trade).
  const worth = target ? VALUE_OF[target.type] * 100 : 0;
  const prize = threat.mate ? 'checkmate'
    : target && target.color !== opponentColor && target.type !== 'p' && threat.gainCp >= worth * 0.6 ? `your ${PIECE_NAME[target.type]} on ${square}` : null;
  const text = level === 'novice'
    ? `Watch out! ${COLOR[opponentColor]} wants to play ${threat.san} next${prize ? ` and win ${prize}` : ''}.`
    : `Threat: ${COLOR[opponentColor]} is threatening ${threat.san}${threat.mate ? ' with mate' : prize ? `, winning ${prize}` : ''}.`;
  return { text, arrow: { from: threat.move.slice(0, 2), to: square, type: 'warning' } };
}
