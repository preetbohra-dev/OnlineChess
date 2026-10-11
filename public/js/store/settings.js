// User preferences: validated on load so stale or hand-edited values can never break the app.
import { createEmitter } from '../core/events.js';
import { appStore } from './storage.js';

export const DEFAULT_SETTINGS = Object.freeze({
  version: 1,
  theme: 'system',
  sound: true,
  showLegalMoves: true,
  showCoordinates: true,
  animation: 'normal',
  autoFlip: false,
  taunts: true,
});

const ALLOWED = {
  theme: ['system', 'dark', 'light'],
  animation: ['off', 'fast', 'normal'],
};

export const ANIMATION_MS = { off: 0, fast: 110, normal: 220 };

function sanitize(raw) {
  const out = { ...DEFAULT_SETTINGS };
  if (!raw || typeof raw !== 'object') return out;
  for (const key of Object.keys(DEFAULT_SETTINGS)) {
    if (key === 'version' || !(key in raw)) continue;
    const value = raw[key];
    if (ALLOWED[key]) { if (ALLOWED[key].includes(value)) out[key] = value; }
    else if (typeof value === typeof DEFAULT_SETTINGS[key]) out[key] = value;
  }
  return out;
}

export function loadSettings(store) {
  return sanitize(store.get('settings', null));
}

export function saveSettings(store, settings) {
  return store.set('settings', sanitize(settings));
}

// Live settings shared by the whole app.
export function createSettings(store) {
  let current = loadSettings(store);
  const events = createEmitter();
  return {
    get: () => current,
    update(patch) {
      current = sanitize({ ...current, ...patch });
      saveSettings(store, current);
      events.emit('change', current);
      return current;
    },
    on: events.on,
  };
}

let shared = null;
export function appSettings() {
  shared ??= createSettings(appStore());
  return shared;
}

export function applyTheme(theme, root = document.documentElement) {
  if (theme === 'system') delete root.dataset.theme;
  else root.dataset.theme = theme;
}
