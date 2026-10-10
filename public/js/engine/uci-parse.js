// Parsers for the UCI lines Stockfish prints. Pure functions, shared by browser and tests.

const INT_FIELDS = new Set(['depth', 'seldepth', 'multipv', 'nodes', 'nps', 'time', 'hashfull', 'tbhits']);

// "info depth 12 ... multipv 1 score cp 31 [lowerbound] [wdl 50 900 50] ... pv e2e4 e7e5"
// -> { depth, multipv, score: {cp}|{mate}, bound, wdl, pv: [...] } or null when it has no score/pv.
export function parseInfo(line) {
  if (!line.startsWith('info ')) return null;
  const tokens = line.split(/\s+/);
  const info = { multipv: 1, bound: null, pv: [] };
  for (let i = 1; i < tokens.length; i++) {
    const key = tokens[i];
    if (INT_FIELDS.has(key)) info[key] = Number(tokens[++i]);
    else if (key === 'score') {
      const kind = tokens[++i];
      const value = Number(tokens[++i]);
      info.score = kind === 'mate' ? { mate: value } : { cp: value };
      if (tokens[i + 1] === 'lowerbound' || tokens[i + 1] === 'upperbound') info.bound = tokens[++i].replace('bound', '');
    } else if (key === 'wdl') {
      info.wdl = [Number(tokens[i + 1]), Number(tokens[i + 2]), Number(tokens[i + 3])];
      i += 3;
    } else if (key === 'pv') {
      info.pv = tokens.slice(i + 1).filter(Boolean);
      break;
    } else if (key === 'string' || key === 'currmove' || key === 'currmovenumber') {
      if (key === 'string') return null;
      i++;
    }
  }
  return info.score && info.pv.length ? info : null;
}

// "bestmove e2e4 ponder e7e5" -> { bestmove: 'e2e4', ponder: 'e7e5' }; "(none)" -> bestmove null.
export function parseBestmove(line) {
  if (!line.startsWith('bestmove')) return null;
  const [, best, , ponder] = line.trim().split(/\s+/);
  return { bestmove: best && best !== '(none)' ? best : null, ponder: ponder ?? null };
}

// "option name Skill Level type spin default 20 min 0 max 20"
export function parseOption(line) {
  const m = /^option name (.+?) type (\w+)(.*)$/.exec(line.trim());
  if (!m) return null;
  const option = { name: m[1], type: m[2] };
  const rest = m[3];
  const def = / default (.*?)(?= min | max | var |$)/.exec(rest);
  if (def) option.default = def[1] === '<empty>' ? '' : def[1];
  const min = / min (-?\d+)/.exec(rest);
  const max = / max (-?\d+)/.exec(rest);
  if (min) option.min = Number(min[1]);
  if (max) option.max = Number(max[1]);
  if (option.type === 'spin' && option.default !== undefined) option.default = Number(option.default);
  if (option.type === 'check') option.default = option.default === 'true';
  return option;
}
