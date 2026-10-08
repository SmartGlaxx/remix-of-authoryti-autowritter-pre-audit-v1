// Phase 2C adversarial gates. Each gate checks the decision AND the resulting state.
// "State" here = the registry after the persistence harness acts on the decision:
// only OK resolutions/plans may mutate; everything else must leave state byte-identical.
// Real-DB atomicity of batches is proven separately against commit_identity_batch.
import { describe, it, expect } from "vitest";
import {
  resolveReference, attributeAt, commitChange, undoSection, registryAt, planBatch, arbitrateModels, idempotencyKey,
  type RegistryEntity, type VersionedValue, type Resolution, type Commit, type Reference,
} from "../../supabase/functions/_shared/narrative/identity";

const P = (c: number, s = 0) => ({ chapterIndex: c, subsectionIndex: s });
const v = (value: string, c: number, key = `s${c}`, authority: VersionedValue["authority"] = "APPROVED_GENERATED_STATE"): VersionedValue =>
  ({ value, effectiveAt: P(c), source: `ch${c}`, authority, evidence: "text", sourceSectionKey: key });
const snap = (r: readonly RegistryEntity[]) => JSON.stringify(r);

/** Persistence harness: applies a proposed commit only when the decision is OK and names an id. */
function persist(reg: RegistryEntity[], res: Resolution, c?: Omit<Commit, "entityId">): RegistryEntity[] {
  if (res.severity !== "OK" || !res.entityId || !c) return reg;
  return commitChange(reg, { ...c, entityId: res.entityId });
}
function decideAndPersist(reg: RegistryEntity[], ref: Reference, at: ReturnType<typeof P>, c?: Omit<Commit, "entityId">) {
  const res = resolveReference(reg, ref, at);
  return { res, after: persist(reg, res, c) };
}

const david = (): RegistryEntity => ({ id: "d1", kind: "person", name: "David", aliases: [], introducedAt: P(1),
  history: { occupation: [v("cfo", 1, "u", "USER_CANON")], location: [v("toronto", 1)], description: [v("45 years old", 1)] } });
const david2 = (): RegistryEntity => ({ id: "d2", kind: "person", name: "David", aliases: [], introducedAt: P(3),
  history: { occupation: [v("teacher", 3)], location: [v("vancouver", 3)] } });
const commitAt = (attr: Commit["attribute"], value: string, c: number, authority: Commit["authority"] = "APPROVED_GENERATED_STATE") =>
  ({ attribute: attr, value, at: P(c), source: `ch${c}`, authority, evidence: "stated in text", sourceSectionKey: `s${c}` });

describe("Phase 2C — 15 adversarial gates (decision + state)", () => {
  it("1 gradual evidence: same-name Davids resolve only with independent, conflict-free evidence", () => {
    const reg = [david(), david2()];
    const bare = decideAndPersist(reg, { surface: "David", material: true }, P(5), commitAt("role", "witness", 5));
    expect(bare.res).toMatchObject({ classification: "AMBIGUOUS", entityId: null, severity: "BLOCK" });
    expect(snap(bare.after)).toBe(snap(reg));
    const strong = decideAndPersist(reg, { surface: "David", attributes: { occupation: "teacher", location: "vancouver" }, material: true }, P(5), commitAt("role", "witness", 5));
    expect(strong.res.entityId).toBe("d2");
    expect(attributeAt(strong.after.find((e) => e.id === "d2")!, "role", P(5))).toBe("witness");
    expect(strong.after.find((e) => e.id === "d1")!.history.role).toBeUndefined();
  });

  it("2 same name + contradictory attributes → CONFLICT/BLOCK, no second David", () => {
    const reg = [david()];
    const r = decideAndPersist(reg, { surface: "David", attributes: { occupation: "teacher", location: "vancouver" }, material: true }, P(6), commitAt("occupation", "teacher", 6));
    expect(r.res).toMatchObject({ classification: "CONFLICT", severity: "BLOCK", entityId: "d1" });
    expect(r.after).toHaveLength(1);
    expect(snap(r.after)).toBe(snap(reg));
    expect(attributeAt(r.after[0], "occupation", P(6))).toBe("cfo");
  });

  it("3 aliases that become ambiguous refuse to resolve", () => {
    const a: RegistryEntity = { id: "x1", kind: "person", name: "Robert Hale", aliases: ["Bob"], introducedAt: P(1), history: {} };
    const b: RegistryEntity = { id: "x2", kind: "person", name: "Bob Marsh", aliases: ["Bob"], introducedAt: P(8), history: {} };
    expect(resolveReference([a, b], { surface: "Bob", material: true }, P(4)).entityId).toBe("x1"); // x2 not yet introduced
    const r = decideAndPersist([a, b], { surface: "Bob", material: true }, P(9), commitAt("location", "dock", 9));
    expect(r.res).toMatchObject({ classification: "AMBIGUOUS", entityId: null });
    expect(snap(r.after)).toBe(snap([a, b]));
  });

  it("4 reveals need explicit evidence; unsupported twists block", () => {
    const reg = [david()];
    const twist = decideAndPersist(reg, { surface: "David", attributes: { location: "paris" }, material: true }, P(7), commitAt("location", "paris", 7));
    expect(twist.res.severity).toBe("BLOCK"); expect(snap(twist.after)).toBe(snap(reg));
    const reveal = decideAndPersist(reg, { surface: "David", attributes: { location: "paris" }, revealEvidence: "David had moved to Paris in secret.", material: true }, P(7), commitAt("location", "paris", 7));
    expect(reveal.res.severity).toBe("OK");
    const d = reveal.after[0];
    expect(attributeAt(d, "location", P(6))).toBe("toronto");
    expect(attributeAt(d, "location", P(7))).toBe("paris");
    expect(d.history.location!.at(-1)!.evidence).toBeTruthy();
  });

  it("5 relationship change: supported commits with lineage, unsupported leaves state", () => {
    const j: RegistryEntity = { id: "j", kind: "person", name: "John", aliases: [], introducedAt: P(1), history: { relationship: [v("friend", 1)] } };
    const bad = decideAndPersist([j], { surface: "John", attributes: { relationship: "enemy" }, material: true }, P(5), commitAt("relationship", "enemy", 5));
    expect(bad.res.classification).toBe("CONFLICT"); expect(snap(bad.after)).toBe(snap([j]));
    const ok = decideAndPersist([j], { surface: "John", attributes: { relationship: "enemy" }, revealEvidence: "Their friendship ended that night.", material: true }, P(5), commitAt("relationship", "enemy", 5));
    expect(ok.after[0].history.relationship!.map((x) => x.value)).toEqual(["friend", "enemy"]);
  });

  it("6 regeneration of ch4 after ch10 canon removes only ch4 state", () => {
    let reg: RegistryEntity[] = [david()];
    reg = commitChange(reg, { entityId: "d1", ...commitAt("location", "ottawa", 4) });
    reg = commitChange(reg, { entityId: "d1", ...commitAt("role", "board chair", 10) });
    const undone = undoSection(reg, "s4");
    const d = undone[0];
    expect(attributeAt(d, "location", P(5))).toBe("toronto");
    expect(attributeAt(d, "role", P(10))).toBe("board chair");
    expect(attributeAt(d, "occupation", P(10))).toBe("cfo");
    expect(undone.length).toBe(1);
  });

  it("7 authority inversion: AI inference cannot overwrite user/outline canon, even at 0.99 confidence", () => {
    const reg = [david()];
    expect(() => commitChange(reg, { entityId: "d1", ...commitAt("occupation", "teacher", 5, "AI_INFERENCE") })).toThrow();
    expect(() => commitChange(reg, { entityId: "d1", ...commitAt("occupation", "teacher", 5, "OUTLINE_CANON") })).toThrow();
    expect(attributeAt(reg[0], "occupation", P(5))).toBe("cfo");
    const undone = undoSection(reg, "u");
    expect(attributeAt(undone[0], "occupation", P(5))).toBe("cfo");
  });

  it("8 long distance: ch2 reference resolves correctly in ch40 without future leakage", () => {
    const m: RegistryEntity = { id: "m", kind: "person", name: "Mara Voss", aliases: ["Mara"], introducedAt: P(2), history: { occupation: [v("pilot", 2), v("captain", 30)] } };
    const late = resolveReference([m], { surface: "Mara", material: true }, P(40));
    expect(late.entityId).toBe("m");
    expect(attributeAt(m, "occupation", P(20))).toBe("pilot");
    expect(attributeAt(m, "occupation", P(40))).toBe("captain");
    expect(registryAt([m], P(1))).toHaveLength(0);
  });

  it("9 batch is all-or-nothing at the decision layer (DB atomicity proven via commit_identity_batch)", () => {
    const reg = [david()];
    const good = [commitAt("location", "ottawa", 5), commitAt("role", "lead", 5), commitAt("relationship", "mentor", 5), commitAt("version", "1", 5), commitAt("language", "en", 5)].map((c) => ({ entityId: "d1", ...c }));
    expect(planBatch(reg, good).ok).toBe(true);
    const bad = [...good.slice(0, 3), { entityId: "d1", ...commitAt("occupation", "teacher", 5, "AI_INFERENCE") }, good[4]];
    const r = planBatch(reg, bad);
    expect(r).toMatchObject({ ok: false, index: 3 });
    expect(snap(reg)).toBe(snap([david()]));
    const retry = planBatch(reg, bad.filter((_, i) => i !== 3));
    expect(retry.ok).toBe(true);
  });

  it("10 idempotency is scoped to book/section/hash/purpose/version, not extraction id or raw hash", () => {
    const base = { bookId: "b", sectionId: "s5", contentHash: "h", purpose: "extract", schemaVersion: 1 };
    expect(idempotencyKey(base)).toBe(idempotencyKey({ ...base }));
    expect(idempotencyKey(base)).not.toBe(idempotencyKey({ ...base, sectionId: "s6" }));
    expect(idempotencyKey(base)).not.toBe(idempotencyKey({ ...base, bookId: "b2" }));
    expect(idempotencyKey(base)).not.toBe(idempotencyKey({ ...base, schemaVersion: 2 }));
    const c = { entityId: "d1", ...commitAt("location", "ottawa", 5) };
    const once = commitChange([david()], c);
    expect(snap(commitChange(once, c))).toBe(snap(once));
    expect(once[0].history.location).toHaveLength(2);
  });

  it("11 multiple simultaneous changes in one section commit together with shared provenance", () => {
    const plan = planBatch([david()], [commitAt("location", "ottawa", 5), commitAt("role", "lead", 5), commitAt("relationship", "mentor", 5)].map((c) => ({ entityId: "d1", ...c })));
    expect(plan.ok).toBe(true);
    if (!plan.ok) return;
    const after = plan.changes.reduce((r, c) => commitChange(r, c), [david()]);
    const d = after[0];
    expect([attributeAt(d, "location", P(5)), attributeAt(d, "role", P(5)), attributeAt(d, "relationship", P(5))]).toEqual(["ottawa", "lead", "mentor"]);
    expect(undoSection(after, "s5")[0].history.role).toEqual([]);
  });

  it("12 partial extraction failure: unknown entity rejects whole plan, no orphan state", () => {
    const reg = [david()];
    const r = planBatch(reg, [{ entityId: "d1", ...commitAt("location", "ottawa", 5) }, { entityId: "ghost", ...commitAt("role", "x", 5) }]);
    expect(r).toMatchObject({ ok: false, index: 1 });
    expect(snap(reg)).toBe(snap([david()]));
  });

  it("13 model disagreement never picks the higher confidence", () => {
    const r = arbitrateModels([{ model: "luna", entityId: "c17", confidence: 0.99 }, { model: "sol", entityId: "c23", confidence: 0.6 }], true);
    expect(r).toMatchObject({ classification: "AMBIGUOUS", entityId: null, severity: "BLOCK" });
    expect(persist([david()], r, commitAt("role", "x", 5))).toEqual([david()]);
    expect(arbitrateModels([{ model: "luna", entityId: "c17", confidence: 0.5 }, { model: "sol", entityId: "c17", confidence: 0.5 }], true).entityId).toBe("c17");
  });

  it("14 nonfiction claims and technical artifacts: collisions are conflicts, not new entities", () => {
    const claim: RegistryEntity = { id: "k", kind: "claim", name: "Savings Rate Rule", aliases: [], introducedAt: P(1), history: { quantity: [v("20%", 1)] } };
    const art: RegistryEntity = { id: "a", kind: "artifact", name: "parseInvoice", aliases: [], introducedAt: P(2), history: { version: [v("v1", 2)], signature: [v("parseInvoice(s: string): Invoice", 2)] } };
    const reg = [claim, art];
    const c = decideAndPersist(reg, { surface: "Savings Rate Rule", attributes: { quantity: "15%" }, material: true }, P(6), commitAt("quantity", "15%", 6));
    const t = decideAndPersist(reg, { surface: "parseInvoice", attributes: { signature: "parseInvoice(b: Buffer): Invoice" }, material: true }, P(6), commitAt("signature", "x", 6));
    expect([c.res.classification, t.res.classification]).toEqual(["CONFLICT", "CONFLICT"]);
    expect(snap(c.after)).toBe(snap(reg)); expect(snap(t.after)).toBe(snap(reg));
  });

  it("15 semantic spoofing: echoed wording without independent evidence does not merge entities", () => {
    const j: RegistryEntity = { id: "j", kind: "person", name: "John", aliases: [], introducedAt: P(1), history: { relationship: [v("michael's childhood friend", 1)], location: [v("leeds", 1)] } };
    const spoof = decideAndPersist([j], { surface: "Michael's childhood friend", kind: "person", attributes: { relationship: "michael's childhood friend" }, material: true }, P(5), commitAt("role", "x", 5));
    expect(spoof.res.entityId).toBeNull();
    expect(snap(spoof.after)).toBe(snap([j]));
    const contradicted = resolveReference([j], { surface: "Michael's childhood friend", kind: "person", attributes: { relationship: "michael's childhood friend", location: "leeds", occupation: "pilot" }, material: true }, P(5));
    expect(contradicted.entityId).toBe("j"); // two agreeing facts, unknown occupation is not a contradiction
    const conflicting = resolveReference([{ ...j, history: { ...j.history, occupation: [v("baker", 1)] } }], { surface: "Michael's childhood friend", kind: "person", attributes: { relationship: "michael's childhood friend", location: "leeds", occupation: "pilot" }, material: true }, P(5));
    expect(conflicting.entityId).toBeNull();
  });
});
