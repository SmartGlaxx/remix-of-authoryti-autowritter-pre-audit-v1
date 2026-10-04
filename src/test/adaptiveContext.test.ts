import { describe, expect, it } from "vitest";
import { assembleAdaptiveContext, CONTEXT_PROFILES, HARD_CONTEXT_WORD_LIMIT, countContextWords, profileForBookType, type ContextCandidate } from "../../supabase/functions/_shared/narrative/adaptiveContext.ts";
import { ENABLED_BOOK_TYPES } from "../types/book";

const position = { chapterIndex: 30, subsectionIndex: 1 };
const item = (id: string, tier: ContextCandidate["tier"], text: string, chapterIndex = 1): ContextCandidate => ({ id, tier, text, source: `section-${chapterIndex}`, authority: "APPROVED_GENERATED_STATE", establishedAt: { chapterIndex, subsectionIndex: 0 }, relevance: 0.9 });
const assemble = (bookType: string, candidates: ContextCandidate[], extras = {}) => assembleAdaptiveContext({ bookType, position, objective: "Advance the chapter without repeating prior material", candidates, ...extras });

describe("Phase 2A adaptive context", () => {
  it("assigns every enabled book type exactly one of five profiles", () => {
    expect(CONTEXT_PROFILES).toHaveLength(5);
    expect(ENABLED_BOOK_TYPES).toHaveLength(20);
    for (const type of ENABLED_BOOK_TYPES) expect(CONTEXT_PROFILES.filter((p) => p.bookTypes.includes(type))).toHaveLength(1);
    expect(profileForBookType("business").id).toBe("practical");
    expect(profileForBookType("drama").facets).toContain("character-continuity");
    expect(() => profileForBookType("unassigned")).toThrow();
  });

  it("allows profile configuration without engine branching", () => {
    const custom = [{ ...CONTEXT_PROFILES[1], bookTypes: ["leadership"] }];
    expect(assembleAdaptiveContext({ bookType: "leadership", position, objective: "Act", candidates: [], profiles: custom }).profileId).toBe("practical");
  });

  it("prioritizes established canon and objective before relevant historical passages", () => {
    const canon = { ...item("thesis", "canon", "Original thesis"), establishedAt: null, authority: "USER_CANON" };
    const history = { ...item("prior", "historical", "A sourced earlier argument"), needIds: ["definition"] };
    const result = assemble("self-help", [history, item("recent", "recent", "Adjacent prose"), canon], { historicalNeedIds: ["definition"] });
    expect(result.included.map((x) => x.id)).toEqual(["thesis", "recent", "prior"]);
    expect(result.text).toContain("[IMMEDIATE_OBJECTIVE]");
    expect(result.text).toContain("source=section-1");
    expect(result.text).toContain("authority=USER_CANON");
  });

  it("refuses future/current material, unknown provenance, and history without a specific need", () => {
    const result = assemble("novel", [item("future", "canon", "SPOILER", 31), item("current", "canon", "OLD ATTEMPT", 30), { ...item("unsourced", "recent", "No position"), establishedAt: null }, { ...item("unknown", "canon", "No source"), source: "" }, { ...item("old", "historical", "Relevant but not requested"), needIds: ["other"] }]);
    expect(result.text).not.toMatch(/SPOILER|OLD ATTEMPT|No position|No source|Relevant but not requested/);
    expect(result.omitted.map((x) => x.reason)).toEqual(["future_or_current", "future_or_current", "missing_provenance", "missing_provenance", "no_specific_need"]);
  });

  it("is deterministic, de-duplicates IDs, and never splits provenance or prose to fill a budget", () => {
    const big = "long ".repeat(1800);
    const candidates = [item("big", "canon", big), item("small", "canon", "Keep me"), item("small", "canon", "Duplicate me")];
    const first = assemble("business", candidates);
    expect(first.included.map((x) => x.id)).toEqual(["small"]);
    expect(first.omitted.map((x) => x.reason)).toEqual(["tier_budget", "duplicate"]);
    expect(assemble("business", candidates)).toEqual(first);
  });

  it("rejects an oversized objective or invalid ceiling instead of silently truncating", () => {
    expect(() => assemble("finance", [], { hardLimitWords: HARD_CONTEXT_WORD_LIMIT + 1 })).toThrow();
    expect(() => assemble("finance", [], { hardLimitWords: 10, objective: "word ".repeat(15) })).toThrow();
  });
});

describe("10,000-word context benchmark (synthetic; no AI or live book calls)", () => {
  for (const profile of CONTEXT_PROFILES) {
    it(`${profile.id}: 50,000 supplied words stay below the hard ceiling`, () => {
      const candidates: ContextCandidate[] = [];
      for (const tier of profile.priorities) {
        for (let n = 0; n < 10; n++) {
          candidates.push({ ...item(`${tier}-${n}`, tier, `${tier} `.repeat(1000), n + 1), relevance: 1 - n / 20, ...(tier === "historical" ? { needIds: ["recall"] } : {}) });
        }
      }
      const start = performance.now();
      const result = assemble(profile.bookTypes[0], candidates, { historicalNeedIds: ["recall"] });
      const elapsed = performance.now() - start;
      expect(result.wordCount).toBe(countContextWords(result.text));
      expect(result.wordCount).toBeLessThanOrEqual(HARD_CONTEXT_WORD_LIMIT);
      expect(result.wordCount).toBeGreaterThan(1000);
      expect(result.included.some((c) => c.tier === "canon")).toBe(true);
      expect(result.included.some((c) => c.tier === "historical")).toBe(true);
      console.info(`[2A benchmark] ${profile.id}: supplied=50000 output=${result.wordCount} omitted=${result.omitted.length} elapsed_ms=${elapsed.toFixed(1)}`);
    });
  }
}