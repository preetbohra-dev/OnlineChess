import { startRouter, navigate } from './router.js';
import { renderHome, renderPlayMenu, renderTrainMenu, renderNotFound } from './screens/home.js';
import { mountGameScreen } from './ui/game-screen.js';
import { createLocalSession } from './sessions/local-session.js';
import { isValidFen } from './core/rules.js';
import { toast } from './ui/toast.js';
import { h } from './ui/dom.js';

// ?fen= lets lessons, tests and shared links start from a position; anything invalid is ignored.
function startFen(query) {
  const fen = query.get('fen');
  if (!fen) return undefined;
  if (isValidFen(fen)) return fen;
  toast('Invalid FEN in the link — starting from the initial position.', { kind: 'warn' });
  return undefined;
}

function renderLocalGame(outlet, { query }) {
  const screen = mountGameScreen(outlet, createLocalSession({ fen: startFen(query) }), {
    onNewGame: () => navigate('/play/local'),
  });
  return () => screen.destroy();
}

if (location.protocol === 'file:') {
  document.body.prepend(h('div', { class: 'file-banner', role: 'alert' },
    'OnlineChess must be served over http. Run "npm start" and open http://localhost:3000.'));
}

startRouter(document.getElementById('app'), [
  { pattern: /^\/$/, title: '', render: renderHome },
  { pattern: /^\/play$/, title: 'Normal Mode', render: renderPlayMenu },
  { pattern: /^\/play\/local$/, title: 'Pass & Play', render: renderLocalGame },
  { pattern: /^\/train$/, title: 'Training Mode', render: renderTrainMenu },
  { pattern: /^$/, notFound: true, title: 'Not found', render: renderNotFound },
]);
