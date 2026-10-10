import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { buildEvaluatorPrompt, qualityRubric, QUALITY_RUBRICS, type EvalContext } from "../../supabase/functions/_shared/narrative/planning/evaluator";
import { GENRE_ADAPTERS } from "../../supabase/functions/_shared/narrative/planning/adapters";
import { findBannedExpressions, vocabularyRules } from "../../supabase/functions/_shared/narrative/planning/validation";

const gen = readFileSync("supabase/functions/generate-content/index.ts", "utf8");
const planning = readFileSync("supabase/functions/_shared/narrative/planning/aiPlanning.ts", "utf8");
const ctx = (adapter: string): EvalContext => ({ adapter, isFiction: adapter === "fiction", objective: "x", beats: [], anchors: [], facts: [], secrets: [] });

describe("Phase I: opening diversity is Progressive-only", () => {
  it("the opening-strategy helpers are actually imported (no silent ReferenceError)", () => {
    expect(gen).toMatch(/import \{ buildLedger, planOpeningStrategy, renderOpeningStrategyBlock \} from "\.\.\/_shared\/writers\/rhetoric\.ts"/);
  });
  it("runs only when a usable progressive plan exists, so Standard prompts are unchanged", () => {
    expect(gen).toContain("if (progressive && progressive.plan.usable) try {");
  });
});

describe("Phase I: configured vocabulary only", () => {
  it("progressive writing drops the global magic ban; Standard keeps its existing prompt", () => {
    expect(gen).toContain('pipeline === "progressive");');
    expect(gen).toMatch(/configuredBansOnly \? "" :/);
  });
  it("planner prompts no longer ban ordinary words", () => {
    expect(planning).not.toMatch(/magic/i);
  });
  it("an author-configured ban is still enforced", () => {
    expect(findBannedExpressions("A dazzling night.", vocabularyRules({ bannedWords: ["dazzling"] }))).not.toEqual([]);
  });
});

describe("Phase I: genre-adaptive advisory quality rubric", () => {
  it("every one of the nine adapters has its own rubric", () => {
    for (const a of GENRE_ADAPTERS) expect(QUALITY_RUBRICS[a.id], a.id).toBeDefined();
  });
  it("nonfiction is not judged on dialogue or dramatic tension", () => {
    for (const id of ["self_help", "business", "finance", "technical", "cookbook", "magazine"]) {
      expect(qualityRubric(id).join(" ")).not.toMatch(/dialogue|tension/);
    }
  });
  it("the evaluator receives the genre rubric and is told it is advisory", () => {
    const p = buildEvaluatorPrompt("draft", ctx("cookbook"));
    expect(p.system).toContain("ingredient, quantity and timing precision");
    expect(p.system).toContain("never material");
  });
});
