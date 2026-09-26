import { describe, it, expect } from "vitest";
import { decideFactInsertion, validateThreadTransition } from "@/lib/narrativeRules";

describe("decideFactInsertion", () => {
  const ex = { id: "e1", value: "brown", authority: "OUTLINE_CANON" as const };
  it("inserts clean when nothing exists", () => expect(decideFactInsertion({ value: "brown", authority: "AI_INFERENCE" }, null).kind).toBe("insert_clean"));
  it("detects duplicates ignoring case/space", () => expect(decideFactInsertion({ value: " Brown ", authority: "AI_INFERENCE" }, ex).kind).toBe("duplicate"));
  it("rejects lower authority", () => expect(decideFactInsertion({ value: "blue", authority: "AI_INFERENCE" }, ex).kind).toBe("insert_rejected"));
  it("disputes equal authority", () => expect(decideFactInsertion({ value: "blue", authority: "OUTLINE_CANON" }, ex).kind).toBe("insert_disputed"));
  it("disputes higher authority (never overwrites)", () => expect(decideFactInsertion({ value: "blue", authority: "USER_CANON" }, ex).kind).toBe("insert_disputed"));
});

describe("validateThreadTransition", () => {
  it("requires notes + chapter to resolve", () => {
    expect(validateThreadTransition("RESOLVED", {})).toBeTruthy();
    expect(validateThreadTransition("RESOLVED", { resolutionNotes: "x" })).toBeTruthy();
    expect(validateThreadTransition("RESOLVED", { resolutionNotes: "x", resolvedChapterIndex: 3 })).toBeNull();
  });
  it("requires reason to abandon and replacement to supersede", () => {
    expect(validateThreadTransition("ABANDONED", {})).toBeTruthy();
    expect(validateThreadTransition("SUPERSEDED", { resolutionNotes: "x" })).toBeTruthy();
    expect(validateThreadTransition("DEVELOPING", {})).toBeNull();
  });
});
