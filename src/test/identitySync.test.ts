import { describe, expect, it } from "vitest";
import { planIdentitySync, type Proposal } from "../../supabase/functions/_shared/narrative/identitySync.ts";
import type { RegistryEntity } from "../../supabase/functions/_shared/narrative/identity.ts";

const pos = { chapterIndex: 3, subsectionIndex: 1 };
const p = (name: string, extra: Partial<Proposal> = {}): Proposal => ({ key: name, name, kind: "person", attribute: "role", value: "friend", evidence: "named in text", outline: false, ...extra });
const john = (id: string, role: string, authority: "OUTLINE_CANON" | "AI_INFERENCE" = "OUTLINE_CANON"): RegistryEntity => ({ id, kind: "person", name: "John", aliases: [], introducedAt: { chapterIndex: 0, subsectionIndex: 0 }, history: { role: [{ value: role, effectiveAt: { chapterIndex: 0, subsectionIndex: 0 }, source: "outline", authority, evidence: "outline", sourceSectionKey: "0:0" }] } });

describe("Phase 2D identity sync", () => {
  it("creates a genuinely new person once, even if proposed twice in one section", () => {
    const plan = planIdentitySync([], [p("Maya"), p("Maya")], pos);
    expect(plan.create).toHaveLength(1);
    expect(plan.create[0].introducedPosition).toBe(30001);
  });

  it("never gives an id when two people share the name (refuses to guess)", () => {
    const plan = planIdentitySync([john("a", "mentor"), john("b", "brother")], [p("John")], pos);
    expect(plan.create).toHaveLength(0);
    expect(plan.changes).toHaveLength(0);
    expect(plan.skipped[0].classification).toBe("AMBIGUOUS");
  });

  it("generated text cannot overwrite an outline role", () => {
    const plan = planIdentitySync([john("a", "mentor")], [p("John", { value: "friend" })], pos);
    expect(plan.changes).toHaveLength(0);
    expect(plan.skipped[0].classification).toBe("LOWER_AUTHORITY");
  });

  it("links an existing person and records new generated detail", () => {
    const plan = planIdentitySync([john("a", "friend", "AI_INFERENCE")], [p("John", { value: "business partner" })], pos);
    expect(plan.create).toHaveLength(0);
    expect(plan.changes[0]).toMatchObject({ entity_key: "a", value: "business partner", authority: "AI_INFERENCE" });
  });
});
