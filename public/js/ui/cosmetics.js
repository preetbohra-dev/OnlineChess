// Board themes and piece sets: chosen in Settings, available once the player's rank unlocks them.
// A choice that is (no longer) unlocked, e.g. after a profile reset, falls back to the default.
import { BOARD_THEMES, PIECE_SETS } from '../data/cosmetics.js';
import { RANKS, rankFor } from '../core/progression.js';
import { appSettings } from '../store/settings.js';
import { loadProfile } from '../store/profile.js';
import { bus } from '../core/events.js';

const rankIndex = (id) => RANKS.findIndex((r) => r.id === id);
export const isUnlocked = (item, xp) => rankIndex(rankFor(xp).id) >= rankIndex(item.rank);
export const rankName = (id) => RANKS.find((r) => r.id === id)?.name ?? id;

function effective(list, chosen, xp) {
  const item = list.find((x) => x.id === chosen);
  return item && isUnlocked(item, xp) ? item : list[0];
}

export const currentBoardTheme = () => effective(BOARD_THEMES, appSettings().get().boardTheme, loadProfile().xp);
export const currentPieceSet = () => effective(PIECE_SETS, appSettings().get().pieceSet, loadProfile().xp);
export const currentPieceFile = () => `pieces/${currentPieceSet().id}.svg`;

export function applyBoardTheme(root = document.documentElement) {
  const t = currentBoardTheme();
  root.style.setProperty('--square-light', t.light);
  root.style.setProperty('--square-dark', t.dark);
  root.dataset.board = t.id;
}

export function installCosmetics() {
  applyBoardTheme();
  const offSettings = appSettings().on('change', () => applyBoardTheme());
  const offProfile = bus.on('profile:change', () => applyBoardTheme());
  return () => { offSettings(); offProfile(); };
}
