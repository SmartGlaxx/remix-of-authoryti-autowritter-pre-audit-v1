// Stage B: Writing Naturalness Analysis (pure, deterministic, zero AI).
// Every finding is advisory or info — never blocking (guardrails 1–4).
import { clampSeverity, type NaturalnessFinding } from "./naturalness.ts";
import { openingFamily, detectPatterns, type LedgerEntry } from "./rhetoric.ts";

const clean = (s: string) => (s ?? "").replace(/<[^>]+>/g, " ").replace(/[\u2018\u2019]/g, "'").replace(/[\u201C\u201D]/g, '"');

export function sentences(text: string): string[] {
  return clean(text).replace(/\s+/g, " ").split(/(?<=[.!?])\s+(?=["'A-Z0-9])/).map((s) => s.trim()).filter((s) => /\w/.test(s));
}
const words = (s: string) => s.split(/\s+/).filter((w) => /\w/.test(w));

export interface RhythmStats { sentences: number; mean: number; stdev: number; cv: number; maxRunSimilar: number }

/** Sentence-length variance. A supporting signal only (guardrail 3). */
export function rhythmStats(text: string): RhythmStats {
  const lens = sentences(text).map((s) => words(s).length);
  const n = lens.length;
  if (!n) return { sentences: 0, mean: 0, stdev: 0, cv: 0, maxRunSimilar: 0 };
  const mean = lens.reduce((a, b) => a + b, 0) / n;
  const stdev = Math.sqrt(lens.reduce((a, b) => a + (b - mean) ** 2, 0) / n);
  let run = 1, maxRun = 1;
  for (let i = 1; i < n; i++) { run = Math.abs(lens[i] - lens[i - 1]) <= 2 ? run + 1 : 1; maxRun = Math.max(maxRun, run); }
  return { sentences: n, mean: +mean.toFixed(2), stdev: +stdev.toFixed(2), cv: mean ? +(stdev / mean).toFixed(3) : 0, maxRunSimilar: maxRun };
}

const SIMILE = /\b(like a|like an|like the|as if|as though|as \w+ as)\b/gi;
const METAPHOR_HINT = /\b(was a|were a|is a|became a) (\w+ )?(of|ocean|storm|river|fire|blade|wall|shadow|ghost|cage|web)\b/gi;

/** Figurative density per 1,000 words — preliminary, context-free count (guardrail 2). */
export function figurativeDensity(text: string): { per1000: number; similes: number; metaphorHints: number; words: number } {
  const t = clean(text); const w = words(t).length || 1;
  const similes = (t.match(SIMILE) ?? []).length, metaphorHints = (t.match(METAPHOR_HINT) ?? []).length;
  return { per1000: +(((similes + metaphorHints) / w) * 1000).toFixed(2), similes, metaphorHints, words: w };
}

/** Repeated sentence starters inside one section (mechanical pattern). */
export function repeatedStarters(text: string): { starter: string; count: number }[] {
  const counts: Record<string, number> = {};
  for (const s of sentences(text)) { const k = words(s).slice(0, 2).join(" ").toLowerCase().replace(/[^\w' ]/g, ""); if (k) counts[k] = (counts[k] ?? 0) + 1; }
  const n = sentences(text).length;
  return Object.entries(counts).filter(([, c]) => c >= 4 && c / Math.max(n, 1) >= 0.15).map(([starter, count]) => ({ starter, count })).sort((a, b) => b.count - a.count);
}

export interface AnalyzeOptions {
  ledger?: LedgerEntry[];
  /** Writer creativity baseline 1–10 widens figurative tolerance. */
  creativityBaseline?: number;
  /** Phrases the author marked as deliberate motifs — never flagged. */
  protectedMotifs?: string[];
  bookType?: string;
}

const PRELIM = "Preliminary signal, not proof — please judge in context.";

export function analyzeSection(text: string, opts: AnalyzeOptions = {}): NaturalnessFinding[] {
  const out: NaturalnessFinding[] = [];
  const motifs = (opts.protectedMotifs ?? []).map((m) => m.toLowerCase());
  const isMotif = (s: string) => motifs.some((m) => m && s.toLowerCase().includes(m));

  // 1. Opening recurrence vs earlier sections (advisory, guardrail 1)
  const fam = openingFamily(text);
  if (fam && !isMotif(sentences(text)[0] ?? "")) {
    const prior = (opts.ledger ?? []).filter((e) => e.family === fam).length;
    if (prior >= 1) out.push({ category: "opening_recurrence", severity: clampSeverity("advisory"), message: `This section opens with the "${fam.replace(/_/g, " ")}" template, already used ${prior} time(s) in this book.`, evidence: { family: fam, priorUses: prior, opening: sentences(text)[0] ?? "" } });
  }

  // 2. Figurative density (guardrail 2), tolerance scales with writer creativity; poetry exempt
  if (opts.bookType !== "poetry") {
    const f = figurativeDensity(text);
    const limit = 8 + Math.max(0, (opts.creativityBaseline ?? 5) - 5) * 2;
    if (f.words >= 150 && f.per1000 > limit) out.push({ category: "figurative_density", severity: "info", message: `Figurative language is dense (${f.per1000} per 1,000 words). ${PRELIM}`, evidence: { ...f, limit } });
  }

  // 3. Burstiness (guardrail 3): info only
  const r = rhythmStats(text);
  if (r.sentences >= 8 && (r.cv < 0.25 || r.maxRunSimilar >= 6)) out.push({ category: "burstiness", severity: "info", message: `Sentence lengths are very uniform (variation ${r.cv}, ${r.maxRunSimilar} similar in a row). ${PRELIM}`, evidence: { ...r } });

  // 4. Mechanical patterns
  const starters = repeatedStarters(text).filter((s) => !isMotif(s.starter));
  const p = detectPatterns(text);
  const stock = p.stockPhrases.filter((s) => !isMotif(s));
  if (starters.length || stock.length || p.triads >= 4) out.push({ category: "mechanical_pattern", severity: "advisory", message: [starters.length ? `Repeated sentence starts: ${starters.map((s) => `"${s.starter}" ×${s.count}`).join(", ")}.` : "", stock.length ? `Stock phrases: ${stock.map((s) => `"${s}"`).join(", ")}.` : "", p.triads >= 4 ? `${p.triads} three-item lists.` : ""].filter(Boolean).join(" "), evidence: { starters, stockPhrases: stock, triads: p.triads } });

  return out;
}

/** Stable dedup key so re-analysis of the same text never duplicates findings. */
export function findingKey(f: NaturalnessFinding, contentHash: string): string {
  return `${contentHash}:${f.category}`;
}
