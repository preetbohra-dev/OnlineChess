// Pass-and-play on one device: both players share the board, and every action is taken
// on behalf of the player whose turn it is.
import { createGame, otherColor } from '../core/rules.js';
import { createEmitter } from '../core/events.js';
import { attachClock } from './clocked.js';

// timeControl: { initialMs, incrementMs } from core/clock.js parseTimeControl, or null for no clock.
export function createLocalSession({ fen, timeControl = null, now } = {}) {
  const rules = createGame({ fen });
  const events = createEmitter();
  const timing = attachClock(rules, timeControl, { now });
  const changed = (detail) => {
    timing?.settle();
    events.emit('change', detail);
  };

  // FIDE 6.9: the flagged player loses unless the opponent cannot possibly checkmate.
  function flag(color) {
    const r = rules.flag(color);
    if (r.ok) changed({ action: 'flag', color });
    return r;
  }

  return {
    kind: 'local',
    title: 'Pass & Play',
    rules,
    clock: timing?.clock ?? null,
    flag,
    players: {
      w: { name: 'White', avatar: '♔' },
      b: { name: 'Black', avatar: '♚' },
    },
    capabilities: { resign: true, offerDraw: true, claimDraw: true, flip: true, autoFlip: true },
    on: events.on,

    // Pass-and-play: the board accepts input for whoever is to move.
    inputColor() {
      return rules.status().over ? null : rules.turn();
    },
    // The player acting on this device right now.
    actingColor() {
      return rules.turn();
    },
    // Both players share the screen, so the other player answers a draw offer here.
    drawAnswerer(offerColor) {
      return otherColor(offerColor);
    },

    submitMove(move) {
      const mover = rules.turn();
      if (timing?.expired(mover)) {
        flag(mover);
        return { ok: false, reason: 'flag' };
      }
      const result = rules.move(move);
      if (result.ok) {
        timing?.moved(mover);
        changed({ move: result });
      }
      return result;
    },
    resign(color = rules.turn()) {
      const r = rules.resign(color);
      if (r.ok) changed({ action: 'resign', color });
      return r;
    },
    offerDraw(color = rules.turn()) {
      const r = rules.offerDraw(color);
      if (r.ok) changed({ action: 'offerDraw', color });
      return r;
    },
    acceptDraw(color) {
      const r = rules.acceptDraw(color);
      if (r.ok) changed({ action: 'acceptDraw', color });
      return r;
    },
    declineDraw(color) {
      const r = rules.declineDraw(color);
      if (r.ok) changed({ action: 'declineDraw', color });
      return r;
    },
    claimDraw(kind) {
      const r = rules.claimDraw(kind);
      if (r.ok) changed({ action: 'claimDraw', kind });
      return r;
    },
    destroy() {
      events.clear();
    },
  };
}
