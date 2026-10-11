// Lesson puzzle state machine. Pure: the lesson player UI drives it.
//   tryMove(move) -> { result: 'illegal' | 'wrong' | 'correct' | 'solved', move?, reply?, message? }
// 'correct' means the move was right and the opponent replied (reply holds its move).
import { createGame, otherColor } from './rules.js';
import { PIECE_NAME } from './tactics.js';

export function createPuzzle(lesson) {
  let game;
  let lines;
  let index;
  let solved;

  function reset() {
    game = createGame({ fen: lesson.fen });
    lines = [lesson.solution, ...(lesson.alternatives ?? [])];
    index = 0;
    solved = false;
  }
  reset();

  function wrong(message) {
    game.undo();
    return { result: 'wrong', message };
  }

  return {
    get game() { return game; },
    get solved() { return solved; },
    reset,

    // The square of the piece the main line moves next (for hints).
    hintSquare: () => (solved ? null : lines[0][index]?.slice(0, 2) ?? null),
    // The main line's next move (UCI), for the "show the move" hint.
    hintMove: () => (solved ? null : lines[0][index] ?? null),

    tryMove(input) {
      if (solved) return { result: 'illegal' };
      const r = game.move(input);
      if (!r.ok) return { result: 'illegal' };
      const status = game.status();

      if (lesson.goal === 'any') return finish(r);
      if (lesson.goal === 'mate') {
        if (status.reason === 'checkmate') return finish(r);
        if (status.reason === 'stalemate') return wrong('Stalemate! Black has no legal move but is not in check — that is a draw. Find a move that gives check.');
      }

      const matching = lines.filter((line) => line[index] === r.uci);
      if (!matching.length) {
        if (lesson.goal === 'promote' && r.promotion && r.promotion !== 'q') return wrong('Good idea to promote — but a queen is the strongest choice here.');
        return wrong(explainWrong(r));
      }
      lines = matching;
      index++;
      if (index >= lines[0].length) return finish(r);

      const reply = game.move(lines[0][index]);
      index++;
      return { result: 'correct', move: r, reply };
    },
  };

  // Why a move is not the solution, in plain words (called with the wrong move still on the board).
  function explainWrong(r) {
    const own = r.color;
    const enemy = otherColor(own);
    const custom = lesson.wrong?.[r.uci];
    if (custom) return custom;
    const attacked = game.attackers(r.to, enemy).length > 0;
    const defended = game.attackers(r.to, own).length > 0;
    if (r.piece !== 'k' && r.piece !== 'p' && attacked && !defended) {
      return `${r.san} puts your ${PIECE_NAME[r.piece]} on ${r.to}, where it can simply be taken. Try again — or use a hint.`;
    }
    const expected = lines[0][index];
    const probe = createGame({ fen: game.history({ verbose: true }).at(-1).before });
    const best = probe.move(expected);
    if (best.ok && /[+#]$/.test(best.san) && !/[+#]$/.test(r.san)) {
      return `${r.san} gives your opponent time to defend. Look for a forcing move — a check — instead.`;
    }
    if (best.ok && best.captured && !r.captured) {
      return `${r.san} is too slow — there is something to capture right now. Look at every capture.`;
    }
    return `${r.san} is not the strongest move here. Try again — or use a hint.`;
  }

  function finish(move) {
    solved = true;
    return { result: 'solved', move, message: lesson.success };
  }
}
