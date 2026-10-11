// Synthesised game sounds (no audio files). The AudioContext is created on the first user
// gesture, as browsers require, and only while sound is enabled.
import { appSettings } from '../store/settings.js';

let ctx = null;
const debug = (globalThis.__oc ??= {});
debug.soundsPlayed = 0;
Object.defineProperty(debug, 'soundEnabled', { configurable: true, get: () => appSettings().get().sound });

// Unlock on every gesture, even while muted, so turning sound on later works at once.
function unlock() {
  try {
    ctx ??= new AudioContext();
    if (ctx.state === 'suspended') ctx.resume().catch(() => {});
  } catch {
    ctx = null;
  }
}

export function installSoundUnlock() {
  for (const type of ['pointerdown', 'keydown']) window.addEventListener(type, unlock, { capture: true });
}

function tone(c, { freq, endFreq, type = 'sine', start = 0, dur = 0.12, gain = 0.2 }) {
  const t = c.currentTime + start;
  const osc = c.createOscillator();
  const amp = c.createGain();
  osc.type = type;
  osc.frequency.setValueAtTime(freq, t);
  if (endFreq) osc.frequency.exponentialRampToValueAtTime(endFreq, t + dur);
  amp.gain.setValueAtTime(0.0001, t);
  amp.gain.exponentialRampToValueAtTime(gain, t + 0.006);
  amp.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  osc.connect(amp).connect(c.destination);
  osc.start(t);
  osc.stop(t + dur + 0.02);
}

function knock(c, { start = 0, dur = 0.05, gain = 0.25, freq = 1800 }) {
  const t = c.currentTime + start;
  const buffer = c.createBuffer(1, Math.ceil(c.sampleRate * dur), c.sampleRate);
  const data = buffer.getChannelData(0);
  for (let i = 0; i < data.length; i++) data[i] = (Math.random() * 2 - 1) * (1 - i / data.length) ** 3;
  const src = c.createBufferSource();
  const filter = c.createBiquadFilter();
  const amp = c.createGain();
  src.buffer = buffer;
  filter.type = 'bandpass';
  filter.frequency.value = freq;
  amp.gain.value = gain;
  src.connect(filter).connect(amp).connect(c.destination);
  src.start(t);
}

const RECIPES = {
  move: (c) => { knock(c, {}); tone(c, { freq: 190, endFreq: 120, type: 'triangle', dur: 0.08, gain: 0.18 }); },
  capture: (c) => { knock(c, { gain: 0.4, freq: 1200, dur: 0.08 }); tone(c, { freq: 150, endFreq: 70, type: 'triangle', dur: 0.15, gain: 0.28 }); },
  castle: (c) => { RECIPES.move(c); knock(c, { start: 0.09 }); tone(c, { freq: 170, endFreq: 110, type: 'triangle', start: 0.09, dur: 0.08, gain: 0.16 }); },
  check: (c) => { tone(c, { freq: 660, type: 'square', dur: 0.1, gain: 0.07 }); tone(c, { freq: 880, type: 'square', start: 0.09, dur: 0.14, gain: 0.07 }); },
  end: (c) => [523, 659, 784, 1047].forEach((f, i) => tone(c, { freq: f, start: i * 0.09, dur: 0.4, gain: 0.12 })),
  lowtime: (c) => tone(c, { freq: 1250, type: 'square', dur: 0.03, gain: 0.05 }),
  notify: (c) => { tone(c, { freq: 523, dur: 0.12, gain: 0.1 }); tone(c, { freq: 784, start: 0.1, dur: 0.18, gain: 0.1 }); },
};

export function playSound(name) {
  if (!appSettings().get().sound || !RECIPES[name]) return;
  debug.soundsPlayed++;
  if (!ctx || ctx.state !== 'running') return;
  try { RECIPES[name](ctx); } catch { /* audio is best-effort */ }
}

// Picks the sound for a move result from rules.move().
export function soundForMove(move) {
  if (move.san.endsWith('+') || move.san.endsWith('#')) return 'check';
  if (move.flags.includes('k') || move.flags.includes('q')) return 'castle';
  if (move.captured) return 'capture';
  return 'move';
}
