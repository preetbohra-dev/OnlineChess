// Board facts the coach turns into words: material, hanging pieces, forks, SAN lines.
import { createGame, otherColor } from './rules.js';

export const VALUE = { p: 1, n: 3, b: 3, r: 5, q: 9, k: 0 };
export const PIECE_NAME = { p: 'pawn', n: 'knight', b: 'bishop', r: 'rook', q: 'queen', k: 'king' };

// Material of `color` minus the opponent's, in pawns.
export function materialBalance(game, color) {
  let sum = 0;
  for (const p of game.board().flat()) if (p) sum += (p.color === color ? 1 : -1) * VALUE[p.type];
  return sum;
}

// SAN for the first `max` moves of a UCI line played from `fen` (stops at the first bad move).
export function sanLine(fen, ucis = [], max = 6) {
  const game = createGame({ fen });
  const out = [];
  for (const uci of ucis.slice(0, max)) {
    const r = game.move(uci);
    if (!r.ok) break;
    out.push(r.san);
  }
  return out;
}

// Material `color` gains over the first `plies` moves of a line (negative = loses).
export function materialSwing(fen, ucis = [], color, plies = 6) {
  const game = createGame({ fen });
  const start = materialBalance(game, color);
  for (const uci of ucis.slice(0, plies)) if (!game.move(uci).ok) break;
  return materialBalance(game, color) - start;
}

// Pieces of `color` (not the king) attacked by the opponent and not defended at all.
export function hangingPieces(game, color) {
  const out = [];
  for (const p of game.board().flat()) {
    if (!p || p.color !== color || p.type === 'k') continue;
    if (game.attackers(p.square, otherColor(color)).length && !game.attackers(p.square, color).length) {
      out.push({ type: p.type, square: p.square });
    }
  }
  return out;
}

// Enemy pieces (never pawns) that the piece on `square` attacks and that are worth chasing: the
// king, anything more valuable than the attacker, or anything undefended. Two or more is a fork —
// but only if the forking piece itself cannot simply be taken for free or by something cheaper.
export function forkTargets(game, square) {
  const attacker = game.get(square);
  if (!attacker) return [];
  const enemy = otherColor(attacker.color);
  const enemyAttackers = game.attackers(square, enemy);
  const capturedCheaply = enemyAttackers.some((sq) => VALUE[game.get(sq)?.type] < VALUE[attacker.type]);
  const capturedFree = enemyAttackers.length > 0 && !game.attackers(square, attacker.color).length;
  if (attacker.type !== 'k' && (capturedCheaply || capturedFree)) return [];
  const targets = [];
  for (const p of game.board().flat()) {
    if (!p || p.color !== enemy || p.type === 'p') continue;
    if (!game.attackers(p.square, attacker.color).includes(square)) continue;
    const undefended = !game.attackers(p.square, enemy).length;
    if (p.type === 'k' || VALUE[p.type] > VALUE[attacker.type] || undefended) targets.push({ type: p.type, square: p.square });
  }
  return targets;
}

// Describe pieces: "the king and rook", "the two rooks", "the queen".
export function listPieces(pieces) {
  const counts = new Map();
  for (const p of pieces) counts.set(p.type, (counts.get(p.type) ?? 0) + 1);
  const order = ['k', 'q', 'r', 'b', 'n', 'p'];
  const names = order.filter((t) => counts.has(t)).map((t) => (counts.get(t) > 1 ? `${counts.get(t) === 2 ? 'two' : counts.get(t)} ${PIECE_NAME[t]}s` : PIECE_NAME[t]));
  if (names.length <= 1) return names.length ? `the ${names[0]}` : '';
  return `the ${names.slice(0, -1).join(', ')} and ${names.at(-1)}`;
}
