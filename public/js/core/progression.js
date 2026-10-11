// Player progression, pure: XP and ranks, per-opponent records, achievements and the daily
// puzzle streak. store/profile.js persists the profile and feeds it app events.
//   applyEvent(profile, event) -> { profile, xp, unlocked: [achievement], rankUp: rank | null }

export const RANKS = [
  { id: 'pawn', name: 'Pawn', icon: '♙', min: 0 },
  { id: 'knight', name: 'Knight', icon: '♘', min: 150 },
  { id: 'bishop', name: 'Bishop', icon: '♗', min: 400 },
  { id: 'rook', name: 'Rook', icon: '♖', min: 800 },
  { id: 'queen', name: 'Queen', icon: '♕', min: 1500 },
  { id: 'king', name: 'King', icon: '♔', min: 2500 },
  { id: 'grandmaster', name: 'Grandmaster', icon: '👑', min: 4000 },
  { id: 'legend', name: 'Legend', icon: '🌟', min: 6500 },
];

// rankFor(xp) -> { ...rank, next: rank | null, progress: 0..1 toward the next rank }
export function rankFor(xp) {
  const i = RANKS.findLastIndex((r) => xp >= r.min);
  const rank = RANKS[Math.max(0, i)];
  const next = RANKS[i + 1] ?? null;
  const progress = next ? (xp - rank.min) / (next.min - rank.min) : 1;
  return { ...rank, next, progress: Math.min(1, Math.max(0, progress)) };
}

// XP for a finished game, from the player's point of view.
const BOT_WIN_XP = { novice: 20, amateur: 40, pro: 70, grandmaster: 120, beyond: 200 };
export const XP = {
  lesson: 25,
  opening: 20,
  daily: 30,
  dailyStreakBonus: 5, // per day of streak, up to a week
  local: 5,
  online: { win: 30, draw: 15, loss: 10 },
  training: { base: 15, accuracyDivisor: 5 },
  botLoss: 5,
  minPlies: 16, // a game shorter than 8 moves each earns no XP (no farming by instant resigns)
  puzzle: 5, // a rated puzzle solved at the first try
  rushPerPoint: 2,
  rushMax: 60,
};

export function emptyProfile() {
  return {
    xp: 0,
    games: { played: 0, won: 0, drawn: 0, lost: 0, mates: 0 },
    bots: {}, // personaId -> { w, d, l, streak, best }
    online: { w: 0, d: 0, l: 0 },
    training: { games: 0, bestAccuracy: 0 },
    lessons: 0,
    openings: 0,
    daily: { last: null, streak: 0, best: 0, solved: 0 },
    puzzles: { solved: 0, bestRating: 0, rushBest: 0 },
    achievements: {}, // id -> ISO date unlocked
  };
}

// A stored profile may be old or damaged: keep only well-formed fields over the defaults.
export function normalizeProfile(raw) {
  const base = emptyProfile();
  if (!raw || typeof raw !== 'object') return base;
  const num = (v, d = 0) => (Number.isFinite(v) && v >= 0 ? v : d);
  const out = { ...base, xp: num(raw.xp), lessons: num(raw.lessons), openings: num(raw.openings) };
  for (const k of Object.keys(base.games)) out.games[k] = num(raw.games?.[k]);
  for (const k of Object.keys(base.online)) out.online[k] = num(raw.online?.[k]);
  out.training = { games: num(raw.training?.games), bestAccuracy: num(raw.training?.bestAccuracy) };
  out.puzzles = { solved: num(raw.puzzles?.solved), bestRating: num(raw.puzzles?.bestRating), rushBest: num(raw.puzzles?.rushBest) };
  const d = raw.daily ?? {};
  out.daily = {
    last: typeof d.last === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(d.last) ? d.last : null,
    streak: num(d.streak), best: num(d.best), solved: num(d.solved),
  };
  if (raw.bots && typeof raw.bots === 'object') {
    for (const [id, r] of Object.entries(raw.bots)) {
      if (/^[a-z]{1,20}$/.test(id)) out.bots[id] = { w: num(r?.w), d: num(r?.d), l: num(r?.l), streak: num(r?.streak), best: num(r?.best) };
    }
  }
  if (raw.achievements && typeof raw.achievements === 'object') {
    for (const [id, at] of Object.entries(raw.achievements)) if (ACHIEVEMENTS.some((a) => a.id === id) && typeof at === 'string') out.achievements[id] = at;
  }
  return out;
}

export const ACHIEVEMENTS = [
  { id: 'first-win', icon: '🎉', title: 'First victory', text: 'Win a game against the computer or a friend online.', test: (p) => p.games.won >= 1 },
  { id: 'checkmate', icon: '♚', title: 'Checkmate!', text: 'Win a game by checkmate.', test: (p) => p.games.mates >= 1 },
  { id: 'beat-novice', icon: '🐣', title: 'Hatchling no more', text: 'Beat Pip the Pawn.', test: (p) => (p.bots.novice?.w ?? 0) >= 1 },
  { id: 'beat-amateur', icon: '🦖', title: 'Dino tamer', text: 'Beat Rookie Rex.', test: (p) => (p.bots.amateur?.w ?? 0) >= 1 },
  { id: 'beat-pro', icon: '🦉', title: 'Top of the class', text: 'Beat Professor Hoot.', test: (p) => (p.bots.pro?.w ?? 0) >= 1 },
  { id: 'beat-grandmaster', icon: '🧙', title: 'Spellbreaker', text: 'Beat Magnus the Wizard.', test: (p) => (p.bots.grandmaster?.w ?? 0) >= 1 },
  { id: 'beat-beyond', icon: '👾', title: 'Into the void', text: 'Beat Deep Void. (Good luck.)', test: (p) => (p.bots.beyond?.w ?? 0) >= 1 },
  { id: 'hat-trick', icon: '🔥', title: 'Hat-trick', text: 'Win three games in a row against the same opponent.', test: (p) => Object.values(p.bots).some((r) => r.best >= 3) },
  { id: 'online-win', icon: '🌐', title: 'Friendly rivalry', text: 'Win an online game.', test: (p) => p.online.w >= 1 },
  { id: 'sharp-eye', icon: '🎯', title: 'Sharp eye', text: 'Finish a coached game with 90% accuracy or better.', test: (p) => p.training.bestAccuracy >= 90 },
  { id: 'student', icon: '📚', title: 'Student', text: 'Complete 10 lessons.', test: (p) => p.lessons >= 10 },
  { id: 'opening-buff', icon: '📖', title: 'Opening buff', text: 'Practise 5 openings to the end.', test: (p) => p.openings >= 5 },
  { id: 'streak-3', icon: '📅', title: 'Habit forming', text: 'Solve the daily puzzle three days in a row.', test: (p) => p.daily.best >= 3 },
  { id: 'streak-7', icon: '🏆', title: 'Week of wisdom', text: 'Solve the daily puzzle seven days in a row.', test: (p) => p.daily.best >= 7 },
  { id: 'puzzle-100', icon: '🧩', title: 'Puzzle addict', text: 'Solve 100 rated puzzles.', test: (p) => p.puzzles.solved >= 100 },
  { id: 'puzzle-1500', icon: '⚔️', title: 'Tactician', text: 'Reach a puzzle rating of 1500.', test: (p) => p.puzzles.bestRating >= 1500 },
  { id: 'puzzle-2000', icon: '🗡️', title: 'Tactical genius', text: 'Reach a puzzle rating of 2000.', test: (p) => p.puzzles.bestRating >= 2000 },
  { id: 'rush-15', icon: '⚡', title: 'Rush hour', text: 'Score 15 in Puzzle Rush.', test: (p) => p.puzzles.rushBest >= 15 },
  { id: 'rush-25', icon: '🌩️', title: 'Lightning', text: 'Score 25 in Puzzle Rush.', test: (p) => p.puzzles.rushBest >= 25 },
];

// Calendar helpers on local dates written as YYYY-MM-DD.
export function dayKey(date = new Date()) {
  const pad = (n) => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}
export function previousDay(key) {
  const [y, m, d] = key.split('-').map(Number);
  return dayKey(new Date(y, m - 1, d - 1));
}

// The game's outcome for the player: 'win' | 'draw' | 'loss', or null when it cannot be told
// (pass-and-play has two players, so no side "wins" for the profile).
function outcomeFor(status, color) {
  if (!status?.over || !color) return null;
  if (!status.winner) return 'draw';
  return status.winner === color ? 'win' : 'loss';
}

// Events:
//   { type: 'game', kind: 'bot'|'online'|'training'|'local'|'practice', status, color, personaId, accuracy, plies }
// 'practice' is a game started from a set-up position: it earns a little XP but no records.
//   { type: 'lesson', total } · { type: 'opening', total } · { type: 'daily', day: 'YYYY-MM-DD' }
//   { type: 'sync', lessons, openings }
//   { type: 'puzzle', solved, rating } · { type: 'rush', score }
export function applyEvent(input, event, { now = new Date() } = {}) {
  const p = structuredClone(normalizeProfile(input));
  const before = rankFor(p.xp);
  let xp = 0;

  if (event.type === 'game') {
    const counted = event.kind !== 'local' && event.kind !== 'practice';
    const result = counted ? outcomeFor(event.status, event.color) : null;
    p.games.played++;
    if (result === 'win') p.games.won++;
    if (result === 'draw') p.games.drawn++;
    if (result === 'loss') p.games.lost++;
    if (result === 'win' && event.status.reason === 'checkmate') p.games.mates++;

    if (!counted) xp = XP.local;
    if (event.kind === 'online' && result) {
      p.online[{ win: 'w', draw: 'd', loss: 'l' }[result]]++;
      xp = XP.online[result];
    }
    if (event.kind === 'bot' && result && event.personaId) {
      const r = p.bots[event.personaId] ?? { w: 0, d: 0, l: 0, streak: 0, best: 0 };
      if (result === 'win') { r.w++; r.streak++; r.best = Math.max(r.best, r.streak); }
      if (result === 'draw') { r.d++; r.streak = 0; }
      if (result === 'loss') { r.l++; r.streak = 0; }
      p.bots[event.personaId] = r;
      const win = BOT_WIN_XP[event.personaId] ?? 20;
      xp = result === 'win' ? win : result === 'draw' ? Math.round(win / 2) : XP.botLoss;
    }
    // Too short to judge: a quick resignation should not count as an accurate game.
    const short = Number.isFinite(event.plies) && event.plies < XP.minPlies;
    if (event.kind === 'training') {
      p.training.games++;
      const accuracy = Number.isFinite(event.accuracy) && !short ? event.accuracy : 0;
      p.training.bestAccuracy = Math.max(p.training.bestAccuracy, accuracy);
      xp = XP.training.base + Math.round(accuracy / XP.training.accuracyDivisor);
    }
    // A checkmate counts however quick it was; any other short ending earns no XP.
    if (short && event.status?.reason !== 'checkmate') xp = 0;
  }
  // `total` is the number completed so far (progress is also kept outside the profile), so
  // completions from before the profile existed, or before a reset, still count.
  if (event.type === 'lesson') { p.lessons = Math.max(p.lessons + 1, event.total ?? 0); xp = XP.lesson; }
  if (event.type === 'opening') { p.openings = Math.max(p.openings + 1, event.total ?? 0); xp = XP.opening; }
  // Catch up counters without awarding XP (e.g. on start-up).
  if (event.type === 'sync') {
    p.lessons = Math.max(p.lessons, event.lessons ?? 0);
    p.openings = Math.max(p.openings, event.openings ?? 0);
  }
  if (event.type === 'puzzle') {
    if (Number.isFinite(event.rating)) p.puzzles.bestRating = Math.max(p.puzzles.bestRating, event.rating);
    if (event.solved) { p.puzzles.solved++; xp = XP.puzzle; }
  }
  if (event.type === 'rush' && Number.isFinite(event.score) && event.score >= 0) {
    p.puzzles.rushBest = Math.max(p.puzzles.rushBest, event.score);
    xp = Math.min(XP.rushMax, event.score * XP.rushPerPoint);
  }
  if (event.type === 'daily') {
    const day = event.day ?? dayKey(now);
    // Only a day after the last solve counts (YYYY-MM-DD strings sort by date), so a clock
    // moved backwards cannot re-earn or reset anything.
    if (!p.daily.last || day > p.daily.last) {
      p.daily.streak = p.daily.last === previousDay(day) ? p.daily.streak + 1 : 1;
      p.daily.best = Math.max(p.daily.best, p.daily.streak);
      p.daily.last = day;
      p.daily.solved++;
      xp = XP.daily + XP.dailyStreakBonus * Math.min(p.daily.streak - 1, 7);
    }
  }

  p.xp += xp;
  const unlocked = [];
  for (const a of ACHIEVEMENTS) {
    if (!p.achievements[a.id] && a.test(p)) {
      p.achievements[a.id] = now.toISOString();
      unlocked.push(a);
    }
  }
  const after = rankFor(p.xp);
  return { profile: p, xp, unlocked, rankUp: after.id !== before.id ? after : null };
}

// The streak as it stands today: a streak whose last solve was before yesterday has lapsed.
export function currentStreak(profile, today = dayKey()) {
  const { last, streak } = profile.daily;
  return last === today || last === previousDay(today) ? streak : 0;
}
