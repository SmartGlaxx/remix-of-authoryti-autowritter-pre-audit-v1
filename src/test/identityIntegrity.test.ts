import { describe, it, expect } from "vitest";
import {
  resolveReference, attributeAt, commitChange, undoSection, gateDecision, registryAt,
  type RegistryEntity, type VersionedValue,
} from "../../supabase/functions/_shared/narrative/identity";

const P = (c: number, s = 0) => ({ chapterIndex: c, subsectionIndex: s });
const v = (value: string, c: number, key = `s${c}`, authority: VersionedValue["authority"] = "APPROVED_GENERATED_STATE"): VersionedValue =>
  ({ value, effectiveAt: P(c), source: `ch${c}`, authority, evidence: "text", sourceSectionKey: key });

const john1: RegistryEntity = { id: "p1", kind: "person", name: "John", aliases: ["Johnny"], introducedAt: P(1),
  history: { relationship: [v("michael's childhood friend", 2), v("michael's mentor", 18)], occupation: [v("carpenter", 1)], location: [v("leeds", 1)] } };
const john2: RegistryEntity = { id: "p2", kind: "person", name: "John", aliases: [], introducedAt: P(4),
  history: { occupation: [v("detective", 4)], location: [v("london", 4)] } };
const acme: RegistryEntity = { id: "o1", kind: "organization", name: "Acme Corp", aliases: [], introducedAt: P(1), history: { description: [v("logistics firm", 1)] } };
const api: RegistryEntity = { id: "a1", kind: "artifact", name: "fetchUser", aliases: [], introducedAt: P(2), history: { signature: [v("fetchUser(id: string): User", 2)], version: [v("v2", 2)] } };
const recipe: RegistryEntity = { id: "r1", kind: "recipe", name: "Basic Bread", aliases: [], introducedAt: P(1), history: { quantity: [v("500", 1)], unit: [v("g", 1)] } };
const sarah: RegistryEntity = { id: "c1", kind: "person", name: "Sarah Lin", aliases: ["Sarah"], introducedAt: P(1), history: { occupation: [v("bakery owner", 1)] } };
const reg = [john1, john2, acme, api, recipe, sarah];

describe("Phase 2B — 15 identity acceptance scenarios", () => {
  it("1 same person/name → one id", () => {
    expect(resolveReference([john1], { surface: "John", material: true }, P(3)).entityId).toBe("p1");
  });
  it("2 verified alias → that id", () => {
    const r = resolveReference(reg, { surface: "Johnny", material: true }, P(5));
    expect(r.classification).toBe("ALIAS"); expect(r.entityId).toBe("p1");
  });
  it("3 two legitimate Johns stay distinct with evidence", () => {
    const r = resolveReference(reg, { surface: "John", attributes: { occupation: "detective" }, material: true }, P(6));
    expect(r.entityId).toBe("p2");
  });
  it("4 unexplained role shift is a blocking conflict", () => {
    const r = resolveReference([john1], { surface: "John", attributes: { occupation: "surgeon" }, material: true }, P(5));
    expect(r.classification).toBe("CONFLICT"); expect(r.severity).toBe("BLOCK");
  });
  it("5 deliberate reveal accepted only with explicit evidence", () => {
    const r = resolveReference([john1], { surface: "John", attributes: { occupation: "spy" }, revealEvidence: "'I was never a carpenter,' John admitted.", material: true }, P(9));
    expect(r.severity).toBe("OK"); expect(r.conflicts.length).toBe(1);
  });
  it("6 paraphrase is not resolved by similarity alone", () => {
    const weak = resolveReference(reg, { surface: "Michael's childhood companion", kind: "person", attributes: { relationship: "michael's childhood friend" }, material: true }, P(5));
    expect(weak.entityId).toBeNull();
    const strong = resolveReference(reg, { surface: "Michael's childhood companion", kind: "person", attributes: { relationship: "michael's childhood friend", location: "leeds" }, material: true }, P(5));
    expect(strong.entityId).toBe("p1");
  });
  it("7 ambiguous John with two candidates blocks when material, warns otherwise", () => {
    expect(resolveReference(reg, { surface: "John", material: true }, P(6))).toMatchObject({ classification: "AMBIGUOUS", entityId: null, severity: "BLOCK" });
    expect(resolveReference(reg, { surface: "John", material: false }, P(6)).severity).toBe("WARNING");
  });
  it("8 chapter-1 character retrievable in chapter 31", () => {
    expect(resolveReference(reg, { surface: "Sarah Lin", material: true }, P(31)).entityId).toBe("c1");
  });
  it("9 dormant return keeps historically correct state (no future leakage)", () => {
    expect(attributeAt(john1, "relationship", P(10))).toBe("michael's childhood friend");
    expect(registryAt(reg, P(3)).some((e) => e.id === "p2")).toBe(false);
  });
  it("10 relationship differs before/after its change", () => {
    expect(attributeAt(john1, "relationship", P(17))).toBe("michael's childhood friend");
    expect(attributeAt(john1, "relationship", P(18))).toBe("michael's mentor");
  });
  it("11 recurring nonfiction case-study person keeps identity", () => {
    expect(resolveReference(reg, { surface: "Sarah", attributes: { occupation: "bakery owner" }, material: true }, P(12)).entityId).toBe("c1");
  });
  it("12 company variant needs evidence", () => {
    const bare = resolveReference(reg, { surface: "Acme Inc", kind: "organization", material: true }, P(3));
    expect(bare.classification).toBe("POSSIBLE_DUPLICATE"); expect(bare.entityId).toBeNull();
  });
  it("13 later API signature conflict detected", () => {
    const r = resolveReference(reg, { surface: "fetchUser", attributes: { signature: "fetchUser(id: number): User" }, material: true }, P(7));
    expect(r.classification).toBe("CONFLICT");
  });
  it("14 cookbook unit clash detected", () => {
    expect(resolveReference(reg, { surface: "Basic Bread", attributes: { unit: "cups" }, material: true }, P(2)).classification).toBe("CONFLICT");
  });
  it("15 regeneration: idempotent commit and section undo without touching user canon", () => {
    const c = { entityId: "p1", attribute: "location" as const, value: "york", at: P(5), source: "ch5", authority: "APPROVED_GENERATED_STATE" as const, evidence: "moved to York", sourceSectionKey: "s5" };
    const once = commitChange(reg, c);
    const twice = commitChange(once, c);
    expect(twice.find((e) => e.id === "p1")!.history.location!.length).toBe(2);
    const undone = undoSection(twice, "s5");
    expect(attributeAt(undone.find((e) => e.id === "p1")!, "location", P(6))).toBe("leeds");
  });
});

describe("Phase 2B — invariants", () => {
  it("new entity only after duplicate exclusion, never auto-assigned an id", () => {
    const r = resolveReference(reg, { surface: "Priya Natarajan", kind: "person", material: true }, P(5));
    expect(r).toMatchObject({ classification: "NEW_ENTITY", entityId: null });
  });
  it("commits require provenance and cannot override user canon", () => {
    const base: RegistryEntity[] = [{ ...sarah, history: { occupation: [v("bakery owner", 1, "u", "USER_CANON")] } }];
    expect(() => commitChange(base, { entityId: "c1", attribute: "occupation", value: "chef", at: P(3), source: "", authority: "AI_INFERENCE", evidence: "", sourceSectionKey: "s3" })).toThrow();
    expect(() => commitChange(base, { entityId: "c1", attribute: "occupation", value: "chef", at: P(3), source: "ch3", authority: "AI_INFERENCE", evidence: "x", sourceSectionKey: "s3" })).toThrow();
  });
  it("gate takes the worst severity", () => {
    expect(gateDecision([{ severity: "OK" }, { severity: "BLOCK" }, { severity: "WARNING" }] as never)).toBe("BLOCK");
  });
});
