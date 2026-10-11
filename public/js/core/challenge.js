// Challenge links: "Your friend beat Magnus in 34 moves. Can you?" — parsed from and built into a
// share URL. Every value is validated; anything unexpected makes the link invalid.
import { PERSONAS } from '../data/personas.js';
import { START_FEN } from './rules.js';

// A game can be shared as a challenge when the player beat the computer from the start position.
export function canShareWin({ kind, status, playerColor, startFen }) {
  return kind === 'bot' && Boolean(status?.winner) && status.winner === playerColor && startFen === START_FEN;
}

const PERSONA_IDS = new Set(PERSONAS.map((p) => p.id));
const int = (v, min, max) => {
  if (!/^\d{1,4}$/.test(v ?? '')) return null;
  const n = Number(v);
  return n >= min && n <= max ? n : null;
};

// query: URLSearchParams -> { kind: 'bot', personaId, moves, accuracy|null } | { kind: 'rush', score } | null
export function parseChallenge(query) {
  const bot = query.get('bot');
  if (bot !== null) {
    if (!PERSONA_IDS.has(bot)) return null;
    const moves = int(query.get('moves'), 1, 500);
    if (moves === null) return null;
    const acc = query.has('acc') ? int(query.get('acc'), 0, 100) : null;
    if (query.has('acc') && acc === null) return null;
    return { kind: 'bot', personaId: bot, moves, accuracy: acc };
  }
  if (query.get('rush') !== null) {
    const score = int(query.get('rush'), 1, 999);
    return score === null ? null : { kind: 'rush', score };
  }
  return null;
}

export function challengeUrl(origin, c) {
  const q = new URLSearchParams(c.kind === 'bot'
    ? { bot: c.personaId, moves: String(c.moves), ...(c.accuracy != null ? { acc: String(c.accuracy) } : {}) }
    : { rush: String(c.score) });
  return `${origin}/#/challenge?${q}`;
}

// The challenge in words: as the friend reads it, or (self) as the sharer writes it.
export function challengeText(c, { self = false } = {}) {
  const who = self ? 'I' : 'Your friend';
  if (c.kind === 'rush') return `${who} scored ${c.score} in Puzzle Rush. Can you beat it?`;
  const p = PERSONAS.find((x) => x.id === c.personaId);
  return `${who} beat ${p.name} (${p.level}) in ${c.moves} moves${c.accuracy != null ? ` with ${c.accuracy}% accuracy` : ''}. Can you?`;
}
