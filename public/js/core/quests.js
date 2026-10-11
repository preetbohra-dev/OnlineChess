// Weekly quests: three per week (Monday to Sunday, local time), picked from a pool so everyone
// gets the same three. Each pays XP; finishing all three earns a streak freeze (at most two
// held), which covers a missed day of the daily puzzle. Pure.

export const QUEST_XP = 30;
export const MAX_FREEZES = 2;

// count(event) -> how much the event advances the quest (0 if it does not apply).
// Games too short to count (e.short: fewer than 8 moves each and not checkmate) never do.
const game = (e, kind) => e.type === 'game' && e.kind === kind && !e.short;
const botWin = (e) => game(e, 'bot') && e.status?.winner && e.status.winner === e.color;
export const QUEST_POOL = [
  { id: 'beat-rex', text: 'Beat Rookie Rex twice', target: 2, count: (e) => (botWin(e) && e.personaId === 'amateur' ? 1 : 0) },
  { id: 'win-3', text: 'Win 3 games against the computer', target: 3, count: (e) => (botWin(e) ? 1 : 0) },
  { id: 'win-fast', text: 'Win a game in 40 moves or fewer', target: 1, count: (e) => (botWin(e) && Number.isFinite(e.plies) && e.plies <= 80 ? 1 : 0) },
  { id: 'puzzles-15', text: 'Solve 15 rated puzzles', target: 15, count: (e) => (e.type === 'puzzle' && e.solved ? 1 : 0) },
  { id: 'rush-10', text: 'Score 10 or more in Puzzle Rush', target: 1, count: (e) => (e.type === 'rush' && e.score >= 10 ? 1 : 0) },
  { id: 'review-3', text: 'Review 3 of your games', target: 3, count: (e) => (e.type === 'review' ? 1 : 0) },
  { id: 'retry-3', text: 'Fix 3 mistakes with Retry', target: 3, count: (e) => (e.type === 'retry' ? 1 : 0) },
  { id: 'daily-5', text: 'Solve the daily puzzle on 5 days', target: 5, count: (e) => (e.type === 'daily' && e.fresh ? 1 : 0) },
  { id: 'coach-2', text: 'Play 2 coached games', target: 2, count: (e) => (game(e, 'training') ? 1 : 0) },
  { id: 'online-1', text: 'Play a game online with a friend', target: 1, count: (e) => (game(e, 'online') ? 1 : 0) },
];

// The Monday (YYYY-MM-DD, local) of the week containing `date`.
export function weekKey(date = new Date()) {
  const d = new Date(date.getFullYear(), date.getMonth(), date.getDate());
  d.setDate(d.getDate() - ((d.getDay() + 6) % 7));
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

const hash = (s) => { let x = 2166136261; for (const c of s) x = Math.imul(x ^ c.charCodeAt(0), 16777619) >>> 0; return x; };

// Three distinct quests for a week.
export function questsFor(week) {
  const pool = [...QUEST_POOL];
  const picked = [];
  let seed = hash(week);
  while (picked.length < 3) {
    seed = Math.imul(seed ^ (seed >>> 15), 2246822507) >>> 0;
    picked.push(pool.splice(seed % pool.length, 1)[0]);
  }
  return picked;
}

export const emptyQuests = (week) => ({ week, progress: {}, rewarded: false });

// Advance this week's quests with an event.
//   -> { quests, completed: [quest], freezeEarned: boolean, xp }
export function advanceQuests(state, event, now = new Date()) {
  const week = weekKey(now);
  const quests = state?.week === week ? { ...state, progress: { ...state.progress } } : emptyQuests(week);
  const completed = [];
  let xp = 0;
  for (const q of questsFor(week)) {
    const before = quests.progress[q.id] ?? 0;
    if (before >= q.target) continue;
    const n = q.count(event);
    if (!n) continue;
    quests.progress[q.id] = Math.min(q.target, before + n);
    if (quests.progress[q.id] >= q.target) { completed.push(q); xp += QUEST_XP; }
  }
  const allDone = questsFor(week).every((q) => (quests.progress[q.id] ?? 0) >= q.target);
  const freezeEarned = allDone && !quests.rewarded;
  if (freezeEarned) quests.rewarded = true;
  return { quests, completed, freezeEarned, xp };
}

// For display: this week's quests with progress.
export function questView(state, now = new Date()) {
  const week = weekKey(now);
  const progress = state?.week === week ? state.progress : {};
  return questsFor(week).map((q) => ({ ...q, progress: progress[q.id] ?? 0, done: (progress[q.id] ?? 0) >= q.target }));
}
