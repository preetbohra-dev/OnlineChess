// The weak-spots deck, persisted locally. Cards come from reviewed games and coached games.
import { appStore } from './storage.js';
import { bus } from '../core/events.js';
import { addCards, answerCard, dueCards, validCard, cardsFromReview, makeCard, answersFor } from '../core/weakspots.js';
import { dayKey } from '../core/progression.js';
import { gameById } from './games.js';
import { expandReview } from '../core/review.js';

const KEY = 'weakspots';

export function loadDeck(store = appStore()) {
  const raw = store.get(KEY, []);
  return Array.isArray(raw) ? raw.filter(validCard) : [];
}

export function addToDeck(cards, store = appStore()) {
  const { deck, added } = addCards(loadDeck(store), cards);
  if (added) store.set(KEY, deck);
  return added;
}

export const dueToday = (store = appStore(), today = dayKey()) => dueCards(loadDeck(store), today);

export function answer(id, right, { store = appStore(), today = dayKey() } = {}) {
  const deck = loadDeck(store);
  const i = deck.findIndex((c) => c.id === id);
  if (i < 0 || deck[i].mastered || deck[i].due > today) return null; // already answered (e.g. in another tab)
  deck[i] = answerCard(deck[i], right, today);
  store.set(KEY, deck);
  bus.emit('weakspot:answered', { id, right, mastered: Boolean(deck[i].mastered) });
  return deck[i];
}

// Add cards whenever a game is reviewed, and when the coach grades a mistake or a blunder.
export function trackWeakSpots({ store = appStore() } = {}) {
  const offs = [
    bus.on('game:reviewed', ({ id }) => {
      const g = gameById(id, store);
      const review = g?.review ? expandReview(g.review, g.startFen, g.moves) : null;
      if (review) addToDeck(cardsFromReview(g, review, dayKey()), store);
    }),
    bus.on('coach:graded', ({ grade, before, san, analysis }) => {
      if (grade !== 'mistake' && grade !== 'blunder') return;
      addToDeck([makeCard({ fen: before, played: san, answers: answersFor(analysis), grade, source: 'coach', day: dayKey() })], store);
    }),
  ];
  return () => offs.forEach((off) => off());
}
