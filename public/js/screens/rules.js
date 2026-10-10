// Rules handbook: every rule of chess in plain words, with a diagram and a link to the lesson.
import { h } from '../ui/dom.js';
import { BoardView } from '../ui/board-view.js';
import { choosePromotion } from '../ui/modal.js';

export const RULE_SECTIONS = [
  { id: 'setup', title: 'The board and setup', text: 'The board has 64 squares with a light square in each player\'s bottom-right corner. White moves first; then the players alternate, one move each.', fen: 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1', lesson: 'novice-board' },
  { id: 'moves', title: 'How the pieces move', text: 'King: one square any direction. Queen: any distance in a straight line or diagonal. Rook: straight lines. Bishop: diagonals. Knight: an L-shape, jumping over pieces. Pawn: forward one square (two from its starting square), capturing one square diagonally forward. No piece except the knight may jump, and you may not capture your own pieces.', fen: '8/8/8/3Q4/8/2N5/4P3/K6k w - - 0 1', lesson: 'novice-pieces' },
  { id: 'castling', title: 'Castling', text: 'The king moves two squares toward a rook, and the rook jumps to the square the king crossed. Allowed only if neither piece has moved, every square between them is empty, the king is not in check, and the king does not pass through or land on a square attacked by the opponent.', fen: 'r3k2r/8/8/8/8/8/8/R3K2R w KQkq - 0 1', arrows: [{ from: 'e1', to: 'g1', type: 'success' }, { from: 'e1', to: 'c1', type: 'success' }], lesson: 'novice-castling' },
  { id: 'en-passant', title: 'En passant', text: 'When a pawn moves two squares and lands beside an enemy pawn, that pawn may capture it as if it had moved only one square. This capture is allowed only on the very next move.', fen: '4k3/8/8/3pP3/8/8/8/4K3 w - d6 0 2', arrows: [{ from: 'e5', to: 'd6', type: 'success' }], lesson: 'novice-en-passant' },
  { id: 'promotion', title: 'Promotion', text: 'A pawn that reaches the last rank must be exchanged, as part of the same move, for a queen, rook, bishop or knight of the same colour — regardless of what pieces are still on the board.', fen: '8/4P3/8/8/8/2k5/8/4K3 w - - 0 1', arrows: [{ from: 'e7', to: 'e8', type: 'success' }], lesson: 'novice-promotion' },
  { id: 'check', title: 'Check, checkmate and stalemate', text: 'A king that is attacked is in check, and the player must get out of it at once — by moving the king, blocking, or capturing the attacker. You may never make a move that leaves your own king in check. If you are in check and have no legal move, it is checkmate and you lose. If you are not in check but have no legal move, it is stalemate: a draw.', fen: '6k1/5ppp/8/8/8/8/8/R5K1 w - - 0 1', arrows: [{ from: 'a1', to: 'a8', type: 'danger' }], lesson: 'novice-back-rank' },
  { id: 'draws', title: 'Draws', text: 'A game is drawn by stalemate; by agreement; when neither side has enough material to checkmate (for example king against king, or king and one bishop or knight against king); by threefold repetition of the same position (claimed by the player to move) or fivefold repetition (automatic); and by the fifty-move rule — fifty moves each without a capture or pawn move (claimed) or seventy-five (automatic, unless the last move was checkmate).', fen: 'k7/8/1Q6/8/8/8/8/7K b - - 0 1', lesson: 'novice-draws' },
  { id: 'time', title: 'Time controls', text: 'With a clock, each player has a time budget; "5 | 3" means five minutes plus three seconds added after every move. A player whose time runs out loses — unless the opponent has no way at all to checkmate (for example only a king left), in which case the game is a draw.', fen: null },
  { id: 'resign', title: 'Resigning and leaving', text: 'You may resign at any time, which loses the game. In online play, if your opponent disconnects and does not return within a minute, you may claim the win.', fen: null },
];

export function renderRules(outlet, { query } = {}) {
  const boards = [];
  const page = h('div', { class: 'page menu rules', testid: 'rules' },
    h('nav', { class: 'crumbs', 'aria-label': 'Breadcrumb' }, h('a', { href: '#/' }, 'Home'), ' / ', h('a', { href: '#/train' }, 'Training Mode'), ' / Rules'),
    h('h1', {}, 'The rules of chess'),
    h('p', { class: 'lede muted' }, 'Everything OnlineChess enforces, following the FIDE Laws of Chess.'),
    h('nav', { class: 'rules-toc', 'aria-label': 'Contents' }, RULE_SECTIONS.map((s) => h('a', { href: `#/rules?section=${s.id}`, dataset: { section: s.id } }, s.title))),
    RULE_SECTIONS.map((s) => {
      const diagram = s.fen ? h('div', { class: 'rules-board', 'aria-hidden': 'true' }) : null;
      if (diagram) boards.push({ host: diagram, section: s });
      return h('section', { class: 'rules-section', id: `rule-${s.id}`, testid: `rule-${s.id}` },
        h('div', { class: 'rules-text' },
          h('h2', {}, s.title),
          h('p', {}, s.text),
          s.lesson ? h('a', { class: 'rules-practice', href: `#/learn/${s.lesson}` }, 'Practise this ▸') : null),
        diagram);
    }));
  outlet.append(page);
  const views = boards.map(({ host, section }) => {
    const v = new BoardView(host, { fen: section.fen, legalMoves: () => [], onMove: () => {}, choosePromotion, animationMs: 0 });
    v.setArrows(section.arrows ?? []);
    return v;
  });
  for (const link of page.querySelectorAll('.rules-toc a')) {
    link.addEventListener('click', (e) => {
      e.preventDefault();
      document.getElementById(`rule-${link.dataset.section}`)?.scrollIntoView({ behavior: 'smooth' });
    });
  }
  // #/rules?section=<id> (e.g. a link from a lesson) opens at that rule.
  const section = query?.get('section');
  if (section && RULE_SECTIONS.some((r) => r.id === section)) {
    requestAnimationFrame(() => document.getElementById(`rule-${section}`)?.scrollIntoView());
  }
  return () => views.forEach((v) => v.destroy());
}
