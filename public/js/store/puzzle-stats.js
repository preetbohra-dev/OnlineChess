// Puzzle rating and history, persisted locally:
// { rating, rd, vol, solved, failed, recent: [id] (last 300 seen), history: [[date, rating]] (last 120),
//   rushBest, rushRuns }.
// Results are announced on the app bus ('puzzle:result', 'rush:end') for XP and achievements.
import { appStore } from './storage.js';
import { bus } from '../core/events.js';
import { ratePuzzle, DEFAULT_RATING } from '../core/glicko2.js';

const KEY = 'puzzles';
const num = (v, d) => (Number.isFinite(v) ? v : d);

export function loadPuzzleStats(store = appStore()) {
  const raw = store.get(KEY, null) ?? {};
  return {
    rating: Math.min(3200, Math.max(100, num(raw.rating, DEFAULT_RATING.rating))),
    rd: Math.min(350, Math.max(30, num(raw.rd, DEFAULT_RATING.rd))),
    vol: Math.min(0.2, Math.max(0.01, num(raw.vol, DEFAULT_RATING.vol))),
    solved: Math.max(0, num(raw.solved, 0)),
    failed: Math.max(0, num(raw.failed, 0)),
    recent: Array.isArray(raw.recent) ? raw.recent.filter((id) => typeof id === 'string').slice(-300) : [],
    history: Array.isArray(raw.history) ? raw.history.filter((h) => Array.isArray(h) && Number.isFinite(h[1])).slice(-120) : [],
    rushBest: Math.max(0, num(raw.rushBest, 0)),
    rushRuns: Math.max(0, num(raw.rushRuns, 0)),
    daily: raw.daily && typeof raw.daily.day === 'string' && typeof raw.daily.id === 'string' ? { day: raw.daily.day, id: raw.daily.id } : null,
  };
}

// The daily puzzle is chosen once per day and kept, so a rating change later that day (or a
// reload mid-solve) never swaps it for another.
export function pinDaily(day, choose, store = appStore()) {
  const s = loadPuzzleStats(store);
  if (s.daily?.day === day) return s.daily.id;
  const id = choose(s.rating);
  s.daily = { day, id };
  store.set(KEY, s);
  return id;
}

// A rated attempt. Returns { stats, change } (change = rating difference, rounded).
export function recordPuzzle(puzzle, solved, { store = appStore(), now = new Date() } = {}) {
  const s = loadPuzzleStats(store);
  const next = ratePuzzle(s, puzzle.rating, solved);
  const change = next.rating - s.rating;
  Object.assign(s, next);
  if (solved) s.solved++; else s.failed++;
  s.recent = [...s.recent.filter((id) => id !== puzzle.id), puzzle.id].slice(-300);
  s.history = [...s.history, [now.toISOString().slice(0, 10), s.rating]].slice(-120);
  store.set(KEY, s);
  bus.emit('puzzle:result', { id: puzzle.id, solved, rating: s.rating, change });
  return { stats: s, change };
}

// Seen without a rating change (e.g. Rush, or the daily).
export function markSeen(id, store = appStore()) {
  const s = loadPuzzleStats(store);
  s.recent = [...s.recent.filter((x) => x !== id), id].slice(-300);
  store.set(KEY, s);
}

export function recordRush(score, store = appStore()) {
  const s = loadPuzzleStats(store);
  const best = score > s.rushBest;
  s.rushBest = Math.max(s.rushBest, score);
  s.rushRuns++;
  store.set(KEY, s);
  bus.emit('rush:end', { score, best });
  return { best, rushBest: s.rushBest };
}

// The library, fetched once per page load.
let library = null;
export function loadLibrary(fetchImpl = globalThis.fetch) {
  library ??= fetchImpl('/data/puzzles.json')
    .then((r) => { if (!r.ok) throw new Error(`HTTP ${r.status}`); return r.json(); })
    .then((d) => d.puzzles)
    .catch((err) => { library = null; throw err; });
  return library;
}
