import { h } from './dom.js';

let host = null;

export function toast(message, { kind = 'info', timeout = 3500 } = {}) {
  if (!host || !host.isConnected) {
    host = h('div', { class: 'toasts', 'aria-live': 'polite' });
    document.body.append(host);
  }
  const el = h('div', { class: `toast toast-${kind}`, testid: 'toast', role: 'status' }, message);
  host.append(el);
  requestAnimationFrame(() => el.classList.add('show'));
  setTimeout(() => {
    el.classList.remove('show');
    setTimeout(() => el.remove(), 250);
  }, timeout);
}
