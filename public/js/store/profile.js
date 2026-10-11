// The player's profile (XP, rank, records, achievements, daily streak), persisted locally and
// updated from app events. Every change is announced as 'profile:change' on the app bus with
// { profile, xp, unlocked, rankUp, event } so the UI can celebrate.
import { appStore } from './storage.js';
import { bus } from '../core/events.js';
import { applyEvent, normalizeProfile, emptyProfile } from '../core/progression.js';
import { START_FEN } from '../core/rules.js';
import { completedLessons, completedOpenings } from './progress.js';

const KEY = 'profile';

export function loadProfile(store = appStore()) {
  return normalizeProfile(store.get(KEY, null));
}

export function recordEvent(event, { store = appStore(), now = new Date() } = {}) {
  const change = applyEvent(loadProfile(store), event, { now });
  store.set(KEY, change.profile);
  bus.emit('profile:change', { ...change, event });
  return change;
}

export function resetProfile(store = appStore()) {
  store.set(KEY, emptyProfile());
  bus.emit('profile:change', { profile: emptyProfile(), xp: 0, unlocked: [], rankUp: null, event: { type: 'reset' } });
  syncCounts(store);
}

// Lesson and opening progress lives in its own keys; bring the profile's counters up to date.
function syncCounts(store) {
  const lessons = completedLessons(store).size;
  const openings = completedOpenings(store).size;
  const p = loadProfile(store);
  if (p.lessons < lessons || p.openings < openings) recordEvent({ type: 'sync', lessons, openings }, { store });
}

// The player's colour in a finished game, or null when there is no single player (pass and play).
function playerColorOf(session) {
  if (session.kind === 'online') return session.you?.() ?? null;
  return session.playerColor ?? null;
}

// Only games from the standard starting position count toward records and achievements;
// a position set up from a link (or an opening played out) is practice.
function fromStart(session) {
  const rules = session.rules;
  if (!rules) return true;
  return (rules.history({ verbose: true })[0]?.before ?? rules.fen()) === START_FEN;
}

// Subscribe once at start-up. Returns an unsubscribe function.
export function trackProgress({ store = appStore() } = {}) {
  syncCounts(store);
  // A takeback can reopen a finished game, which then ends again: credit each session once.
  const credited = new WeakSet();
  const offs = [
    bus.on('game:end', ({ kind, status, session }) => {
      if (!session || credited.has(session)) return;
      credited.add(session);
      recordEvent({
        type: 'game',
        kind: kind !== 'local' && !fromStart(session) ? 'practice' : kind,
        status,
        color: playerColorOf(session),
        personaId: kind === 'bot' ? session.persona?.id : undefined,
        accuracy: kind === 'training' ? session.summary?.()?.accuracy : undefined,
        plies: session.rules?.history().length,
      }, { store });
    }),
    bus.on('lesson:complete', () => recordEvent({ type: 'lesson', total: completedLessons(store).size }, { store })),
    bus.on('opening:complete', () => recordEvent({ type: 'opening', total: completedOpenings(store).size }, { store })),
    bus.on('daily:solved', ({ day }) => recordEvent({ type: 'daily', day }, { store })),
  ];
  return () => offs.forEach((off) => off());
}
