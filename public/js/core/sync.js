// Cloud sync of a player's progress: a snapshot of the locally stored keys, and the merge rules
// that combine two snapshots (this device and the account). Shared by the browser and the server.
// Merging is commutative and idempotent, so devices can sync in any order: counters take the
// larger value, sets are united, achievements keep the earliest date, and per-record choices
// prefer the more advanced record. (Two devices playing offline therefore do not add up their
// counters — the larger total wins — but nothing earned is lost.)
import { normalizeProfile } from './progression.js';
import { loadPuzzleStats } from '../store/puzzle-stats.js';
import { listGames, MAX_GAMES } from '../store/games.js';
import { loadDeck } from '../store/weakspots.js';
import { MAX_CARDS } from './weakspots.js';

// The synced storage keys (without the "oc.v1." prefix).
export const SYNC_KEYS = ['profile', 'puzzles', 'games', 'weakspots', 'lessons.completed', 'openings.completed'];
export const MAX_STATE_BYTES = 256 * 1024;

// A read-only store over a plain object, so the stores' own loaders can validate a snapshot.
// Arrays are cut to a sane length before any per-item checks run.
const CAPS = { games: 100, weakspots: 400, 'lessons.completed': 500, 'openings.completed': 100 };
const objectStore = (data) => ({
  get(key, fallback) {
    if (!data || !Object.hasOwn(data, key)) return fallback;
    const v = data[key];
    return Array.isArray(v) && CAPS[key] ? v.slice(0, CAPS[key]) : v;
  },
  set() { return false; },
});

const str = (v, n) => (typeof v === 'string' ? v.slice(0, n) : null);
const RESULT = /^(1-0|0-1|1\/2-1\/2|\*)$/;
// Only known fields, with known types and lengths. Reviews are not synced (they are recomputed on
// the device that wants one), which keeps a full history well under the size limit.
const cleanGame = (g) => ({
  id: g.id, date: str(g.date, 30) ?? '', kind: ['bot', 'training', 'online', 'local'].includes(g.kind) ? g.kind : 'local',
  white: str(g.white, 40) ?? 'White', black: str(g.black, 40) ?? 'Black',
  playerColor: g.playerColor === 'w' || g.playerColor === 'b' ? g.playerColor : null,
  personaId: typeof g.personaId === 'string' && /^[a-z]{1,20}$/.test(g.personaId) ? g.personaId : null,
  result: RESULT.test(g.result ?? '') ? g.result : '*', reason: str(g.reason, 30) ?? '',
  startFen: g.startFen, moves: g.moves.slice(0, 600),
  ...(Array.isArray(g.retried) ? { retried: g.retried.filter(Number.isInteger).slice(0, 600) } : {}),
});
const num = (v) => (Number.isFinite(v) ? v : 0);
const cleanCard = (c) => ({
  id: c.id, fen: c.fen, played: str(c.played, 12) ?? '', answers: c.answers.slice(0, 3), grade: c.grade === 'mistake' ? 'mistake' : 'blunder',
  source: str(c.source, 40) ?? '', created: str(c.created, 10) ?? '', due: c.mastered ? null : c.due, step: num(c.step), reps: num(c.reps), lapses: num(c.lapses),
  ...(c.mastered ? { mastered: true } : {}),
});

const ids = (raw) => (Array.isArray(raw) ? [...new Set(raw.filter((x) => typeof x === 'string' && x.length <= 80))] : []);

// Validate and clean a snapshot (from a device or the database). Unknown keys are dropped.
export function normalizeState(raw) {
  const s = objectStore(raw && typeof raw === 'object' ? raw : {});
  return {
    profile: normalizeProfile(s.get('profile', null)),
    puzzles: loadPuzzleStats(s),
    games: listGames(s).slice(0, MAX_GAMES).map(cleanGame),
    weakspots: loadDeck(s).slice(-MAX_CARDS).map(cleanCard),
    'lessons.completed': ids(s.get('lessons.completed', [])),
    'openings.completed': ids(s.get('openings.completed', [])),
  };
}

const max = (a, b) => Math.max(a ?? 0, b ?? 0);
const own = (o, k) => (o && Object.hasOwn(o, k) ? o[k] : undefined);
function maxFields(a = {}, b = {}) {
  const out = {};
  for (const k of new Set([...Object.keys(a), ...Object.keys(b)])) {
    const x = own(a, k);
    const y = own(b, k);
    out[k] = typeof x === 'number' || typeof y === 'number' ? max(x, y) : x ?? y;
  }
  return out;
}

function mergeProfiles(a, b) {
  const p = normalizeProfile(null);
  p.xp = max(a.xp, b.xp);
  p.lessons = max(a.lessons, b.lessons);
  p.openings = max(a.openings, b.openings);
  p.freezes = Math.min(2, max(a.freezes, b.freezes));
  for (const k of ['games', 'online', 'training', 'puzzles', 'weakspots']) p[k] = maxFields(a[k], b[k]);
  for (const id of new Set([...Object.keys(a.bots), ...Object.keys(b.bots)])) p.bots[id] = maxFields(own(a.bots, id), own(b.bots, id));
  for (const id of new Set([...Object.keys(a.campaign), ...Object.keys(b.campaign)])) {
    const x = own(a.campaign, id) ?? {};
    const y = own(b.campaign, id) ?? {};
    p.campaign[id] = { win: Boolean(x.win || y.win), fast: Boolean(x.fast || y.fast), clean: Boolean(x.clean || y.clean) };
  }
  for (const id of new Set([...Object.keys(a.achievements), ...Object.keys(b.achievements)])) {
    const dates = [own(a.achievements, id), own(b.achievements, id)].filter(Boolean).sort();
    p.achievements[id] = dates[0];
  }
  // The daily streak follows the device that solved most recently.
  const [newer, older] = (a.daily.last ?? '') >= (b.daily.last ?? '') ? [a.daily, b.daily] : [b.daily, a.daily];
  p.daily = { ...newer, best: max(newer.best, older.best), solved: max(newer.solved, older.solved) };
  // Weekly quests: the later week wins; the same week merges quest by quest.
  if (!a.quests || !b.quests || a.quests.week !== b.quests.week) {
    p.quests = [a.quests, b.quests].filter(Boolean).sort((x, y) => (x.week < y.week ? 1 : -1))[0] ?? null;
  } else {
    p.quests = { week: a.quests.week, progress: maxFields(a.quests.progress, b.quests.progress), rewarded: a.quests.rewarded || b.quests.rewarded };
  }
  return normalizeProfile(p);
}

function mergePuzzles(a, b) {
  // Rating, deviation and history come from the device that has rated more puzzles.
  const [lead, other] = a.solved + a.failed >= b.solved + b.failed ? [a, b] : [b, a];
  const recent = [...new Set([...other.recent, ...lead.recent])].slice(-300);
  const daily = [a.daily, b.daily].filter(Boolean).sort((x, y) => (x.day < y.day ? 1 : -1))[0] ?? null;
  return { ...lead, solved: max(a.solved, b.solved), failed: max(a.failed, b.failed), rushBest: max(a.rushBest, b.rushBest), rushRuns: max(a.rushRuns, b.rushRuns), recent, daily };
}

function mergeById(a, b, prefer) {
  const byId = new Map(a.map((x) => [x.id, x]));
  for (const x of b) byId.set(x.id, byId.has(x.id) ? prefer(byId.get(x.id), x) : x);
  return [...byId.values()];
}

export function mergeStates(rawA, rawB) {
  const a = normalizeState(rawA);
  const b = normalizeState(rawB);
  const games = mergeById(a.games, b.games, (x, y) => (y.review && !x.review ? y : x))
    .sort((x, y) => (x.date < y.date ? 1 : x.date > y.date ? -1 : 0))
    .slice(0, MAX_GAMES);
  const weakspots = mergeById(a.weakspots, b.weakspots, (x, y) => (y.reps > x.reps ? y : x)).slice(-MAX_CARDS);
  return {
    profile: mergeProfiles(a.profile, b.profile),
    puzzles: mergePuzzles(a.puzzles, b.puzzles),
    games,
    weakspots,
    'lessons.completed': [...new Set([...a['lessons.completed'], ...b['lessons.completed']])],
    'openings.completed': [...new Set([...a['openings.completed'], ...b['openings.completed']])],
  };
}
