import { h, pieceGlyph } from './dom.js';

let openCount = 0;
const openModals = new Set();

// Closes every open dialog, e.g. when the route changes underneath them.
export function closeAllModals() {
  for (const modal of [...openModals]) modal.close('route');
}

// Accessible modal dialog. actions: [{label, testid, primary, danger, onClick, keepOpen}]
export function openModal({ title, body = [], actions = [], testid, dismissible = true, onClose, className = '' }) {
  const previousFocus = document.activeElement;
  const titleId = `modal-title-${++openCount}`;
  let closed = false;

  const close = (reason) => {
    if (closed) return;
    closed = true;
    openModals.delete(handle);
    document.removeEventListener('keydown', onKey, true);
    backdrop.classList.remove('show');
    setTimeout(() => backdrop.remove(), 160);
    if (previousFocus?.focus) previousFocus.focus();
    onClose?.(reason);
  };

  const buttons = actions.map((a) =>
    h('button', {
      class: `btn ${a.primary ? 'btn-primary' : ''} ${a.danger ? 'btn-danger' : ''}`,
      testid: a.testid,
      type: 'button',
      onClick: () => {
        a.onClick?.();
        if (!a.keepOpen) close('action');
      },
    }, a.label));

  const dialog = h('div', { class: `modal ${className}`, role: 'dialog', 'aria-modal': 'true', 'aria-labelledby': titleId, testid },
    h('h2', { id: titleId, class: 'modal-title' }, title),
    h('div', { class: 'modal-body' }, body),
    buttons.length ? h('div', { class: 'modal-actions' }, buttons) : null);

  const backdrop = h('div', {
    class: 'modal-backdrop',
    onClick: (e) => { if (dismissible && e.target === backdrop) close('dismiss'); },
  }, dialog);

  function onKey(e) {
    if (e.key === 'Escape' && dismissible) { e.stopPropagation(); close('dismiss'); }
    if (e.key === 'Tab') {
      const focusable = [...dialog.querySelectorAll('button, [href], input, textarea, select')];
      if (!focusable.length) return;
      const first = focusable[0], last = focusable[focusable.length - 1];
      if (e.shiftKey && document.activeElement === first) { last.focus(); e.preventDefault(); }
      else if (!e.shiftKey && document.activeElement === last) { first.focus(); e.preventDefault(); }
    }
  }

  document.addEventListener('keydown', onKey, true);
  document.body.append(backdrop);
  requestAnimationFrame(() => backdrop.classList.add('show'));
  (buttons.find((b) => b.classList.contains('btn-primary')) ?? buttons[0] ?? dialog).focus?.();
  const handle = { close, el: dialog };
  openModals.add(handle);
  return handle;
}

export function confirmDialog({ title, message, confirmLabel = 'Confirm', danger = false }) {
  return new Promise((resolve) => {
    let answer = false;
    openModal({
      title,
      body: [h('p', {}, message)],
      actions: [
        { label: 'Cancel', testid: 'btn-cancel' },
        { label: confirmLabel, testid: 'btn-confirm', primary: !danger, danger, onClick: () => { answer = true; } },
      ],
      onClose: () => resolve(answer),
    });
  });
}

// Lets the player choose the promotion piece (FIDE 3.7.e: queen, rook, bishop or knight).
export function choosePromotion(color) {
  return new Promise((resolve) => {
    let choice = null;
    const names = { q: 'Queen', r: 'Rook', b: 'Bishop', n: 'Knight' };
    openModal({
      title: 'Promote your pawn',
      className: 'promotion',
      body: [h('p', { class: 'muted' }, 'Choose the piece your pawn becomes.')],
      actions: ['q', 'r', 'b', 'n'].map((p) => ({
        label: h('span', { class: 'promo-choice' }, h('span', { class: 'glyph', 'aria-hidden': 'true' }, pieceGlyph(color, p)), names[p]),
        testid: `promo-${p}`,
        primary: p === 'q',
        onClick: () => { choice = p; },
      })),
      onClose: () => resolve(choice),
    });
  });
}
