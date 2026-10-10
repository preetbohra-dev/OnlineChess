// Lesson progress, persisted locally. Completing a lesson also announces it on the app bus.
import { appStore } from './storage.js';
import { bus } from '../core/events.js';

const KEY = 'lessons.completed';

export function completedLessons(store = appStore()) {
  const raw = store.get(KEY, []);
  return new Set(Array.isArray(raw) ? raw.filter((id) => typeof id === 'string') : []);
}

export function markLessonComplete(id, store = appStore()) {
  const done = completedLessons(store);
  if (done.has(id)) return false;
  done.add(id);
  store.set(KEY, [...done]);
  bus.emit('lesson:complete', { id });
  return true;
}
