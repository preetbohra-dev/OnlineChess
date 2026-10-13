// Challenges between friends, client side.
import { apiFetch } from '../net/api.js';

async function call(method, path, body) {
  try {
    const res = await apiFetch(path, { method, body });
    const json = await res.json().catch(() => ({}));
    return res.ok ? { ok: true, json } : { ok: false, status: res.status, error: json.error ?? 'Something went wrong.' };
  } catch {
    return { ok: false, status: 0, error: 'No connection. Try again when you are online.' };
  }
}

export const loadChallenges = () => call('GET', '/api/challenges');
export const sendChallenge = (code, tc, color) => call('POST', '/api/challenges', { code, tc, color });
export const answerChallenge = (id, accept) => call('POST', '/api/challenges/answer', { id, accept });
export const cancelChallenge = (id) => call('POST', '/api/challenges/cancel', { id });
