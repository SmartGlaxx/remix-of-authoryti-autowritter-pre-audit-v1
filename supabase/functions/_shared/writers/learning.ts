// Stage D: Continuous Writer Learning (pure, deterministic, no I/O, no AI).
// Learns from stored naturalness findings and author/validation outcomes. Produces PROPOSED,
// versioned, reversible overlays; base writer profiles and slider bounds are never modified.
import { getWriter, WRITER_PERSONAS } from "./personas.ts";
import { SLIDERS, MAX_ADJUST, type SliderKey } from "./sliders.ts";

export const LEARNING_SCHEMA_VERSION = 1;
export const MIN_SECTIONS = 3;
export const MIN_CHAPTERS = 2;
export const MIN_CONFIDENCE = 0.5;

/** finding = a stylistic flag; approved = author-approved correction; proven = rewrite passed full checks and improved;
 *  rejected = discarded/reverted change; detector = heuristic/AI-detector signal (never sufficient alone). */
export type SignalKind = "finding" | "approved" | "proven" | "rejected" | "detector";
export const SIGNAL_WEIGHT: Record<SignalKind, number> = { finding: 1, approved: 3, proven: 2, rejected: -3, detector: 0.25 };

export interface LearningSignal {
  userId: string; writerId: string; bookId?: string | null; genre?: string | null;
  category: string; kind: SignalKind; chapterIndex?: number | null; subsectionIndex?: number | null; sourceRef: string;
}

export interface Weakness {
  writerId: string; genre: string | null; category: string;
  sections: number; chapters: number; books: number;
  findings: number; approved: number; proven: number; rejected: number; detector: number;
  recurring: boolean; score: number;
}

const key = (...p: unknown[]) => p.map((x) => String(x ?? "")).join("|");

/** Roll up signals per user+writer+genre+category. Signals from different users are never mixed. */
export function aggregateWeaknesses(signals: LearningSignal[], userId: string): Weakness[] {
  const groups = new Map<string, { w: Weakness; secs: Set<string>; chs: Set<string>; books: Set<string>; refs: Set<string> }>();
  for (const s of signals) {
    if (s.userId !== userId) continue;
    const k = key(s.writerId, s.genre ?? null, s.category);
    let g = groups.get(k);
    if (!g) {
      g = { w: { writerId: s.writerId, genre: s.genre ?? null, category: s.category, sections: 0, chapters: 0, books: 0, findings: 0, approved: 0, proven: 0, rejected: 0, detector: 0, recurring: false, score: 0 }, secs: new Set(), chs: new Set(), books: new Set(), refs: new Set() };
      groups.set(k, g);
    }
    const dedup = key(s.sourceRef, s.kind);
    if (g.refs.has(dedup)) continue;
    g.refs.add(dedup);
    if (s.kind === "finding") g.w.findings++; else if (s.kind === "approved") g.w.approved++;
    else if (s.kind === "proven") g.w.proven++; else if (s.kind === "rejected") g.w.rejected++; else g.w.detector++;
    g.w.score += SIGNAL_WEIGHT[s.kind];
    // Detector signals never count toward recurrence.
    if (s.kind !== "detector" && s.chapterIndex != null) {
      g.secs.add(key(s.bookId, s.chapterIndex, s.subsectionIndex));
      g.chs.add(key(s.bookId, s.chapterIndex));
    }
    if (s.bookId) g.books.add(s.bookId);
  }
  return [...groups.values()].map(({ w, secs, chs, books }) => {
    w.sections = secs.size; w.chapters = chs.size; w.books = books.size;
    w.recurring = w.sections >= MIN_SECTIONS && w.chapters >= MIN_CHAPTERS;
    return w;
  });
}

/** 0..1. Requires real evidence; rejections pull it down; detectors add almost nothing. */
export function confidenceOf(w: Weakness): number {
  const positive = w.approved * 3 + w.proven * 2 + Math.min(w.findings, 10) * 0.3 + Math.min(w.detector, 4) * 0.05;
  const negative = w.rejected * 3;
  const raw = (positive - negative) / (positive + negative + 4);
  return Math.max(0, Math.min(1, Math.round(raw * 100) / 100));
}

/** Technique library: neutral dimension + adjustment, deliberately voice-agnostic. */
export const TECHNIQUES: Record<string, { dimension: string; directive: string; slider?: { key: SliderKey; delta: number } }> = {
  opening_recurrence: { dimension: "opening_variety", directive: "Vary the first beat of each section; avoid reusing an opening shape already used in this book." },
  figurative_density: { dimension: "figurative_restraint", directive: "Keep comparisons sparse; let one strong image carry a passage rather than several." },
  burstiness: { dimension: "sentence_rhythm", directive: "Mix short and long sentences so the rhythm does not flatten.", slider: { key: "sentenceVariation", delta: 1 } },
  mechanical_pattern: { dimension: "phrase_freshness", directive: "Avoid stock transitions and repeated sentence starters." },
};

export interface Recommendation {
  schemaVersion: number; writerId: string; genre: string | null; category: string;
  dimension: string; adjustment: { directive: string; slider?: { key: SliderKey; delta: number } };
  scope: "writer" | "writer_genre" | "transfer"; sourceWriterId?: string;
  confidence: number; evidence: Omit<Weakness, "recurring" | "score">;
}

/** Gate: recurring + at least one author-approved or proven signal + confidence. Detector-only or one-off never qualifies. */
export function qualifies(w: Weakness): boolean {
  return w.recurring && (w.approved + w.proven) > 0 && w.rejected < (w.approved + w.proven) && confidenceOf(w) >= MIN_CONFIDENCE && !!TECHNIQUES[w.category];
}

export function proposeRecommendations(signals: LearningSignal[], userId: string): Recommendation[] {
  return aggregateWeaknesses(signals, userId).filter(qualifies).map((w) => {
    const t = TECHNIQUES[w.category];
    const { recurring: _r, score: _s, ...evidence } = w;
    return { schemaVersion: LEARNING_SCHEMA_VERSION, writerId: w.writerId, genre: w.genre, category: w.category, dimension: t.dimension,
      adjustment: { directive: t.directive, ...(t.slider ? { slider: t.slider } : {}) }, scope: w.genre ? "writer_genre" : "writer", confidence: confidenceOf(w), evidence };
  });
}

/** Compatible = shares a top book type. Target keeps its own voice: only the neutral directive transfers. */
export function compatibleWriters(sourceId: string): string[] {
  const src = getWriter(sourceId); if (!src) return [];
  const types = new Set(src.bookTypes.slice(0, 3));
  return WRITER_PERSONAS.filter((w) => w.id !== src.id && w.bookTypes.slice(0, 3).some((t) => types.has(t))).map((w) => w.id);
}

export function transferTechnique(r: Recommendation, targetWriterId: string): Recommendation | null {
  if (r.scope === "transfer" || !compatibleWriters(r.writerId).includes(targetWriterId)) return null;
  return { ...r, writerId: targetWriterId, scope: "transfer", sourceWriterId: r.writerId,
    adjustment: { directive: `${r.adjustment.directive} Express this entirely in your own established voice.`, ...(r.adjustment.slider ? { slider: r.adjustment.slider } : {}) },
    confidence: Math.round(r.confidence * 0.7 * 100) / 100 };
}

/** Clamp an overlay's slider nudge so the combined effect can never exceed the ±MAX_ADJUST bound. */
export function clampOverlayToSliders(slider: { key: string; delta: number } | undefined, alreadyApplied = 0): { key: SliderKey; delta: number } | undefined {
  if (!slider || !SLIDERS.some((s) => s.key === slider.key)) return undefined;
  const room = MAX_ADJUST - Math.abs(alreadyApplied);
  const d = Math.max(-room, Math.min(room, Math.round(slider.delta)));
  return d === 0 ? undefined : { key: slider.key as SliderKey, delta: d };
}

export interface StoredOverlay { id: string; writer_id: string; dimension: string; adjustment: any; status: string; version: number; expires_at?: string | null }

/** Active, pinned (if pins given), unexpired overlays for this writer → dynamic prompt tail block. */
export function renderActiveOverlays(rows: StoredOverlay[], writerId: string, pins?: string[] | null, now = new Date()): string {
  const usable = rows.filter((r) => r.writer_id === writerId && r.status === "active" && (!r.expires_at || new Date(r.expires_at) > now) && (!pins || pins.includes(r.id)));
  const seen = new Set<string>(); const lines: string[] = [];
  for (const r of usable.sort((a, b) => b.version - a.version)) {
    if (seen.has(r.dimension)) continue; seen.add(r.dimension);
    const d = typeof r.adjustment?.directive === "string" ? r.adjustment.directive.slice(0, 300) : "";
    if (d) lines.push(`- ${d}`);
  }
  return lines.length ? `AUTHOR-APPROVED CRAFT NOTES (refinements only; keep your established voice):\n${lines.join("\n")}` : "";
}

/** Contradicting evidence after approval (rejections ≥ supporting) means the overlay should expire. */
export function shouldExpire(w: Weakness): boolean {
  return w.rejected > 0 && w.rejected >= w.approved + w.proven;
}

/** Map a naturalness finding / outcome into a signal (pure). */
export function signalFromFinding(f: { category: string; severity?: string }, ctx: Omit<LearningSignal, "category" | "kind">, detector = false): LearningSignal {
  return { ...ctx, category: f.category, kind: detector ? "detector" : "finding" };
}
