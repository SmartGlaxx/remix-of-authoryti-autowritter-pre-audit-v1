import { describe, it, expect } from "vitest";
import { resolveIdentity, gateCreation, type KnownIdentity } from "../../supabase/functions/_shared/narrative/identityResolution";
import {
  parsePersonaOutput, mockPersonaModel, buildPersonaPrompt, checkLifeChronology, isDomain, isRole,
  type PersonaGenerationRequest,
} from "../../supabase/functions/_shared/narrative/personaGeneration";

const reg: KnownIdentity[] = [
  { id: "a", displayName: "Mara Quell", aliases: ["The Widow"], universeId: "U1" },
  { id: "b", displayName: "John Hale", aliases: [], universeId: "U1" },
  { id: "c", displayName: "Mara Quell", aliases: [], universeId: "U2" },
];

describe("authoritative identity resolution", () => {
  it("exact name in same universe needs confirmation, never auto-merges", () => {
    const r = resolveIdentity(reg, { displayName: "Mara Quell", universeId: "U1" });
    expect(r.status).toBe("EXACT_MATCH");
    expect(r.matches.map((m) => m.id)).toEqual(["a"]);
    expect(gateCreation(r).action).toBe("confirm");
  });
  it("other universes are never matched", () => {
    expect(resolveIdentity(reg, { displayName: "Mara Quell", universeId: "U3" }).status).toBe("NEW");
  });
  it("honorific variant is ambiguous, not new", () => {
    expect(resolveIdentity(reg, { displayName: "Dr. Mara", universeId: "U1" }).status).toBe("AMBIGUOUS");
  });
  it("alias match is detected", () => {
    expect(resolveIdentity(reg, { displayName: "The Widow", universeId: "U1" }).matches[0].reason).toBe("alias_match");
  });
  it("same first name, different surname = different people", () => {
    expect(resolveIdentity(reg, { displayName: "John Smith", universeId: "U1" }).status).toBe("NEW");
  });
  it("use_existing must name a matched id", () => {
    const r = resolveIdentity(reg, { displayName: "Mara Quell", universeId: "U1" });
    expect(gateCreation(r, "use_existing", "b").action).toBe("confirm");
    expect(gateCreation(r, "use_existing", "a")).toEqual({ action: "use_existing", id: "a" });
    expect(gateCreation(r, "create_distinct").action).toBe("create");
  });
});

describe("persona generation contract", () => {
  const req: PersonaGenerationRequest = {
    mode: "hybrid", domain: "finance", seed: "Hedge fund analyst",
    authorFacts: [{ field: "displayName", value: "Ada Brook" }, { field: "birthDate", value: { precision: "year", year: 1980 } }],
  };
  it("author facts are never overwritten by the model", () => {
    const out = parsePersonaOutput(mockPersonaModel(req), req);
    expect(out.ok).toBe(true);
    if (!out.ok) return;
    expect(out.draft.displayName).toBe("Ada Brook");
    expect(out.draft.suggestions.some((s) => s.field === "birthDate" || s.field === "displayName")).toBe(false);
    expect(out.draft.rejectedOverrides).toEqual(expect.arrayContaining(["displayName", "birthDate"]));
  });
  it("AI suggestions start as suggested, awaiting review", () => {
    const out = parsePersonaOutput(mockPersonaModel({ ...req, authorFacts: [] }), { ...req, authorFacts: [] });
    expect(out.ok && out.draft.suggestions.every((s) => s.status === "suggested")).toBe(true);
  });
  it("bad model output is rejected", () => {
    expect(parsePersonaOutput("not json", req)).toEqual({ ok: false, error: "INVALID_JSON" });
  });
  it("prompt carries author facts as fixed", () => {
    expect(buildPersonaPrompt(req).user).toContain("Ada Brook");
  });
  it("domains and roles are separate lists", () => {
    expect(isDomain("finance")).toBe(true);
    expect(isDomain("protagonist")).toBe(false);
    expect(isRole("protagonist")).toBe(true);
    expect(isRole("finance")).toBe(false);
  });
});

describe("life chronology back-check", () => {
  const y = (year: number) => ({ precision: "year" as const, year });
  it("death before birth is a violation", () => {
    expect(checkLifeChronology(y(1990), y(1980))).toEqual([{ key: "death", against: "birth", verdict: "violation" }]);
  });
  it("milestone before birth is a violation", () => {
    expect(checkLifeChronology(y(1990), null, [{ key: "graduated", date: y(1985) }])[0].verdict).toBe("violation");
  });
  it("valid life passes", () => {
    expect(checkLifeChronology(y(1960), y(2020), [{ key: "married", date: y(1990) }])).toEqual([]);
  });
});
