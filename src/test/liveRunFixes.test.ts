import { describe, it, expect } from "vitest";
import { defaultBookConfig, resolveModelForRole } from "../../supabase/functions/_shared/ai/roles";
import { missingReferenceNames } from "../../supabase/functions/_shared/narrative/characterReference";

describe("books without a saved model config", () => {
  it("draft novel prose on Sonnet 5, not DeepSeek", () => {
    expect(resolveModelForRole(defaultBookConfig("sophia"), "writer", { bookType: "novel", fast: true }).model).toBe("anthropic/claude-sonnet-5");
  });
  it("draft drama on Sol", () => {
    expect(resolveModelForRole(defaultBookConfig("marcus"), "writer", { bookType: "drama" }).model).toBe("openai/gpt-6-sol");
  });
});

describe("cast members needing a reference picture", () => {
  it("lists approved cast without a locked card", () => {
    const cards = [{ name: "Mara Venn", reference: { locked: true } }, { name: "Rusk", reference: { locked: false } }];
    expect(missingReferenceNames(["Mara Venn", "Rusk", "Bell’s successor"], cards)).toEqual(["Rusk", "Bell’s successor"]);
  });
  it("matches names regardless of case and apostrophe style", () => {
    expect(missingReferenceNames(["bell's successor"], [{ name: "Bell’s Successor", reference: { locked: true } }])).toEqual([]);
  });
});

describe("one model pair for every writer", () => {
  it("prose defaults to Sonnet 5, drama to Sol", () => {
    expect(resolveModelForRole(defaultBookConfig("elena"), "writer", { bookType: "novel" }).model).toBe("anthropic/claude-sonnet-5");
    expect(resolveModelForRole(defaultBookConfig("elena"), "writer", { bookType: "drama" }).model).toBe("openai/gpt-6-sol");
  });
  it("the writer toggle switches drafting to Sol (or drama back to Sonnet)", () => {
    expect(resolveModelForRole(defaultBookConfig("elena", "sol"), "writer", { bookType: "novel" }).model).toBe("openai/gpt-6-sol");
    expect(resolveModelForRole(defaultBookConfig("elena", "sonnet"), "writer", { bookType: "drama" }).model).toBe("anthropic/claude-sonnet-5");
  });
  it("planning, checks, memory and character cards use Sol", () => {
    for (const role of ["planner", "continuity_checker", "narrative_extractor", "summarizer", "character_generator", "manuscript_auditor"] as const)
      expect(resolveModelForRole(defaultBookConfig("marcus"), role).model).toBe("openai/gpt-6-sol");
  });
});
