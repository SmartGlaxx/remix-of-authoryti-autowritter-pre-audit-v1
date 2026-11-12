import { describe, expect, it, vi } from "vitest";
import { applyReplacements, runPreAcceptance, type EvalContext, type EvalModel } from "../../supabase/functions/_shared/narrative/planning/evaluator";
import { persistOutcome } from "../../supabase/functions/_shared/narrative/planning/preAcceptanceServer";

const context: EvalContext = { adapter: "fiction", isFiction: true, objective: "Reveal the betrayal", beats: [], anchors: [], facts: [{ id: "f1", text: "Mara has green eyes" }], secrets: [] };
const draft = "Her brown eyes met his. The betrayal hurt more than she expected. He had promised to stay, but his bag waited by the door. Mara refused to beg. Outside, a bus stopped and a woman shouted for her son. He reached for the handle. She stepped aside. There was nothing left to say, and neither of them tried. His footsteps faded down the stairs. She remained until the street fell quiet, holding the letter he had never read.";
const clean = { beats: [], continuity: [], claims: [], quality: [] };
const bad = { ...clean, continuity: [{ kind: "fact", severity: "material", message: "Mara has green eyes", excerpt: "Her brown eyes", sourceRef: "f1" }] };
const evaluator: EvalModel = async (p) => ({ text: JSON.stringify(p.user.includes("Her brown eyes") ? bad : clean) });
const repair: EvalModel = async () => ({ text: JSON.stringify({ reasoning: "Preserve the betrayal and emotional impact while restoring green eyes.", replacements: [{ find: "Her brown eyes", replace: "Her green eyes" }] }) });

describe("forward autonomous resolution", () => {
  it("automatically fixes the new draft, preserves canon and records the source", async () => {
    const original = structuredClone(context);
    const r = await runPreAcceptance(draft, context, evaluator, repair);
    expect(r.decision).toBe("accept");
    expect(r.outcome).toBe("repaired");
    expect(r.text).toBe(draft.replace("brown", "green"));
    expect(r.autoResolved?.[0].sourceRef).toBe("f1");
    expect(context).toEqual(original);
  });

  it("never accepts when revalidation becomes unavailable", async () => {
    let checks = 0;
    const r = await runPreAcceptance(draft, context, async () => { if (++checks > 1) throw new Error("offline"); return { text: JSON.stringify(bad) }; }, repair);
    expect(r.decision).not.toBe("accept");
    expect(r.text).toBe(draft);
    expect(r.autoResolved).toBeUndefined();
  });

  it("rejects a new conflict even when it has the same code as the old one", async () => {
    const r = await runPreAcceptance(draft, context, async (p) => ({ text: JSON.stringify(p.user.includes("Her brown eyes") ? bad : { ...bad, continuity: [{ ...bad.continuity[0], excerpt: "this betrayal", sourceRef: "f2" }] }) }), repair);
    expect(r.decision).toBe("blocked_material");
    expect(r.text).toBe(draft);
  });

  it("holds a repair exceeding the 20% cumulative edit limit", async () => {
    const short = "Her brown eyes met his.";
    const r = await runPreAcceptance(short, context, evaluator, async () => ({ text: JSON.stringify({ replacements: [{ find: short, replace: "Mara fled the town and never returned." }] }) }));
    expect(r.decision).not.toBe("accept");
    expect(r.heldForApproval?.ratio).toBeGreaterThan(0.2);
    expect(r.text).toBe(short);
  });

  it("makes at most two autonomous repair attempts", async () => {
    const revise = vi.fn(repair);
    const r = await runPreAcceptance(draft, context, async () => ({ text: JSON.stringify(bad) }), revise);
    expect(r.decision).toBe("blocked_material");
    expect(revise.mock.calls.length).toBeLessThanOrEqual(2);
  });

  it("does not guess a repair when the conflicting excerpt is absent", async () => {
    const revise = vi.fn(repair);
    const r = await runPreAcceptance("Mara waited.", context, async () => ({ text: JSON.stringify(bad) }), revise);
    expect(r.decision).toBe("blocked_material");
    expect(revise).not.toHaveBeenCalled();
  });

  it("does not guess canon when the cited source is unavailable", async () => {
    const revise = vi.fn(repair);
    const r = await runPreAcceptance(draft, { ...context, facts: [] }, evaluator, revise);
    expect(r.decision).toBe("blocked_material");
    expect(revise).not.toHaveBeenCalled();
  });

  it("preserves an explicit approved author change without repairing it away", async () => {
    const revise = vi.fn(repair);
    const r = await runPreAcceptance(draft, { ...context, approvedCanonKeys: ["CANON_CONTRADICTION:her brown eyes"] }, evaluator, revise);
    expect(r.decision).toBe("accept");
    expect(r.text).toBe(draft);
    expect(revise).not.toHaveBeenCalled();
  });

  it("holds acceptance if repair history cannot be saved", async () => {
    const r = await runPreAcceptance(draft, context, evaluator, repair);
    await expect(persistOutcome(r, { db: { from: () => ({ upsert: async () => ({ error: { message: "offline" } }) }) }, bookId: "book", userId: "owner", chapter: 0, sub: 0, hash: "hash", masterPlanId: null, origin: "generated" })).rejects.toThrow("Could not record automatic repair");
  });

  it("refuses ambiguous replacements and deletions", () => {
    expect(applyReplacements("Mara waited. Mara waited.", JSON.stringify({ replacements: [{ find: "Mara waited.", replace: "Mara left." }] }))).toBe("Mara waited. Mara waited.");
    expect(applyReplacements("Mara waited.", JSON.stringify({ replacements: [{ find: "Mara waited.", replace: "" }] }))).toBe("Mara waited.");
  });

  it("records resolved repair history without making an author decision", async () => {
    const r = await runPreAcceptance(draft, context, evaluator, repair);
    const upsert = vi.fn(async (_row: unknown, _opts: unknown) => ({ error: null }));
    const rpc = vi.fn();
    await persistOutcome(r, { db: { from: () => ({ upsert }), rpc }, bookId: "book", userId: "owner", chapter: 0, sub: 0, hash: "hash", masterPlanId: null, origin: "generated" });
    expect(rpc).not.toHaveBeenCalled();
    expect(upsert.mock.calls[0]?.[0]).toMatchObject({ status: "RESOLVED", details: { scope: "new_draft_only", canon_changed: false } });
  });
});