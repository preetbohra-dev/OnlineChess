// Tiny DOM builder. Text is always inserted as text nodes, never parsed as HTML.
export function h(tag, attrs = {}, ...children) {
  const el = document.createElement(tag);
  for (const [key, value] of Object.entries(attrs ?? {})) {
    if (value == null || value === false) continue;
    if (key === 'class') el.className = value;
    else if (key === 'testid') el.dataset.testid = value;
    else if (key === 'dataset') Object.assign(el.dataset, value);
    else if (key === 'text') el.textContent = value;
    else if (key.startsWith('on') && typeof value === 'function') el.addEventListener(key.slice(2).toLowerCase(), value);
    else el.setAttribute(key, value === true ? '' : String(value));
  }
  for (const child of children.flat(Infinity)) {
    if (child == null || child === false) continue;
    el.append(child instanceof Node ? child : document.createTextNode(String(child)));
  }
  return el;
}

// Unicode glyphs; U+FE0E keeps them as text rather than emoji.
const GLYPHS = { w: { k: '♔', q: '♕', r: '♖', b: '♗', n: '♘', p: '♙' }, b: { k: '♚', q: '♛', r: '♜', b: '♝', n: '♞', p: '♟' } };
export const pieceGlyph = (color, type) => GLYPHS[color][type] + '︎';

export const COLOR_NAME = { w: 'White', b: 'Black' };

// Replace an element's children, skipping null/false (replaceChildren would print "null").
// Keyboard focus inside the element stays on the control with the same data-testid, or moves to
// its first control, so re-rendering a panel never drops focus to <body>.
export function fill(el, ...children) {
  const active = document.activeElement;
  const hadFocus = active && active !== el && el.contains(active);
  const keep = hadFocus ? active.dataset?.testid : null;
  el.replaceChildren(...children.flat(Infinity).filter((c) => c != null && c !== false));
  if (!hadFocus) return;
  const target = (keep && el.querySelector(`[data-testid="${CSS.escape(keep)}"]`)) || el.querySelector('button:not([disabled]), a[href]');
  target?.focus();
}

// A screen-reader live region that stays in the DOM; say() only announces changed text.
export function liveRegion() {
  const el = h('p', { class: 'sr-only', role: 'status', 'aria-live': 'polite' });
  return { el, say(text) { if (el.textContent !== text) el.textContent = text; } };
}
