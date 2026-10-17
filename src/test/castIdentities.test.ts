import { describe, it, expect } from "vitest";
import { planCastIdentities, baseName } from "../../supabase/functions/_shared/narrative/castIdentities";
import { planKnowledgeWrites } from "../../supabase/functions/_shared/narrative/knowledge";

const item = { character: "Kiera Vance", claim: "The beacon is a trap", kind: "fact", source: "observed", truth: "true" } as any;

describe("planned cast is never 'Characters to confirm'", () => {
  it("strips descriptive brackets", () => expect(baseName("Kiera Vance (recorded voice)")).toBe("Kiera Vance"));

  it("creates one identity for a cast member and their bracketed variant", () => {
    const p = planCastIdentities([{ id: "a", name: "Kiera Vance" }, { id: "b", name: "Kiera Vance (recorded voice)" }], []);
    expect(p.create).toHaveLength(1);
    expect(p.links.map((l) => l.target)).toEqual(["new:kiera vance", "new:kiera vance"]);
  });

  it("reuses an existing identity of this book instead of duplicating", () => {
    const p = planCastIdentities([{ id: "a", name: "Jax" }], [{ id: "id1", displayName: "Jax", aliases: [], universeId: null }]);
    expect(p.create).toHaveLength(0);
    expect(p.links[0].target).toBe("id1");
  });

  it("leaves already-linked cast untouched", () => {
    expect(planCastIdentities([{ id: "a", name: "Jax", narrative_identity_id: "x" }], []).links).toHaveLength(0);
  });

  it("knowledge for a planned character resolves instead of creating a review", () => {
    const before = planKnowledgeWrites([item], { identities: [], universeId: null, bookId: "b", chapterIndex: 0, subsectionIndex: 1, contentHash: "h" });
    expect(before.reviews).toHaveLength(1);
    const after = planKnowledgeWrites([item], { identities: [{ id: "k1", displayName: "Kiera Vance", aliases: [], universeId: null }], universeId: null, bookId: "b", chapterIndex: 0, subsectionIndex: 1, contentHash: "h" });
    expect(after.reviews).toHaveLength(0);
    expect(after.rows[0].identity_id).toBe("k1");
  });

  it("a genuinely unplanned name still goes to review", () => {
    const r = planKnowledgeWrites([{ ...item, character: "Mrs. Finch" }], { identities: [{ id: "k1", displayName: "Kiera Vance", aliases: [], universeId: null }], universeId: null, bookId: "b", chapterIndex: 0, subsectionIndex: 1, contentHash: "h" });
    expect(r.reviews).toHaveLength(1);
  });
});
