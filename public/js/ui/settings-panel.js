// Settings dialog, reachable from the header on every screen. Changes apply immediately.
import { h } from './dom.js';
import { openModal } from './modal.js';
import { appSettings } from '../store/settings.js';

function toggle(key, label, hint) {
  const settings = appSettings();
  const input = h('input', { type: 'checkbox', testid: `setting-${key}`, onChange: (e) => settings.update({ [key]: e.target.checked }) });
  input.checked = settings.get()[key];
  return h('label', { class: 'setting-row' },
    h('span', { class: 'setting-text' }, h('strong', {}, label), hint ? h('span', { class: 'muted' }, hint) : null),
    h('span', { class: 'switch' }, input, h('span', { class: 'switch-track', 'aria-hidden': 'true' })));
}

function segmented(key, label, options) {
  const settings = appSettings();
  const name = `setting-${key}`;
  return h('fieldset', { class: 'setting-row segmented' },
    h('legend', { class: 'setting-text' }, h('strong', {}, label)),
    h('span', { class: 'segments' }, options.map(([value, text]) => {
      const input = h('input', { type: 'radio', name, value, testid: `${key}-${value}`, onChange: () => settings.update({ [key]: value }) });
      input.checked = settings.get()[key] === value;
      return h('label', { class: 'segment' }, input, h('span', {}, text));
    })));
}

export function openSettings() {
  return openModal({
    title: 'Settings',
    testid: 'settings-modal',
    className: 'settings',
    body: [
      segmented('theme', 'Theme', [['system', 'System'], ['dark', 'Dark'], ['light', 'Light']]),
      segmented('animation', 'Piece animation', [['off', 'Off'], ['fast', 'Fast'], ['normal', 'Smooth']]),
      toggle('sound', 'Sound effects', 'Moves, captures, checks and low-time ticks'),
      toggle('showLegalMoves', 'Show legal moves', 'Dots on the squares a piece can reach'),
      toggle('showCoordinates', 'Board coordinates', 'Applies to the next game you open'),
      toggle('autoFlip', 'Auto-flip in pass and play', 'Turn the board toward the player to move'),
      toggle('taunts', 'Computer trash talk', 'Let computer opponents comment on your blunders'),
    ],
    actions: [{ label: 'Done', primary: true, testid: 'btn-settings-done' }],
  });
}
