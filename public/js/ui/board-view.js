// Board rendering and move input, wrapping cm-chessboard. Knows nothing about game rules:
// legality comes from the `legalMoves(square)` callback, moves leave via `onMove`.
import { Chessboard, COLOR, INPUT_EVENT_TYPE, BORDER_TYPE } from '../../vendor/cm-chessboard/src/Chessboard.js';
import { Markers } from '../../vendor/cm-chessboard/src/extensions/markers/Markers.js';
import { Arrows, ARROW_TYPE } from '../../vendor/cm-chessboard/src/extensions/arrows/Arrows.js';

const MARK = {
  selected: { class: 'marker-selected', slice: 'markerSquare' },
  lastMove: { class: 'marker-last-move', slice: 'markerSquare' },
  check: { class: 'marker-check', slice: 'markerSquare' },
  hint: { class: 'marker-hint', slice: 'markerSquare' },
};
export { ARROW_TYPE };

const toBoardColor = (c) => (c === 'b' ? COLOR.black : COLOR.white);

export class BoardView {
  #pending = null;
  #inputColor = null;
  #destroyed = false;

  constructor(el, { fen, orientation = 'w', legalMoves, onMove, choosePromotion, showLegalDots = () => true, animationMs = 200 }) {
    this.legalMoves = legalMoves;
    this.onMove = onMove;
    this.choosePromotion = choosePromotion;
    this.showLegalDots = showLegalDots;
    this.board = new Chessboard(el, {
      position: fen,
      orientation: toBoardColor(orientation),
      assetsUrl: '/vendor/cm-chessboard/assets/',
      style: {
        cssClass: 'oc',
        borderType: BORDER_TYPE.none,
        showCoordinates: true,
        pieces: { file: 'pieces/staunty.svg' },
        animationDuration: animationMs,
      },
      extensions: [{ class: Markers, props: { autoMarkers: MARK.selected } }, { class: Arrows }],
    });
  }

  // 'w', 'b', 'both' or null (no input). cm-chessboard input stays enabled for both colours;
  // toggling it from inside its own move callbacks corrupts its input state machine.
  setInput(color) {
    this.#inputColor = color;
    if (!this.board.isMoveInputEnabled()) this.board.enableMoveInput((e) => this.#onInput(e));
  }

  #onInput(event) {
    switch (event.type) {
      case INPUT_EVENT_TYPE.moveInputStarted: {
        const pieceColor = event.piece?.[0];
        if (!this.#inputColor || (this.#inputColor !== 'both' && pieceColor !== this.#inputColor)) return false;
        const moves = this.legalMoves(event.squareFrom);
        if (!moves.length) return false;
        if (this.showLegalDots()) this.board.addLegalMovesMarkers(moves);
        return true;
      }
      case INPUT_EVENT_TYPE.validateMoveInput: {
        this.board.removeLegalMovesMarkers();
        const { squareFrom: from, squareTo: to } = event;
        const matches = this.legalMoves(from).filter((m) => m.to === to);
        if (!matches.length) return false;
        if (matches[0].promotion) {
          this.#promote(from, to, matches[0].color);
          return false;
        }
        this.#pending = { from, to };
        return true;
      }
      case INPUT_EVENT_TYPE.moveInputCanceled:
        this.board.removeLegalMovesMarkers();
        return undefined;
      case INPUT_EVENT_TYPE.moveInputFinished: {
        const pending = this.#pending;
        this.#pending = null;
        // Let cm-chessboard finish its own bookkeeping before the game re-renders the board.
        if (event.legalMove && pending) setTimeout(() => { if (!this.#destroyed) this.onMove(pending); }, 0);
        return undefined;
      }
      default:
        return undefined;
    }
  }

  async #promote(from, to, color) {
    const piece = await this.choosePromotion(color);
    if (piece && !this.#destroyed) this.onMove({ from, to, promotion: piece });
  }

  setPosition(fen, animated = true) {
    return this.board.setPosition(fen, animated);
  }

  cancelInput() {
    this.board.cancelMoveInput();
    this.board.removeLegalMovesMarkers();
  }

  setOrientation(color) {
    if (this.board.getOrientation() !== toBoardColor(color)) return this.board.setOrientation(toBoardColor(color));
    return Promise.resolve();
  }

  orientation() {
    return this.board.getOrientation() === COLOR.black ? 'b' : 'w';
  }

  highlight({ lastMove = null, check = null, hint = null } = {}) {
    this.board.removeMarkers(MARK.lastMove);
    this.board.removeMarkers(MARK.check);
    this.board.removeMarkers(MARK.hint);
    if (lastMove) {
      this.board.addMarker(MARK.lastMove, lastMove.from);
      this.board.addMarker(MARK.lastMove, lastMove.to);
    }
    if (check) this.board.addMarker(MARK.check, check);
    if (hint) this.board.addMarker(MARK.hint, hint);
  }

  // arrows: [{from, to, type}] where type is an ARROW_TYPE value.
  setArrows(arrows = []) {
    this.board.removeArrows();
    for (const a of arrows) this.board.addArrow(a.type ?? ARROW_TYPE.success, a.from, a.to);
  }

  destroy() {
    this.#destroyed = true;
    this.board.destroy();
  }
}
