import { describe, expect, it } from "vitest";
import { blueprintApprovalIssues, blueprintGate, bulkApprovableIds, pendingCastProposals, resolveBlueprintMode, type ChapterBlueprint } from "../../supabase/functions/_shared/narrative/planning/blueprint.ts";

const cast = [{ id: "c1", name: "Kiera Vance", aliases: ["Kiera"] }];
const bp = (props: { id: string; name: string }[] = []) => ({ castProposals: props.map((p) => ({ ...p, role: "r", justification: "j" })) }) as unknown as ChapterBlueprint;

describe("Stage 2 completion — authority loopholes", () => {
  it("self-help Reader and Bill payer roles do not need story identities", () => {
    const roles = bp([{ id: "p0", name: "Bill payer" }, { id: "p1", name: "Reader" }]);
    expect(pendingCastProposals(roles, [], "self_help")).toEqual([]);
    expect(blueprintApprovalIssues(roles, [], "self_help")).toEqual([]);
    expect(blueprintGate("required", [{ id: "r", plan_status: "READY", content: { blueprint: roles } }], 0, [], "self_help").ok).toBe(true);
    expect(blueprintGate("required", [], 0, [], "self_help")).toMatchObject({ ok: false, code: "BLUEPRINT_REQUIRED" });
  });
  it("named nonfiction people still need approval", () => {
    expect(blueprintApprovalIssues(bp([{ id: "p0", name: "Omar Reyes" }]), [], "self_help")).toHaveLength(1);
  });
  it("fiction, memoir and unknown adapters never bypass person approval", () => {
    for (const adapter of ["fiction", "children", "narrative_nonfiction", "unknown", undefined]) {
      expect(blueprintApprovalIssues(bp([{ id: "p0", name: "Reader" }]), [], adapter)).toHaveLength(1);
    }
  });
  it("a proposed new person is not authorized by being listed", () => {
    expect(pendingCastProposals(bp([{ id: "p0", name: "Omar Reyes" }]), cast)).toHaveLength(1);
    expect(blueprintApprovalIssues(bp([{ id: "p0", name: "Omar Reyes" }]), cast)[0]).toMatch(/Omar Reyes/);
  });
  it("once registered in the cast, the proposal no longer blocks approval", () => {
    expect(blueprintApprovalIssues(bp([{ id: "p0", name: "Omar Reyes" }]), [...cast, { id: "c2", name: "Omar Reyes" }])).toEqual([]);
  });
  it("bulk approve never includes blueprints", () => {
    expect(bulkApprovableIds([{ id: "a", plan_status: "PLANNED", plan_level: "SECTION" }, { id: "b", plan_status: "PLANNED", plan_level: "BLUEPRINT" }, { id: "c", plan_status: "READY", plan_level: "CHAPTER" }])).toEqual(["a"]);
  });
  it("blueprints are required only for opted-in progressive books", () => {
    expect(resolveBlueprintMode({ planning_pipeline: "progressive", blueprint_mode: "required" })).toBe("required");
    expect(resolveBlueprintMode({ planning_pipeline: "progressive" })).toBe("off");
    expect(resolveBlueprintMode({ blueprint_mode: "required" })).toBe("off");
  });
  it("writing gate: no approved blueprint stops writing", () => {
    expect(blueprintGate("required", [{ id: "x", plan_status: "PLANNED", content: { blueprint: bp() } }], 0, cast)).toMatchObject({ ok: false, code: "BLUEPRINT_REQUIRED" });
  });
  it("writing gate: unregistered proposal in an approved blueprint stops writing", () => {
    expect(blueprintGate("required", [{ id: "x", plan_status: "READY", version: 1, content: { blueprint: bp([{ id: "p0", name: "Omar" }]) } }], 0, cast)).toMatchObject({ ok: false, code: "CAST_APPROVAL_REQUIRED" });
  });
  it("writing gate uses the latest approved version and passes when complete", () => {
    const g = blueprintGate("required", [{ id: "v1", plan_status: "READY", version: 1, content: { blueprint: bp() } }, { id: "v2", plan_status: "READY", version: 2, content: { blueprint: bp() } }], 0, cast);
    expect(g).toMatchObject({ ok: true, planId: "v2", version: 2 });
  });
  it("older books and Standard books are not gated", () => {
    expect(blueprintGate("off", [], 0, []).ok).toBe(true);
  });
});
