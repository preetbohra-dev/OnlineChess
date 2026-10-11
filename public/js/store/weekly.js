// The weekly challenge, client side: fetch this week's set, answer puzzles, report games.
import { toast } from '../ui/toast.js';

const HEADERS = { 'Content-Type': 'application/json', 'X-OC-Request': '1' };

async function call(method, path, body) {
  const res = await fetch(path, { method, headers: body === undefined ? {} : HEADERS, body: body === undefined ? undefined : JSON.stringify(body), credentials: 'same-origin' });
  const json = await res.json().catch(() => ({}));
  return { ok: res.ok, status: res.status, json };
}

export const loadChallenge = () => call('GET', '/api/challenge');
export const loadLeaderboard = () => call('GET', '/api/challenge/leaderboard');
export const answerPuzzle = (week, index, move) => call('POST', '/api/challenge/answer', { week, index, move });
export const startGame = (week, slot) => call('POST', '/api/challenge/start', { week, slot });

// Endings the server can check from the moves alone (resignations and time-outs cannot be).
const CHECKABLE = new Set(['checkmate', 'stalemate', 'insufficient', 'fivefold', 'seventyfive']);

// Called when a challenge game ends: sends the moves for checking and says how it scored.
export async function reportGame(week, slot, moves, status) {
  if (status && !CHECKABLE.has(status.reason)) {
    return toast('Weekly challenge: only games that end on the board (checkmate or a draw by the rules) score. You can play this one again.');
  }
  try {
    const r = await call('POST', '/api/challenge/game', { week, slot, moves });
    if (!r.ok) return toast(`Weekly challenge: ${r.json.error ?? 'the result could not be saved.'}`, { kind: 'warn' });
    if (!r.json.first) return toast('Weekly challenge: only your first result for this game counts.');
    return toast(r.json.points ? `Weekly challenge: ${r.json.outcome}, +${r.json.points} points!` : 'Weekly challenge: no points this time.', { kind: r.json.points ? 'achievement' : 'info' });
  } catch {
    return toast('Weekly challenge: offline — the result was not saved.', { kind: 'warn' });
  }
}
