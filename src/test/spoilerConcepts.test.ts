import { describe, it, expect } from "vitest";
import { futureSpoilerConcepts, spoilerCandidates, parseSpoilerJudge, conceptOf } from "../../supabase/functions/_shared/narrative/planning/spoilerConcepts";

const sk = { reveals: [{ id: "r1", summary: "short", concept: "The escort captain was secretly paid by the mayor to let the killer into the gala", secretTerms: ["escort captain"], revealChapter: 8, setupChapters: [0] }] } as any;

describe("concept spoilers", () => {
  it("needs a concept of at least 10 words", () => {
    expect(conceptOf({ concept: "too short concept" })).toBe("");
    expect(futureSpoilerConcepts(sk, 0)).toHaveLength(1);
    expect(futureSpoilerConcepts(sk, 8)).toHaveLength(0);
  });
  it("a keyword already in the chapter's approved plan is planned, not a spoiler", () => {
    const c = futureSpoilerConcepts(sk, 0);
    expect(spoilerCandidates("Tessa watched the escort captain wave guests in.", c, "plan: the escort captain greets Tessa")).toHaveLength(0);
  });
  it("an unplanned keyword hit becomes a candidate carrying its concept", () => {
    const [x] = spoilerCandidates("Tessa watched the escort captain wave guests in.", futureSpoilerConcepts(sk, 0), "plan: Tessa arrives");
    expect(x.revealId).toBe("r1");
    expect(x.concept).toContain("paid by the mayor");
  });
  it("judge verdict decides; unreadable output fails closed", () => {
    const c = spoilerCandidates("the escort captain", futureSpoilerConcepts(sk, 0), "");
    expect(parseSpoilerJudge('{"verdicts":[{"item":1,"spoils":false}]}', c)).toHaveLength(0);
    expect(parseSpoilerJudge('{"verdicts":[{"item":1,"spoils":true,"why":"x"}]}', c)).toHaveLength(1);
    expect(parseSpoilerJudge("garbage", c)).toHaveLength(1);
  });
});
