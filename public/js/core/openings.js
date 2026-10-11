// Opening detection by position (so transpositions count) and the openings-trainer drill.
import { Chess } from '../../vendor/chess.js/chess.js';
import { createGame, START_FEN } from './rules.js';
import { OPENING_NAMES } from '../data/opening-names.js';
import { OPENINGS } from '../data/openings.js';

// Placement, side to move and castling rights: enough to identify an opening position.
const keyOf = (fen) => fen.split(' ').slice(0, 3).join(' ');

let index = null;
function openingIndex() {
  if (index) return index;
  index = new Map();
  for (const [eco, name, moves] of OPENING_NAMES) {
    const chess = new Chess(); // plain chess.js: building the index must be fast
    for (const san of moves.split(' ')) chess.move(san);
    index.set(keyOf(chess.fen()), { eco, name });
  }
  return index;
}

// history: verbose moves of a game. Returns the latest named position reached
// ({ eco, name, ply, trainerId }) or null — also null when the game did not start from the
// standard position.
export function detectOpening(history) {
  if (!history.length || history[0].before !== START_FEN) return null;
  const known = openingIndex();
  let found = null;
  history.forEach((m, i) => {
    const hit = known.get(keyOf(m.after));
    if (hit) found = { ...hit, ply: i + 1 };
  });
  return found ? { ...found, trainerId: trainerFor(found.name) } : null;
}

// The trainer opening that teaches a detected opening, if any.
export function trainerFor(name) {
  const fits = (m) => name === m || name.startsWith(`${m}:`) || name.endsWith(`: ${m}`);
  return OPENINGS.find((o) => (o.matches ?? [o.name]).some(fits))?.id ?? null;
}

// Practice drill: the student plays their side's moves; the other side replies from the line.
//   tryMove(input) -> { result: 'illegal' | 'wrong' | 'correct' | 'done', move?, reply?, expected? }
export function createOpeningDrill(opening) {
  const sans = opening.line.map(([san]) => san);
  let game;
  let mistakes;
  const isDone = () => game.history().length >= sans.length;

  function autoReply() {
    // The student's opponent moves whenever it is their turn.
    const ply = game.history().length;
    if (ply < sans.length && game.turn() !== opening.side) return game.move(sans[ply]);
    return null;
  }

  function reset() {
    game = createGame();
    mistakes = 0;
    autoReply();
  }
  reset();

  return {
    get game() { return game; },
    get mistakes() { return mistakes; },
    get done() { return isDone(); },
    get ply() { return game.history().length; },
    expected: () => sans[game.history().length] ?? null,
    noteFor: (ply) => opening.line[ply]?.[1] ?? null,
    reset,
    tryMove(input) {
      if (isDone() || game.turn() !== opening.side) return { result: 'illegal' };
      const ply = game.history().length;
      const r = game.move(input);
      if (!r.ok) return { result: 'illegal' };
      if (r.san !== sans[ply]) {
        game.undo();
        mistakes++;
        return { result: 'wrong', move: r, expected: sans[ply] };
      }
      const reply = autoReply();
      return { result: isDone() ? 'done' : 'correct', move: r, reply };
    },
  };
}
