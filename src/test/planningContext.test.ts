import { describe, expect, it } from "vitest";
import { buildPlanSkeleton } from "../../supabase/functions/_shared/narrative/planning/engine.ts";
import { buildPlanningAwareContext, resolvePlanForSection, anchorCandidates } from "../../supabase/functions/_shared/narrative/planning/planningContext.ts";
import { buildAdaptiveContext } from "../../supabase/functions/_shared/narrative/adaptiveCandidates.ts";
import { HARD_CONTEXT_WORD_LIMIT } from "../../supabase/functions/_shared/narrative/adaptiveContext.ts";
import type { NarrativeRows } from "../../supabase/functions/_shared/narrative/context.ts";

const empty: NarrativeRows = { characters: [], states: [], events: [], participants: [], threads: [], threadEvents: [], facts: [], timeline: [], entities: [], snapshots: [] };
const words = (n: number, tag: string) => Array.from({ length: n }, (_, i) => `${tag}${i}.`).join(" ");
const outline = (chapters: number, perCh: number, w: number) => ({
  characters: [{ id: "mara", name: "Mara Quell", role: "clerk" }],
  chapters: Array.from({ length: chapters }, (_, c) => ({ title: `C${c}`, subsections: Array.from({ length: perCh }, (_, s) => ({ title: `S${s}`, content: c < 3 ? words(w, `c${c}s${s}w`) : "" })) })),
});
const skeleton = () => {
  const sk = buildPlanSkeleton({ bookType: "novel", targetWords: 48000, chapterCount: 12, sectionsPerChapter: 4,
    genreData: { theme: "complicity in small towns", ending: "HARBORMASTER_ENDING", central_twist: "TWIST_FIELD" },
    reveals: [
      { id: "r1", summary: "the crane log was forged", revealChapter: 2, setupChapters: [0, 1] },
      { id: "r2", summary: "Hale ordered the collapse", revealChapter: 9, setupChapters: [3, 6] },
    ] });
  return sk;
};
const approved = (over: Record<string, unknown> = {}) => ({ status: "APPROVED", version: 2, plan_skeleton: skeleton(), ...over });
const pos = { chapterIndex: 3, subsectionIndex: 1 };
const base = { bookType: "novel", position: pos, objective: "Continue", outline: outline(12, 4, 200), rows: empty };

describe("Phase E plan resolution (safe fallbacks)", () => {
  it("uses only an APPROVED, schema-compatible master", () => {
    expect(resolvePlanForSection(null, pos, "novel")).toEqual({ usable: false, reason: "no_master_plan" });
    for (const s of ["DRAFT", "SUPERSEDED", "CANCELLED"]) expect(resolvePlanForSection(approved({ status: s }), pos, "novel")).toMatchObject({ usable: false, reason: "master_not_approved" });
    expect(resolvePlanForSection(approved({ plan_skeleton: { ...skeleton(), schemaVersion: 99 } }), pos, "novel")).toMatchObject({ reason: "incompatible_schema" });
    expect(resolvePlanForSection(approved({ plan_skeleton: null }), pos, "novel")).toMatchObject({ reason: "missing_skeleton" });
    expect(resolvePlanForSection(approved(), pos, "self-help")).toMatchObject({ reason: "book_type_mismatch" });
    expect(resolvePlanForSection(approved(), { chapterIndex: 40, subsectionIndex: 0 }, "novel")).toMatchObject({ reason: "chapter_not_planned" });
    expect(resolvePlanForSection(approved(), pos, "novel")).toMatchObject({ usable: true, sectionSource: "skeleton", masterVersion: 2 });
  });

  it("a READY section plan overrides the skeleton; PLANNED ones are ignored", () => {
    const sec = { id: "c3s1", chapterIndex: 3, sectionIndex: 1, unit: "scene", objective: "READY_OBJ", targetWords: 900, dependsOn: [], beats: [] };
    expect(resolvePlanForSection(approved(), pos, "novel", [{ plan_status: "PLANNED", chapter_index: 3, subsection_index: 1, plan_skeleton: sec }])).toMatchObject({ sectionSource: "skeleton" });
    const r = resolvePlanForSection(approved(), pos, "novel", [{ plan_status: "READY", chapter_index: 3, subsection_index: 1, plan_skeleton: sec }]);
    expect(r).toMatchObject({ sectionSource: "ready" });
  });
});

describe("Phase E context construction + spoiler gating", () => {
  it("adds current chapter/section/beats and keeps whole-book direction without ending or twists", () => {
    const r = buildPlanningAwareContext({ ...base, master: approved() });
    expect(r.mode).toBe("planned");
    expect(r.context.text).toContain("This chapter's goal");
    expect(r.context.text).toContain("This section's goal");
    expect(r.context.text).toContain("complicity in small towns");
    expect(r.context.text).not.toContain("HARBORMASTER_ENDING");
    expect(r.context.text).not.toContain("TWIST_FIELD");
  });

  it("never leaks a future reveal, even through memory or anchors; past reveals are visible", () => {
    const rows: NarrativeRows = { ...empty, facts: [{ id: "f1", subject: "Rumor", predicate: "says", value: "Hale ordered the collapse", authority: "USER_CANON", is_canonical: true, conflict_status: "clean" }] };
    const anchors = [{ anchor_key: "leak", exact_text: "Hale ordered the collapse", is_active: true, version: 1, match_mode: "EXACT", effective_chapter_index: 0, source_type: "USER" }];
    const r = buildPlanningAwareContext({ ...base, rows, master: approved(), anchors });
    expect(r.context.text).not.toMatch(/Hale ordered the collapse/i);
    expect(r.metrics.spoilerBlocked).toBe(2);
    expect(r.context.text).toContain("the crane log was forged");
    expect(r.context.text).toContain("setup detail"); // ch3 is a setup chapter for r2, hint only
  });

  it("does not expose later chapter objectives", () => {
    const sk = skeleton();
    const later = sk.chapters[4].objective;
    sk.chapters[4].objective = `LATER_GOAL ${later}`;
    const r = buildPlanningAwareContext({ ...base, master: approved({ plan_skeleton: sk }) });
    expect(r.context.text).not.toContain("LATER_GOAL");
  });
});

describe("Phase E exact-detail anchors", () => {
  it("selects active, effective, latest-version anchors only", () => {
    const c = anchorCandidates([
      { anchor_key: "ship", exact_text: "Saint Brendan", is_active: false, version: 1, effective_chapter_index: 0, source_type: "MANUSCRIPT" },
      { anchor_key: "ship", exact_text: "St. Brendan II", is_active: true, version: 2, effective_chapter_index: 0, source_type: "MANUSCRIPT" },
      { anchor_key: "code", exact_text: "PX-41", is_active: true, version: 1, effective_chapter_index: 8, source_type: "MASTER_PLAN" },
      { anchor_key: "free", exact_text: "x", is_active: true, version: 1, match_mode: "NONE", effective_chapter_index: 0, source_type: "USER" },
    ], pos);
    expect(c.map((x) => x.text).join()).toContain("St. Brendan II");
    expect(c.map((x) => x.text).join()).not.toMatch(/PX-41|Saint Brendan"/);
    expect(c).toHaveLength(1);
  });
});

describe("Phase E budgets + backward compatibility", () => {
  it("stays under the 10,000-word ceiling on a long book and reports metrics", () => {
    const r = buildPlanningAwareContext({ ...base, outline: outline(12, 4, 2500), master: approved() });
    expect(r.metrics.words).toBeLessThanOrEqual(HARD_CONTEXT_WORD_LIMIT);
    expect(r.metrics.planCandidates).toBeGreaterThan(0);
  });

  it("without an approved plan, output equals the existing Adaptive build exactly", () => {
    for (const master of [null, approved({ status: "DRAFT" })]) {
      const r = buildPlanningAwareContext({ ...base, master });
      expect(r.mode).toBe("legacy");
      expect(r.context.text).toBe(buildAdaptiveContext(base).context.text);
    }
  });

  it("keeps Phase 2D gating: prior prose only, no target/future sections", () => {
    const r = buildPlanningAwareContext({ ...base, outline: outline(12, 4, 200), position: { chapterIndex: 2, subsectionIndex: 1 }, master: approved() });
    expect(r.context.text).toContain("c2s0w");
    expect(r.context.text).not.toMatch(/c2s1w|c2s2w/);
  });
});
