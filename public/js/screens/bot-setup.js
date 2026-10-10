// Against the computer: pick a persona, a colour and a time control.
import { h } from '../ui/dom.js';
import { navigate } from '../router.js';
import { PERSONAS, personaById } from '../data/personas.js';
import { timeControlPicker } from './local-setup.js';
import { appStore } from '../store/storage.js';
import { TIME_CONTROLS } from '../core/clock.js';

export function renderBotSetup(outlet, { query }) {
  const store = appStore();
  const saved = store.get('lastBotSetup', {}) ?? {};
  let personaId = personaById(query.get('persona') ?? saved.persona).id;
  let color = ['w', 'b', 'random'].includes(saved.color) ? saved.color : 'w';
  let tc = TIME_CONTROLS.some((t) => t.id === saved.tc) ? saved.tc : 'none';

  const personaCards = h('div', { class: 'persona-grid', role: 'radiogroup', 'aria-label': 'Opponent' },
    PERSONAS.map((p) => {
      const input = h('input', { type: 'radio', name: 'persona', value: p.id, testid: `persona-${p.id}`, onChange: () => { personaId = p.id; } });
      input.checked = p.id === personaId;
      return h('label', { class: 'persona-card', dataset: { persona: p.id } }, input,
        h('span', { class: 'persona-avatar', 'aria-hidden': 'true' }, p.avatar),
        h('span', { class: 'persona-level' }, p.level),
        h('strong', { class: 'persona-name' }, p.name),
        h('span', { class: 'persona-rating' }, p.rating),
        h('span', { class: 'persona-tagline' }, p.tagline));
    }));

  const colorPicker = h('span', { class: 'segments', role: 'radiogroup', 'aria-label': 'Your colour' },
    [['w', '♔ White'], ['random', '🎲 Random'], ['b', '♚ Black']].map(([value, text]) => {
      const input = h('input', { type: 'radio', name: 'color', value, testid: `color-${value}`, onChange: () => { color = value; } });
      input.checked = value === color;
      return h('label', { class: 'segment' }, input, h('span', {}, text));
    }));

  outlet.append(h('div', { class: 'page menu setup setup-wide' },
    h('nav', { class: 'crumbs', 'aria-label': 'Breadcrumb' }, h('a', { href: '#/' }, 'Home'), ' / ', h('a', { href: '#/play' }, 'Normal Mode'), ' / Computer'),
    h('h1', {}, 'Play the computer'),
    h('section', { class: 'menu-section' }, h('h2', {}, 'Choose your opponent'), personaCards),
    h('section', { class: 'menu-section' }, h('h2', {}, 'Your colour'), colorPicker),
    h('section', { class: 'menu-section' }, h('h2', {}, 'Time control'), timeControlPicker(tc, (id) => { tc = id; })),
    h('div', { class: 'setup-actions' },
      h('button', {
        class: 'btn btn-primary btn-large', type: 'button', testid: 'btn-start',
        onClick: () => {
          store.set('lastBotSetup', { persona: personaId, color, tc });
          const params = new URLSearchParams({ persona: personaId, color });
          if (tc !== 'none') params.set('tc', tc);
          navigate(`/play/bot?${params}`);
        },
      }, 'Start game'))));
}
