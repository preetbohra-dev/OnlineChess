// Settings dialog, reachable from the header on every screen. Changes apply immediately.
import { h } from './dom.js';
import { openModal } from './modal.js';
import { appSettings } from '../store/settings.js';
import { BOARD_THEMES, PIECE_SETS } from '../data/cosmetics.js';
import { isUnlocked, rankName, currentBoardTheme, currentPieceSet } from './cosmetics.js';
import { loadProfile } from '../store/profile.js';

// A choice of cosmetics; locked items are listed with the rank that unlocks them.
function cosmeticSelect(key, label, list, current, hint) {
  const settings = appSettings();
  const xp = loadProfile().xp;
  const select = h('select', { testid: `setting-${key}`, onChange: (e) => settings.update({ [key]: e.target.value }) },
    list.map((item) => {
      const open = isUnlocked(item, xp);
      const option = h('option', { value: item.id, disabled: !open }, open ? item.name : `${item.name} — unlocks at ${rankName(item.rank)}`);
      option.selected = item.id === current.id;
      return option;
    }));
  return h('label', { class: 'setting-row' },
    h('span', { class: 'setting-text' }, h('strong', {}, label), hint ? h('span', { class: 'muted' }, hint) : null),
    select);
}

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
      cosmeticSelect('boardTheme', 'Board', BOARD_THEMES, currentBoardTheme(), 'Earn XP to rise in rank and unlock more boards and pieces'),
      cosmeticSelect('pieceSet', 'Pieces', PIECE_SETS, currentPieceSet(), 'Applies to the next board you open'),
      segmented('animation', 'Piece animation', [['off', 'Off'], ['fast', 'Fast'], ['normal', 'Smooth']]),
      toggle('sound', 'Sound effects', 'Moves, captures, checks and low-time ticks'),
      toggle('showLegalMoves', 'Show legal moves', 'Dots on the squares a piece can reach'),
      toggle('showCoordinates', 'Board coordinates', 'Applies to the next game you open'),
      toggle('autoFlip', 'Auto-flip in pass and play', 'Turn the board toward the player to move'),
      toggle('taunts', 'Computer trash talk', 'Let computer opponents comment on your blunders'),
      h('p', { class: 'muted small settings-links' },
        h('a', { href: '/privacy.html', testid: 'link-privacy' }, 'Privacy policy'), ' · ',
        h('a', { href: '/support.html', testid: 'link-support' }, 'Support')),
    ],
    actions: [{ label: 'Done', primary: true, testid: 'btn-settings-done' }],
  });
}
