// Phase E: planning-aware context assembly (pure, no I/O, NOT wired to live generation).
// Adds the approved plan (current chapter/section/beats + spoiler-safe direction) and exact-detail
// anchors to the existing Standard/Adaptive context. Planners see the whole book; this module
// produces only the prose writer's view: no synopsis, no ending, no future chapter objectives,
// no future reveal summaries. Anything unusable falls back to the legacy outline path unchanged.
import { PLAN_SCHEMA_VERSION, revealsVisibleAt, type MasterPlanSkeleton, type PlannedReveal, type SectionPlan } from "./engine.ts";
import { buildAdaptiveCandidates, type AdaptiveInput } from "../adaptiveCandidates.ts";
import { assembleAdaptiveContext, countContextWords, type AssembledContext, type ContextCandidate } from "../adaptiveContext.ts";
import type { StoryPosition } from "../rules.ts";
import { foreshadowFor } from "./pipeline.ts";

// deno-lint-ignore no-explicit-any
type Row = Record<string, any>;

export type PlanFallbackReason =
  | "no_master_plan" | "master_not_approved" | "incompatible_schema" | "missing_skeleton"
  | "chapter_not_planned" | "section_not_planned" | "book_type_mismatch";

export interface ResolvedPlan {
  usable: true; master: MasterPlanSkeleton; masterVersion: number; section: SectionPlan;
  /** "ready" = an approved section-level plan overrode the skeleton; "skeleton" = master plan only. */
  sectionSource: "ready" | "skeleton";
}
export type PlanResolution = ResolvedPlan | { usable: false; reason: PlanFallbackReason };

/** Only an APPROVED master with a compatible schema is ever used. Drafts, superseded, cancelled → legacy. */
export function resolvePlanForSection(master: Row | null | undefined, position: StoryPosition, bookType: string, readyPlans: Row[] = []): PlanResolution {
  if (!master) return { usable: false, reason: "no_master_plan" };
  if (master.status !== "APPROVED") return { usable: false, reason: "master_not_approved" };
  const sk = master.plan_skeleton as MasterPlanSkeleton | null;
  if (!sk || !Array.isArray(sk.chapters)) return { usable: false, reason: "missing_skeleton" };
  if (typeof sk.schemaVersion !== "number" || sk.schemaVersion > PLAN_SCHEMA_VERSION) return { usable: false, reason: "incompatible_schema" };
  if (sk.bookType && bookType && sk.bookType !== bookType) return { usable: false, reason: "book_type_mismatch" };
  const ch = sk.chapters.find((c) => c.chapterIndex === position.chapterIndex);
  if (!ch) return { usable: false, reason: "chapter_not_planned" };
  // An approved (READY) section plan wins; PLANNED/SUPERSEDED/CANCELLED rows are ignored.
  const ready = readyPlans.find((p) => p?.plan_status === "READY" && p.chapter_index === position.chapterIndex && p.subsection_index === position.subsectionIndex && p.plan_skeleton?.objective);
  if (ready) return { usable: true, master: sk, masterVersion: Number(master.version ?? 1), section: ready.plan_skeleton as SectionPlan, sectionSource: "ready" };
  const sec = ch.sections.find((s) => s.sectionIndex === position.subsectionIndex);
  if (!sec) return { usable: false, reason: "section_not_planned" };
  return { usable: true, master: sk, masterVersion: Number(master.version ?? 1), section: sec, sectionSource: "skeleton" };
}

/** Text fragments that must never reach the writer before their reveal chapter. */
export function futureSecrets(master: MasterPlanSkeleton, ch: number): string[] {
  const out: string[] = [];
  for (const r of master.reveals as (PlannedReveal & { secretTerms?: string[] })[]) {
    if (r.revealChapter <= ch) continue;
    if (r.summary?.trim()) out.push(r.summary.trim());
    for (const t of r.secretTerms ?? []) if (t?.trim()) out.push(t.trim());
  }
  return out;
}

export const leaksSecret = (text: string, secrets: string[]): boolean => {
  const t = text.toLowerCase();
  return secrets.some((s) => t.includes(s.toLowerCase()));
};

/** Spoiler-safe master genre fields: anything naming an ending, twist or resolution is planner-only. */
const PLANNER_ONLY_FIELD = /ending|twist|reveal|resolution|climax|secret|synopsis|outcome|culprit/i;

export function planCandidates(plan: ResolvedPlan, position: StoryPosition): ContextCandidate[] {
  const { master, section } = plan;
  const ch = position.chapterIndex;
  const chapter = master.chapters.find((c) => c.chapterIndex === ch)!;
  const src = `approved plan v${plan.masterVersion}`;
  const out: ContextCandidate[] = [];
  const direction = Object.entries(master.genreData ?? {})
    .filter(([k, v]) => !PLANNER_ONLY_FIELD.test(k) && typeof v === "string" && v.trim())
    .map(([k, v]) => `${k.replace(/_/g, " ")}: ${v}`);
  if (direction.length) out.push({ id: "plan:direction", tier: "canon", text: `Book direction — ${direction.join("; ")}`, source: src, authority: "OUTLINE_CANON", establishedAt: null, relevance: 0.97 });
  out.push({ id: `plan:chapter:${ch}`, tier: "canon", text: `This chapter's goal [${chapter.objectiveKind}]: ${chapter.objective}`, source: src, authority: "OUTLINE_CANON", establishedAt: null, relevance: 0.99 });
  const beats = [...(section.beats ?? [])].sort((a, b) => a.order - b.order).map((b) => b.kind.replace(/_/g, " "));
  out.push({ id: `plan:section:${section.id}`, tier: "canon", text: `This section's goal: ${section.objective}${beats.length ? ` — beats, in order: ${beats.join(" → ")}` : ""}. Length is an estimate (~${section.targetWords} words), never pad or cut to hit it.`, source: `${src} (${plan.sectionSource})`, authority: "OUTLINE_CANON", establishedAt: null, relevance: 1 });
  const { revealed } = revealsVisibleAt(master, ch);
  for (const r of revealed) out.push({ id: `plan:revealed:${r.id}`, tier: "canon", text: `Already revealed${r.revealChapter === ch ? " IN THIS CHAPTER" : ""}: ${r.summary}`, source: src, authority: "OUTLINE_CANON", establishedAt: null, relevance: r.revealChapter === ch ? 0.98 : 0.8 });
  // Phase F: actionable, spoiler-safe setup instructions (writer knowledge ≠ reader/character knowledge).
  foreshadowFor(master, ch).forEach((f, i) => out.push({ id: `plan:foreshadow:${f.revealId}:${i}`, tier: "canon", text: f.text, source: src, authority: "OUTLINE_CANON", establishedAt: null, relevance: f.specific ? 0.95 : 0.85 }));
  return out;
}

/** Active anchors only, effective at or before this chapter, latest version per key. */
export function anchorCandidates(anchors: Row[], position: StoryPosition): ContextCandidate[] {
  const latest = new Map<string, Row>();
  for (const a of anchors) {
    if (!a?.is_active || a.match_mode === "NONE" || Number(a.effective_chapter_index ?? 0) > position.chapterIndex) continue;
    const prev = latest.get(a.anchor_key);
    if (!prev || Number(a.version) > Number(prev.version)) latest.set(a.anchor_key, a);
  }
  return [...latest.values()].map((a) => ({
    id: `anchor:${a.anchor_key}`, tier: "canon" as const,
    text: `EXACT (use verbatim): ${a.anchor_key} = "${a.exact_text}"${a.context_hint ? ` (${a.context_hint})` : ""}`,
    source: `anchor v${a.version} ${String(a.source_type).toLowerCase()}`, authority: a.source_type === "USER" ? "USER_CANON" : "OUTLINE_CANON",
    establishedAt: null, relevance: 0.96,
  }));
}

export interface PlanningContextInput extends AdaptiveInput {
  master?: Row | null; readyPlans?: Row[]; anchors?: Row[];
  /** Phase 3: narrator-knowledge candidates (already filtered by scene chronology and vantage). */
  extraCandidates?: ContextCandidate[];
}
export interface PlanningContextResult {
  mode: "planned" | "legacy"; fallbackReason?: PlanFallbackReason;
  context: AssembledContext;
  metrics: { candidates: number; planCandidates: number; anchorCandidates: number; spoilerBlocked: number; words: number; hardLimitWords: number };
}

/** Adaptive build plus plan + anchors. Without a usable plan, output equals the existing Adaptive build. */
export function buildPlanningAwareContext(input: PlanningContextInput): PlanningContextResult {
  const base = buildAdaptiveCandidates(input);
  const plan = resolvePlanForSection(input.master, input.position, input.bookType, input.readyPlans);
  const planC = plan.usable ? planCandidates(plan, input.position) : [];
  const anchorC = anchorCandidates(input.anchors ?? [], input.position);
  // Keywords the current chapter's approved plan already uses are planned, not spoilers.
  const chapterPlan = plan.usable ? JSON.stringify(plan.master.chapters?.find((c) => c.chapterIndex === input.position.chapterIndex) ?? plan.section).toLowerCase() : "";
  const secrets = plan.usable ? futureSecrets(plan.master, input.position.chapterIndex).filter((t) => !chapterPlan.includes(t.toLowerCase())) : [];
  const all = [...planC, ...anchorC, ...(input.extraCandidates ?? []), ...base.candidates];
  const safe = all.filter((c) => !leaksSecret(c.text, secrets));
  const objective = plan.usable ? `${plan.section.objective}${input.objective ? ` | ${input.objective}` : ""}` : input.objective;
  const context = assembleAdaptiveContext({ bookType: input.bookType, position: input.position, objective, candidates: safe, historicalNeedIds: base.needIds });
  return {
    mode: plan.usable ? "planned" : "legacy", fallbackReason: plan.usable ? undefined : (plan as { reason?: PlanFallbackReason }).reason, context,
    metrics: { candidates: all.length, planCandidates: planC.length, anchorCandidates: anchorC.length, spoilerBlocked: all.length - safe.length, words: countContextWords(context.text), hardLimitWords: context.hardLimitWords },
  };
}
