// Opening repertoires that give each computer opponent a personality in the first moves.
// Lines are SAN from the start; the bot follows any line that matches the game so far.
// Every line is checked for legality by tests.
import { BOOK_LINES } from './book.js';
import { OPENINGS } from './openings.js';

const TRAINER_LINES = OPENINGS.filter((o) => o.botSafe !== false).map((o) => o.line.map(([san]) => san).join(' '));

export const REPERTOIRES = {
  // Pip goes for a quick mate and plays hopeful, loosening moves.
  novice: [
    'e4 e5 Qh5 Nc6 Bc4 Nf6',
    'e4 e5 Bc4 Nc6 Qh5 g6',
    'e4 e5 Bc4 Nf6 Qf3',
    'e4 e5 Nf3 f6',
    'e4 e5 Nf3 Nc6 Bc4 h6',
    'd4 d5 Bf4 Nf6 e3 e6',
    'd4 e5 dxe5 Nc6 Nf3 Qe7',
    'e4 c5 Nf3 d6 d4 cxd4',
  ],
  // Rex loves gambits and traps.
  amateur: [
    'e4 e5 Nf3 Nc6 Bc4 Nf6 Ng5 d5 exd5 Nxd5 Nxf7',
    'e4 e5 Nf3 Nc6 Bc4 Bc5 b4',
    'e4 e5 Nf3 Nf6 Nxe5 Nc6',
    'e4 e5 d4 exd4 c3',
    'e4 e5 f4 exf4 Nf3 g5',
    'e4 c5 d4 cxd4 c3',
    'd4 e5 dxe5 Nc6 Nf3 Qe7',
    'd4 d5 c4 e5',
    'e4 d5 exd5 Qxd5 Nc3 Qa5 d4 Nf6',
  ],
};

// The lines a persona draws on: its own repertoire, else the main lines of the trainer openings
// and the general book.
export function linesFor(personaId) {
  return REPERTOIRES[personaId] ?? [...TRAINER_LINES, ...BOOK_LINES];
}
