// Online protocol: strict validation of every client message. Anything unexpected is rejected:
// unknown types, unknown or missing fields, wrong types, oversized input.
import { TIME_CONTROLS } from '../public/js/core/clock.js';

export const MAX_MESSAGE_BYTES = 4096;
export const EMOTES = { thumbs: '👍', gl: 'Good luck!', nice: 'Nice move!', oops: 'Oops!', gg: 'GG' };

const NAME = /^[\p{L}\p{N} _'-]{1,20}$/u;
const ROOM = /^[A-HJ-NP-Z2-9]{6}$/;
const TOKEN = /^[A-Za-z0-9_-]{22}$/;
const SQUARE = /^[a-h][1-8]$/;
const TC_IDS = new Set(TIME_CONTROLS.map((t) => t.id));

const isName = (v) => typeof v === 'string' && NAME.test(v) && v.trim() === v && v.length > 0;
const isInt = (min, max) => (v) => Number.isInteger(v) && v >= min && v <= max;

// field -> validator. A trailing '?' marks an optional field.
const SCHEMAS = {
  create: { name: isName, tc: (v) => TC_IDS.has(v), color: (v) => ['w', 'b', 'random'].includes(v) },
  join: { room: (v) => typeof v === 'string' && ROOM.test(v), name: isName },
  resume: { room: (v) => typeof v === 'string' && ROOM.test(v), token: (v) => typeof v === 'string' && TOKEN.test(v) },
  move: {
    from: (v) => typeof v === 'string' && SQUARE.test(v),
    to: (v) => typeof v === 'string' && SQUARE.test(v),
    'promotion?': (v) => ['q', 'r', 'b', 'n'].includes(v),
    ply: isInt(0, 2000),
  },
  resign: {},
  offerDraw: {},
  answerDraw: { accept: (v) => typeof v === 'boolean' },
  claimDraw: { kind: (v) => v === 'threefold' || v === 'fifty' },
  claimAbandon: {},
  rematch: {},
  emote: { id: (v) => Object.hasOwn(EMOTES, v) },
  ping: { t: (v) => typeof v === 'number' && Number.isFinite(v) },
};

// raw: string | Buffer -> { ok: true, msg } | { ok: false, code }
export function parseClientMessage(raw) {
  const text = typeof raw === 'string' ? raw : Buffer.isBuffer(raw) ? raw.toString('utf8') : null;
  if (text == null || Buffer.byteLength(text) > MAX_MESSAGE_BYTES) return { ok: false, code: 'too_large' };
  let data;
  try {
    data = JSON.parse(text);
  } catch {
    return { ok: false, code: 'bad_json' };
  }
  if (!data || typeof data !== 'object' || Array.isArray(data)) return { ok: false, code: 'bad_message' };
  const { type, ...fields } = data;
  if (typeof type !== 'string' || !Object.hasOwn(SCHEMAS, type)) return { ok: false, code: 'unknown_type' };
  const schema = SCHEMAS[type];
  const allowed = new Set(Object.keys(schema).map((k) => k.replace('?', '')));
  for (const key of Object.keys(fields)) if (!allowed.has(key)) return { ok: false, code: 'unknown_field' };
  for (const [rawKey, validate] of Object.entries(schema)) {
    const optional = rawKey.endsWith('?');
    const key = rawKey.replace('?', '');
    if (!(key in fields)) {
      if (optional) continue;
      return { ok: false, code: 'missing_field' };
    }
    if (!validate(fields[key])) return { ok: false, code: 'invalid_field' };
  }
  return { ok: true, msg: { type, ...fields } };
}
