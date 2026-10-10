// Chess clock with Fischer increment. Pure: time comes from the injected `now()`.
// Policy: no clock runs until the first move; the increment is added after each move made
// while that player's clock was running.

const MAX_MINUTES = 180;
const MAX_INCREMENT_SECONDS = 60;

export const TIME_CONTROLS = [
  { id: 'none', label: 'No clock', kind: 'Casual' },
  { id: '1+0', label: '1 min', kind: 'Bullet' },
  { id: '3+2', label: '3 | 2', kind: 'Blitz' },
  { id: '5+0', label: '5 min', kind: 'Blitz' },
  { id: '10+0', label: '10 min', kind: 'Rapid' },
  { id: '15+10', label: '15 | 10', kind: 'Rapid' },
  { id: '30+0', label: '30 min', kind: 'Classical' },
];

// "minutes+seconds" -> { initialMs, incrementMs, id } or null for "no clock" / invalid input.
export function parseTimeControl(text) {
  // In a query string a raw "+" decodes to a space ("?tc=5+3" -> "5 3"), so accept both.
  const normalised = String(text ?? '').trim().replace(/ /g, '+');
  const match = /^(\d{1,3}(?:\.\d{1,2})?)\+(\d{1,2})$/.exec(normalised);
  if (!match) return null;
  const minutes = Number(match[1]);
  const seconds = Number(match[2]);
  if (!(minutes > 0) || minutes > MAX_MINUTES || seconds > MAX_INCREMENT_SECONDS) return null;
  return { initialMs: Math.round(minutes * 60_000), incrementMs: seconds * 1000, id: normalised };
}

export function formatClock(ms) {
  const safe = Math.max(0, ms);
  if (safe < 10_000) return `0:0${Math.floor(safe / 1000)}.${Math.floor((safe % 1000) / 100)}`;
  const totalSeconds = Math.ceil(safe / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  return `${minutes}:${String(totalSeconds % 60).padStart(2, '0')}`;
}

export function createClock({ initialMs, incrementMs = 0, now = () => performance.now() }) {
  const remaining = { w: initialMs, b: initialMs };
  let running = null;
  let startedAt = 0;

  const live = (color) => (running === color ? Math.max(0, remaining[color] - (now() - startedAt)) : remaining[color]);

  return {
    initialMs,
    incrementMs,
    running: () => running,
    remaining: live,

    // `color` just completed a move.
    press(color) {
      const other = color === 'w' ? 'b' : 'w';
      if (running === color) remaining[color] = live(color) + incrementMs;
      running = other;
      startedAt = now();
    },

    // Colour whose time has run out, if any.
    flagged() {
      return running && live(running) <= 0 ? running : null;
    },

    stop() {
      if (running) remaining[running] = live(running);
      running = null;
    },

    // Adopt an authoritative snapshot (online games): { w, b, running } in ms.
    sync(snapshot) {
      remaining.w = Math.max(0, snapshot.w);
      remaining.b = Math.max(0, snapshot.b);
      running = snapshot.running ?? null;
      startedAt = now();
    },
  };
}
