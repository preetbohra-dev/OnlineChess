// Material-based draw rules. Works on chess.js board() rows: {square, type, color} | null.

const MATING_TYPES = new Set(['p', 'r', 'q']);
const isLightSquare = (square) => ((square.charCodeAt(0) - 97) + (Number(square[1]) - 1)) % 2 === 1;
const nonKingPieces = (board) => board.flat().filter((p) => p && p.type !== 'k');

// FIDE 5.2.2: no sequence of legal moves can lead to checkmate for either side.
// Covers K v K, K+minor v K, and any number of bishops all on squares of one colour.
export function isInsufficientMaterial(board) {
  const pieces = nonKingPieces(board);
  if (pieces.some((p) => MATING_TYPES.has(p.type))) return false;
  if (pieces.length <= 1) return true;
  if (!pieces.every((p) => p.type === 'b')) return false;
  const light = pieces.filter((p) => isLightSquare(p.square)).length;
  return light === 0 || light === pieces.length;
}

// FIDE 6.9: when a player's flag falls, the opponent (`color`) only wins if they could still
// checkmate by some series of legal moves. Conservative: answers true whenever unsure.
export function canPossiblyMate(board, color) {
  const pieces = nonKingPieces(board);
  const own = pieces.filter((p) => p.color === color);
  if (own.length === 0) return false;
  if (own.some((p) => MATING_TYPES.has(p.type))) return true;
  if (isInsufficientMaterial(board)) return false;
  // A single minor piece needs an enemy piece to block its own king's escape square.
  const theirs = pieces.length - own.length;
  return !(own.length === 1 && theirs === 0);
}
