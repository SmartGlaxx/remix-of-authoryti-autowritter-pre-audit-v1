import { describe, expect, it } from "vitest";
import { buildAdaptiveContext, resolveContextEngine } from "../../supabase/functions/_shared/narrative/adaptiveCandidates.ts";
import { HARD_CONTEXT_WORD_LIMIT } from "../../supabase/functions/_shared/narrative/adaptiveContext.ts";
import type { NarrativeRows } from "../../supabase/functions/_shared/narrative/context.ts";

const empty: NarrativeRows = { characters: [], states: [], events: [], participants: [], threads: [], threadEvents: [], facts: [], timeline: [], entities: [], snapshots: [] };
const words = (n: number, tag: string) => Array.from({ length: n }, (_, i) => `${tag}${i}.`).join(" ");
const outline = (chapters: number, perCh: number, wordsEach: number) => ({
  characters: [{ id: "john", name: "John", role: "mentor" }],
  chapters: Array.from({ length: chapters }, (_, c) => ({ title: `C${c}`, subsections: Array.from({ length: perCh }, (_, s) => ({ title: `S${s}`, content: words(wordsEach, `c${c}s${s}w`) })) })),
});

describe("Phase 2D A/B switch", () => {
  it("defaults to legacy for missing or unknown values", () => {
    expect(resolveContextEngine(undefined)).toBe("legacy");
    expect(resolveContextEngine({})).toBe("legacy");
    expect(resolveContextEngine({ context_engine: "ADAPTIVE" })).toBe("legacy");
    expect(resolveContextEngine({ context_engine: "adaptive" })).toBe("adaptive");
  });
});

describe("Phase 2D adaptive build on real-shaped data", () => {
  it("never includes the target section or anything after it (regeneration / no future leak)", () => {
    const o = outline(6, 4, 300);
    const rows: NarrativeRows = { ...empty, facts: [
      { id: "f1", subject: "John", predicate: "is", value: "a mentor", authority: "APPROVED_GENERATED_STATE", source_chapter_index: 1, source_subsection_index: 0, is_canonical: true, conflict_status: "clean" },
      { id: "f2", subject: "John", predicate: "betrays", value: "FUTURE_SECRET", authority: "APPROVED_GENERATED_STATE", source_chapter_index: 4, source_subsection_index: 0, is_canonical: true, conflict_status: "clean" },
    ] };
    const { context } = buildAdaptiveContext({ bookType: "novel", position: { chapterIndex: 2, subsectionIndex: 1 }, objective: "Continue", outline: o, rows });
    expect(context.text).toContain("a mentor");
    expect(context.text).not.toContain("FUTURE_SECRET");
    expect(context.text).not.toMatch(/c2s1w|c2s2w|c3s0w/);
    expect(context.text).toContain("c2s0w");
  });

  it("stays under the 10,000-word ceiling on a long 50k-word book for every profile", () => {
    const o = outline(40, 4, 320);
    for (const t of ["novel", "self-help", "memoir", "programming", "cookbook"]) {
      const { context } = buildAdaptiveContext({ bookType: t, position: { chapterIndex: 39, subsectionIndex: 3 }, objective: "Continue", outline: o, rows: empty });
      expect(context.wordCount).toBeLessThanOrEqual(HARD_CONTEXT_WORD_LIMIT);
      expect(context.included.some((i) => i.tier === "recent")).toBe(true);
    }
  });

  it("practical nonfiction carries far less prior prose than fiction", () => {
    const o = outline(20, 4, 800);
    const pos = { chapterIndex: 19, subsectionIndex: 3 };
    const novel = buildAdaptiveContext({ bookType: "novel", position: pos, objective: "x", outline: o, rows: empty }).context.wordCount;
    const selfHelp = buildAdaptiveContext({ bookType: "self-help", position: pos, objective: "x", outline: o, rows: empty }).context.wordCount;
    expect(selfHelp).toBeLessThan(novel);
  });

  it("ignores identity entities introduced at or after the target", () => {
    const { context } = buildAdaptiveContext({ bookType: "business", position: { chapterIndex: 3, subsectionIndex: 0 }, objective: "x", outline: outline(4, 2, 50), rows: empty,
      identityEntities: [{ id: "a", kind: "framework", name: "Four Pillars", aliases: [], introduced_position: 10000 }, { id: "b", kind: "framework", name: "Six Pillars", aliases: [], introduced_position: 30000 }] });
    expect(context.text).toContain("Four Pillars");
    expect(context.text).not.toContain("Six Pillars");
  });
});
