// Board themes and piece sets, unlocked by rank (see core/progression.js RANKS).
export const BOARD_THEMES = [
  { id: 'wood', name: 'Wood', rank: 'pawn', light: '#eedcb8', dark: '#b88762' }, // the original board
  { id: 'tournament', name: 'Tournament green', rank: 'knight', light: '#ebecd0', dark: '#779556' },
  { id: 'marble', name: 'Marble', rank: 'bishop', light: '#e8e8e4', dark: '#9a9a96' },
  { id: 'ocean', name: 'Ocean', rank: 'rook', light: '#dee3e6', dark: '#5a8fb0' },
  { id: 'night', name: 'Night', rank: 'queen', light: '#9aa1ad', dark: '#3d4452' },
  { id: 'royal', name: 'Royal gold', rank: 'king', light: '#f3e3b0', dark: '#a8792a' },
];

export const PIECE_SETS = [
  { id: 'staunty', name: 'Staunty', rank: 'pawn' },
  { id: 'standard', name: 'Classic', rank: 'bishop' },
];
