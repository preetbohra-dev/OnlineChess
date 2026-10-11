// The daily puzzle: the same puzzle for everyone on a given local date, drawn from the lesson
// puzzles (rule demonstrations excluded) so it changes every day and cycles through them all.
import { ALL_LESSONS } from '../data/lessons/index.js';

export const DAILY_POOL = ALL_LESSONS.filter((l) => l.type === 'puzzle' && !l.rule);

// Days since 1970-01-01 for a 'YYYY-MM-DD' key, in UTC so it does not depend on the time zone.
const dayNumber = (day) => Math.floor(Date.UTC(...day.split('-').map((n, i) => (i === 1 ? Number(n) - 1 : Number(n)))) / 86_400_000);

// A fixed shuffle of the pool (so neighbouring days are not neighbouring lessons), then one per day.
const ORDER = DAILY_POOL.map((_, i) => i).sort((a, b) => ((a * 7919) % 101) - ((b * 7919) % 101));

export function dailyPuzzle(day) {
  const n = dayNumber(day);
  return DAILY_POOL[ORDER[((n % ORDER.length) + ORDER.length) % ORDER.length]];
}
