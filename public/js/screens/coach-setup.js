// Training → Coached game: pick your level and colour.
import { h } from '../ui/dom.js';
import { navigate } from '../router.js';
import { TRAINING_LEVELS } from '../sessions/training-session.js';
import { personaById } from '../data/personas.js';
import { appStore } from '../store/storage.js';

export function renderCoachSetup(outlet, { query }) {
  const store = appStore();
  const saved = store.get('lastCoachSetup', {}) ?? {};
  const wanted = query.get('level') ?? saved.level;
  let level = TRAINING_LEVELS.some((l) => l.id === wanted) ? wanted : 'novice';
  let color = ['w', 'b', 'random'].includes(saved.color) ? saved.color : 'w';

  const cards = h('div', { class: 'persona-grid', role: 'radiogroup', 'aria-label': 'Your level' },
    TRAINING_LEVELS.map((l) => {
      const input = h('input', { type: 'radio', name: 'level', value: l.id, testid: `level-${l.id}`, onChange: () => { level = l.id; } });
      input.checked = l.id === level;
      const opponent = personaById(l.id);
      return h('label', { class: 'persona-card' }, input,
        h('span', { class: 'persona-avatar', 'aria-hidden': 'true' }, opponent.avatar),
        h('strong', { class: 'persona-name' }, l.label),
        h('span', { class: 'persona-tagline' }, l.blurb),
        h('span', { class: 'persona-rating' }, `Opponent: ${opponent.name}`));
    }));

  const colorPicker = h('span', { class: 'segments', role: 'radiogroup', 'aria-label': 'Your colour' },
    [['w', '♔ White'], ['random', '🎲 Random'], ['b', '♚ Black']].map(([value, text]) => {
      const input = h('input', { type: 'radio', name: 'color', value, testid: `color-${value}`, onChange: () => { color = value; } });
      input.checked = value === color;
      return h('label', { class: 'segment' }, input, h('span', {}, text));
    }));

  outlet.append(h('div', { class: 'page menu setup setup-wide' },
    h('nav', { class: 'crumbs', 'aria-label': 'Breadcrumb' }, h('a', { href: '#/' }, 'Home'), ' / ', h('a', { href: '#/train' }, 'Training Mode'), ' / Coached game'),
    h('h1', {}, 'Coached game'),
    h('p', { class: 'lede muted' }, 'Play a game while Coach Castle grades every move, shows what was better, points out what you missed, and warns you about threats. Use Hint and Undo whenever you like.'),
    h('section', { class: 'menu-section' }, h('h2', {}, 'Your level'), cards),
    h('section', { class: 'menu-section' }, h('h2', {}, 'Your colour'), colorPicker),
    h('div', { class: 'setup-actions' },
      h('button', {
        class: 'btn btn-primary btn-large', type: 'button', testid: 'btn-start',
        onClick: () => {
          store.set('lastCoachSetup', { level, color });
          navigate(`/train/coach/play?${new URLSearchParams({ level, color })}`);
        },
      }, 'Start training'))));
}
