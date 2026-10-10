import { describe, expect, it } from "vitest";
import { buildPlanSkeleton } from "../../supabase/functions/_shared/narrative/planning/engine.ts";
import {
  checkAnchors, discrepanciesFor, foreshadowFor, previousPosition, priorFromAcceptances, progressiveGate,
  renderPlanBlock, requiredAnchorKeys, resolvePipeline, runAnchorRepair, scopedAnchors, type AnchorRow,
} from "../../supabase/functions/_shared/narrative/planning/pipeline.ts";
import { buildPlanningAwareContext, resolvePlanForSection, type ResolvedPlan } from "../../supabase/functions/_shared/narrative/planning/planningContext.ts";
import { acquireLease, canCommitWithFence } from "../../supabase/functions/_shared/narrative/planning/safeguards.ts";
import type { NarrativeRows } from "../../supabase/functions/_shared/narrative/context.ts";

const empty: NarrativeRows = { characters: [], states: [], events: [], participants: [], threads: [], threadEvents: [], facts: [], timeline: [], entities: [], snapshots: [] };
const master = () => buildPlanSkeleton({ bookType: "novel", targetWords: 48000, chapterCount: 12, sectionsPerChapter: 4, genreData: { theme: "loyalty" },
  reveals: [{ id: "r1", summary: "Daniel is secretly working for the antagonist", secretTerms: ["working for Voss"], revealChapter: 9, setupChapters: [2, 5],
    setupDirectives: [
      { chapterIndex: 2, writerInstruction: "Daniel hesitates when asked about his whereabouts on Tuesday and changes the subject.", viewpointKnows: "Daniel seems evasive.", readerSees: "An unexplained evasion." },
      { chapterIndex: 5, writerInstruction: "Daniel admits he is working for Voss." }, // leaks → must be dropped
    ] }] });
const anchor = (k: string, t: string, o: Partial<AnchorRow> = {}): AnchorRow => ({ anchor_key: k, exact_text: t, match_mode: "EXACT", effective_chapter_index: 0, version: 1, is_active: true, ...o });

describe("Phase F opt-in switch", () => {
  it("only 'progressive' enables the new pathway; everything else stays on current writing", () => {
    expect(resolvePipeline({ planning_pipeline: "progressive" })).toBe("progressive");
    for (const c of [null, {}, { planning_pipeline: "on" }, { context_engine: "adaptive" }]) expect(resolvePipeline(c)).toBe("current");
  });
});

describe("Phase F spoiler-safe, actionable foreshadowing", () => {
  it("gives the writer the concrete clue, viewpoint and reader layers, without the secret", () => {
    const f = foreshadowFor(master(), 2);
    expect(f).toHaveLength(1);
    expect(f[0].specific).toBe(true);
    expect(f[0].text).toContain("hesitates when asked about his whereabouts on Tuesday");
    expect(f[0].text).toContain("Viewpoint character understands only");
    expect(f[0].text).not.toMatch(/antagonist|Voss/);
  });
  it("drops a directive that would leak the secret and falls back (flagged non-specific)", () => {
    const f = foreshadowFor(master(), 5);
    expect(f).toEqual([expect.objectContaining({ specific: false })]);
    expect(f[0].text).not.toContain("Voss");
  });
  it("reaches both modes: Adaptive context and the Standard plan block", () => {
    const outline = { characters: [], chapters: Array.from({ length: 12 }, (_, c) => ({ title: `C${c}`, subsections: Array.from({ length: 4 }, () => ({ title: "s", content: "" })) })) };
    const ad = buildPlanningAwareContext({ bookType: "novel", position: { chapterIndex: 2, subsectionIndex: 0 }, objective: "go", outline, rows: empty, master: { status: "APPROVED", version: 1, plan_skeleton: master() } });
    expect(ad.context.text).toContain("whereabouts on Tuesday");
    expect(ad.context.text).not.toContain("antagonist");
    const plan = resolvePlanForSection({ status: "APPROVED", version: 1, plan_skeleton: master() }, { chapterIndex: 2, subsectionIndex: 0 }, "novel") as ResolvedPlan;
    const block = renderPlanBlock(plan, 2, [], []);
    expect(block).toContain("whereabouts on Tuesday");
    expect(block).not.toMatch(/antagonist|Voss/);
  });
});

describe("Phase F exact-detail enforcement", () => {
  const anchors = [anchor("door_code", "7-4-1-9"), anchor("mentor", "Ilse Varga", { retrieval_tags: ["always"] }), anchor("later", "X-99", { effective_chapter_index: 8 })];
  it("requires only plan-listed or 'always' anchors; others are never forced in", () => {
    expect(requiredAnchorKeys({ requiredAnchors: ["door_code"] }, anchors).sort()).toEqual(["door_code", "mentor"]);
    expect(requiredAnchorKeys(null, [anchor("phone", "555-0101")])).toEqual([]);
    expect(scopedAnchors(anchors, 3).map((a) => a.anchor_key)).not.toContain("later");
  });
  it("detects missing and wrongly reproduced details", () => {
    const v = checkAnchors("She typed 7-4-1-90 and thought of ilse varga.", anchors, ["door_code", "mentor"]);
    expect(v.map((x) => [x.key, x.kind])).toEqual([["door_code", "missing"], ["mentor", "variant"]]);
    expect(checkAnchors("She typed 7-4-1-9. Ilse Varga nodded.", anchors, ["door_code", "mentor"])).toEqual([]);
  });
  it("repairs with at most 2 targeted attempts and rejects over-rewrites", async () => {
    const base = "She typed the code and waited. ".repeat(20);
    let calls = 0;
    const r = await runAnchorRepair(base, anchors, ["door_code"], async (t) => { calls++; return calls === 1 ? "totally different" : t.replace("the code", "7-4-1-9"); });
    expect(calls).toBe(2);
    expect(r.repaired).toBe(true);
    expect(r.remaining).toEqual([]);
    const stuck = await runAnchorRepair(base, anchors, ["door_code"], async (t) => t);
    expect(stuck.attempts).toBe(2);
    expect(stuck.remaining.map((v) => v.key)).toEqual(["door_code"]);
  });
});

describe("Phase F generation gate (staged acceptance + contradictions)", () => {
  const pos = { chapterIndex: 2, subsectionIndex: 1 };
  it("blocks until the previous section is accepted and in story memory", () => {
    expect(progressiveGate({ manuscript: "DRAFTED", extraction: "NOT_STARTED" }, [], pos)).toMatchObject({ ok: false, code: "AWAIT_ACCEPTANCE" });
    expect(progressiveGate({ manuscript: "ACCEPTED", extraction: "PENDING_EXTRACTION" }, [], pos)).toMatchObject({ ok: false, code: "RECOVER_EXTRACTION" });
    expect(progressiveGate({ manuscript: "ACCEPTED", extraction: "FAILED" }, [], pos)).toMatchObject({ ok: false, code: "RECOVER_EXTRACTION" });
    expect(progressiveGate({ manuscript: "ESTABLISHED", extraction: "EXTRACTED" }, [], pos)).toEqual({ ok: true });
    expect(progressiveGate(null, [], { chapterIndex: 0, subsectionIndex: 0 })).toEqual({ ok: true });
  });
  it("undecided serious contradictions block; decided, minor and self-test ones never do", () => {
    const ok = { manuscript: "ESTABLISHED", extraction: "EXTRACTED" } as const;
    const log = (o: Record<string, unknown>) => ({ decision: "PENDING", severity: "CRITICAL", dedup_key: "pf_x", chapter_index: 1, subsection_index: 0, ...o });
    expect(progressiveGate(ok, [log({})], pos)).toMatchObject({ ok: false, code: "CANON_RECONCILIATION_REQUIRED" });
    expect(progressiveGate(ok, [log({ decision: "DISMISS" })], pos)).toEqual({ ok: true });
    expect(progressiveGate(ok, [log({ severity: "MINOR" })], pos)).toEqual({ ok: true });
    expect(progressiveGate(ok, [log({ dedup_key: "selftest_1" })], pos)).toEqual({ ok: true });
  });
  it("finds the previous section across chapter boundaries and ignores revised acceptance rows", () => {
    const outline = { chapters: [{ subsections: [1, 2, 3] }, { subsections: [] }, { subsections: [1] }] };
    expect(previousPosition(outline, 2, 0)).toEqual({ chapterIndex: 0, subsectionIndex: 2 });
    expect(previousPosition(outline, 0, 0)).toBeNull();
    expect(priorFromAcceptances([{ manuscript_status: "REVISED", extraction_status: "EXTRACTED" }])).toBe("missing");
  });
  it("only serious unresolved findings become author decisions", () => {
    const d = discrepanciesFor([
      { classification: "ERROR", severity: "HIGH", type: "FACT_CONTRADICTION", excerpt: "blue eyes", explanation: "eyes were green" },
      { classification: "AMBIGUOUS", severity: "CRITICAL", type: "X", excerpt: "" },
      { classification: "ERROR", severity: "MEDIUM", type: "Y", excerpt: "" },
    ], [{ key: "door_code", expected: "7-4-1-9", kind: "missing" }]);
    expect(d.map((x) => [x.severity, x.type])).toEqual([["MAJOR", "CANON_CONFLICT"], ["MAJOR", "ANCHOR_MISMATCH"]]);
  });
});

describe("Phase F stale workers", () => {
  it("a worker whose lease was taken over can never commit", () => {
    const now = 1_000_000;
    const a = acquireLease(null, "old", 60, now); if (!a.acquired) throw new Error();
    const b = acquireLease(a.lease, "new", 60, now + 61_000); if (!b.acquired) throw new Error();
    expect(canCommitWithFence(b.lease, "old", a.lease.fencingToken, now + 62_000)).toBe(false);
    expect(canCommitWithFence(b.lease, "new", b.lease.fencingToken, now + 62_000)).toBe(true);
  });
});
