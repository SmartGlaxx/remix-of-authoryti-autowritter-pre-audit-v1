import { describe, it, expect } from "vitest";
import { analyzeSection, rhythmStats, figurativeDensity, repeatedStarters } from "../../supabase/functions/_shared/writers/naturalnessMetrics";
import { naturalnessBlocksAcceptance } from "../../supabase/functions/_shared/writers/naturalness";

const uniform = Array.from({ length: 10 }, (_, i) => `The man walked to the door number ${i}.`).join(" ");
const varied = "Rain. The street emptied as the storm rolled through the old harbour district and every shutter banged. She waited. Then, without a word to anyone in the crowded station, she turned and ran toward the trains. Silence. Nobody followed her that night, and nobody would ask about it later. Why? Because.";

describe("Stage B naturalness metrics", () => {
  it("uniform rhythm has low variation, varied rhythm high", () => {
    expect(rhythmStats(uniform).cv).toBeLessThan(0.25);
    expect(rhythmStats(varied).cv).toBeGreaterThan(0.5);
  });
  it("burstiness is info only, never advisory", () => {
    const f = analyzeSection(uniform).find((x) => x.category === "burstiness");
    expect(f?.severity).toBe("info");
  });
  it("opening recurrence needs a prior use in the ledger", () => {
    const t = "There's a particular kind of silence in old houses. " + varied;
    expect(analyzeSection(t).some((f) => f.category === "opening_recurrence")).toBe(false);
    const ledger = [{ chapterIndex: 0, subsectionIndex: 0, strategy: "general_observation" as const, family: "general_observation" as const, stockPhrases: [] }];
    expect(analyzeSection(t, { ledger }).find((f) => f.category === "opening_recurrence")?.severity).toBe("advisory");
  });
  it("protected motifs are never flagged", () => {
    const t = "There's a particular kind of silence in old houses. " + varied;
    const ledger = [{ chapterIndex: 0, subsectionIndex: 0, strategy: "general_observation" as const, family: "general_observation" as const, stockPhrases: [] }];
    expect(analyzeSection(t, { ledger, protectedMotifs: ["particular kind of silence"] }).some((f) => f.category === "opening_recurrence")).toBe(false);
  });
  it("figurative tolerance widens with writer creativity", () => {
    const t = Array.from({ length: 30 }, () => "Her voice was like a river and the night felt as if it would never end today.").join(" ");
    expect(figurativeDensity(t).per1000).toBeGreaterThan(8);
    const low = analyzeSection(t, { creativityBaseline: 3 }).some((f) => f.category === "figurative_density");
    const high = analyzeSection(t, { creativityBaseline: 10 }).find((f) => f.category === "figurative_density");
    expect(low).toBe(true);
    expect(high?.evidence.limit).toBe(18);
  });
  it("detects repeated sentence starters", () => {
    expect(repeatedStarters(uniform)[0]).toMatchObject({ starter: "the man", count: 10 });
  });
  it("findings never block acceptance", () => {
    expect(naturalnessBlocksAcceptance(analyzeSection(uniform))).toBe(false);
  });
});
