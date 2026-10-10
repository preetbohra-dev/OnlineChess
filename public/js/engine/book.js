// Opening book lookup: the next move of any book line that matches the game so far.
import { pick } from '../core/rng.js';
import { BOOK_LINES } from '../data/book.js';

export function createBook(lines = BOOK_LINES) {
  return lines.map((line) => line.trim().split(/\s+/));
}

// playedSans: SAN moves from the standard start position. Returns a SAN move or null.
export function bookMove(book, playedSans, rng, maxPlies) {
  if (playedSans.length >= maxPlies) return null;
  const n = playedSans.length;
  const candidates = book
    .filter((line) => line.length > n && playedSans.every((san, i) => line[i] === san))
    .map((line) => line[n]);
  return candidates.length ? pick(rng, candidates) : null;
}
