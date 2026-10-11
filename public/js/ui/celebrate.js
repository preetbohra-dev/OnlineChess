// Turns profile changes into feedback: XP toasts, rank-ups, achievement unlocks and confetti
// for wins, new achievements, new ranks and the daily puzzle.
import { bus } from '../core/events.js';
import { toast } from './toast.js';
import { confetti } from './confetti.js';

export function installCelebrations() {
  return bus.on('profile:change', ({ xp, unlocked, rankUp, event }) => {
    if (event?.type === 'reset' || (event?.type === 'sync' && !unlocked.length)) return;
    const won = event?.type === 'game' && event.kind !== 'local' && event.kind !== 'practice' && event.status?.winner && event.status.winner === event.color;
    if (xp > 0) toast(`+${xp} XP`, { kind: 'xp', timeout: 2500 });
    for (const a of unlocked) toast(`${a.icon} Achievement unlocked: ${a.title}`, { kind: 'achievement', timeout: 5000 });
    if (rankUp) toast(`${rankUp.icon} New rank: ${rankUp.name}!`, { kind: 'achievement', timeout: 5000 });
    if (won || unlocked.length || rankUp || (event?.type === 'daily' && xp > 0)) confetti();
  });
}
