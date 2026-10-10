import { startRouter, navigate } from './router.js';
import { renderHome, renderPlayMenu, renderTrainMenu, renderNotFound } from './screens/home.js';
import { mountGameScreen } from './ui/game-screen.js';
import { createLocalSession } from './sessions/local-session.js';
import { isValidFen } from './core/rules.js';
import { parseTimeControl } from './core/clock.js';
import { toast } from './ui/toast.js';
import { h } from './ui/dom.js';
import { renderLocalSetup } from './screens/local-setup.js';
import { openSettings } from './ui/settings-panel.js';
import { installSoundUnlock } from './ui/sound.js';
import { appSettings, applyTheme } from './store/settings.js';

// ?fen= lets lessons, tests and shared links start from a position; anything invalid is ignored.
function startFen(query) {
  const fen = query.get('fen');
  if (!fen) return undefined;
  if (isValidFen(fen)) return fen;
  toast('Invalid FEN in the link — starting from the initial position.', { kind: 'warn' });
  return undefined;
}

function renderLocalGame(outlet, { query }) {
  const tc = query.get('tc');
  const timeControl = parseTimeControl(tc);
  if (tc && !timeControl) toast('Invalid time control in the link — playing without a clock.', { kind: 'warn' });
  const screen = mountGameScreen(outlet, createLocalSession({ fen: startFen(query), timeControl }), {
    onNewGame: () => navigate('/play/local/new'),
  });
  return () => screen.destroy();
}

const settings = appSettings();
applyTheme(settings.get().theme);
settings.on('change', (s) => applyTheme(s.theme));
installSoundUnlock();
document.getElementById('btn-settings').addEventListener('click', () => openSettings());

if (location.protocol === 'file:') {
  document.body.prepend(h('div', { class: 'file-banner', role: 'alert' },
    'OnlineChess must be served over http. Run "npm start" and open http://localhost:3200.'));
}

startRouter(document.getElementById('app'), [
  { pattern: /^\/$/, title: '', render: renderHome },
  { pattern: /^\/play$/, title: 'Normal Mode', render: renderPlayMenu },
  { pattern: /^\/play\/local$/, title: 'Pass & Play', render: renderLocalGame },
  { pattern: /^\/play\/local\/new$/, title: 'Pass & Play', render: renderLocalSetup },
  { pattern: /^\/train$/, title: 'Training Mode', render: renderTrainMenu },
  { pattern: /^$/, notFound: true, title: 'Not found', render: renderNotFound },
]);
