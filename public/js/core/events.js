// Minimal event emitter. `bus` carries app-wide events (game:end, lesson:complete, ...),
// which later feed the profile, XP and achievements.
export function createEmitter() {
  const handlers = new Map();
  return {
    on(type, fn) {
      if (!handlers.has(type)) handlers.set(type, new Set());
      handlers.get(type).add(fn);
      return () => handlers.get(type)?.delete(fn);
    },
    // One failing subscriber must not stop the others or the code that emitted the event.
    emit(type, payload) {
      for (const fn of [...(handlers.get(type) ?? [])]) {
        try {
          fn(payload);
        } catch (err) {
          console.error(`Handler for "${type}" failed:`, err);
        }
      }
    },
    clear() {
      handlers.clear();
    },
  };
}

export const bus = createEmitter();
