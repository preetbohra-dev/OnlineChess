// Chooses what a persona says. Rules: urgent reactions (blunders, hung pieces, mates) always
// fire; everything else waits for a cooldown; never repeat one of the last five lines.
import { pick } from './rng.js';

const URGENT = new Set(['hangPiece', 'allowMate', 'missedMate', 'blunder']);
const PIECE_NAMES = { p: 'pawn', n: 'knight', b: 'bishop', r: 'rook', q: 'queen', k: 'king' };

export const pieceName = (type) => PIECE_NAMES[type] ?? 'piece';

export function fillTemplate(template, vars = {}) {
  return template.replace(/\{(\w+)\}/g, (_, key) => (vars[key] != null ? String(vars[key]) : ''));
}

// A "free piece" taunt needs a real loss: at least about a minor piece.
export const HANG_MIN_LOSS_CP = 250;

// Decides what an analysed move deserves. analysis: engine/analysis.js result.
// position: { bestSan, refutationTarget: { type, square } | null, forced, gameOver } from the caller
// (forced: only legal move or a plain recapture). Returns { trigger, vars } or null for silence.
export function tauntTriggerFor(analysis, position, rng) {
  const { grade } = analysis.classification;
  const bad = grade === 'blunder' || grade === 'mistake' || grade === 'inaccuracy';
  // Only mate-in-one is called a missed checkmate; longer mates are just mistakes.
  if (bad && analysis.bestLine?.score?.mate === 1) {
    return { trigger: 'missedMate', vars: { move: position.bestSan } };
  }
  if (grade === 'blunder') {
    if (analysis.afterLine?.score?.mate > 0) return { trigger: 'allowMate', vars: {} };
    const target = position.refutationTarget;
    const loss = analysis.bestCp - analysis.playedCp;
    if (target && target.type !== 'p' && loss >= HANG_MIN_LOSS_CP) {
      return { trigger: 'hangPiece', vars: { piece: pieceName(target.type), square: target.square } };
    }
    return { trigger: 'blunder', vars: {} };
  }
  if (grade === 'mistake') return { trigger: 'mistake', vars: {} };
  if (grade === 'inaccuracy') return rng() < 0.35 ? { trigger: 'inaccuracy', vars: {} } : null;
  if (grade === 'great' && !position.forced && !position.gameOver) return { trigger: 'great', vars: {} };
  return null;
}

export function createTaunter({ lines, rng, cooldownPlies = 3, memory = 5 }) {
  const recent = [];
  let lastPly = -Infinity;
  return {
    // trigger: one of TAUNT_TRIGGERS; ply: the game ply this reacts to; vars fill the template.
    pick(trigger, { ply, vars } = {}) {
      const pool = lines?.[trigger];
      if (!pool?.length) return null;
      if (!URGENT.has(trigger) && ply - lastPly < cooldownPlies) return null;
      const fresh = pool.filter((line) => !recent.includes(line));
      const line = pick(rng, fresh.length ? fresh : pool);
      recent.push(line);
      if (recent.length > memory) recent.shift();
      lastPly = ply;
      return fillTemplate(line, vars);
    },
  };
}
