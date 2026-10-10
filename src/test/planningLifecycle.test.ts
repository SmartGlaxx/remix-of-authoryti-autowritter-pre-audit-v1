import { describe, it, expect } from "vitest";
import {
  canTransitionMaster, canTransitionPlan, canTransitionManuscript,
  isMasterContentFrozen, isPlanContentFrozen, countsAsCanon, generationGate,
} from "../../supabase/functions/_shared/narrative/planning/lifecycle";

describe("progressive planning lifecycle", () => {
  it("approved master plan cannot return to draft", () => {
    expect(canTransitionMaster("APPROVED", "DRAFT")).toBe(false);
    expect(canTransitionMaster("APPROVED", "SUPERSEDED")).toBe(true);
  });
  it("superseded plans are terminal", () => {
    expect(canTransitionPlan("SUPERSEDED", "READY")).toBe(false);
    expect(canTransitionMaster("SUPERSEDED", "APPROVED")).toBe(false);
  });
  it("ready plan cannot go back to planned", () => {
    expect(canTransitionPlan("READY", "PLANNED")).toBe(false);
  });
  it("content freezes once approved/ready", () => {
    expect(isMasterContentFrozen("DRAFT")).toBe(false);
    expect(isMasterContentFrozen("APPROVED")).toBe(true);
    expect(isPlanContentFrozen("READY")).toBe(true);
  });
  it("drafted prose cannot skip acceptance", () => {
    expect(canTransitionManuscript("DRAFTED", "ESTABLISHED")).toBe(false);
  });
  it("prose is canon only after extraction", () => {
    expect(countsAsCanon("ACCEPTED", "PENDING_EXTRACTION")).toBe(false);
    expect(countsAsCanon("DRAFTED", "EXTRACTED")).toBe(false);
    expect(countsAsCanon("ESTABLISHED", "EXTRACTED")).toBe(true);
  });
  it("blocks next section while previous extraction is pending", () => {
    expect(generationGate({ manuscript: "ACCEPTED", extraction: "PENDING_EXTRACTION" })).toMatchObject({ ok: false, action: "recover_extraction" });
    expect(generationGate({ manuscript: "DRAFTED", extraction: "NOT_STARTED" })).toMatchObject({ ok: false, action: "await_acceptance" });
    expect(generationGate({ manuscript: "ESTABLISHED", extraction: "EXTRACTED" })).toEqual({ ok: true });
    expect(generationGate(null)).toEqual({ ok: true });
  });
});
