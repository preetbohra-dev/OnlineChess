// Playout lesson state machine: the player plays a position out against the engine. Pure — the
// lesson player feeds it the player's moves and the engine's replies.
//   goal 'mate'    checkmate within `moves` of your moves
//   goal 'promote' promote a pawn within `moves` and keep the new piece through the reply
//   goal 'hold'    survive `moves` of your moves: no checkmate, and an enemy promotion must be
//                  answered at once (capture it, or promote too) so material stays level
// playerMove(input) / opponentMove(uci) ->
//   { result: 'illegal' } | { result: 'continue', move } | { result: 'won' | 'lost', move, message }
import { createGame, otherColor } from './rules.js';
import { materialBalance, PIECE_NAME } from './tactics.js';

export function createPlayout(lesson) {
  let game;
  let made; // the player's moves so far
  let result; // null while playing, else 'won' | 'lost'
  let promotedOn; // square of the player's new piece, until it survives the reply
  let enemyPromotedOn; // square of the opponent's new piece, until the player captures it
  const start = createGame({ fen: lesson.fen });
  const playerColor = start.turn();
  const startBalance = materialBalance(start, playerColor);
  const opponent = otherColor(playerColor);

  function reset() {
    game = createGame({ fen: lesson.fen });
    made = 0;
    result = null;
    promotedOn = null;
    enemyPromotedOn = null;
  }
  reset();

  const end = (kind, move, message) => {
    result = kind;
    return { result: kind, move, message };
  };
  const won = (move) => end('won', move, lesson.success);
  const outOfMoves = () => `Out of moves — you had ${lesson.moves}. Restart and try a quicker plan.`;

  // A finished game (after either side's move), judged against the goal.
  function judgeGameOver(move) {
    const s = game.status();
    if (s.reason === 'checkmate') {
      return s.winner === playerColor
        ? (lesson.goal === 'hold' ? end('won', move, `Checkmate — even better than holding! ${lesson.success}`) : won(move))
        : end('lost', move, 'Checkmate — you were mated. Restart and try again.');
    }
    if (lesson.goal === 'hold') return won(move);
    if (s.reason === 'stalemate') return end('lost', move, 'Stalemate! The king has no legal move but is not in check — that is a draw. Leave it a square.');
    if (s.reason === 'insufficient') {
      return end('lost', move, move.color === playerColor
        ? 'Draw — there is not enough material left to checkmate.'
        : `Your ${PIECE_NAME[move.captured] ?? 'piece'} was captured — without it there is no way to checkmate. Keep your pieces protected.`);
    }
    return end('lost', move, 'The game ended in a draw. Restart and try again.');
  }

  return {
    get game() { return game; },
    get result() { return result; },
    get over() { return result !== null; },
    playerColor,
    movesLeft: () => Math.max(0, lesson.moves - made),
    reset,

    playerMove(input) {
      if (result || game.turn() !== playerColor) return { result: 'illegal' };
      const r = game.move(input);
      if (!r.ok) return { result: 'illegal' };
      made++;
      if (enemyPromotedOn) {
        enemyPromotedOn = null;
        if (materialBalance(game, playerColor) < startBalance - 3) return end('lost', r, 'Your opponent promoted and kept the new piece. Restart and stop the pawn earlier.');
      }
      if (game.status().over) return judgeGameOver(r);
      if (lesson.goal === 'hold' && game.claimableDraws().includes('threefold')) return won(r);
      if (lesson.goal === 'promote' && r.promotion) promotedOn = r.to;
      if (lesson.goal === 'mate' && made >= lesson.moves) return end('lost', r, outOfMoves());
      if (lesson.goal === 'promote' && made >= lesson.moves && !promotedOn) return end('lost', r, outOfMoves());
      return { result: 'continue', move: r };
    },

    opponentMove(uci) {
      if (result || game.turn() !== opponent) return { result: 'illegal' };
      const r = game.move(uci);
      if (!r.ok) return { result: 'illegal' };
      if (promotedOn) {
        if (r.to === promotedOn) {
          promotedOn = null;
          if (made >= lesson.moves) return end('lost', r, `Your new piece was captured, and you are out of moves. ${outOfMoves()}`);
          if (!game.status().over) return { result: 'continue', move: r, message: 'Your new piece was captured! Keep going if you can.' };
        } else if (!game.status().over) {
          return won(r);
        }
      }
      if (game.status().over) return judgeGameOver(r);
      if (lesson.goal === 'hold') {
        if (r.promotion) enemyPromotedOn = r.to;
        if (game.claimableDraws().includes('threefold')) return won(r);
        if (made >= lesson.moves && !enemyPromotedOn) return won(r);
      }
      return { result: 'continue', move: r };
    },
  };
}
