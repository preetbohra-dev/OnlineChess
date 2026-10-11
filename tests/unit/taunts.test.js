import test from 'node:test';
import assert from 'node:assert/strict';
import { TAUNTS, TAUNT_TRIGGERS } from '../../public/js/data/taunts.js';
import { PERSONAS } from '../../public/js/data/personas.js';
import { createTaunter, fillTemplate, tauntTriggerFor } from '../../public/js/core/taunts.js';
import { createRng } from '../../public/js/core/rng.js';

const analysisOf = (grade, extra = {}) => ({ classification: { grade }, bestLine: { score: { cp: 50 } }, bestCp: 50, playedCp: -600, ...extra });

test('triggers: hung piece, allowed mate, missed mate, grades', () => {
  const rng = createRng(1);
  assert.deepEqual(tauntTriggerFor(analysisOf('blunder'), { refutationTarget: { type: 'q', square: 'g5' } }, rng),
    { trigger: 'hangPiece', vars: { piece: 'queen', square: 'g5' } });
  assert.equal(tauntTriggerFor(analysisOf('blunder'), { refutationTarget: { type: 'p', square: 'e5' } }, rng).trigger, 'blunder', 'a pawn is not a "piece"');
  assert.equal(tauntTriggerFor(analysisOf('blunder', { afterLine: { score: { mate: 2 } } }), {}, rng).trigger, 'allowMate');
  assert.deepEqual(tauntTriggerFor(analysisOf('mistake', { bestLine: { score: { mate: 1 } } }), { bestSan: 'Qh7#' }, rng),
    { trigger: 'missedMate', vars: { move: 'Qh7#' } });
  assert.equal(tauntTriggerFor(analysisOf('mistake'), {}, rng).trigger, 'mistake');
  assert.equal(tauntTriggerFor(analysisOf('great'), {}, rng).trigger, 'great');
  assert.equal(tauntTriggerFor(analysisOf('best'), {}, rng), null);
});

test('triggers stay truthful', () => {
  const rng = createRng(2);
  assert.equal(tauntTriggerFor(analysisOf('mistake', { bestLine: { score: { mate: 3 } } }), { bestSan: 'Qd8+' }, rng).trigger, 'mistake',
    'a mate in three is not called "checkmate"');
  assert.equal(tauntTriggerFor(analysisOf('blunder', { bestCp: 50, playedCp: -150 }), { refutationTarget: { type: 'n', square: 'f3' } }, rng).trigger,
    'blunder', 'a trade is not a free piece');
  assert.equal(tauntTriggerFor(analysisOf('great'), { forced: true }, rng), null, 'no praise for forced moves');
  assert.equal(tauntTriggerFor(analysisOf('great'), { gameOver: true }, rng), null, 'no praise on the final move');
  assert.equal(tauntTriggerFor(analysisOf('good'), {}, rng), null);
});

// Words that must never appear in a taunt (case-insensitive, whole words).
const BANNED = ['stupid', 'idiot', 'dumb', 'loser', 'pathetic', 'trash', 'garbage', 'moron', 'useless', 'hate', 'kill', 'die', 'damn', 'hell', 'suck', 'sucks', 'ugly', 'fat'];
const PLACEHOLDERS = new Set(['piece', 'square', 'move']);

test('every persona has at least three lines for every trigger', () => {
  for (const persona of PERSONAS) {
    for (const trigger of TAUNT_TRIGGERS) {
      assert.ok(TAUNTS[persona.id]?.[trigger]?.length >= 3, `${persona.id}.${trigger}`);
    }
  }
});

test('taunts are playful: no banned words, only known placeholders, short', () => {
  const persona = PERSONAS.flatMap((p) => Object.values(p.lines).flat());
  const all = [...Object.values(TAUNTS).flatMap((byTrigger) => Object.values(byTrigger).flat()), ...persona];
  for (const line of all) {
    for (const word of BANNED) assert.doesNotMatch(line, new RegExp(`\\b${word}\\b`, 'i'), `"${line}" contains "${word}"`);
    for (const [, name] of line.matchAll(/\{(\w+)\}/g)) assert.ok(PLACEHOLDERS.has(name), `unknown {${name}} in "${line}"`);
    assert.ok(line.length <= 90, `too long: "${line}"`);
  }
});

test('placeholders are filled; missing values leave no braces behind', () => {
  assert.equal(fillTemplate('Free {piece} on {square}!', { piece: 'queen', square: 'd5' }), 'Free queen on d5!');
  assert.equal(fillTemplate('{move} was mate', {}), ' was mate');
});

test('cooldown: minor reactions wait, urgent ones always fire', () => {
  const t = createTaunter({ lines: TAUNTS.pro, rng: createRng(1), cooldownPlies: 3 });
  assert.ok(t.pick('mistake', { ply: 1 }));
  assert.equal(t.pick('inaccuracy', { ply: 2 }), null, 'too soon');
  assert.ok(t.pick('blunder', { ply: 3 }), 'blunders always get a reaction');
  assert.ok(t.pick('mistake', { ply: 7 }));
});

test('no line repeats within the last five', () => {
  const t = createTaunter({ lines: { blunder: ['a', 'b', 'c', 'd', 'e', 'f'] }, rng: createRng(9), memory: 5 });
  const said = Array.from({ length: 6 }, (_, i) => t.pick('blunder', { ply: i * 10 }));
  assert.equal(new Set(said).size, 6);
});

test('unknown triggers say nothing', () => {
  const t = createTaunter({ lines: TAUNTS.novice, rng: createRng(1) });
  assert.equal(t.pick('nonsense', { ply: 1 }), null);
});
