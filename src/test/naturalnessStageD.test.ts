import { describe, it, expect } from "vitest";
import {
  aggregateWeaknesses, proposeRecommendations, transferTechnique, compatibleWriters, clampOverlayToSliders,
  renderActiveOverlays, shouldExpire, confidenceOf, type LearningSignal,
} from "../../supabase/functions/_shared/writers/learning";
import { WRITER_PERSONAS } from "../../supabase/functions/_shared/writers/personas";
import { PROFILES } from "../../supabase/functions/_shared/writers/profiles";
import { MAX_ADJUST } from "../../supabase/functions/_shared/writers/sliders";

const W = WRITER_PERSONAS[0].id;
const sig = (o: Partial<LearningSignal>): LearningSignal => ({ userId: "u1", writerId: W, bookId: "b1", category: "opening_recurrence", kind: "finding", chapterIndex: 0, subsectionIndex: 0, sourceRef: Math.random().toString(), ...o });
const recurring = (extra: Partial<LearningSignal>[] = []) => [
  sig({ chapterIndex: 0, subsectionIndex: 0 }), sig({ chapterIndex: 0, subsectionIndex: 1 }), sig({ chapterIndex: 1, subsectionIndex: 0 }),
  ...extra.map(sig),
];

describe("Stage D continuous writer learning", () => {
  it("needs 3 sections across 2 chapters before a weakness is recurring", () => {
    expect(aggregateWeaknesses([sig({}), sig({ subsectionIndex: 1 })], "u1")[0].recurring).toBe(false);
    expect(aggregateWeaknesses(recurring(), "u1")[0].recurring).toBe(true);
  });

  it("findings alone never become a rule; an approved or proven signal is required", () => {
    expect(proposeRecommendations(recurring(), "u1")).toHaveLength(0);
    expect(proposeRecommendations(recurring([{ kind: "approved" }]), "u1")).toHaveLength(1);
  });

  it("detector-only signals never qualify and never count toward recurrence", () => {
    const det = Array.from({ length: 20 }, (_, i) => sig({ kind: "detector", chapterIndex: i, subsectionIndex: i }));
    expect(aggregateWeaknesses(det, "u1")[0].recurring).toBe(false);
    expect(proposeRecommendations(det, "u1")).toHaveLength(0);
  });

  it("an isolated false positive does not qualify even with an approval", () => {
    expect(proposeRecommendations([sig({}), sig({ kind: "approved" })], "u1")).toHaveLength(0);
  });

  it("rejections outweigh support and block the recommendation", () => {
    const s = recurring([{ kind: "approved" }, { kind: "rejected" }]);
    expect(proposeRecommendations(s, "u1")).toHaveLength(0);
    expect(shouldExpire(aggregateWeaknesses(s, "u1")[0])).toBe(true);
  });

  it("learning data is isolated per user", () => {
    const other = recurring([{ kind: "approved" }]).map((s) => ({ ...s, userId: "u2" }));
    expect(proposeRecommendations(other, "u1")).toHaveLength(0);
    expect(aggregateWeaknesses(other, "u1")).toHaveLength(0);
  });

  it("duplicate source refs are counted once", () => {
    const one = sig({ kind: "approved", sourceRef: "same" });
    const w = aggregateWeaknesses([...recurring(), one, { ...one }], "u1")[0];
    expect(w.approved).toBe(1);
    expect(confidenceOf(w)).toBeGreaterThan(0);
  });

  it("transfers only to compatible writers, keeps the target's own voice, lowers confidence", () => {
    const [rec] = proposeRecommendations(recurring([{ kind: "approved" }, { kind: "proven" }]), "u1");
    const target = compatibleWriters(W)[0];
    const t = transferTechnique(rec, target)!;
    expect(t.writerId).toBe(target);
    expect(t.sourceWriterId).toBe(W);
    expect(t.adjustment.directive).toMatch(/your own established voice/);
    expect(t.confidence).toBeLessThan(rec.confidence);
    expect(transferTechnique(t, W)).toBeNull(); // no chained transfers
  });

  it("slider nudges are clamped to the ±2 limit and unknown sliders are dropped", () => {
    expect(clampOverlayToSliders({ key: "sentenceVariation", delta: 5 })).toEqual({ key: "sentenceVariation", delta: MAX_ADJUST });
    expect(clampOverlayToSliders({ key: "sentenceVariation", delta: 1 }, 2)).toBeUndefined();
    expect(clampOverlayToSliders({ key: "nonexistent", delta: 1 })).toBeUndefined();
  });

  it("only active, pinned, unexpired overlays for this writer render; latest version per dimension", () => {
    const rows = [
      { id: "a", writer_id: W, dimension: "opening_variety", adjustment: { directive: "old" }, status: "active", version: 1 },
      { id: "b", writer_id: W, dimension: "opening_variety", adjustment: { directive: "new" }, status: "active", version: 2 },
      { id: "c", writer_id: W, dimension: "x", adjustment: { directive: "proposed" }, status: "proposed", version: 1 },
      { id: "d", writer_id: W, dimension: "y", adjustment: { directive: "expired" }, status: "active", version: 1, expires_at: "2000-01-01" },
      { id: "e", writer_id: "other", dimension: "z", adjustment: { directive: "other writer" }, status: "active", version: 1 },
    ];
    const out = renderActiveOverlays(rows, W);
    expect(out).toContain("new"); expect(out).not.toContain("old"); expect(out).not.toContain("proposed");
    expect(out).not.toContain("expired"); expect(out).not.toContain("other writer");
    expect(renderActiveOverlays(rows, W, ["a"])).toContain("old"); // book pinned to an older version
    expect(renderActiveOverlays(rows, W, [])).toBe("");
  });

  it("base writer personas and profiles are untouched by learning", () => {
    const before = JSON.stringify([WRITER_PERSONAS, PROFILES]);
    const recs = proposeRecommendations(recurring([{ kind: "approved" }]), "u1");
    recs.forEach((r) => compatibleWriters(r.writerId).forEach((t) => transferTechnique(r, t)));
    expect(JSON.stringify([WRITER_PERSONAS, PROFILES])).toBe(before);
    expect(Object.keys(PROFILES).length * 4).toBe(48);
  });
});
