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
