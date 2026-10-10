import { describe, it, expect } from "vitest";
import {
  ageAt, checkOrder, checkStatedAge, validateMilestones, narratorAccess, toInterval,
  type KnowledgeRecord,
} from "../../supabase/functions/_shared/narrative/chronology";
import {
  promoteIdentity, relationshipAllowed, relationshipsFor, assertEntityKind,
  type NarrativeIdentity, type Relationship,
} from "../../supabase/functions/_shared/narrative/personaIdentity";

const exact = (year: number, month: number, day: number) => ({ precision: "exact" as const, year, month, day });
const yr = (year: number) => ({ precision: "year" as const, year });

describe("age calculation", () => {
  it("respects month and day around a birthday", () => {
    const birth = exact(1980, 4, 15);
    expect(ageAt(birth, exact(2000, 4, 14))).toMatchObject({ minAge: 19, maxAge: 19, exact: true });
    expect(ageAt(birth, exact(2000, 4, 15))).toMatchObject({ minAge: 20, maxAge: 20, exact: true });
  });
  it("gives a bounded range for a year-only birth", () => {
    expect(ageAt(yr(1980), exact(2000, 6, 1))).toMatchObject({ minAge: 19, maxAge: 20, exact: false });
  });
  it("gives a wider range for an approximate birth (~1980, ±2)", () => {
    expect(ageAt({ precision: "approximate", year: 1980 }, exact(1995, 6, 1))).toMatchObject({ minAge: 12, maxAge: 17 });
  });
  it("unknown birth gives unknown age, never a guess", () => {
    expect(ageAt({ precision: "unknown" }, exact(2000, 1, 1)).known).toBe(false);
  });
  it("stated age: exact mismatch is a violation, uncertain range is review", () => {
    expect(checkStatedAge(25, exact(1980, 4, 15), exact(2000, 5, 1))).toBe("violation");
    expect(checkStatedAge(20, exact(1980, 4, 15), exact(2000, 5, 1))).toBe("ok");
    expect(checkStatedAge(20, yr(1980), exact(2000, 6, 1))).toBe("uncertain");
  });
});

describe("chronological order", () => {
  it("cannot retire in 2001 from a job started in 2002", () => {
    const f = validateMilestones([
      { key: "employment_start", date: yr(2002) },
      { key: "retirement", date: yr(2001), requires: ["employment_start"] },
    ]);
    expect(f).toEqual([{ key: "retirement", requires: "employment_start", verdict: "violation" }]);
  });
  it("overlapping uncertain dates are review, not a block", () => {
    expect(checkOrder(yr(2002), exact(2002, 3, 1))).toBe("uncertain");
    expect(checkOrder(exact(2002, 1, 1), exact(2002, 3, 1))).toBe("ok");
  });
  it("disputed dates widen to cover every claim", () => {
    const i = toInterval({ precision: "disputed", disputedClaims: [
      { claim: yr(1998), claimType: "memory" }, { claim: yr(1997), claimType: "belief" },
    ] })!;
    expect(i.earliest.year).toBe(1997);
    expect(i.latest.year).toBe(1998);
  });
});

describe("narrator knowledge: event vs learning vs telling", () => {
  // Father died in 2001 but Sammy only learned it in 2010.
  const rec: KnowledgeRecord = { claim: "father died", identityId: "sammy", learned: { date: yr(2010) }, certainty: "certain" };
  it("immediate narration in 2005 cannot know it", () => {
    expect(narratorAccess(rec, { date: yr(2005) }, "immediate")).toEqual({ inScene: "no", hindsight: "no" });
  });
  it("retrospective narration from 2025 may use it as hindsight, not as in-scene knowledge", () => {
    expect(narratorAccess(rec, { date: yr(2005) }, "retrospective", { date: yr(2025) }))
      .toEqual({ inScene: "no", hindsight: "yes" });
  });
  it("knowledge learned before the scene is available in scene", () => {
    expect(narratorAccess(rec, { date: yr(2012) }, "immediate").inScene).toBe("yes");
  });
  it("superseded beliefs stop being current", () => {
    const belief: KnowledgeRecord = { ...rec, claim: "father is dead", learned: { date: yr(2010) }, superseded: { date: yr(2015) }, certainty: "false_belief" };
    expect(narratorAccess(belief, { date: yr(2016) }, "immediate").inScene).toBe("no");
    expect(narratorAccess(belief, { date: yr(2012) }, "immediate").inScene).toBe("yes");
  });
  it("falls back to manuscript position when dates are missing", () => {
    const r: KnowledgeRecord = { ...rec, learned: { chapterIndex: 5 } };
    expect(narratorAccess(r, { chapterIndex: 3 }, "immediate").inScene).toBe("no");
    expect(narratorAccess(r, { chapterIndex: 6 }, "immediate").inScene).toBe("yes");
  });
});

describe("stable identity and relationships", () => {
  const sammy: NarrativeIdentity = { id: "s", userId: "u", universeId: "U1", displayName: "Sammy", aliases: [], level: "story_character" };
  const father: NarrativeIdentity = { id: "f", userId: "u", universeId: "U1", displayName: "Sammy's father", aliases: [], level: "mentioned" };
  const rels: Relationship[] = [{ id: "r1", subjectIdentityId: "f", targetIdentityId: "s", universeId: "U1", type: "parent" }];

  it("relationships work before either side is a full persona", () => {
    expect(relationshipAllowed(father, sammy, "U1")).toEqual({ ok: true });
  });
  it("promotion keeps the id and every relationship", () => {
    const promoted = promoteIdentity(sammy, "independent_persona");
    expect(promoted.id).toBe("s");
    expect(relationshipsFor(promoted.id, rels)).toHaveLength(1);
  });
  it("promotion never demotes", () => {
    expect(() => promoteIdentity({ ...sammy, level: "independent_persona" }, "seed")).toThrow("PROMOTION_MUST_NOT_DEMOTE");
  });
  it("universes are isolated", () => {
    expect(relationshipAllowed(sammy, { ...father, universeId: "U2" }, "U1")).toMatchObject({ ok: false });
  });
  it("a pen name is never a fictional identity", () => {
    expect(() => assertEntityKind("pen_name", "narrative_identity")).toThrow("ENTITY_KIND_MISMATCH");
  });
});
