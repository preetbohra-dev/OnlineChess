// FIDE Laws of Chess on top of chess.js. Shared by the browser and the Node server.
// chess.js handles move generation; this wrapper owns game termination, because chess.js
// treats threefold repetition and the fifty-move rule as automatic draws, which FIDE does not.
import { Chess, validateFen } from '../../vendor/chess.js/chess.js';
import { isInsufficientMaterial, canPossiblyMate } from './material.js';

export const START_FEN = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';

const SQUARE = /^[a-h][1-8]$/;
const PROMOTION = /^[qrbn]$/;
const UCI = /^([a-h][1-8])([a-h][1-8])([qrbn])?$/;
const COLOR_NAME = { w: 'White', b: 'Black' };
const ONGOING = Object.freeze({ over: false, result: null, winner: null, reason: null });

export const otherColor = (color) => (color === 'w' ? 'b' : 'w');
const isColor = (color) => color === 'w' || color === 'b';
const stripAnnotations = (san) => san.replace(/[+#!?]+$/, '');

const ended = (winner, reason) => ({
  over: true,
  result: winner === 'w' ? '1-0' : winner === 'b' ? '0-1' : '1/2-1/2',
  winner,
  reason,
});

export function isValidFen(fen) {
  if (typeof fen !== 'string' || fen.length > 100 || !validateFen(fen).ok) return false;
  const chess = new Chess(fen);
  const waiting = otherColor(chess.turn());
  const [king] = chess.findPiece({ type: 'k', color: waiting });
  return !chess.isAttacked(king, chess.turn());
}

export function createGame({ fen = START_FEN } = {}) {
  return new Game(fen);
}

function summarize(m) {
  return {
    color: m.color,
    piece: m.piece,
    from: m.from,
    to: m.to,
    san: m.san,
    uci: m.from + m.to + (m.promotion ?? ''),
    flags: m.flags,
    captured: m.captured,
    promotion: m.promotion,
    before: m.before,
    after: m.after,
  };
}

class Game {
  #chess;
  #keys;
  #ended = null;
  #drawOffer = null;

  constructor(fen) {
    if (!isValidFen(fen)) throw new Error('Invalid FEN');
    this.#chess = new Chess(fen);
    this.#keys = [this.#computeKey()];
  }

  // Position identity for repetition: placement, side to move, castling rights, and the
  // en-passant square only when an en-passant capture is actually legal (FIDE 9.2.3).
  #computeKey() {
    const [placement, turn, castling] = this.#chess.fen().split(' ');
    const ep = this.#chess.moves({ verbose: true }).find((m) => m.flags.includes('e'));
    return `${placement} ${turn} ${castling} ${ep ? ep.to : '-'}`;
  }

  #repetitions() {
    const current = this.#keys[this.#keys.length - 1];
    return this.#keys.filter((k) => k === current).length;
  }

  #halfmoves() {
    return Number(this.#chess.fen().split(' ')[4]);
  }

  // Normalises any supported input into a chess.js move object, or explains why not.
  #resolve(input) {
    let spec = input;
    if (typeof input === 'string') {
      const text = input.trim();
      if (!text || text.length > 10) return { error: 'illegal' };
      const uci = UCI.exec(text);
      if (uci) spec = { from: uci[1], to: uci[2], promotion: uci[3] };
      else {
        const found = this.#chess.moves({ verbose: true }).find((m) => stripAnnotations(m.san) === stripAnnotations(text));
        if (!found) return { error: 'illegal' };
        return { move: { from: found.from, to: found.to, promotion: found.promotion } };
      }
    }
    if (!spec || typeof spec !== 'object' || !SQUARE.test(spec.from) || !SQUARE.test(spec.to)) return { error: 'illegal' };
    if (spec.promotion != null && !PROMOTION.test(spec.promotion)) return { error: 'illegal' };
    const candidates = this.#chess.moves({ square: spec.from, verbose: true }).filter((m) => m.to === spec.to);
    if (!candidates.length) return { error: 'illegal' };
    if (candidates[0].promotion) {
      if (!spec.promotion) return { error: 'promotion-required' };
      return { move: { from: spec.from, to: spec.to, promotion: spec.promotion } };
    }
    return { move: { from: spec.from, to: spec.to } };
  }

  move(input) {
    if (this.status().over) return { ok: false, reason: 'game-over' };
    const { move, error } = this.#resolve(input);
    if (error) return { ok: false, reason: error };
    let made;
    try {
      made = this.#chess.move(move);
    } catch {
      return { ok: false, reason: 'illegal' };
    }
    this.#keys.push(this.#computeKey());
    if (this.#drawOffer && this.#drawOffer !== made.color) this.#drawOffer = null;
    return { ok: true, ...summarize(made) };
  }

  undo() {
    const undone = this.#chess.undo();
    if (!undone) return null;
    this.#keys.pop();
    this.#ended = null;
    this.#drawOffer = null;
    return summarize(undone);
  }

  status() {
    if (this.#ended) return { ...this.#ended };
    const chess = this.#chess;
    if (chess.isCheckmate()) return ended(otherColor(chess.turn()), 'checkmate');
    if (chess.isStalemate()) return ended(null, 'stalemate');
    if (isInsufficientMaterial(chess.board())) return ended(null, 'insufficient');
    if (this.#repetitions() >= 5) return ended(null, 'fivefold');
    if (this.#halfmoves() >= 150) return ended(null, 'seventyfive');
    return { ...ONGOING };
  }

  // Draws the player to move may claim (FIDE 9.2 threefold repetition, 9.3 fifty-move rule).
  claimableDraws() {
    if (this.status().over) return [];
    const kinds = [];
    if (this.#repetitions() >= 3) kinds.push('threefold');
    if (this.#halfmoves() >= 100) kinds.push('fifty');
    return kinds;
  }

  claimDraw(kind) {
    if (!this.claimableDraws().includes(kind)) return { ok: false, reason: 'not-claimable' };
    this.#ended = ended(null, kind);
    return { ok: true };
  }

  resign(color) {
    if (!isColor(color) || this.status().over) return { ok: false, reason: 'game-over' };
    this.#ended = ended(otherColor(color), 'resign');
    return { ok: true };
  }

  drawOffer() {
    return this.#drawOffer;
  }

  offerDraw(color) {
    if (!isColor(color) || this.status().over) return { ok: false, reason: 'game-over' };
    if (this.#drawOffer === otherColor(color)) return this.acceptDraw(color);
    if (this.#drawOffer === color) return { ok: false, reason: 'already-offered' };
    this.#drawOffer = color;
    return { ok: true };
  }

  acceptDraw(color) {
    if (this.status().over || this.#drawOffer !== otherColor(color)) return { ok: false, reason: 'no-offer' };
    this.#drawOffer = null;
    this.#ended = ended(null, 'agreement');
    return { ok: true };
  }

  declineDraw(color) {
    if (this.#drawOffer !== otherColor(color)) return { ok: false, reason: 'no-offer' };
    this.#drawOffer = null;
    return { ok: true };
  }

  // FIDE 6.9: the flagged player loses unless the opponent cannot possibly checkmate.
  flag(color) {
    if (!isColor(color) || this.status().over) return { ok: false, reason: 'game-over' };
    const winner = otherColor(color);
    this.#ended = this.canPossiblyMate(winner) ? ended(winner, 'timeout') : ended(null, 'timeout-vs-insufficient');
    return { ok: true };
  }

  abandon(color) {
    if (!isColor(color) || this.status().over) return { ok: false, reason: 'game-over' };
    this.#ended = ended(otherColor(color), 'abandon');
    return { ok: true };
  }

  canPossiblyMate(color) {
    return canPossiblyMate(this.#chess.board(), color);
  }

  legalMoves(square) {
    if (this.status().over) return [];
    const opts = square ? { square, verbose: true } : { verbose: true };
    return this.#chess.moves(opts).map(summarize);
  }

  isPromotion(from, to) {
    return this.legalMoves(from).some((m) => m.to === to && m.promotion);
  }

  history({ verbose = false } = {}) {
    const moves = this.#chess.history({ verbose: true });
    return verbose ? moves.map(summarize) : moves.map((m) => m.san);
  }

  get(square) {
    const piece = SQUARE.test(square) ? this.#chess.get(square) : null;
    return piece ? { type: piece.type, color: piece.color } : null;
  }

  // Squares of `color` pieces attacking `square` (defenders when the square holds a `color` piece).
  attackers(square, color) {
    return SQUARE.test(square) && isColor(color) ? this.#chess.attackers(square, color) : [];
  }

  board() { return this.#chess.board(); }
  fen() { return this.#chess.fen(); }
  turn() { return this.#chess.turn(); }
  inCheck() { return this.#chess.inCheck(); }
  positionKey() { return this.#keys[this.#keys.length - 1]; }
  perft(depth) { return this.#chess.perft(depth); }

  pgn(headers = {}) {
    const status = this.status();
    const all = {
      Event: 'Casual Game',
      Site: 'OnlineChess',
      Date: new Date().toISOString().slice(0, 10).replace(/-/g, '.'),
      ...headers,
      Result: status.over ? status.result : '*',
    };
    for (const [key, value] of Object.entries(all)) this.#chess.setHeader(key, String(value));
    if (status.over) this.#chess.setHeader('Termination', describeResult(status));
    else this.#chess.removeHeader('Termination');
    return this.#chess.pgn();
  }
}

export function describeResult(status) {
  if (!status?.over) return '';
  const winner = COLOR_NAME[status.winner];
  const loser = status.winner ? COLOR_NAME[otherColor(status.winner)] : '';
  switch (status.reason) {
    case 'checkmate': return `${winner} wins by checkmate`;
    case 'resign': return `${winner} wins — ${loser} resigned`;
    case 'timeout': return `${winner} wins on time`;
    case 'abandon': return `${winner} wins — opponent left the game`;
    case 'stalemate': return 'Draw by stalemate';
    case 'insufficient': return 'Draw by insufficient material';
    case 'threefold': return 'Draw by threefold repetition';
    case 'fivefold': return 'Draw by fivefold repetition';
    case 'fifty': return 'Draw by the fifty-move rule';
    case 'seventyfive': return 'Draw by the seventy-five-move rule';
    case 'agreement': return 'Draw by agreement';
    case 'timeout-vs-insufficient': return 'Draw — time ran out, but the opponent cannot checkmate';
    default: return 'Game over';
  }
}

// One-line rule reminders shown under the result, so every ending teaches the rule behind it.
export const RULE_NOTES = {
  checkmate: 'The king is attacked and has no legal way to escape.',
  stalemate: 'The player to move has no legal moves and is not in check, so the game is drawn.',
  insufficient: 'Neither side has enough material left to ever deliver checkmate.',
  threefold: 'The same position occurred three times with the same player to move, and a draw was claimed.',
  fivefold: 'The same position occurred five times, which ends the game automatically.',
  fifty: 'Fifty moves by each side passed without a capture or pawn move, and a draw was claimed.',
  seventyfive: 'Seventy-five moves by each side passed without a capture or pawn move, which ends the game automatically.',
  agreement: 'Both players agreed to a draw.',
  resign: 'A player resigned the game.',
  timeout: 'A player ran out of time.',
  'timeout-vs-insufficient': 'A flag fell, but the opponent had no way to ever checkmate, so it is a draw.',
  abandon: 'A player left the game and did not return in time.',
};
