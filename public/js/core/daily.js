// The daily puzzle: one puzzle per local date, drawn from the lesson puzzles (rule demonstrations
// excluded) so it changes every day. Newer players (below the Rook rank) get the Novice and
// Amateur puzzles; everyone at the same tier gets the same puzzle that day.
import { ALL_LESSONS } from '../data/lessons/index.js';
import { RANKS } from './progression.js';

export const DAILY_POOL = ALL_LESSONS.filter((l) => l.type === 'puzzle' && !l.rule);
const EASY_POOL = DAILY_POOL.filter((l) => l.level === 'novice' || l.level === 'amateur');

// Days since 1970-01-01 for a 'YYYY-MM-DD' key, in UTC so it does not depend on the time zone.
const dayNumber = (day) => Math.floor(Date.UTC(...day.split('-').map((n, i) => (i === 1 ? Number(n) - 1 : Number(n)))) / 86_400_000);

// A fixed shuffle (so neighbouring days are not neighbouring lessons), then one per day.
const shuffled = (pool) => pool.map((_, i) => i).sort((a, b) => ((a * 7919) % 101) - ((b * 7919) % 101)).map((i) => pool[i]);
const ORDERS = { easy: shuffled(EASY_POOL), all: shuffled(DAILY_POOL) };

// tier: 'easy' | 'all'
export function dailyPuzzle(day, tier = 'all') {
  const order = ORDERS[tier] ?? ORDERS.all;
  const n = dayNumber(day);
  return order[((n % order.length) + order.length) % order.length];
}

// The tier for a player with this much XP.
export const dailyTier = (xp) => (xp < RANKS.find((r) => r.id === 'rook').min ? 'easy' : 'all');
