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

// Syntactic templates: content words collapse to X, function words stay. Catches a rewrite that
// swaps "As the X, she waited" for "The X while she waited" — different words, same skeleton.
const FUNCTION = new Set("a an the as while when then and but or so yet she he they i we you it her his their its my our your him them me us of in on at to from by with into over under through after before again still not no".split(" "));
export function templateSignature(s: string): string {
  const toks = s.toLowerCase().replace(/[^a-z', ]/g, " ").replace(/,/g, " , ").split(/\s+/).filter(Boolean);
  const sig: string[] = [];
  for (const t of toks) { const k = FUNCTION.has(t) || t === "," ? t : "X"; if (!(k === "X" && sig[sig.length - 1] === "X")) sig.push(k); }
  return sig.join(" ");
}
export interface RepeatedTemplate { template: string; count: number; examples: string[] }
/** Narrative (non-dialogue) sentences sharing one skeleton ≥4 times and ≥12% of narration.
 *  Three-beat literary parallelism stays below the threshold; protected motifs are exempt. */
export function repeatedTemplates(text: string, motifs: string[] = []): RepeatedTemplate[] {
  const narr = sentences(text).filter((s) => !/["\u201C\u201D]/.test(s) && !motifs.some((m) => m && s.toLowerCase().includes(m.toLowerCase())));
  const m = new Map<string, string[]>();
  for (const s of narr) { const sig = templateSignature(s); if (sig.split(" ").length < 5 || (sig.match(/X/g) ?? []).length < 2) continue; m.set(sig, [...(m.get(sig) ?? []), s]); }
  return [...m].filter(([, v]) => v.length >= 4 && v.length / Math.max(narr.length, 1) >= 0.12).map(([template, v]) => ({ template, count: v.length, examples: v.slice(0, 3) }));
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


export interface VerbatimDuplicate { text: string; count: number }

/** Separate from statistical checks: two exact uses suffice. Normalize layout only;
 * quoted dialogue, protected motifs and poetry are conservatively exempt. */
export function verbatimDuplicates(text: string, opts: Pick<AnalyzeOptions, "protectedMotifs" | "bookType"> = {}): {
  sentences: VerbatimDuplicate[]; paragraphs: VerbatimDuplicate[];
} {
  if (opts.bookType === "poetry") return { sentences: [], paragraphs: [] };
  const layout = (text ?? "").replace(/<(?:br\s*\/?|\/(?:p|div))\s*>/gi, "\n\n").replace(/<[^>]+>/g, " ");
  const normalize = (s: string) => s.replace(/\s+/g, " ").trim();
  const motifs = (opts.protectedMotifs ?? []).map((m) => normalize(m).toLowerCase()).filter(Boolean);
  const prose: string[] = [], paragraphs: string[] = [];
  let close = "";
  for (const raw of layout.split(/\n{2,}/)) {
    let segment = "", dialogue = Boolean(close);
    for (let i = 0; i < raw.length; i++) {
      const c = raw[i];
      if (close) {
        dialogue = true;
        if (c === close && (close !== "'" || !/\p{L}/u.test(raw[i + 1] ?? ""))) close = "";
        continue;
      }
      const singleStart = (c === "'" || c === "‘") && !/\p{L}/u.test(raw[i - 1] ?? "");
      if (c === '"' || c === "“" || singleStart) {
        if (segment.trim()) prose.push(segment);
        segment = "";
        close = c === "“" ? "”" : c === "‘" ? "’" : c;
        dialogue = true;
      } else segment += c;
    }
    if (segment.trim()) prose.push(segment);
    if (!dialogue) paragraphs.push(raw);
  }
  const collect = (items: string[]): VerbatimDuplicate[] => {
    const counts = new Map<string, number>();
    for (const raw of items) {
      const t = normalize(raw);
      if (!/\p{L}/u.test(t) || motifs.some((m) => t.toLowerCase().includes(m))) continue;
      counts.set(t, (counts.get(t) ?? 0) + 1);
    }
    return [...counts].filter(([, count]) => count >= 2).map(([text, count]) => ({ text, count }));
  };
  return {
    sentences: collect(prose.flatMap((s) => normalize(s).split(/(?<=[.!?])\s+/))),
    paragraphs: collect(paragraphs),
  };
}

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
  const duplicates = verbatimDuplicates(text, opts);
  const duplicateNotes = (["sentences", "paragraphs"] as const).flatMap((kind) => duplicates[kind].slice(0, 5).map((d) => `Identical ${kind === "sentences" ? "sentence" : "paragraph"} ×${d.count}: “${d.text.slice(0, 160)}${d.text.length > 160 ? "…" : ""}”.`));
  const templates = repeatedTemplates(text, opts.protectedMotifs);
  const templateNotes = templates.map((t) => `Same sentence shape ×${t.count}: “${t.examples[0].slice(0, 100)}”.`);
  if (starters.length || stock.length || p.triads >= 4 || duplicateNotes.length || templates.length) out.push({ category: "mechanical_pattern", severity: "advisory", message: [starters.length ? `Repeated sentence starts: ${starters.map((s) => `"${s.starter}" ×${s.count}`).join(", ")}.` : "", stock.length ? `Stock phrases: ${stock.map((s) => `"${s}"`).join(", ")}.` : "", p.triads >= 4 ? `${p.triads} three-item lists.` : "", ...duplicateNotes, ...templateNotes].filter(Boolean).join(" "), evidence: { starters, stockPhrases: stock, triads: p.triads, templates, ...(duplicateNotes.length ? { subtype: "verbatim_repetition", duplicates } : {}) } });

  return out;
}

/** Stable dedup key so re-analysis of the same text never duplicates findings. */
export function findingKey(f: NaturalnessFinding, contentHash: string): string {
  return `${contentHash}:${f.category}`;
}
