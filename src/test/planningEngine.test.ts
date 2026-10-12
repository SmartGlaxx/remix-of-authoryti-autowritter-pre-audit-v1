import { describe, it, expect } from "vitest";
import { GENRE_ADAPTERS, adapterForBookType, getAdapter, type AdapterId } from "../../supabase/functions/_shared/narrative/planning/adapters";
import { allocate, buildPlanSkeleton, validatePlan, downstreamOf, revealsVisibleAt, PLAN_SCHEMA_VERSION } from "../../supabase/functions/_shared/narrative/planning/engine";
import { blockingDiscrepancies } from "../../supabase/functions/_shared/narrative/planning/reconciliationFilter";
import { CONTEXT_PROFILES } from "../../supabase/functions/_shared/narrative/adaptiveContext";

const fields = (id: AdapterId) => Object.fromEntries(getAdapter(id).masterFields.map((f) => [f, f === "reveals" ? [] : "x"]));
const sample: Record<AdapterId, string> = { fiction: "novel", self_help: "self-help", business: "business", finance: "finance", children: "children", cookbook: "cookbook", magazine: "magazine", technical: "programming", narrative_nonfiction: "memoir" };

describe("Phase C adapters", () => {
  it("has exactly nine adapters", () => {
    expect(GENRE_ADAPTERS.map((a) => a.id).sort()).toEqual(["business", "children", "cookbook", "fiction", "finance", "magazine", "narrative_nonfiction", "self_help", "technical"]);
  });
  it("every app book type maps to exactly one adapter", () => {
    const types = CONTEXT_PROFILES.flatMap((p) => p.bookTypes);
    expect(types.length).toBe(21);
    expect(GENRE_ADAPTERS.find((a) => a.bookTypes.includes("textbook"))?.id).toBe("technical");
    for (const t of types) expect(GENRE_ADAPTERS.filter((a) => a.bookTypes.includes(t)).length).toBe(1);
  });
  it("unknown book type throws rather than guessing", () => {
    expect(() => adapterForBookType("spaceship-manual")).toThrow();
  });
  for (const a of GENRE_ADAPTERS) {
    it(`${a.id}: skeleton is valid with genre-specific structure`, () => {
      const p = buildPlanSkeleton({ bookType: sample[a.id], targetWords: 50000, chapterCount: 10, genreData: fields(a.id) });
      expect(validatePlan(p)).toEqual([]);
      expect(p.adapter).toBe(a.id);
      expect(p.chapters).toHaveLength(10);
      for (const c of p.chapters) {
        expect(a.chapterObjectives).toContain(c.objectiveKind);
        for (const s of c.sections) {
          expect(s.unit).toBe(a.sectionUnit);
          expect(s.beats.map((b) => b.kind)).toEqual([...a.beatKinds]);
        }
      }
    });
  }
  it("nonfiction adapters carry no fiction requirements", () => {
    for (const a of GENRE_ADAPTERS.filter((x) => !x.isFiction)) {
      expect(a.masterFields).not.toContain("reveals");
      expect(a.masterFields).not.toContain("protagonist");
      expect(a.beatKinds).not.toContain("exit_hook");
    }
  });
  it("nonfiction drops supplied reveals and validator rejects injected ones", () => {
    const p = buildPlanSkeleton({ bookType: "business", targetWords: 30000, chapterCount: 6, genreData: fields("business"), reveals: [{ id: "r", summary: "twist", revealChapter: 3, setupChapters: [1] }] });
    expect(p.reveals).toEqual([]);
    p.reveals.push({ id: "r", summary: "twist", revealChapter: 3, setupChapters: [1] });
    expect(validatePlan(p).map((i) => i.code)).toContain("FICTION_IN_NONFICTION");
  });
});

describe("Phase C word allocation", () => {
  it("allocate sums exactly and is deterministic", () => {
    const a = allocate(50001, [1, 1.3, 0.7]);
    expect(a.reduce((x, y) => x + y, 0)).toBe(50001);
    expect(allocate(50001, [1, 1.3, 0.7])).toEqual(a);
  });
  it("50k novel: chapters, sections and beats all sum exactly", () => {
    const p = buildPlanSkeleton({ bookType: "novel", targetWords: 50000, chapterCount: 20, genreData: fields("fiction") });
    expect(p.chapters.reduce((x, c) => x + c.targetWords, 0)).toBe(50000);
    expect(p.chapters[17].targetWords).toBeGreaterThan(p.chapters[0].targetWords); // builds toward climax
  });
  it("magazine features outweigh front/back of book", () => {
    const p = buildPlanSkeleton({ bookType: "magazine", targetWords: 20000, chapterCount: 8, genreData: fields("magazine") });
    expect(p.chapters[3].targetWords).toBeGreaterThan(p.chapters[0].targetWords);
  });
  it("rejects a target too small for the structure", () => {
    expect(() => buildPlanSkeleton({ bookType: "novel", targetWords: 1000, chapterCount: 10 })).toThrow();
  });
  it("clamps sections per chapter to the adapter range", () => {
    const p = buildPlanSkeleton({ bookType: "children", targetWords: 2000, chapterCount: 4, sectionsPerChapter: 50, genreData: fields("children") });
    expect(p.chapters[0].sections).toHaveLength(4);
  });
});

describe("Phase C hierarchy and dependencies", () => {
  const base = () => buildPlanSkeleton({ bookType: "novel", targetWords: 40000, chapterCount: 8, genreData: fields("fiction") });
  it("flags missing genre fields", () => {
    const p = buildPlanSkeleton({ bookType: "cookbook", targetWords: 30000, chapterCount: 5 });
    expect(validatePlan(p).filter((i) => i.code === "MISSING_GENRE_FIELD").map((i) => i.ref).sort()).toEqual(["cuisine", "skill_level", "unit_system"]);
  });
  it("flags word mismatch, bad beat, misplaced section", () => {
    const p = base();
    p.chapters[0].sections[0].targetWords += 5;
    p.chapters[1].sections[0].beats[0].kind = "recipe_step";
    p.chapters[2].sections[1].chapterIndex = 5;
    const codes = validatePlan(p).map((i) => i.code);
    expect(codes).toEqual(expect.arrayContaining(["WORDS_MISMATCH", "BAD_BEAT", "SECTION_PARENT"]));
  });
  it("flags dangling, forward and cyclic dependencies", () => {
    const p = base();
    p.chapters[1].dependsOn.push("c99");
    p.chapters[0].dependsOn.push("c1");
    const codes = validatePlan(p).map((i) => i.code);
    expect(codes).toEqual(expect.arrayContaining(["DANGLING_DEP", "FORWARD_DEP", "CYCLE"]));
  });
  it("blast radius: changing chapter 5 marks 5..7 for re-planning, not 0..4", () => {
    const d = downstreamOf(base(), "c5");
    expect(d).toContain("c6s0");
    expect(d).toContain("c7");
    expect(d.some((id) => /^c[0-4](s|$)/.test(id))).toBe(false);
  });
  it("cookbook recipes are independent: changing one recipe affects nothing else", () => {
    const p = buildPlanSkeleton({ bookType: "cookbook", targetWords: 30000, chapterCount: 5, genreData: fields("cookbook") });
    expect(downstreamOf(p, "c1s2")).toEqual([]);
  });
});

describe("Phase C spoiler containment and series readiness", () => {
  const p = buildPlanSkeleton({ bookType: "novel", targetWords: 40000, chapterCount: 8, genreData: fields("fiction"), reveals: [{ id: "twist", summary: "The mentor is the thief", revealChapter: 6, setupChapters: [2, 4] }] });
  it("future twist summary is hidden before its chapter, only a setup hint", () => {
    const v = revealsVisibleAt(p, 4);
    expect(v.revealed).toEqual([]);
    expect(v.foreshadow).toEqual([{ id: "twist", hint: "setup_only" }]);
    expect(JSON.stringify(v)).not.toContain("mentor");
    expect(revealsVisibleAt(p, 6).revealed).toHaveLength(1);
  });
  it("setup after reveal is invalid", () => {
    const bad = structuredClone(p); bad.reveals[0].setupChapters = [7];
    expect(validatePlan(bad).map((i) => i.code)).toContain("SETUP_AFTER_REVEAL");
  });
  it("series ref is carried but optional; newer schema rejected", () => {
    expect(p.series).toBeNull();
    const s = buildPlanSkeleton({ bookType: "novel", targetWords: 40000, chapterCount: 8, genreData: fields("fiction"), series: { seriesId: "s1", bookNumber: 2 } });
    expect(s.series?.bookNumber).toBe(2);
    expect(validatePlan({ ...s, schemaVersion: PLAN_SCHEMA_VERSION + 1 }).map((i) => i.code)).toContain("SCHEMA_TOO_NEW");
  });
});

describe("Self-test reconciliation record cannot block benchmarks", () => {
  it("decided and selftest records never block; real pending critical does", () => {
    const logs = [
      { decision: "ACCEPT_PROSE_UPDATE_CANON", dedup_key: "selftest_64db", severity: "CRITICAL" },
      { decision: "PENDING", dedup_key: "selftest_x", severity: "CRITICAL" },
      { decision: "PENDING", dedup_key: "real_1", severity: "CRITICAL" },
      { decision: "PENDING", dedup_key: "real_2", severity: "MINOR" },
    ];
    expect(blockingDiscrepancies(logs).map((l) => l.dedup_key)).toEqual(["real_1"]);
  });
});

import { BOOK_TYPE_GENRES, DEFAULT_BANNED_WORDS } from "@/types/book";
describe("book type sub-categories", () => {
  it("children's books never offer adult genres", () => {
    expect(BOOK_TYPE_GENRES.children).not.toContain("Romance");
    expect(BOOK_TYPE_GENRES.children).not.toContain("Thriller & Suspense");
  });
  it("popular science no longer lists Evolution & Nature", () => {
    expect(BOOK_TYPE_GENRES["science-popular"]).not.toContain("Evolution & Nature");
  });
  it("default banned words include fantasy terms", () => {
    expect(DEFAULT_BANNED_WORDS).toEqual(expect.arrayContaining(["magic", "magical", "wizard"]));
  });
});

import { summaryBand, SERIES_BOOK_BAND, buildMasterPrompt } from "../../supabase/functions/_shared/narrative/planning/aiPlanning";
describe("elastic summary lengths", () => {
  it("comic summaries are 150–350 words", () => expect(summaryBand("comic")).toEqual({ min: 150, max: 350 }));
  it("novel summaries are 300–350 words", () => expect(summaryBand("novel", "Literary")).toEqual({ min: 300, max: 350 }));
  it("novel thrillers are capped at 350", () => expect(summaryBand("novel", "Thriller & Suspense").max).toBe(350));
  it("series books are 450–500 each", () => expect(SERIES_BOOK_BAND).toEqual({ min: 450, max: 500 }));
  it("no summary band exceeds 500 words", () => {
    for (const t of ["comic", "children", "short-story", "poetry", "novel", "fiction-serial", "drama", "biography", "memoir", "self-help", "business", "cookbook", "textbook"])
      expect(summaryBand(t).max).toBeLessThanOrEqual(500);
  });
  it("series master plan asks for one summary per book", () => {
    const p = buildMasterPrompt({ title: "T", bookType: "novel", premise: "p", targetWords: 50000, chapterCount: 12, seriesPlan: { books: 5 } }, null);
    expect(p.user).toContain("series of 5 books");
  });
});
