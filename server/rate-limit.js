// Token bucket: `rate` messages per second on average, bursts up to `burst`.
export function createTokenBucket({ rate = 20, burst = 40, now = () => Date.now() } = {}) {
  let tokens = burst;
  let last = now();
  return {
    take() {
      const t = now();
      tokens = Math.min(burst, tokens + ((t - last) / 1000) * rate);
      last = t;
      if (tokens < 1) return false;
      tokens -= 1;
      return true;
    },
  };
}

// Counts live connections per client address.
export function createConnectionCounter(max) {
  const counts = new Map();
  return {
    tryAcquire(key) {
      const n = counts.get(key) ?? 0;
      if (n >= max) return false;
      counts.set(key, n + 1);
      return true;
    },
    release(key) {
      const n = (counts.get(key) ?? 1) - 1;
      if (n <= 0) counts.delete(key);
      else counts.set(key, n);
    },
  };
}
