import { describe, it, expect } from "vitest";
import {
  resolveNaturalnessMode, naturalnessBlocksAcceptance, clampSeverity, applyAdaptations,
} from "../../supabase/functions/_shared/writers/naturalness";

describe("Naturalness Stage A", () => {
  it("defaults to off for existing and new books", () => {
    expect(resolveNaturalnessMode(undefined)).toBe("off");
    expect(resolveNaturalnessMode({})).toBe("off");
    expect(resolveNaturalnessMode({ naturalness: "strict" })).toBe("off");
    expect(resolveNaturalnessMode({ naturalness: "advise" })).toBe("advise");
  });
  it("stylistic findings never block acceptance", () => {
    expect(naturalnessBlocksAcceptance([{ category: "opening_recurrence", severity: "advisory", message: "x", evidence: {} }])).toBe(false);
  });
  it("severity cannot escalate to material", () => {
    expect(clampSeverity("critical")).toBe("advisory");
    expect(clampSeverity("info")).toBe("info");
  });
  it("adaptations never mutate the base writer profile", () => {
    const base = { id: "sophia", rhythm: 5 };
    const out = applyAdaptations(base, [
      { writerId: "sophia", dimension: "rhythm", adjustment: { rhythm: 7 }, status: "active" },
      { writerId: "sophia", dimension: "x", adjustment: {}, status: "reverted" },
    ]);
    expect(base).toEqual({ id: "sophia", rhythm: 5 });
    expect(out.adaptations).toHaveLength(1);
  });
});
