// The rated puzzle library (a curated subset of the Lichess puzzle database, CC0).
// Rows are [id, fen, moves, rating, themes]; `fen` is the position before the opponent's move
// and `moves` starts with that move (as in the Lichess CSV). Pure: loading is done by the caller.
import { Chess } from '../../vendor/chess.js/chess.js';

// Themes offered as filters, with friendly names.
export const THEMES = {
  mateIn1: 'Mate in 1',
  mateIn2: 'Mate in 2',
  mateIn3: 'Mate in 3',
  fork: 'Forks',
  pin: 'Pins',
  skewer: 'Skewers',
  discoveredAttack: 'Discovered attacks',
  sacrifice: 'Sacrifices',
  deflection: 'Deflection',
  hangingPiece: 'Hanging pieces',
  endgame: 'Endgames',
  rookEndgame: 'Rook endgames',
  pawnEndgame: 'Pawn endgames',
  opening: 'Openings',
  defensiveMove: 'Defence',
  quietMove: 'Quiet moves',
};

export function parseRow([id, fen, moves, rating, themes]) {
  return { id, fen, moves: moves.split(' '), rating, themes: themes.split(' ') };
}

// A puzzle as the lesson puzzle player expects it: the opponent's setup move already played.
export function toLesson(p) {
  const chess = new Chess(p.fen);
  const setup = chess.move({ from: p.moves[0].slice(0, 2), to: p.moves[0].slice(2, 4), promotion: p.moves[0][4] });
  const side = chess.turn() === 'w' ? 'White' : 'Black';
  const mate = p.themes.includes('mate');
  return {
    id: p.id,
    type: 'puzzle',
    level: 'library',
    title: `Puzzle ${p.id}`,
    fen: chess.fen(),
    setupFen: p.fen,
    setupMove: { from: setup.from, to: setup.to },
    goal: mate ? 'mate' : 'line',
    solution: p.moves.slice(1),
    rating: p.rating,
    themes: p.themes,
    prompt: mate ? `${side} to move and checkmate.` : `${side} to move. Find the best move.`,
    hints: [hintFor(p.themes)],
    success: 'Solved!',
  };
}

function hintFor(themes) {
  if (themes.includes('mateIn1')) return 'There is a checkmate in one move.';
  if (themes.includes('mate')) return 'Look at every check: one of them starts a forced mate.';
  const named = Object.keys(THEMES).find((t) => themes.includes(t) && !t.startsWith('mate'));
  return named ? `Theme: ${THEMES[named].toLowerCase()}.` : 'Look for checks, captures and threats first.';
}

// A puzzle near `rating` that is not in `exclude`, optionally of one theme. The window widens
// until something fits; rng picks among the candidates.
export function choosePuzzle(puzzles, rating, { theme = null, exclude = new Set(), rng = Math.random } = {}) {
  const pool = theme ? puzzles.filter((p) => p.themes.includes(theme)) : puzzles;
  for (const width of [75, 150, 300, 600, 3000]) {
    const near = pool.filter((p) => Math.abs(p.rating - rating) <= width && !exclude.has(p.id));
    if (near.length) return near[Math.floor(rng() * near.length)];
  }
  return pool.find((p) => !exclude.has(p.id)) ?? pool[0] ?? null;
}

// Puzzle Rush: the target rating climbs with every solve.
export const RUSH = { seconds: 180, strikes: 3, start: 600, step: 60 };
export const rushTarget = (solved) => RUSH.start + RUSH.step * solved;

// Days since 1970-01-01 for a 'YYYY-MM-DD' key (UTC arithmetic on the date only).
export const dayNumber = (day) => {
  const [y, m, d] = day.split('-').map(Number);
  return Math.floor(Date.UTC(y, m - 1, d) / 86_400_000);
};

// The daily puzzle from the library: the same for every player in a 400-point rating band on a
// given day, and different every day for over a year (each band holds several hundred puzzles,
// walked with a step that is coprime to the band size).
export function dailyFromLibrary(puzzles, day, playerRating) {
  const low = Math.max(400, Math.floor((playerRating - 200) / 200) * 200);
  const band = puzzles.filter((p) => p.rating >= low && p.rating < low + 400).sort((a, b) => (a.id < b.id ? -1 : 1));
  if (!band.length) return puzzles[0] ?? null;
  let step = 7919 % band.length || 1;
  const gcd = (a, b) => (b ? gcd(b, a % b) : a);
  while (gcd(step, band.length) !== 1) step++;
  return band[(dayNumber(day) * step) % band.length];
}
