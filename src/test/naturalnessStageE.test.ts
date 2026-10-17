import { describe, it, expect } from "vitest";
import { protectedMotifLabels, resolveNaturalnessMode, NATURALNESS_OPERATIONAL } from "../../supabase/functions/_shared/writers/naturalness";
import { analyzeSection } from "../../supabase/functions/_shared/writers/naturalnessMetrics";
import { motifCandidate, MODE_LABELS } from "../lib/naturalnessUi";

describe("Stage E naturalness UI contracts", () => {
  it("only active motif artifacts protect phrases", () => {
    expect(protectedMotifLabels([
      { artifact_type: "verbal_motif", label: "nine beats, pause", status: "active" },
      { artifact_type: "motif", label: "the lantern", status: "retired" },
      { artifact_type: "scenery", label: "harbour", status: "active" },
    ])).toEqual(["nine beats, pause"]);
  });

  it("an opening marked as intentional motif is no longer flagged", () => {
    const text = "She remembered Ceres again. " + "The corridor was quiet and long. ".repeat(20);
    const ledger = [{ family: "memory_recall" }, { family: "memory_recall" }] as never;
    const flagged = analyzeSection(text, { ledger }).some((f) => f.category === "opening_recurrence");
    const withMotif = analyzeSection(text, { ledger, protectedMotifs: ["remembered Ceres"] }).some((f) => f.category === "opening_recurrence");
    expect(withMotif).toBe(false);
    if (flagged) expect(withMotif).not.toBe(flagged);
  });

  it("settings offer exactly the three modes and legacy advise stays analyze-only", () => {
    expect(Object.keys(MODE_LABELS)).toEqual(["off", "analyze_only", "analyze_and_rewrite"]);
    expect(resolveNaturalnessMode({ naturalness: "advise" })).toBe("analyze_only");
  });

  it("reports only the four implemented categories as operational", () => {
    expect(NATURALNESS_OPERATIONAL).toEqual(["opening_recurrence", "figurative_density", "burstiness", "mechanical_pattern"]);
  });

  it("suggests a motif phrase from finding evidence", () => {
    expect(motifCandidate({ stockPhrases: ["at the end of the day"] })).toBe("at the end of the day");
    expect(motifCandidate({ starters: [{ starter: "she felt" }] })).toBe("she felt");
    expect(motifCandidate({})).toBe("");
  });
});
