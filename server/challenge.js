// The weekly challenge: every Monday (00:00 UTC) the same ten puzzles and three games for
// everyone, and a leaderboard.
//   Puzzles: find the best move, one attempt each, checked here (the answer is never sent first).
//   Games: play a set position out against a computer opponent; the result is self-reported (the
//   computer's moves cannot be verified), checked for legality and a real finish, and worth less.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createGame } from '../public/js/core/rules.js';
import { parseRow, toLesson } from '../public/js/core/puzzle-library.js';

export const PUZZLE_POINTS = 10;
export const GAME_POINTS = { win: 5, draw: 2 };
const MAX_GAME_PLIES = 400;
// A reported game must have taken real time: at least this long per move made (both sides),
// counted from when the player started it, and at least MIN_GAME_PLIES moves.
export const MIN_MS_PER_PLY = 400;
export const MIN_GAME_PLIES = 6;
const TARGETS = [800, 950, 1100, 1250, 1400, 1550, 1700, 1850, 2000, 2200];

// Game slots rotate weekly from this list (all from the side to move; persona is the opponent).
export const GAME_POOL = [
  { id: 'queen-mate', title: 'Checkmate with king and queen', fen: '8/8/8/4k3/8/8/8/4K2Q w - - 0 1', persona: 'pro' },
  { id: 'rook-mate', title: 'Checkmate with king and rook', fen: '8/8/8/4k3/8/8/8/4K2R w - - 0 1', persona: 'pro' },
  { id: 'two-bishops', title: 'Win with two bishops', fen: '8/8/8/4k3/8/8/8/2B1KB2 w - - 0 1', persona: 'pro' },
  { id: 'extra-queen', title: 'Convert an extra queen', fen: 'r1b1kbnr/pppp1ppp/2n5/4p3/4P3/5N2/PPPP1PPP/RNBQKB1R w KQkq - 0 4', persona: 'amateur' },
  { id: 'extra-rook', title: 'Convert an extra rook', fen: '1nbqkbnr/pppp1ppp/8/4p3/4P3/5N2/PPPP1PPP/RNBQKB1R w KQk - 0 3', persona: 'pro' },
  { id: 'lucena', title: 'Win the Lucena position', fen: '1K1k4/1P6/8/8/8/8/r7/2R5 w - - 0 1', persona: 'grandmaster' },
];

// Monday 00:00 UTC of the week containing `ms`, as YYYY-MM-DD.
export function challengeWeek(ms = Date.now()) {
  const d = new Date(ms);
  const day = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
  day.setUTCDate(day.getUTCDate() - ((day.getUTCDay() + 6) % 7));
  return day.toISOString().slice(0, 10);
}
export const weekEnds = (week) => Date.parse(`${week}T00:00:00Z`) + 7 * 86_400_000;

const hash = (s) => { let x = 2166136261; for (const c of s) x = Math.imul(x ^ c.charCodeAt(0), 16777619) >>> 0; return x; };

// The week's ten puzzles (with answers) and three games, chosen deterministically.
export function weeklySet(week, puzzles) {
  const used = new Set();
  const chosen = TARGETS.map((target, i) => {
    const near = puzzles.filter((p) => Math.abs(p.rating - target) <= 60 && !used.has(p.id));
    const pool = near.length ? near : puzzles.filter((p) => !used.has(p.id));
    const p = pool[hash(`${week}#${i}`) % pool.length];
    used.add(p.id);
    const lesson = toLesson(p);
    return { index: i, id: p.id, fen: lesson.fen, lastMove: lesson.setupMove, rating: p.rating, answer: lesson.solution[0], mate: p.themes.includes('mateIn1') };
  });
  const games = [];
  for (let k = 0; games.length < 3; k++) {
    const g = GAME_POOL[hash(`${week}/game/${k}`) % GAME_POOL.length];
    if (!games.includes(g)) games.push(g);
  }
  return { week, puzzles: chosen, games: games.map((g, slot) => ({ slot, ...g })) };
}

// Is `move` (UCI) right for a challenge puzzle? The stored best move, or any mate in a mate-in-1.
export function isCorrect(puzzle, move) {
  if (typeof move !== 'string' || !/^[a-h][1-8][a-h][1-8][qrbn]?$/.test(move)) return false;
  if (move === puzzle.answer) return true;
  if (!puzzle.mate) return false;
  const game = createGame({ fen: puzzle.fen });
  return game.move(move).ok && game.status().reason === 'checkmate';
}

// A reported game for a slot: legal from the slot's position, and finished by the rules.
// -> { ok: true, outcome: 'win' | 'draw', points, plies } | { ok: false, error }
export function scoreGame(slot, moves) {
  if (!Array.isArray(moves) || moves.length < MIN_GAME_PLIES || moves.length > MAX_GAME_PLIES) return { ok: false, error: 'Bad game.' };
  if (!moves.every((m) => typeof m === 'string' && /^[a-h][1-8][a-h][1-8][qrbn]?$/.test(m))) return { ok: false, error: 'Bad game.' };
  const game = createGame({ fen: slot.fen });
  const player = game.turn();
  for (const m of moves) {
    if (typeof m !== 'string' || !game.move(m).ok) return { ok: false, error: 'Illegal move in the game.' };
  }
  const status = game.status();
  if (!status.over) return { ok: false, error: 'The game is not finished.' };
  if (status.winner === player) return { ok: true, outcome: 'win', points: GAME_POINTS.win, plies: moves.length };
  if (!status.winner) return { ok: true, outcome: 'draw', points: GAME_POINTS.draw, plies: moves.length };
  return { ok: true, outcome: 'loss', points: 0, plies: moves.length };
}

// The challenge's own puzzles: a separate sample of the Lichess database that is never served to
// browsers (the public library at public/data/puzzles.json is, so its answers are easy to look up).
export const WEEKLY_POOL_FILE = path.join(path.dirname(fileURLToPath(import.meta.url)), 'data', 'weekly-puzzles.json');

const libraries = new Map();
export function loadPuzzleLibrary(file = WEEKLY_POOL_FILE) {
  if (!libraries.has(file)) {
    const rows = JSON.parse(fs.readFileSync(file, 'utf8')).puzzles;
    if (!Array.isArray(rows) || rows.length < TARGETS.length * 10) throw new Error(`${file} has too few puzzles for the weekly challenge`);
    libraries.set(file, rows.map(parseRow));
  }
  return libraries.get(file);
}

// The part of the week's set the player may see (no answers), with their progress.
export function publicView(set, answers, games) {
  const answered = new Map(answers.map((a) => [a.idx, a]));
  const played = new Map(games.map((g) => [g.slot, g]));
  return {
    week: set.week,
    endsAt: weekEnds(set.week),
    puzzles: set.puzzles.map((p) => {
      const a = answered.get(p.index);
      return { index: p.index, fen: p.fen, lastMove: p.lastMove, rating: p.rating, ...(a ? { answered: { move: a.move, correct: Boolean(a.correct), best: p.answer } } : {}) };
    }),
    games: set.games.map((g) => {
      const r = played.get(g.slot);
      return { slot: g.slot, title: g.title, fen: g.fen, persona: g.persona, ...(r ? { result: { points: r.points, outcome: r.outcome } } : {}) };
    }),
  };
}
