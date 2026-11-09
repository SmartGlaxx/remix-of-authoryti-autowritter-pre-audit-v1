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
