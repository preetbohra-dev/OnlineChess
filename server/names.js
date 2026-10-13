// Usernames are shown to everyone on the weekly leaderboard, so obviously offensive ones and ones
// that pretend to be the site are refused at sign-up. This is a first line only: a determined
// player can spell around any list, which is what reporting (server/api.js) is for. Letters that look alike (0/o, 1/i, 3/e, 4/a,
// 5/s, 7/t) are compared as letters. Words that are rude on their own but common inside harmless
// words ("ass" in "classic") only count as a whole part of the name, split at - and _.

// Rude anywhere in a name.
// (Short words that hide inside harmless ones, like "rape" in "grapes", are left out.)
const ANYWHERE = [
  'fuck', 'shit', 'cunt', 'nigg', 'fagg', 'bitch', 'whore', 'slut', 'hitler', 'porn',
  'vagina', 'pussy', 'retard', 'twat', 'wanker', 'bastard', 'asshole', 'dildo',
  'jizz', 'molest', 'pedophile', 'paedo', 'kkk',
];
// Rude only as a whole part of the name.
const WHOLE = new Set(['ass', 'arse', 'cock', 'cocks', 'dick', 'dicks', 'cum', 'sex', 'tit', 'tits', 'anal', 'fag', 'spic', 'coon', 'homo', 'nonce', 'piss', 'crap', 'rape', 'wank', 'pedo', 'nazi', 'kike', 'penis']);
// Names that would look official.
const RESERVED = ['admin', 'moderator', 'mod', 'support', 'official', 'onlinechess', 'staff', 'system', 'root', 'stockfish'];

const LOOKALIKE = { 0: 'o', 1: 'i', 3: 'e', 4: 'a', 5: 's', 7: 't', 8: 'b', 9: 'g' };
const plain = (s) => s.toLowerCase().replace(/[0-9]/g, (d) => LOOKALIKE[d] ?? d);

// null when the name is fine, otherwise the reason (for logs and tests; users see one message).
export function nameProblem(username) {
  const name = username.toLowerCase();
  const parts = name.split(/[-_]+/).filter(Boolean);
  // Reserved names also in look-alike spellings and with a number after them (adm1n, admin2).
  const official = [name, plain(name)].flatMap((n) => [...n.split(/[-_]+/), n.replace(/[-_]/g, '')]).map((p) => p.replace(/[0-9]+$/, ''));
  if (official.some((p) => RESERVED.includes(p))) return 'reserved';
  // Digits are kept in one spelling (score99) and read as letters in the other (sh1t).
  const joined = [name.replace(/[-_]/g, ''), plain(name).replace(/[-_]/g, '')];
  if (joined.some((n) => ANYWHERE.some((w) => n.includes(w)))) return 'offensive';
  const wholeParts = [...parts, ...plain(name).split(/[-_]+/), ...parts.map((p) => p.replace(/[0-9]+$/, ''))];
  if (wholeParts.some((p) => WHOLE.has(p))) return 'offensive';
  return null;
}
