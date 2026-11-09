import { describe, it, expect } from "vitest";
import { findUnplannedNames, renderBlueprintBrief, blueprintKnownNames } from "../../supabase/functions/_shared/narrative/planning/closedWorld";

const bp: any = {
  objective: "Mara confronts Tom", cast: [{ id: "c1", name: "Mara Quinn" }, { id: "c2", name: "Tom Hale" }],
  locations: [{ id: "l1", name: "Harbor Street" }], events: [],
  microbeats: [{ id: "b1", sectionId: "0", order: 1, text: "Mara waits", characterIds: ["c1"], locationId: "l1" },
               { id: "b2", sectionId: "1", order: 1, text: "Tom arrives", characterIds: ["c2"], locationId: "l1" }],
};

describe("closed-world writing", () => {
  it("brief lists only this section's beats", () => {
    const t = renderBlueprintBrief(bp, 1);
    expect(t).toContain("Tom arrives");
    expect(t).not.toContain("Mara waits");
  });
  it("flags a repeated unplanned name", () => {
    const f = findUnplannedNames("Mara saw that Kiera was late. Then she called for Kiera again.", blueprintKnownNames(bp));
    expect(f.map((x) => x.excerpt)).toEqual(["Kiera"]);
  });
  it("does not flag planned names or sentence starts", () => {
    expect(findUnplannedNames("Mara met Tom on Harbor Street. Later, Tom left. Quinn smiled at Hale.", blueprintKnownNames(bp))).toEqual([]);
  });
});

import { amendBlueprint, universeCollisions, appearanceContradictions, reentryFinding, deadlineFindings, titleThemeLock } from "../../supabase/functions/_shared/narrative/planning/closedWorld";

describe("stage 5 amendments and emergent characters", () => {
  const base: any = { cast: [{ id: "c1", name: "Mara Quinn" }], castProposals: [], locations: [], events: [], microbeats: [] };
  it("adds a person as a cast proposal in a new copy with a log", () => {
    const n = amendBlueprint(base, [{ kind: "person", name: "Kiera Vance", reason: "appeared" }], 2, "t");
    expect(n.castProposals.map((p) => p.name)).toEqual(["Kiera Vance"]);
    expect(n.amendments[0].fromVersion).toBe(2);
    expect(base.castProposals).toEqual([]);
  });
  it("skips people already in the cast", () => {
    expect(amendBlueprint(base, [{ kind: "person", name: "mara quinn", reason: "" }], 1).castProposals).toEqual([]);
  });
  it("finds same-universe name collisions", () => {
    expect(universeCollisions("Kiera Vance", [{ name: "Kiera Vance", bookTitle: "Book One" }, { name: "Tom" }])).toEqual(["Kiera Vance (Book One)"]);
  });
});

describe("appearance, re-entry, deadlines, title", () => {
  const look = { name: "Mara Quinn", features: { eyes: "green eyes", hair: "short auburn hair" }, locked: true };
  it("flags a contradicting eye colour", () => {
    expect(appearanceContradictions("Mara looked up with blue eyes.", [look])[0].code).toBe("APPEARANCE_CONTRADICTION");
  });
  it("accepts the locked colour", () => {
    expect(appearanceContradictions("Mara blinked her green eyes.", [look])).toEqual([]);
  });
  it("flags too few re-entry cues", () => {
    expect(reentryFinding("Mara walked in.", look, [2, 3])[0].code).toBe("REENTRY_CUES_LOW");
    expect(reentryFinding("Mara walked in, green eyes narrowed, short auburn hair wet.", look, [2, 3])).toEqual([]);
  });
  it("flags a passed unresolved deadline only", () => {
    expect(deadlineFindings([{ name: "Ransom", due: "1999-06-01" }, { name: "Trial", due: "1999-06-01", resolved: true }], "1999-06-05").map((f) => f.message.slice(1, 7))).toEqual(["Ransom"]);
  });
  it("title lock names the title", () => {
    expect(titleThemeLock("Salt Road")).toContain('"Salt Road"');
  });
});
