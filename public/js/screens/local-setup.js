// Pass-and-play setup: pick a time control, then start.
import { h } from '../ui/dom.js';
import { navigate } from '../router.js';
import { TIME_CONTROLS } from '../core/clock.js';
import { appSettings } from '../store/settings.js';
import { appStore } from '../store/storage.js';

export function timeControlPicker(selected, onSelect) {
  return h('div', { class: 'tc-grid', role: 'radiogroup', 'aria-label': 'Time control' },
    TIME_CONTROLS.map((tc) => {
      const input = h('input', { type: 'radio', name: 'time-control', value: tc.id, testid: `tc-${tc.id}`, onChange: () => onSelect(tc.id) });
      input.checked = tc.id === selected;
      return h('label', { class: 'tc-option' }, input, h('span', { class: 'tc-label' }, tc.label), h('span', { class: 'tc-kind' }, tc.kind));
    }));
}

export function renderLocalSetup(outlet) {
  const store = appStore();
  const saved = store.get('lastLocalTc', 'none');
  let tc = TIME_CONTROLS.some((t) => t.id === saved) ? saved : 'none';
  const settings = appSettings();
  const autoFlip = h('input', { type: 'checkbox', testid: 'setup-autoflip', onChange: (e) => settings.update({ autoFlip: e.target.checked }) });
  autoFlip.checked = settings.get().autoFlip;

  outlet.append(h('div', { class: 'page menu setup' },
    h('nav', { class: 'crumbs', 'aria-label': 'Breadcrumb' }, h('a', { href: '#/' }, 'Home'), ' / ', h('a', { href: '#/play' }, 'Normal Mode'), ' / Same device'),
    h('h1', {}, 'Pass & Play'),
    h('p', { class: 'muted' }, 'Two players, one screen. Take turns making moves.'),
    h('section', { class: 'menu-section' }, h('h2', {}, 'Time control'), timeControlPicker(tc, (id) => { tc = id; })),
    h('label', { class: 'setting-row inline' },
      h('span', { class: 'setting-text' }, h('strong', {}, 'Auto-flip the board'), h('span', { class: 'muted' }, 'Turn the board toward whoever is to move')),
      h('span', { class: 'switch' }, autoFlip, h('span', { class: 'switch-track', 'aria-hidden': 'true' }))),
    h('div', { class: 'setup-actions' },
      h('button', {
        class: 'btn btn-primary btn-large', type: 'button', testid: 'btn-start',
        onClick: () => {
          store.set('lastLocalTc', tc);
          navigate(tc === 'none' ? '/play/local' : `/play/local?tc=${encodeURIComponent(tc)}`);
        },
      }, 'Start game'))));
}
