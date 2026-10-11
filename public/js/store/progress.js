// Training progress, persisted locally: completed lessons and practised openings. Completing one
// also announces it on the app bus.
import { appStore } from './storage.js';
import { bus } from '../core/events.js';

function completedSet(key, store) {
  const raw = store.get(key, []);
  return new Set(Array.isArray(raw) ? raw.filter((id) => typeof id === 'string') : []);
}

function markComplete(key, event, id, store) {
  const done = completedSet(key, store);
  if (done.has(id)) return false;
  done.add(id);
  store.set(key, [...done]);
  bus.emit(event, { id });
  return true;
}

export const completedLessons = (store = appStore()) => completedSet('lessons.completed', store);
export const markLessonComplete = (id, store = appStore()) => markComplete('lessons.completed', 'lesson:complete', id, store);
export const completedOpenings = (store = appStore()) => completedSet('openings.completed', store);
export const markOpeningComplete = (id, store = appStore()) => markComplete('openings.completed', 'opening:complete', id, store);
