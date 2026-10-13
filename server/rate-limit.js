// Token bucket: `rate` messages per second on average, bursts up to `burst`.
export function createTokenBucket({ rate = 20, burst = 40, now = () => Date.now() } = {}) {
  let tokens = burst;
  let last = now();
  return {
    // Whether a take() would succeed now, without using a token.
    peek() {
      return Math.min(burst, tokens + ((now() - last) / 1000) * rate) >= 1;
    },
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

// The key that rate limits use for an address: IPv6 clients usually control a whole /64, so
// they are limited per /64 network; IPv4 addresses are used as they are.
export function addressKey(address) {
  const a = String(address ?? '').replace(/^::ffff:/, '');
  if (!a.includes(':')) return a;
  const parts = a.split('::');
  const head = parts[0] ? parts[0].split(':') : [];
  const tail = parts[1] !== undefined ? (parts[1] ? parts[1].split(':') : []) : [];
  const full = [...head, ...Array(Math.max(0, 8 - head.length - tail.length)).fill('0'), ...tail];
  return `${full.slice(0, 4).map((x) => x.toLowerCase().replace(/^0+(?=.)/, '')).join(':')}::/64`;
}

// Token buckets per key, keeping at most `max` keys: the least recently used are evicted (never
// all at once, so flooding with new keys cannot reset everyone's limit).
export function createBucketMap({ rate, burst, max = 10_000, now = () => Date.now() }) {
  const buckets = new Map();
  return {
    take(key) {
      let b = buckets.get(key);
      if (b) buckets.delete(key);
      else b = createTokenBucket({ rate, burst, now });
      buckets.set(key, b); // most recently used last
      while (buckets.size > max) buckets.delete(buckets.keys().next().value);
      return b.take();
    },
    peek(key) {
      return buckets.get(key)?.peek() ?? true;
    },
    get size() { return buckets.size; },
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
