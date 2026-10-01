import { describe, it, expect } from "vitest";
import { SLIDERS, readSliders, boundToBaseline, resolveDivergence, renderExpressionBlock } from "../../supabase/functions/_shared/writers/sliders";
describe("15-slider expression layer", () => {
  it("has 15 unique sliders", () => expect(new Set(SLIDERS.map((s) => s.key)).size).toBe(15));
  it("maps legacy fields; new ones default to 5", () => {
    const v = readSliders({ formality: 8, emotionalIntensity: 2 }, { velocity: 9, entityComplexity: 7 });
    expect([v.formality, v.emotion, v.pacing, v.conceptualComplexity, v.warmth]).toEqual([8, 2, 9, 7, 5]);
  });
  it("bounds to ±2 and 1–10", () => { expect(boundToBaseline(5, 10)).toBe(7); expect(boundToBaseline(2, -3)).toBe(1); });
  it("divergence: legacy boolean and explicit mode", () => {
    expect(resolveDivergence({ divergenceAllowed: true })).toBe("open");
    expect(resolveDivergence({})).toBe("strict");
    expect(resolveDivergence({ divergenceMode: "controlled", divergenceAllowed: false })).toBe("controlled");
  });
  it("prompt block is deterministic and lists all 15", () => {
    const b = renderExpressionBlock(readSliders({}, {}), "strict");
    expect(b).toBe(renderExpressionBlock(readSliders({}, {}), "strict"));
    for (const s of SLIDERS) expect(b).toContain(s.label);
  });
});
