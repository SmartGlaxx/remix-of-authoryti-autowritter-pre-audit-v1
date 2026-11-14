export function hashString(s: string): number {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
  return h >>> 0;
}
/** mulberry32 — tiny reproducible PRNG; same seed → same sequence everywhere. */
export function rng(seed: number) {
  let a = seed >>> 0;
  const next = () => { a = (a + 0x6d2b79f5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
  return {
    next,
    pick<T>(arr: readonly T[]): T { return arr[Math.floor(next() * arr.length) % arr.length]; },
    weighted<T>(items: readonly T[], weight: (t: T) => number): T {
      const ws = items.map((i) => Math.max(0, weight(i))); const total = ws.reduce((a, b) => a + b, 0);
      if (total <= 0) return items[Math.floor(next() * items.length) % items.length];
      let x = next() * total; for (let i = 0; i < items.length; i++) { x -= ws[i]; if (x <= 0) return items[i]; } return items[items.length - 1];
    },
  };
}
