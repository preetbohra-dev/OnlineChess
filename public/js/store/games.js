// The last finished games, kept locally for review: { id, date, kind, white, black, playerColor,
// personaId, result, reason, startFen, moves: [uci], review?: compact review }.
// Newest first; at most MAX_GAMES are kept.
import { appStore } from './storage.js';
import { bus } from '../core/events.js';
import { START_FEN, isValidFen } from '../core/rules.js';

const KEY = 'games';
export const MAX_GAMES = 50;
const UCI = /^[a-h][1-8][a-h][1-8][qrbn]?$/;

function valid(g) {
  return g && typeof g.id === 'string' && /^[a-z0-9]{6,24}$/.test(g.id)
    && typeof g.startFen === 'string' && isValidFen(g.startFen)
    && Array.isArray(g.moves) && g.moves.every((m) => typeof m === 'string' && UCI.test(m));
}

export function listGames(store = appStore()) {
  const raw = store.get(KEY, []);
  return Array.isArray(raw) ? raw.filter(valid) : [];
}

export const gameById = (id, store = appStore()) => listGames(store).find((g) => g.id === id) ?? null;

// Write the list; when storage is full, drop cached reviews from the oldest games first, then
// the oldest games themselves (never the one just saved). Returns whether it was written.
function writeGames(games, store, keepId) {
  const list = games.slice(0, MAX_GAMES);
  if (store.set(KEY, list)) return true;
  for (let i = list.length - 1; i >= 0; i--) {
    if (list[i].review && list[i].id !== keepId) {
      delete list[i].review;
      if (store.set(KEY, list)) return true;
    }
  }
  while (list.length > 1) {
    const at = list.findLastIndex((g) => g.id !== keepId);
    if (at < 0) break;
    list.splice(at, 1);
    if (store.set(KEY, list)) return true;
  }
  return false;
}

export function saveGame(record, store = appStore()) {
  const games = listGames(store).filter((g) => g.id !== record.id);
  games.unshift(record);
  return writeGames(games, store, record.id) ? record : null;
}

export function attachReview(id, review, store = appStore()) {
  const games = listGames(store);
  const g = games.find((x) => x.id === id);
  if (!g) return false;
  g.review = review;
  return writeGames(games, store, id);
}

const newId = () => (Date.now().toString(36) + Math.random().toString(36).slice(2, 8)).slice(0, 16);

// The id under which a session's game was saved (for the result window's Review button).
const ids = new WeakMap();
export const savedGameId = (session) => ids.get(session) ?? null;

function playerColorOf(session) {
  if (session.kind === 'online') return session.you?.() ?? null;
  return session.playerColor ?? null;
}

// Save every finished game. A game reopened by a takeback and finished again replaces its record.
export function trackGames({ store = appStore(), now = () => new Date() } = {}) {
  return bus.on('game:end', ({ kind, status, session }) => {
    const rules = session?.rules;
    if (!rules) return;
    const history = rules.history({ verbose: true });
    if (!history.length) return; // nothing to review
    const id = ids.get(session) ?? newId();
    const saved = saveGame({
      id,
      date: now().toISOString(),
      kind,
      white: session.players?.w?.name ?? 'White',
      black: session.players?.b?.name ?? 'Black',
      playerColor: playerColorOf(session),
      personaId: session.persona?.id ?? null,
      result: status.result,
      reason: status.reason,
      startFen: history[0].before ?? START_FEN,
      moves: history.map((m) => m.uci),
    }, store);
    if (saved) ids.set(session, id); // no Review button for a game that could not be stored
  });
}
