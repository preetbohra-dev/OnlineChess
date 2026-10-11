// A short confetti burst on a full-screen canvas. Skipped when the user prefers reduced motion.
const COLORS = ['#f2c14e', '#6cc4a1', '#e76f51', '#8ab4f8', '#f4a6c1', '#ffffff'];
const DURATION_MS = 1800;
const debug = (globalThis.__oc ??= {});
debug.confetti = 0;
let active = null; // the running burst's canvas: a new burst replaces it

export function confetti({ count = 120 } = {}) {
  debug.confetti++;
  if (globalThis.matchMedia?.('(prefers-reduced-motion: reduce)').matches) return;
  active?.remove();
  const canvas = document.createElement('canvas');
  active = canvas;
  // requestAnimationFrame pauses in hidden tabs; make sure the canvas never lingers.
  setTimeout(() => canvas.remove(), DURATION_MS + 500);
  canvas.className = 'confetti';
  canvas.setAttribute('aria-hidden', 'true');
  const dpr = Math.min(2, globalThis.devicePixelRatio || 1);
  canvas.width = innerWidth * dpr;
  canvas.height = innerHeight * dpr;
  document.body.append(canvas);
  const ctx = canvas.getContext('2d');
  if (!ctx) return canvas.remove();
  ctx.scale(dpr, dpr);
  const pieces = Array.from({ length: count }, () => ({
    x: innerWidth / 2 + (Math.random() - 0.5) * innerWidth * 0.3,
    y: innerHeight * 0.35,
    vx: (Math.random() - 0.5) * 9,
    vy: -Math.random() * 11 - 4,
    size: 5 + Math.random() * 6,
    spin: Math.random() * Math.PI,
    vspin: (Math.random() - 0.5) * 0.3,
    color: COLORS[Math.floor(Math.random() * COLORS.length)],
  }));
  const start = performance.now();
  function frame(t) {
    const elapsed = t - start;
    ctx.clearRect(0, 0, innerWidth, innerHeight);
    ctx.globalAlpha = Math.max(0, 1 - elapsed / DURATION_MS);
    for (const p of pieces) {
      p.vy += 0.35;
      p.x += p.vx;
      p.y += p.vy;
      p.spin += p.vspin;
      ctx.save();
      ctx.translate(p.x, p.y);
      ctx.rotate(p.spin);
      ctx.fillStyle = p.color;
      ctx.fillRect(-p.size / 2, -p.size / 4, p.size, p.size / 2);
      ctx.restore();
    }
    if (elapsed < DURATION_MS && canvas.isConnected) requestAnimationFrame(frame);
    else canvas.remove();
  }
  requestAnimationFrame(frame);
  return undefined;
}
