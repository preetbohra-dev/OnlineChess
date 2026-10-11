// The campaign: the five computer opponents in order, up to three stars each.
//   ★ win · ★ win in at most 40 moves · ★ win without a blunder (judged by the game review)
// An opponent unlocks once the previous one is beaten (Pip is always open; Deep Void needs
// Magnus). Locked opponents can still be played from Normal Mode, just without stars.
import { PERSONAS } from '../data/personas.js';

export const STAR_RULES = [
  { id: 'win', label: 'Win' },
  { id: 'fast', label: 'Win in 40 moves or fewer' },
  { id: 'clean', label: 'Win without a blunder' },
];
export const FAST_PLIES = 80;

export const emptyStars = () => ({ win: false, fast: false, clean: false });
export const starCount = (s) => (s ? STAR_RULES.filter((r) => s[r.id]).length : 0);

// campaign: { personaId: { win, fast, clean } }
export function campaignView(campaign = {}) {
  return PERSONAS.map((p, i) => {
    const stars = campaign[p.id] ?? emptyStars();
    const unlocked = i === 0 || Boolean(campaign[PERSONAS[i - 1].id]?.win);
    return { persona: p, stars, count: starCount(stars), unlocked };
  });
}

export const totalStars = (campaign = {}) => PERSONAS.reduce((n, p) => n + starCount(campaign[p.id]), 0);

// Stars earned by a won game against `personaId`: { win, fast } (clean comes from the review).
export function starsForWin({ plies, playerColor }) {
  // Moves by the player: a game the player starts as White has ceil(plies / 2) of them.
  const moves = playerColor === 'w' ? Math.ceil(plies / 2) : Math.floor(plies / 2);
  return { win: true, fast: moves <= FAST_PLIES / 2 };
}

// Can a just-finished win against `personaId` still earn the blunder-free star by review?
export function cleanStarAvailable(campaign, personaId) {
  const stop = campaignView(campaign).find((v) => v.persona.id === personaId);
  return Boolean(stop?.unlocked && stop.stars.win && !stop.stars.clean);
}

// Merge newly earned stars; returns { campaign, earned: [ruleId] }.
export function awardStars(campaign, personaId, stars) {
  const current = { ...emptyStars(), ...(campaign[personaId] ?? {}) };
  const earned = STAR_RULES.map((r) => r.id).filter((id) => stars[id] && !current[id]);
  for (const id of earned) current[id] = true;
  return { campaign: { ...campaign, [personaId]: current }, earned };
}
