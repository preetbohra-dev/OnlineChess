// Turns a persona's `strength` into Stockfish settings and a move choice.
// Stockfish's UCI_Elo bottoms out at 1320, so the Novice instead uses Skill Level 0, a
// shallow search and deliberate weaker picks from its MultiPV candidates.
import { pick } from '../core/rng.js';

export function engineOptionsFor(persona) {
  const s = persona.strength;
  if (s.limitElo) return [['UCI_LimitStrength', true], ['UCI_Elo', s.limitElo]];
  return [['UCI_LimitStrength', false], ['Skill Level', s.skill ?? 20]];
}

// remainingMs: the bot's clock (never spend more than 1/30 of it). fast: ?engine=fast test mode.
export function searchFor(persona, { remainingMs = null, fast = false } = {}) {
  const s = persona.strength;
  const search = { multipv: s.multipv ?? 1 };
  if (s.depth) search.depth = s.depth;
  else search.movetime = s.movetime;
  if (remainingMs != null && search.movetime) search.movetime = Math.max(50, Math.min(search.movetime, remainingMs / 30));
  if (fast) {
    if (search.movetime) search.movetime = Math.min(search.movetime, 100);
    search.depth = Math.min(search.depth ?? 8, 8);
  }
  return search;
}

export function pickMove(persona, result, legalUcis, rng) {
  const s = persona.strength;
  if (s.randomRate && rng() < s.randomRate) return pick(rng, legalUcis);
  if (s.blunderRate && rng() < s.blunderRate) {
    const alternatives = result.lines.slice(1).map((l) => l.pv[0]).filter((m) => legalUcis.includes(m));
    if (alternatives.length) return pick(rng, alternatives);
  }
  return result.bestmove;
}

// Engine score of the side that just searched, in centipawns (mates map to ±100 000).
export function scoreCp(line) {
  if (!line?.score) return null;
  if (line.score.mate !== undefined) return Math.sign(line.score.mate || -1) * (100_000 - Math.abs(line.score.mate));
  return line.score.cp;
}
