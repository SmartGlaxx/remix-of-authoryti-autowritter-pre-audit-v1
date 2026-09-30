import { describe, it, expect } from "vitest";
import { calibrateSeverity, deduplicateFindings, type ValidatedFinding } from "../../supabase/functions/_shared/narrative/audit";

const base = (o: Partial<ValidatedFinding>): ValidatedFinding => ({
  category: "nonfiction_consistency", severity: "HIGH", confidence: 0.9, title: "t", description: "", evidenceExcerpt: "ex",
  contradictingExcerpt: null, contradictingEvidence: null, explanation: "", suggestedAction: "",
  related: { facts: [], events: [], characters: [], threads: [], checks: [] },
  evidenceLocation: { chapterIndex: 0, subsectionIndex: 0 } as never, contradictingLocation: null,
  verification: "VERIFIED", userCanonProtected: false, dedupKey: Math.random().toString(), ...o,
} as ValidatedFinding);

describe("Pass 5 severity calibration", () => {
  it("CRITICAL without two-sided proof drops to HIGH", () => expect(calibrateSeverity(base({ severity: "CRITICAL" })).severity).toBe("HIGH"));
  it("CRITICAL with low confidence drops to HIGH", () => expect(calibrateSeverity(base({ severity: "CRITICAL", confidence: 0.7, contradictingLocation: { chapterIndex: 1, subsectionIndex: 0 } as never })).severity).toBe("HIGH"));
  it("well-proven CRITICAL stays", () => expect(calibrateSeverity(base({ severity: "CRITICAL", contradictingLocation: { chapterIndex: 1, subsectionIndex: 0 } as never })).severity).toBe("CRITICAL"));
  it("low-confidence HIGH → MEDIUM", () => expect(calibrateSeverity(base({ confidence: 0.5 })).severity).toBe("MEDIUM"));
  it("UNCERTAIN caps at MEDIUM", () => expect(calibrateSeverity(base({ verification: "UNCERTAIN" })).severity).toBe("MEDIUM"));
  it("never inflates", () => expect(calibrateSeverity(base({ severity: "LOW" })).severity).toBe("LOW"));
});

describe("Pass 5 cross-stage dedup by passage pair", () => {
  it("same statistic clash quoted differently by two stages merges into one", () => {
    const a = base({ category: "nonfiction_consistency", title: "Statistic changes 40% vs 70%", evidenceExcerpt: "about 40% of people quit", contradictingLocation: { chapterIndex: 2, subsectionIndex: 1 } as never });
    const b = base({ category: "canonical_fact", title: "40% figure contradicted by 70%", evidenceExcerpt: "people quit within weeks, 40%", evidenceLocation: { chapterIndex: 2, subsectionIndex: 1 } as never, contradictingLocation: { chapterIndex: 0, subsectionIndex: 0 } as never });
    expect(deduplicateFindings([a, b])).toHaveLength(1);
  });
  it("different problems between the same sections stay separate", () => {
    const a = base({ title: "Steps 4 vs 5", evidenceExcerpt: "four steps", contradictingLocation: { chapterIndex: 2, subsectionIndex: 1 } as never });
    const b = base({ title: "Statistic 40% vs 70%", evidenceExcerpt: "40% of people", contradictingLocation: { chapterIndex: 2, subsectionIndex: 1 } as never });
    expect(deduplicateFindings([a, b])).toHaveLength(2);
  });
});

import { applyConsolidation } from "../../supabase/functions/_shared/narrative/audit";
describe("Pass 5 semantic consolidation (group-only)", () => {
  const f = (t: string, sev: "HIGH" | "MEDIUM") => base({ title: t, severity: sev, dedupKey: t });
  const list = [f("Dana profession changes", "HIGH"), f("Marcus profession changes", "MEDIUM"), f("Billing rate differs", "MEDIUM")];
  it("merges a proposed group, keeps the strongest, records the others", () => {
    const out = applyConsolidation(list, '{"groups":[[0,1]]}');
    expect(out).toHaveLength(2); expect(out[0].title).toBe("Dana profession changes"); expect(out[0].explanation).toContain("Marcus");
  });
  it("ignores invalid, out-of-range and overlapping indexes", () => {
    expect(applyConsolidation(list, '{"groups":[[0,9],[1,1]]}')).toHaveLength(3);
    expect(applyConsolidation(list, "garbage")).toHaveLength(3);
  });
  it("never invents findings", () => expect(applyConsolidation(list, '{"groups":[[0,1,2]]}')).toHaveLength(1));
});
