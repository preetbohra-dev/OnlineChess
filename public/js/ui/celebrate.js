// Turns profile changes into feedback: XP toasts, rank-ups, achievement unlocks and confetti
// for wins, new achievements, new ranks and the daily puzzle.
import { bus } from '../core/events.js';
import { toast } from './toast.js';
import { confetti } from './confetti.js';
import { PERSONAS } from '../data/personas.js';
import { STAR_RULES } from '../core/campaign.js';

const PERSONA_NAME = Object.fromEntries(PERSONAS.map((p) => [p.id, p.name]));
const STAR_LABEL = Object.fromEntries(STAR_RULES.map((r) => [r.id, r.label.toLowerCase()]));

export function installCelebrations() {
  return bus.on('profile:change', ({ xp, unlocked, rankUp, event, stars = [], quests = [], freezeEarned = false, freezeUsed = 0 }) => {
    if (event?.type === 'reset' || (event?.type === 'sync' && !unlocked.length)) return;
    const won = event?.type === 'game' && event.kind !== 'local' && event.kind !== 'practice' && event.status?.winner && event.status.winner === event.color;
    if (xp > 0) toast(`+${xp} XP`, { kind: 'xp', timeout: 2500 });
    for (const s of stars) toast(`⭐ Campaign star vs ${PERSONA_NAME[s.personaId] ?? s.personaId}: ${STAR_LABEL[s.id]}`, { kind: 'achievement', timeout: 5000 });
    for (const q of quests) toast(`✅ Weekly quest done: ${q.text}`, { kind: 'achievement', timeout: 5000 });
    if (freezeEarned) toast('🧊 All three weekly quests done — you earned a streak freeze!', { kind: 'achievement', timeout: 6000 });
    if (freezeUsed) toast(`🧊 A streak freeze saved your daily streak${freezeUsed > 1 ? ` (${freezeUsed} used)` : ''}.`, { kind: 'xp', timeout: 6000 });
    for (const a of unlocked) toast(`${a.icon} Achievement unlocked: ${a.title}`, { kind: 'achievement', timeout: 5000 });
    if (rankUp) toast(`${rankUp.icon} New rank: ${rankUp.name}!`, { kind: 'achievement', timeout: 5000 });
    if (won || stars.length || freezeEarned || unlocked.length || rankUp || (event?.type === 'daily' && xp > 0)) confetti();
  });
}
