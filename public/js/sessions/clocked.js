// Clock handling shared by sessions whose clock runs on this device (pass and play, vs computer).
// Online games take the server's clock instead (clock.sync).
import { createClock } from '../core/clock.js';

export function attachClock(rules, timeControl, { now } = {}) {
  if (!timeControl) return null;
  const clock = createClock({ ...timeControl, ...(now ? { now } : {}) });
  return {
    clock,
    // True when `mover` ran out of time before moving: the session must flag, not move.
    expired: (mover) => clock.running() === mover && clock.remaining(mover) <= 0,
    // Call after `mover` completed a move.
    moved: (mover) => clock.press(mover),
    // Call after any state change: freezes both clocks once the game is over.
    settle: () => { if (rules.status().over) clock.stop(); },
  };
}
