import { describe, it, expect } from "vitest";
import { buildAlternativesPrompt, buildAdjustPremisePrompt, parseAdjustedPremise, TWIST_MODE_ON, TWIST_MODE_OFF, type BookBrief } from "../../supabase/functions/_shared/narrative/planning/aiPlanning";

const brief = (x: Partial<BookBrief> = {}): BookBrief => ({ title: "T", bookType: "novel", premise: "A lighthouse keeper finds a letter from herself.", targetWords: 50000, chapterCount: 12, ...x });

describe("inception plot-twist mode", () => {
  it("twist mode on builds every alternative around a twist", () => {
    expect(buildAlternativesPrompt(brief({ twistMode: true }), 3).user).toContain(TWIST_MODE_ON);
  });
  it("twist mode off asks for clean arcs", () => {
    const u = buildAlternativesPrompt(brief({ twistMode: false }), 3).user;
    expect(u).toContain(TWIST_MODE_OFF);
    expect(u).not.toContain(TWIST_MODE_ON);
  });
});

describe("Adjust with AI", () => {
  it("includes the chosen adjustment and custom text", () => {
    const u = buildAdjustPremisePrompt(brief(), ["romance"], "set in Accra").user;
    expect(u).toContain("romance");
    expect(u).toContain("set in Accra");
  });
  it("refuses with no adjustment or empty idea", () => {
    expect(() => buildAdjustPremisePrompt(brief(), [])).toThrow();
    expect(() => buildAdjustPremisePrompt(brief({ premise: " " }), ["drama"])).toThrow();
  });
  it("rejects a too-short rewrite", () => {
    expect(parseAdjustedPremise('{"premise":"too short","changes":"x"}').ok).toBe(false);
  });
});
