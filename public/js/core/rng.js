// Small seedable PRNG (mulberry32) so bot "personality" is reproducible in tests via ?seed=.
export function createRng(seed = randomSeed()) {
  let s = (seed >>> 0) || 0x9e3779b9;
  return () => {
    s = (s + 0x6d2b79f5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export const randomSeed = () => Math.floor(Math.random() * 2 ** 32);
export const pick = (rng, list) => list[Math.floor(rng() * list.length)];
