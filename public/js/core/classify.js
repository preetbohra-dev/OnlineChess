// Move quality from engine evaluations, on the win-probability scale lichess uses.
// Scores are centipawns from the mover's point of view; mates are passed as { mate } and
// converted to large centipawn values first.

export const THRESHOLDS = { inaccuracy: 0.1, mistake: 0.2, blunder: 0.3 }; // drop in winning chances (−1..1)
export const GREAT_MARGIN = 0.15; // best move clearly better than the second best = "great find"
const MATE_CP = 10_000;

// { cp } | { mate } -> centipawns (mate in N scores higher the sooner it is).
export function scoreToCp(score) {
  if (!score) return 0;
  if (score.mate !== undefined) {
    if (score.mate === 0) return -MATE_CP;
    return Math.sign(score.mate) * (MATE_CP - Math.abs(score.mate) * 10);
  }
  return score.cp;
}

// Winning chances in [-1, 1].
export function winChances(cp) {
  return 2 / (1 + Math.exp(-0.00368208 * cp)) - 1;
}

export const winPercent = (cp) => 50 + 50 * winChances(cp);

// Per-move accuracy (0-100) from the drop in win percentage, lichess formula.
export function moveAccuracy(winPercentDrop) {
  const raw = 103.1668 * Math.exp(-0.04354 * Math.max(0, winPercentDrop)) - 3.1669;
  return Math.max(0, Math.min(100, raw));
}

// bestCp: eval of the best move, playedCp: eval after the played move, secondCp: eval of the
// second-best move (optional), all from the mover's point of view.
// -> { grade, drop, winPercentDrop } with grade in
//    best | great | excellent | good | inaccuracy | mistake | blunder
export function classifyMove({ bestCp, playedCp, secondCp = null, isBest = false }) {
  const drop = Math.max(0, winChances(bestCp) - winChances(playedCp));
  const winPercentDrop = 50 * drop;
  let grade;
  if (drop >= THRESHOLDS.blunder) grade = 'blunder';
  else if (drop >= THRESHOLDS.mistake) grade = 'mistake';
  else if (drop >= THRESHOLDS.inaccuracy) grade = 'inaccuracy';
  else if (isBest) grade = secondCp !== null && winChances(bestCp) - winChances(secondCp) >= GREAT_MARGIN ? 'great' : 'best';
  else grade = drop < 0.02 ? 'excellent' : 'good';
  return { grade, drop, winPercentDrop };
}

export const GRADE_LABEL = {
  great: 'Great find',
  best: 'Best move',
  excellent: 'Excellent',
  good: 'Good',
  inaccuracy: 'Inaccuracy',
  mistake: 'Mistake',
  blunder: 'Blunder',
};
