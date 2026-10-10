import { describe, it, expect } from "vitest";
import {
  parseKnowledge, certaintyFor, parseStoryDate, scenePoint, resolveKnowledgeHolder, planKnowledgeWrites,
  narratorBoundaries, knowledgeCandidates, ageFindings, postDeathFindings, parseEpistemic, secretTermNotes,
} from "../../supabase/functions/_shared/narrative/knowledge";
import { validateMilestones } from "../../supabase/functions/_shared/narrative/chronology";
import { deterministicValidation, routeFinding } from "../../supabase/functions/_shared/narrative/planning/validation";
import { buildEvaluatorPrompt, parseEvaluation, stageOneFindings, type EvalContext } from "../../supabase/functions/_shared/narrative/planning/evaluator";
import { buildExtractionPrompt, planExtraction, evidenceSupported } from "../../supabase/functions/_shared/narrative/extraction";
import { knowledgeEnabled } from "../../supabase/functions/_shared/narrative/knowledgeRepo";

const yr = (year: number) => ({ precision: "year" as const, year });
const exact = (year: number, month: number, day: number) => ({ precision: "exact" as const, year, month, day });
const ids = [
  { id: "mara", displayName: "Mara Quell", aliases: ["Mara"], universeId: "U" },
  { id: "john", displayName: "John Hale", aliases: [], universeId: "U" },
  { id: "john2", displayName: "John Hale", aliases: [], universeId: "U" },
  { id: "petr", displayName: "Petr Saul", aliases: [], universeId: "U" },
];
const ctx = (o: Partial<EvalContext> = {}): EvalContext => ({ adapter: "fiction", isFiction: true, objective: "x", beats: [], anchors: [], facts: [], secrets: [], ...o });
const row = (o: Record<string, unknown>) => ({ identity_id: "mara", certainty: "certain", ...o });

describe("1. premature knowledge — narrator knows a secret before learning it", () => {
  const rows = [row({ id: "k1", claim: "Petr is her brother", learned_chapter_index: 4, learned_subsection_index: 0 })];
  it("is withheld from in-scene context before chapter 4", () => {
    const b = narratorBoundaries(rows, "mara", { chapterIndex: 2, subsectionIndex: 0 }, "immediate");
    expect(b.inScene).toHaveLength(0);
    expect(b.unknown).toHaveLength(1);
    expect(knowledgeCandidates(b, "Mara").map((c) => c.text).join(" ")).not.toContain("brother");
  });
  it("a definite, verbatim premature-knowledge finding blocks; a possible one is advisory", () => {
    const draft = "I already knew Petr was my brother, and I said nothing.";
    const [d] = parseEpistemic({ epistemic: [{ kind: "premature_knowledge", certainty: "definite", excerpt: "I already knew Petr was my brother" }] }, draft);
    expect(routeFinding(d)).toBe("canon_reconciliation");
    const [p] = parseEpistemic({ epistemic: [{ kind: "premature_knowledge", certainty: "possible", excerpt: "I already knew Petr was my brother" }] }, draft);
    expect(routeFinding(p)).not.toBe("canon_reconciliation");
  });
  it("an excerpt not found in the draft never blocks", () => {
    const [f] = parseEpistemic({ epistemic: [{ kind: "premature_knowledge", certainty: "definite", excerpt: "invented quote not in draft" }] }, "Real text here.");
    expect(f.severity).not.toBe("material");
  });
});

describe("2. immediate vs retrospective narrator on the same event", () => {
  const rows = [row({ id: "k", claim: "the fire was arson", learned_date: yr(2010), scene_point: { date: yr(2010) } })];
  it("immediate narration in 2005 does not know it", () => {
    const b = narratorBoundaries(rows, "mara", { date: yr(2005) }, "immediate");
    expect(b.inScene).toHaveLength(0); expect(b.hindsightOnly).toHaveLength(0);
  });
  it("retrospective narration from 2020 may use it only as hindsight", () => {
    const b = narratorBoundaries(rows, "mara", { date: yr(2005) }, "retrospective", { date: yr(2020) });
    expect(b.inScene).toHaveLength(0); expect(b.hindsightOnly).toHaveLength(1);
    expect(knowledgeCandidates(b, "Mara")[0].text).toMatch(/^HINDSIGHT ONLY/);
  });
  it("a framed hindsight device is never definite", () => {
    const draft = "I did not know then that the fire was arson.";
    const [f] = parseEpistemic({ epistemic: [{ kind: "premature_knowledge", certainty: "definite", device: true, excerpt: "I did not know then that the fire was arson" }] }, draft);
    expect(f.severity).toBe("minor");
  });
});

describe("3. false beliefs stay separate from canon", () => {
  it("misunderstanding and false truth become false_belief, suspicion stays suspected", () => {
    expect(certaintyFor({ kind: "misunderstands", truth: "unverified" })).toBe("false_belief");
    expect(certaintyFor({ kind: "knows", truth: "false" })).toBe("false_belief");
    expect(certaintyFor({ kind: "suspects", truth: "true" })).toBe("suspected");
    expect(certaintyFor({ kind: "knows", truth: "true" })).toBe("certain");
  });
  it("knowledge items need verbatim evidence", () => {
    const text = "Mara was sure the letter came from her father, though it did not.";
    const r = parseKnowledge([
      { character: "Mara", claim: "letter is from father", kind: "misunderstands", truth: "false", evidence: "Mara was sure the letter came from her father" },
      { character: "Mara", claim: "invented", evidence: "not in the text at all here" },
    ], text, (t, e) => evidenceSupported(t, e));
    expect(r.items).toHaveLength(1); expect(r.dropped).toBe(1);
  });
});

describe("4. two books, same event, different perspectives", () => {
  it("each narrator gets their own record; neither inherits the other's knowledge", () => {
    const rows = [row({ id: "a", claim: "saw the crash", scene_point: { date: yr(2001) } }), row({ id: "b", identity_id: "john", claim: "heard about the crash", scene_point: { date: yr(2003) } })];
    expect(narratorBoundaries(rows, "mara", { date: yr(2002) }, "immediate").inScene.map((r) => r.id)).toEqual(["a"]);
    expect(narratorBoundaries(rows, "john", { date: yr(2002) }, "immediate").inScene).toHaveLength(0);
  });
});

describe("5. prequels and non-linear chronology (safeguard 1)", () => {
  it("a dated prequel scene does not see knowledge learned later even from an earlier chapter", () => {
    const rows = [row({ id: "k", claim: "the company folds", learned_chapter_index: 1, scene_point: { date: yr(2005), chapterIndex: 1 } })];
    expect(narratorBoundaries(rows, "mara", { date: yr(1995), chapterIndex: 9 }, "immediate").inScene).toHaveLength(0);
  });
  it("an undated flashback gets no chapter position, so order is unclear rather than assumed", () => {
    expect(scenePoint({ chapterIndex: 7, subsectionIndex: 1, nonLinear: true })).toEqual({});
    const rows = [row({ id: "k", claim: "x", scene_point: { chapterIndex: 3 } })];
    const b = narratorBoundaries(rows, "mara", scenePoint({ chapterIndex: 7, subsectionIndex: 1, nonLinear: true }), "immediate");
    expect(b.inScene).toHaveLength(0); expect(b.uncertain).toHaveLength(1);
  });
  it("vague dates are never made precise", () => {
    expect(parseStoryDate("that winter")).toBeNull();
    expect(parseStoryDate("March 2004")).toMatchObject({ precision: "month_year", year: 2004, month: 3 });
    expect(parseStoryDate("around 1990")).toMatchObject({ precision: "approximate", year: 1990 });
    expect(parseStoryDate("14 June 1999")).toMatchObject({ precision: "exact", year: 1999, month: 6, day: 14 });
  });
});

describe("6–7. ages and milestones (safeguard 2)", () => {
  const people = [{ name: "Mara Quell", birth: exact(1980, 4, 15) }];
  it("an impossible stated age in narration blocks", () => {
    const f = ageFindings("Mara Quell was 35 that spring.", people, exact(2000, 5, 1));
    expect(f[0].code).toBe("AGE_IMPOSSIBLE"); expect(routeFinding(f[0])).toBe("canon_reconciliation");
  });
  it("the same age spoken in dialogue is advisory (she may be lying)", () => {
    const f = ageFindings('"Mara Quell was 35 when she left," he lied.', people, exact(2000, 5, 1));
    expect(f[0].severity).toBe("minor");
  });
  it("no scene date → no age check at all", () => {
    expect(ageFindings("Mara Quell was 35.", people, null)).toHaveLength(0);
  });
  it("a year-only birth one year off is advisory, not a block", () => {
    const f = ageFindings("Mara Quell was 21.", [{ name: "Mara Quell", birth: yr(1980) }], exact(2000, 6, 1));
    expect(f[0].severity).toBe("minor");
  });
  it("retiring after starting a job is ordered; a new job after retirement is not a contradiction", () => {
    expect(validateMilestones([{ key: "employment_start", date: yr(2002) }, { key: "retirement", date: yr(2001), requires: ["employment_start"] }])[0].verdict).toBe("violation");
    expect(validateMilestones([{ key: "retirement", date: yr(2001) }, { key: "new_job", date: yr(2003) }])).toHaveLength(0);
  });
  it("acting after death in narration blocks; mention in dialogue does not", () => {
    const dead = [{ name: "John Hale", death: yr(1999) }];
    expect(postDeathFindings("John Hale smiled at me.", dead, yr(2005))[0].code).toBe("ACTS_AFTER_DEATH");
    expect(postDeathFindings('"John Hale smiled at me once," she said.', dead, yr(2005))).toHaveLength(0);
  });
  it("stage one runs life checks only when life records are supplied", () => {
    expect(stageOneFindings("Mara Quell was 35.", ctx()).some((f) => f.code === "AGE_IMPOSSIBLE")).toBe(false);
    expect(stageOneFindings("Mara Quell was 35.", ctx({ lifeRecords: people, sceneDate: exact(2000, 5, 1) })).some((f) => f.code === "AGE_IMPOSSIBLE")).toBe(true);
  });
});

describe("8. planned twist and foreshadowing (safeguard 3)", () => {
  it("a protected name in prose is only a note, never a block", () => {
    const f = deterministicValidation("Petr Saul lit the lamp.", { secrets: ["Petr Saul"] });
    const leak = f.find((x) => x.code === "SECRET_TERM_PRESENT")!;
    expect(leak.severity).toBe("minor"); expect(routeFinding(leak)).not.toBe("canon_reconciliation");
    expect(secretTermNotes("nothing here", ["Petr Saul"])).toHaveLength(0);
  });
  it("a definite semantic disclosure with a real excerpt blocks", () => {
    const draft = "Then I understood: Petr Saul had been my brother all along.";
    const f = parseEvaluation(JSON.stringify({ beats: [], disclosures: [{ secret: 1, disclosed: true, certainty: "definite", excerpt: "Petr Saul had been my brother all along" }] }), ctx({ secrets: ["Petr is Mara's brother"] }), draft);
    expect(f.find((x) => x.code === "SECRET_LEAK")?.severity).toBe("material");
  });
  it("a possible hint is advisory", () => {
    const f = parseEvaluation(JSON.stringify({ beats: [], disclosures: [{ disclosed: true, certainty: "possible", excerpt: "his eyes were like hers" }] }), ctx({ secrets: ["s"] }), "his eyes were like hers, oddly.");
    expect(f.find((x) => x.code === "SECRET_POSSIBLE_LEAK")?.severity).toBe("minor");
  });
  it("the evaluator is told that mentions and foreshadowing are not disclosure", () => {
    expect(buildEvaluatorPrompt("d", ctx({ secrets: ["s"] })).system).toMatch(/foreshadowing are NOT disclosure/);
    expect(buildEvaluatorPrompt("d", ctx()).user).not.toMatch(/PROTECTED FUTURE TWISTS/);
  });
});

describe("identity resolution for knowledge holders (safeguard 4)", () => {
  it("a unique name resolves to its stable id", () => {
    expect(resolveKnowledgeHolder("Mara Quell", ids, "U")).toEqual({ status: "resolved", identityId: "mara" });
    expect(resolveKnowledgeHolder("Mara", ids, "U")).toEqual({ status: "resolved", identityId: "mara" });
  });
  it("two identities with the same name are held, never guessed", () => {
    expect(resolveKnowledgeHolder("John Hale", ids, "U")).toMatchObject({ status: "ambiguous", candidates: ["john", "john2"] });
  });
  it("an unknown name is held as no_identity", () => {
    expect(resolveKnowledgeHolder("Ruth Okafor", ids, "U").status).toBe("no_identity");
  });
  it("ambiguous holders go to review, resolved ones to rows", () => {
    const items = [
      { character: "Mara", claim: "door was locked", kind: "knows", source: "direct_witness", truth: "true", fromCharacter: null, storyDate: null, supersedes: null, evidence: "e" },
      { character: "John Hale", claim: "letter burned", kind: "knows", source: "direct_witness", truth: "true", fromCharacter: null, storyDate: null, supersedes: null, evidence: "e" },
    ] as const;
    const p = planKnowledgeWrites(items as never, { identities: ids, universeId: "U", bookId: "B", chapterIndex: 1, subsectionIndex: 2, contentHash: "h1" });
    expect(p.rows.map((r) => r.identity_id)).toEqual(["mara"]);
    expect(p.reviews[0]).toMatchObject({ character_name: "John Hale", reason: "ambiguous" });
  });
});

describe("9–10. idempotency, rejected drafts, opt-in", () => {
  const items = [{ character: "Mara", claim: "door was locked", kind: "knows", source: "direct_witness", truth: "true", fromCharacter: null, storyDate: null, supersedes: null, evidence: "e" }];
  const plan = (hash: string) => planKnowledgeWrites(items as never, { identities: ids, universeId: "U", bookId: "B", chapterIndex: 1, subsectionIndex: 2, contentHash: hash });
  it("re-extracting the same text yields identical dedup keys (no duplicates)", () => {
    expect(plan("h1").rows[0].dedup_key).toBe(plan("h1").rows[0].dedup_key);
  });
  it("a rewritten section produces new keys, so older rows can be rolled back by hash", () => {
    expect(plan("h1").rows[0].dedup_key).not.toBe(plan("h2").rows[0].dedup_key);
  });
  it("knowledge extraction is off unless the book uses a universe, narrator persona or progressive pipeline", () => {
    expect(knowledgeEnabled({ controls: {} })).toBe(false);
    expect(knowledgeEnabled({ universe_id: "U" })).toBe(true);
    expect(knowledgeEnabled({ narrator_identity_id: "n" })).toBe(true);
    expect(knowledgeEnabled({ controls: { planning_pipeline: "progressive" } })).toBe(true);
  });
  it("Standard extraction prompt is unchanged when knowledge is off", () => {
    const a = { text: "t", position: { chapterIndex: 0, subsectionIndex: 0 }, characters: [], threads: [] };
    expect(buildExtractionPrompt(a).system).not.toMatch(/"knowledge"/);
    expect(buildExtractionPrompt({ ...a, knowledge: true }).system).toMatch(/ALSO return key "knowledge"/);
    expect(planExtraction({ knowledge: [{ character: "M", claim: "c", evidence: "t" }] }, { text: "t", characters: [], threads: [] }).knowledge).toBeUndefined();
  });
});
