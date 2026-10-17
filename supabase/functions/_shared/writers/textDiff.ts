// Word-level change measurement (pure, deterministic). Counts only tokens actually inserted,
// deleted or replaced — unchanged text between separate edits never counts. Moved passages
// count as delete + insert. Always compare the final text against the ORIGINAL baseline.
const tokenize = (s: string) => (s ?? "").replace(/<[^>]+>/g, " ").replace(/[\u2018\u2019]/g, "'").replace(/[\u201C\u201D]/g, '"').match(/[\p{L}\p{N}']+|[^\s\p{L}\p{N}]/gu) ?? [];

/** Length of the longest common subsequence (O(n·m) time, O(m) memory). */
function lcs(a: string[], b: string[]): number {
  let prev = new Uint32Array(b.length + 1), cur = new Uint32Array(b.length + 1);
  for (let i = 1; i <= a.length; i++) {
    for (let j = 1; j <= b.length; j++) cur[j] = a[i - 1] === b[j - 1] ? prev[j - 1] + 1 : Math.max(prev[j], cur[j - 1]);
    [prev, cur] = [cur, prev]; cur.fill(0);
  }
  return prev[b.length];
}

export interface DiffStats { originalTokens: number; revisedTokens: number; deleted: number; inserted: number; ratio: number }

const MAX_CELLS = 40_000_000; // ~6k × 6k tokens; larger inputs are diffed per paragraph pair

export function diffStats(original: string, revised: string): DiffStats {
  const a = tokenize(original), b = tokenize(revised);
  let common: number;
  if (a.length * b.length <= MAX_CELLS) common = lcs(a, b);
  else {
    // Size guard: align paragraphs by index and sum per-paragraph LCS (still counts only changed words).
    const pa = original.split(/\n\s*\n/), pb = revised.split(/\n\s*\n/); common = 0;
    for (let i = 0; i < Math.max(pa.length, pb.length); i++) common += lcs(tokenize(pa[i] ?? ""), tokenize(pb[i] ?? ""));
  }
  const deleted = a.length - common, inserted = b.length - common;
  const ratio = a.length ? Math.min(1, (deleted + inserted) / (2 * a.length)) : b.length ? 1 : 0;
  return { originalTokens: a.length, revisedTokens: b.length, deleted, inserted, ratio: +ratio.toFixed(4) };
}

/** Share of the original actually modified, 0–1. */
export const changeRatio = (original: string, revised: string) => original === revised ? 0 : diffStats(original, revised).ratio;
