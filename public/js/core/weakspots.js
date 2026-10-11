// Weak spots: your own mistakes, brought back as puzzles on a spaced-repetition schedule.
// A card is the position before a mistake (or blunder) with the engine's better move(s) as the
// answer. A right answer moves the card along INTERVALS (in days); after the last step it is
// mastered. A wrong answer sends it back to the start. Pure: dates are 'YYYY-MM-DD' keys.
import { classifyMove, scoreToCp } from './classify.js';
import { createGame, isValidFen } from './rules.js';

export const INTERVALS = [1, 3, 7, 21];
export const MAX_CARDS = 200;
const BAD = new Set(['mistake', 'blunder']);

const addDays = (day, n) => {
  const [y, m, d] = day.split('-').map(Number);
  const t = new Date(Date.UTC(y, m - 1, d + n));
  return t.toISOString().slice(0, 10);
};

// The answers for a mistake: the best move, plus the second-best when it is not itself a mistake.
export function answersFor(analysis) {
  const out = [analysis.bestMove];
  const second = analysis.secondLine?.pv?.[0];
  if (second && second !== analysis.move) {
    const { grade } = classifyMove({ bestCp: analysis.bestCp, playedCp: scoreToCp(analysis.secondLine.score) });
    if (!BAD.has(grade) && grade !== 'inaccuracy') out.push(second);
  }
  return out;
}

// One card per position (placement, side, castling, en passant), whatever found the mistake.
export function makeCard({ fen, played, answers, grade, source, day }) {
  const key = fen.split(' ').slice(0, 4).join(' ');
  return { id: key, fen, played, answers, grade, source, created: day, due: addDays(day, 1), step: 0, reps: 0, lapses: 0 };
}

// Cards from a reviewed game: the player's mistakes and blunders (both sides in pass and play).
export function cardsFromReview(record, review, day) {
  return review.moves
    .filter((m) => BAD.has(m.grade) && (!record.playerColor || m.color === record.playerColor))
    .map((m) => makeCard({ fen: m.before, played: m.san, answers: answersFor(m.analysis), grade: m.grade, source: `game:${record.id}`, day }));
}

// Add cards. A position already in the deck is kept, but a mastered one comes back (the same
// mistake was made again). When the deck is full, mastered cards are dropped first, then the oldest.
export function addCards(deck, cards) {
  const byId = new Map(deck.map((c) => [c.id, c]));
  let added = 0;
  for (const c of cards) {
    const old = byId.get(c.id);
    if (!old) { byId.set(c.id, c); added++; }
    else if (old.mastered) { byId.set(c.id, { ...old, mastered: false, step: 0, due: c.due, played: c.played }); added++; }
  }
  let next = [...byId.values()];
  while (next.length > MAX_CARDS) {
    const i = next.findIndex((c) => c.mastered);
    next.splice(i >= 0 ? i : 0, 1);
  }
  return { deck: next, added };
}

export const dueCards = (deck, today) => deck.filter((c) => !c.mastered && c.due <= today).sort((a, b) => (a.due < b.due ? -1 : 1));

// Grade an answer: a legal move that is one of the answers.
export function isRight(card, uci) {
  return card.answers.includes(uci);
}

// Reschedule after an answer. Returns the updated card.
export function answerCard(card, right, today) {
  const c = { ...card, reps: card.reps + 1 };
  if (right) {
    c.step = card.step + 1;
    if (c.step >= INTERVALS.length) { c.mastered = true; c.due = null; } else c.due = addDays(today, INTERVALS[c.step]);
  } else {
    c.step = 0;
    c.lapses = card.lapses + 1;
    c.due = addDays(today, INTERVALS[0]);
  }
  return c;
}

// A stored card is trusted only if its position is legal and its answers are legal moves there.
// The legality check is cached per position and answers, since the deck is read on every home
// page render; the cheap shape checks run every time.
const legalCache = new Map();
function legalAnswers(fen, answers) {
  const key = `${fen}|${answers.join(',')}`;
  if (legalCache.has(key)) return legalCache.get(key);
  let ok = false;
  if (isValidFen(fen)) {
    try {
      const legal = new Set(createGame({ fen }).legalMoves().map((m) => m.uci));
      ok = answers.every((a) => legal.has(a));
    } catch { ok = false; }
  }
  if (legalCache.size < 1000) legalCache.set(key, ok);
  return ok;
}

export function validCard(c) {
  if (!c || typeof c.id !== 'string' || typeof c.fen !== 'string' || !Array.isArray(c.answers) || !c.answers.length) return false;
  if (!c.answers.every((a) => typeof a === 'string')) return false;
  if (!(c.mastered || /^\d{4}-\d{2}-\d{2}$/.test(c.due ?? ''))) return false;
  return legalAnswers(c.fen, c.answers);
}
