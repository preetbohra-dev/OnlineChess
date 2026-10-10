// Lesson puzzle state machine. Pure: the lesson player UI drives it.
//   tryMove(move) -> { result: 'illegal' | 'wrong' | 'correct' | 'solved', move?, reply?, message? }
// 'correct' means the move was right and the opponent replied (reply holds its move).
import { createGame } from './rules.js';

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
        return wrong('Not quite. Try again — or use a hint.');
      }
      lines = matching;
      index++;
      if (index >= lines[0].length) return finish(r);

      const reply = game.move(lines[0][index]);
      index++;
      return { result: 'correct', move: r, reply };
    },
  };

  function finish(move) {
    solved = true;
    return { result: 'solved', move, message: lesson.success };
  }
}
