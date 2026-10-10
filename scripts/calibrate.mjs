// Persona strength sanity check: plays the real engine against itself in Node.
//   node scripts/calibrate.mjs [games=6] [stronger=amateur] [weaker=novice]
// Expect the stronger persona to score clearly better. Uses createRequire'd Stockfish via the test transport.
import { createNodeTransport } from '../tests/helpers/node-engine-transport.js';
import { UciEngine } from '../public/js/engine/uci-engine.js';
import { personaById } from '../public/js/data/personas.js';
import { engineOptionsFor, searchFor, pickMove } from '../public/js/engine/personas.js';
import { createRng } from '../public/js/core/rng.js';
import { createGame } from '../public/js/core/rules.js';

const [games = 6, strongId = 'amateur', weakId = 'novice'] = process.argv.slice(2);
const strong = personaById(strongId);
const weak = personaById(weakId);
const engine = new UciEngine(await createNodeTransport(), { timeoutMs: 60_000 });
await engine.init();

let score = 0;
for (let i = 0; i < Number(games); i++) {
  const game = createGame();
  const rng = createRng(1000 + i);
  const strongColor = i % 2 === 0 ? 'w' : 'b';
  while (!game.status().over && game.history().length < 200) {
    const persona = game.turn() === strongColor ? strong : weak;
    const result = await engine.go({
      fen: game.fen(),
      ...searchFor(persona),
      options: engineOptionsFor(persona),
    });
    const legal = game.legalMoves().map((m) => m.uci);
    game.move(pickMove(persona, result, legal, rng) ?? result.bestmove);
  }
  const s = game.status();
  const points = !s.over ? 0.5 : s.winner === strongColor ? 1 : s.winner ? 0 : 0.5;
  score += points;
  console.log(`game ${i + 1}: ${strong.name} (${strongColor}) ${points} — ${s.reason ?? 'move limit'} after ${game.history().length} plies`);
}
console.log(`\n${strong.name} scored ${score}/${games} against ${weak.name}`);
engine.terminate();
