import { describe, it, expect } from "vitest";
import {
  vocabularyRules, findBannedExpressions, findRepetition, classifyBeats, checkEvidence, routeFinding,
  blocksAcceptance, decideRevision, runValidationLoop, deterministicValidation, type Finding,
} from "../../supabase/functions/_shared/narrative/planning/validation";

describe("Phase G — configurable vocabulary", () => {
  it("bans nothing by default (magic is fine in fantasy)", () => {
    expect(findBannedExpressions("The magic of the old wood was magical.", vocabularyRules({}))).toEqual([]);
  });
  it("flags only words the book's settings exclude", () => {
    const f = findBannedExpressions("A delve into the tapestry.", vocabularyRules({ bannedWords: ["tapestry"] }));
    expect(f.map((x) => x.excerpt)).toEqual(["tapestry"]);
  });
  it("author allow-list overrides a genre ban", () => {
    expect(vocabularyRules({ allowedExpressions: ["magic"] }, ["magic"]).banned).toEqual([]);
  });
});

describe("Phase G — contextual repetition", () => {
  const line = "the tide went out again";
  it("flags repeated narration", () => {
    expect(findRepetition(`${line}. ${line}. ${line}.`, { adapter: "fiction" }).length).toBeGreaterThan(0);
  });
  it("preserves dialogue repetition", () => {
    const t = `"${line}," he said.\n"${line}," she said.\n"${line}," they said.`;
    expect(findRepetition(t, { adapter: "fiction" })).toEqual([]);
  });
  it("preserves declared motifs and terminology", () => {
    expect(findRepetition(`${line}. ${line}. ${line}.`, { adapter: "fiction", motifs: [line] })).toEqual([]);
  });
  it("preserves refrains in children's books", () => {
    expect(findRepetition(`${line}. ${line}. ${line}.`, { adapter: "childrens" })).toEqual([]);
  });
});

describe("Phase G — deferrals are not omissions", () => {
  it("an unresolved deferred mystery that was planted passes", () => {
    expect(classifyBeats([{ id: "b1", intent: "deferred_resolution", planted: true, resolved: false }])).toEqual([]);
  });
  it("explaining a deferral early is material", () => {
    expect(classifyBeats([{ id: "b1", intent: "setup_only", planted: true, resolved: false, explanationRevealed: true }])[0].severity).toBe("material");
  });
  it("a missing immediate objective is flagged", () => {
    expect(classifyBeats([{ id: "b2", intent: "immediate_payoff", planted: false, resolved: false, required: true }])[0].code).toBe("OBJECTIVE_MISSING");
  });
});

describe("Phase G — routing", () => {
  it("style and missed objectives go to editorial, not canon", () => {
    const style: Finding = { code: "X", category: "writing_quality", severity: "minor", message: "", repairable: false };
    const obj = classifyBeats([{ id: "b", intent: "immediate_payoff", planted: false, resolved: false, required: true }])[0];
    expect(routeFinding(style)).toBe("editorial_review");
    expect(routeFinding(obj)).not.toBe("canon_reconciliation");
    expect(blocksAcceptance([style, obj])).toBe(false);
  });
  it("material factual conflict goes to canon reconciliation", () => {
    const f = checkEvidence([{ id: "c", tier: "documented", sourceProvided: false, presentedAsFact: true }], "narrative_nonfiction");
    expect(routeFinding(f[0])).toBe("canon_reconciliation");
  });
  it("a protected term alone does not block (Phase 3: disclosure is judged semantically)", () => {
    expect(blocksAcceptance(deterministicValidation("Hollis was her father all along.", { secrets: ["Hollis was her father"] }))).toBe(false);
  });
});

describe("Phase G — revision scope", () => {
  const orig = "P1.\n\nP2.\n\nP3.\n\nP4.\n\nP5.";
  it("targeted revision under 20% applies", () => {
    expect(decideRevision({ original: orig, revised: orig.replace("P5.", "P5b."), draftInCanon: false }).apply).toBe(true);
  });
  it("broad rewrite needs author approval rather than being forbidden", () => {
    const d = decideRevision({ original: orig, revised: "A.\n\nB.\n\nC.\n\nP4.\n\nP5.", draftInCanon: false });
    expect(d).toMatchObject({ apply: false, route: "author_approval" });
    expect(decideRevision({ original: orig, revised: "A.\n\nB.\n\nC.\n\nP4.\n\nP5.", draftInCanon: false, authorApproved: true }).apply).toBe(true);
  });
  it("threshold is configurable", () => {
    expect(decideRevision({ original: orig, revised: "A.\n\nB.\n\nC.\n\nP4.\n\nP5.", draftInCanon: false, warnRatio: 0.7 }).apply).toBe(true);
  });
  it("accepted prose in story memory is never auto-overwritten", () => {
    expect(decideRevision({ original: orig, revised: orig.replace("P5.", "P5b."), draftInCanon: true }).apply).toBe(false);
  });
});

describe("Phase G — bounded loop with revalidation", () => {
  const v = (t: string): Finding[] => (t.includes("##") ? [{ code: "MARKDOWN", category: "deterministic", severity: "minor", message: "", repairable: true }] : []);
  it("repairs and revalidates", async () => {
    const r = await runValidationLoop("A.\n\nB.\n\nC.\n\nD.\n\n## E.", v, async (t) => t.replace("## ", ""));
    expect(r.outcome).toBe("repaired");
  });
  it("stops after two rounds and escalates", async () => {
    let calls = 0;
    const r = await runValidationLoop("A.\n\nB.\n\nC.\n\nD.\n\n## E.", v, async (t) => { calls++; return t.replace("E.", `E${calls}.`); });
    expect(r.rounds).toBe(2); expect(r.outcome).toBe("escalated");
  });
  it("discards a revision that introduces a new problem", async () => {
    const vv = (t: string): Finding[] => [...v(t), ...(t.includes("LEAK") ? [{ code: "SECRET_LEAK", category: "deterministic", severity: "material", canonKind: "canon", message: "", repairable: true } as Finding] : [])];
    const r = await runValidationLoop("A.\n\nB.\n\nC.\n\nD.\n\n## E.", vv, async (t) => t.replace("## E.", "E LEAK."));
    expect(r.text).toContain("## E.");
  });
});
