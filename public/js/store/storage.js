// Versioned JSON storage over localStorage. Never throws: private mode, quota errors and
// corrupt values degrade to the fallback (corrupt values are kept under "<key>.corrupt").

const PREFIX = 'oc.v1.';

export function memoryBackend() {
  const map = new Map();
  return {
    getItem: (k) => (map.has(k) ? map.get(k) : null),
    setItem: (k, v) => { map.set(k, String(v)); },
    removeItem: (k) => { map.delete(k); },
  };
}

function browserBackend() {
  try {
    const ls = globalThis.localStorage;
    const probe = `${PREFIX}__probe`;
    ls.setItem(probe, '1');
    ls.removeItem(probe);
    return ls;
  } catch {
    return memoryBackend();
  }
}

export function createStore({ backend = browserBackend(), prefix = PREFIX } = {}) {
  const attempt = (fn, fallback) => {
    try { return fn(); } catch { return fallback; }
  };
  return {
    get(key, fallback = undefined) {
      const raw = attempt(() => backend.getItem(prefix + key), null);
      if (raw == null) return fallback;
      try {
        return JSON.parse(raw);
      } catch {
        attempt(() => backend.setItem(`${prefix + key}.corrupt`, raw));
        attempt(() => backend.removeItem(prefix + key));
        return fallback;
      }
    },
    set(key, value) {
      return attempt(() => { backend.setItem(prefix + key, JSON.stringify(value)); return true; }, false);
    },
    remove(key) {
      attempt(() => backend.removeItem(prefix + key));
    },
  };
}

let shared = null;
export function appStore() {
  shared ??= createStore();
  return shared;
}
