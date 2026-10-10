// Phase C universal progressive planning engine (pure, deterministic, no AI).
// Builds the master -> chapter -> section -> beat skeleton, allocates words, holds
// the dependency graph and validates hierarchy. Phase D fills the skeleton's text
// with AI; this module never writes to the database or generates prose.
import { adapterForBookType, getAdapter, type AdapterId, type GenreAdapter } from "./adapters.ts";

export const PLAN_SCHEMA_VERSION = 1;

/** Reserved for future serialized multi-book projects. Carried, never acted on yet. */
export interface SeriesRef { seriesId: string; bookNumber: number; inheritedCanonRefs?: string[] }

export interface PlanBeat { id: string; kind: string; order: number; targetWords: number }
export interface SectionPlan {
  id: string; chapterIndex: number; sectionIndex: number; unit: string;
  objective: string; targetWords: number; dependsOn: string[]; beats: PlanBeat[];
}
export interface ChapterPlan {
  id: string; chapterIndex: number; objectiveKind: string; objective: string;
  targetWords: number; dependsOn: string[]; sections: SectionPlan[];
}
/** Fiction-only reveal schedule; nonfiction plans keep it empty. */
export interface PlannedReveal { id: string; summary: string; revealChapter: number; setupChapters: number[] }
export interface MasterPlanSkeleton {
  schemaVersion: number; adapter: AdapterId; bookType: string; targetWords: number;
  genreData: Record<string, unknown>; reveals: PlannedReveal[]; series: SeriesRef | null;
  chapters: ChapterPlan[];
}

export interface SkeletonInput {
  bookType: string; targetWords: number; chapterCount: number;
  sectionsPerChapter?: number; genreData?: Record<string, unknown>;
  reveals?: PlannedReveal[]; series?: SeriesRef | null;
}

/** Largest-remainder split: integers that sum exactly to total. */
export function allocate(total: number, weights: number[]): number[] {
  const sum = weights.reduce((a, b) => a + b, 0) || 1;
  const raw = weights.map((w) => (total * w) / sum);
  const out = raw.map(Math.floor);
  let rest = total - out.reduce((a, b) => a + b, 0);
  const order = raw.map((r, i) => [r - Math.floor(r), i] as const).sort((a, b) => b[0] - a[0] || a[1] - b[1]);
  for (let k = 0; rest > 0; k = (k + 1) % order.length, rest--) out[order[k][1]]++;
  return out;
}

function objectiveKindFor(a: GenreAdapter, i: number, n: number): string {
  const k = a.chapterObjectives;
  if (n === 1) return k[0];
  if (i === 0) return k[0];
  if (i === n - 1) return k[k.length - 1];
  return k[1 + ((i - 1) % Math.max(1, k.length - 2))];
}

export function buildPlanSkeleton(input: SkeletonInput): MasterPlanSkeleton {
  const a = adapterForBookType(input.bookType);
  const n = Math.max(1, Math.floor(input.chapterCount));
  const spc = Math.min(a.sectionsPerChapter.max, Math.max(a.sectionsPerChapter.min, input.sectionsPerChapter ?? a.sectionsPerChapter.default));
  if (input.targetWords < n * spc * a.minSectionWords) throw new Error("Target words too low for this structure");
  const chapterWords = allocate(input.targetWords, Array.from({ length: n }, (_, i) => a.weight(n === 1 ? 0.5 : i / (n - 1))));
  const chapters: ChapterPlan[] = chapterWords.map((cw, c) => {
    const sectionWords = allocate(cw, Array(spc).fill(1));
    const kind = objectiveKindFor(a, c, n);
    const sections: SectionPlan[] = sectionWords.map((sw, s) => ({
      id: `c${c}s${s}`, chapterIndex: c, sectionIndex: s, unit: a.sectionUnit, objective: "",
      targetWords: sw,
      // Sequential arc: each section follows the previous one (cookbook recipes and magazine articles stand alone).
      dependsOn: s > 0 && !["cookbook", "magazine"].includes(a.id) ? [`c${c}s${s - 1}`] : [],
      beats: allocate(sw, Array(a.beatKinds.length).fill(1)).map((bw, b) => ({ id: `c${c}s${s}b${b}`, kind: a.beatKinds[b], order: b, targetWords: bw })),
    }));
    return { id: `c${c}`, chapterIndex: c, objectiveKind: kind, objective: "", targetWords: cw, dependsOn: c > 0 && !["cookbook", "magazine"].includes(a.id) ? [`c${c - 1}`] : [], sections };
  });
  return {
    schemaVersion: PLAN_SCHEMA_VERSION, adapter: a.id, bookType: input.bookType, targetWords: input.targetWords,
    genreData: input.genreData ?? {}, reveals: a.isFiction ? (input.reveals ?? []) : [], series: input.series ?? null, chapters,
  };
}

export interface PlanIssue { code: string; ref: string; message: string }

export function validatePlan(p: MasterPlanSkeleton): PlanIssue[] {
  const issues: PlanIssue[] = [];
  const a = getAdapter(p.adapter);
  const add = (code: string, ref: string, message: string) => issues.push({ code, ref, message });
  if (p.schemaVersion > PLAN_SCHEMA_VERSION) add("SCHEMA_TOO_NEW", "plan", `Schema ${p.schemaVersion} not supported`);
  for (const f of a.masterFields) if (p.genreData[f] === undefined || p.genreData[f] === "") add("MISSING_GENRE_FIELD", f, `Missing ${f}`);
  if (!a.isFiction && p.reveals.length) add("FICTION_IN_NONFICTION", "reveals", "Nonfiction plans cannot schedule reveals");
  const ids = new Set<string>();
  let total = 0;
  p.chapters.forEach((c, ci) => {
    if (c.chapterIndex !== ci) add("CHAPTER_ORDER", c.id, "Chapter index out of order");
    if (!a.chapterObjectives.includes(c.objectiveKind)) add("BAD_OBJECTIVE", c.id, `${c.objectiveKind} not valid for ${a.id}`);
    ids.add(c.id);
    const sum = c.sections.reduce((x, s) => x + s.targetWords, 0);
    if (sum !== c.targetWords) add("WORDS_MISMATCH", c.id, "Section words do not sum to chapter");
    total += c.targetWords;
    c.sections.forEach((s, si) => {
      ids.add(s.id);
      if (s.chapterIndex !== ci || s.sectionIndex !== si) add("SECTION_PARENT", s.id, "Section not under its chapter");
      if (s.unit !== a.sectionUnit) add("BAD_UNIT", s.id, `Expected ${a.sectionUnit}`);
      if (s.beats.reduce((x, b) => x + b.targetWords, 0) !== s.targetWords) add("WORDS_MISMATCH", s.id, "Beat words do not sum to section");
      for (const b of s.beats) if (!a.beatKinds.includes(b.kind)) add("BAD_BEAT", b.id, `${b.kind} not valid for ${a.id}`);
    });
  });
  if (total !== p.targetWords) add("WORDS_MISMATCH", "plan", "Chapter words do not sum to book");
  for (const n of nodes(p)) for (const d of n.dependsOn) {
    if (!ids.has(d)) add("DANGLING_DEP", n.id, `Unknown dependency ${d}`);
    else if (orderKey(d) >= orderKey(n.id)) add("FORWARD_DEP", n.id, `Depends on later node ${d}`);
  }
  if (findCycle(p)) add("CYCLE", "plan", "Dependency cycle");
  for (const r of p.reveals) {
    if (r.revealChapter < 0 || r.revealChapter >= p.chapters.length) add("REVEAL_RANGE", r.id, "Reveal chapter out of range");
    if (r.setupChapters.some((s) => s >= r.revealChapter)) add("SETUP_AFTER_REVEAL", r.id, "Setup must precede reveal");
  }
  return issues;
}

const nodes = (p: MasterPlanSkeleton) => p.chapters.flatMap((c) => [c as { id: string; dependsOn: string[] }, ...c.sections]);
/** Story order key: chapters sort before their own sections. */
function orderKey(id: string): number {
  const m = /^c(\d+)(?:s(\d+))?/.exec(id);
  return m ? Number(m[1]) * 1000 + (m[2] === undefined ? -1 : Number(m[2])) : Infinity;
}

function findCycle(p: MasterPlanSkeleton): boolean {
  const g = new Map(nodes(p).map((n) => [n.id, n.dependsOn]));
  const state = new Map<string, number>();
  const visit = (id: string): boolean => {
    if (state.get(id) === 1) return true;
    if (state.get(id) === 2) return false;
    state.set(id, 1);
    for (const d of g.get(id) ?? []) if (g.has(d) && visit(d)) return true;
    state.set(id, 2);
    return false;
  };
  return [...g.keys()].some(visit);
}

/** Blast radius: every node that transitively depends on `id` (targets for re-planning). */
export function downstreamOf(p: MasterPlanSkeleton, id: string): string[] {
  const rev = new Map<string, string[]>();
  for (const n of nodes(p)) for (const d of n.dependsOn) rev.set(d, [...(rev.get(d) ?? []), n.id]);
  // A chapter's sections are downstream of it too.
  for (const c of p.chapters) rev.set(c.id, [...(rev.get(c.id) ?? []), ...c.sections.map((s) => s.id)]);
  const out = new Set<string>(); const q = [id];
  while (q.length) for (const nx of rev.get(q.shift()!) ?? []) if (!out.has(nx)) { out.add(nx); q.push(nx); }
  return [...out].sort((x, y) => orderKey(x) - orderKey(y));
}

/** Spoiler containment: reveals the drafter may see while writing chapter `ch`. */
export function revealsVisibleAt(p: MasterPlanSkeleton, ch: number): { revealed: PlannedReveal[]; foreshadow: { id: string; hint: "setup_only" }[] } {
  return {
    revealed: p.reveals.filter((r) => r.revealChapter <= ch),
    // Future reveals expose only their id and "setup" instruction, never the summary.
    foreshadow: p.reveals.filter((r) => r.revealChapter > ch && r.setupChapters.includes(ch)).map((r) => ({ id: r.id, hint: "setup_only" as const })),
  };
}
