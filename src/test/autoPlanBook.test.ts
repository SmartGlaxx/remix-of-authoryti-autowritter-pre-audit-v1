import { describe, expect, it } from "vitest";
import { autoPlanBook } from "@/lib/autoPlanBook";

function fakeServer(chapters: number) {
  const masters: any[] = []; const plans: any[] = []; const log: string[] = [];
  let id = 0;
  const add = (plan_level: string, chapter_index: number, content: any = {}) => plans.push({ id: `p${++id}`, master_plan_id: "m1", plan_level, chapter_index, plan_status: "PLANNED", content });
  const call = async (b: any) => {
    if (b.action !== "status") log.push(`${b.action}${b.chapter !== undefined ? b.chapter : ""}`);
    switch (b.action) {
      case "status": return { ok: true, data: { masters, plans } };
      case "master": masters.push({ id: "m1", status: "DRAFT", plan_skeleton: { chapters: [...Array(chapters)] } }); return { ok: true, data: {} };
      case "approve_master": masters[0].status = "APPROVED"; return { ok: true, data: {} };
      case "chapters": for (let c = 0; c < chapters; c++) add("CHAPTER", c); return { ok: true, data: {} };
      case "sections": add("SECTION", b.chapter); return { ok: true, data: {} };
      case "beats": add("BEATS", b.chapter); return { ok: true, data: {} };
      case "blueprint": add("BLUEPRINT", b.chapter, { blueprint: { castProposals: b.chapter === 1 ? [{ id: "x", name: "Ada Stone" }] : [] } }); return { ok: true, data: {} };
      case "approve_cast_proposal": return { ok: true, data: {} };
      case "approve_plans": for (const p of plans) if (b.ids.includes(p.id)) p.plan_status = "READY"; return { ok: true, data: {} };
    }
    return { ok: false, data: { error: "bad" } };
  };
  return { call, log, plans };
}

describe("hands-off auto setup", () => {
  it("chains summary → chapters → sections → beats → blueprints and approves everything", async () => {
    const s = fakeServer(2);
    const r = await autoPlanBook({ bookId: "b", brief: { premise: "x" }, call: s.call, onProgress: () => {}, shouldStop: () => false });
    expect(r.completed).toBe(true);
    expect(s.log).toEqual(["master", "approve_master", "chapters", "sections0", "beats0", "sections1", "beats1", "approve_plans",
      "blueprint0", "approve_plans", "blueprint1", "approve_cast_proposal", "approve_plans"]);
    expect(s.plans.every((p) => p.plan_status === "READY")).toBe(true);
  });
  it("resumes without redoing finished steps", async () => {
    const s = fakeServer(2);
    await autoPlanBook({ bookId: "b", brief: {}, call: s.call, onProgress: () => {}, shouldStop: () => false });
    s.log.length = 0;
    expect((await autoPlanBook({ bookId: "b", brief: {}, call: s.call, onProgress: () => {}, shouldStop: () => false })).completed).toBe(true);
    expect(s.log).toEqual([]);
  });
});
