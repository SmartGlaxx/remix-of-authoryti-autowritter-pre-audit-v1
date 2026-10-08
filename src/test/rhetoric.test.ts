import { describe, expect, it } from "vitest";
import { openingFamily, classifyOpening, detectPatterns, planOpeningStrategy, allowedStrategies, buildLedger, renderOpeningStrategyBlock, RECENT_WINDOW, OPENING_STRATEGIES } from "../../supabase/functions/_shared/writers/rhetoric";
import { rhetoricalRepetitionFindings } from "../../supabase/functions/_shared/narrative/audit";
import { ENABLED_BOOK_TYPES } from "../types/book";

describe("rhetorical pattern families", () => {
  it("catches variants of the same opening template, not just one phrase", () => {
    for (const s of [
      "There's a particular kind of silence after a bad meeting.",
      "There is a certain kind of founder who never sleeps.",
      "Some problems have a way of growing quietly.",
      "We've all experienced that moment when the money runs out.",
      "There's a moment in every career when you doubt yourself.",
      "Few things are more stressful than payroll week.",
      "One of the most common mistakes is waiting.",
    ]) expect(openingFamily(s)).not.toBeNull();
  });
  it("leaves concrete openings alone", () => {
    expect(openingFamily("Maria signed the lease at 9:14 on a Tuesday.")).toBeNull();
    expect(classifyOpening("What would you cut first if revenue fell 30%?")).toBe("question");
    expect(classifyOpening("There's a particular kind of dread.")).toBe("general_observation");
  });
  it("detects stock phrases", () => {
    expect(detectPatterns("The truth is, cash is king. But here's the thing: nobody tracks it.").stockPhrases).toEqual(expect.arrayContaining(["the truth is", "here's the thing"]));
  });
});

describe("opening strategy planner", () => {
  it("never reuses a strategy within the recent window", () => {
    const outline = { chapters: [{ subsections: [] as { content: string }[] }] };
    const texts: Record<string, string> = { problem_statement: "Your cash runs out in May.", question: "Why do budgets fail?", statistic: "Only 40% of firms survive.", contrarian_claim: "Budgets are useless.", case_study: "Acme Ltd nearly folded." };
    const used: string[] = [];
    for (let i = 0; i < 6; i++) {
      const ledger = buildLedger(outline);
      const s = planOpeningStrategy({ bookType: "finance", writerId: "claire", position: i, ledger });
      expect(used.slice(-RECENT_WINDOW).filter((u) => texts[u] && classifyOpening(texts[u]) === u)).not.toContain(s);
      used.push(s);
      outline.chapters[0].subsections.push({ content: texts[s] ?? "Plain opening sentence here." });
    }
  });
  it("keeps format-constrained types format-safe", () => {
    expect(allowedStrategies("drama").every((s) => ["concrete_scene", "short_dialogue", "consequence_first"].includes(s))).toBe(true);
    expect(allowedStrategies("cookbook")).not.toContain("short_dialogue");
    for (const t of ENABLED_BOOK_TYPES) expect(allowedStrategies(t).every((s) => OPENING_STRATEGIES.includes(s))).toBe(true);
  });
  it("statistic strategy forbids invented numbers", () => {
    expect(renderOpeningStrategyBlock("statistic")).toContain("Never invent numbers");
  });
  it("is deterministic and ignores sections at or after the target", () => {
    const outline = { chapters: [{ subsections: [{ content: "There's a particular kind of fear." }, { content: "Later text." }] }] };
    expect(buildLedger(outline, { chapterIndex: 0, subsectionIndex: 1 })).toHaveLength(1);
    const a = planOpeningStrategy({ bookType: "self-help", writerId: "maya", position: 3 });
    expect(planOpeningStrategy({ bookType: "self-help", writerId: "maya", position: 3 })).toBe(a);
  });
});

describe("audit rhetorical repetition", () => {
  it("flags one template reused in 3+ sections, read-only", () => {
    const sec = (i: number, c: string) => ({ chapterIndex: 0, subsectionIndex: i, content: c, title: "", chapterTitle: "", goal: "" } as never);
    const f = rhetoricalRepetitionFindings([sec(0, "There's a particular kind of fear."), sec(1, "There is a certain kind of hope."), sec(2, "There's a peculiar kind of quiet."), sec(3, "Cash ran out.")]);
    expect(f).toHaveLength(1);
    expect(f[0].category).toBe("redundancy");
    expect(rhetoricalRepetitionFindings([sec(0, "There's a particular kind of fear."), sec(1, "Cash ran out.")])).toHaveLength(0);
  });
});
