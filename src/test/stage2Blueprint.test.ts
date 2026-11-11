import { describe, it, expect } from "vitest";
import { parseBlueprint, validateBlueprint, mockBlueprintOutput, buildBlueprintPrompt, expectedMicrobeats, type BlueprintInput } from "../../supabase/functions/_shared/narrative/planning/blueprint";
import { knowledgeHold, planKnowledgeWrites } from "../../supabase/functions/_shared/narrative/knowledge";

const chapter = { id: "c0", chapterIndex: 0, objectiveKind: "setup", objective: "Kiera finds the beacon", targetWords: 1200, dependsOn: [],
  sections: [0, 1].map((i) => ({ id: `c0s${i}`, chapterIndex: 0, sectionIndex: i, unit: "scene", objective: `s${i}`, targetWords: 600, dependsOn: [], beats: [] })) } as any;
const input: BlueprintInput = {
  m: { premise: "p", synopsis: "s", ending: "e", skeleton: { adapter: "fiction", chapters: [chapter, { ...chapter, chapterIndex: 1 }], reveals: [{ id: "r", summary: "Jax is the traitor", revealChapter: 1, setupChapters: [0], secretTerms: ["traitor"] }], genreData: {} } as any },
  chapter, expanded: {}, notes: [],
  details: [{ id: "c0s0", entry: "arrives at the dock", focus: "spots the beacon", outcome: "takes it" }, { id: "c0s1", entry: "returns home", focus: "studies it", outcome: "it activates" }],
  cast: [{ id: "k", name: "Kiera Vance" }, { id: "j", name: "Jax" }],
};
const good = () => JSON.parse(mockBlueprintOutput(input));

describe("Stage 2 chapter blueprints", () => {
  it("self-help example roles can be plan-local without proposals", () => {
    const i = { ...input, cast: [], m: { ...input.m, skeleton: { ...input.m.skeleton, adapter: "self_help", reveals: [] } } } as BlueprintInput;
    const o = good();
    o.cast = [{ id: "k", name: "Bill payer", role: "example" }, { id: "j", name: "Reader", role: "exercise participant" }];
    expect(parseBlueprint(JSON.stringify(o), i).ok).toBe(true);
    o.cast[0].name = "Omar Reyes";
    expect(parseBlueprint(JSON.stringify(o), i).ok).toBe(false);
  });
  it("a complete, plan-grounded blueprint passes", () => expect(parseBlueprint(JSON.stringify(good()), input).ok).toBe(true));
  it("microbeat target is one per ~120 words", () => expect(expectedMicrobeats(1200)).toBe(10));
  it("a person outside the cast is rejected unless proposed", () => {
    const o = good(); o.cast.push({ id: "x", name: "Mrs. Finch", role: "" }); o.microbeats[0].characterIds.push("x");
    expect(parseBlueprint(JSON.stringify(o), input).ok).toBe(false);
    o.castProposals = [{ id: "x", name: "Mrs. Finch", role: "neighbour", justification: "chapter objective needs a witness" }];
    expect(parseBlueprint(JSON.stringify(o), input).ok).toBe(true);
  });
  it("proposing an existing cast member is rejected", () => {
    const o = good(); o.castProposals = [{ id: "p0", name: "Jax", role: "", justification: "x" }];
    const r = parseBlueprint(JSON.stringify(o), input); expect(r.ok).toBe(false);
  });
  it("events must cite an approved source", () => { const o = good(); o.events[0].source = "invented"; expect(parseBlueprint(JSON.stringify(o), input).ok).toBe(false); });
  it("every section must be covered, in order", () => {
    const o = good(); o.microbeats = o.microbeats.filter((b: any) => b.sectionId === "c0s0");
    expect(parseBlueprint(JSON.stringify(o), input).ok).toBe(false);
    const o2 = good(); o2.microbeats.reverse(); expect(parseBlueprint(JSON.stringify(o2), input).ok).toBe(false);
  });
  it("beats starting with a pronoun are flagged", () => { const o = good(); o.microbeats[0].text = "She runs."; expect(parseBlueprint(JSON.stringify(o), input).ok).toBe(false); });
  it("a later reveal cannot leak into reader/character layers", () => { const o = good(); o.knowledge.reader.push("Jax is a traitor"); expect(parseBlueprint(JSON.stringify(o), input).ok).toBe(false); });
  it("the author layer may hold the twist", () => { const o = good(); o.knowledge.author.push("Jax is the traitor"); expect(parseBlueprint(JSON.stringify(o), input).ok).toBe(true); });
  it("too-thin coverage is rejected", () => { const o = good(); o.microbeats = o.microbeats.filter((_: any, i: number) => i === 0 || i === o.microbeats.length - 1); expect(parseBlueprint(JSON.stringify(o), input).ok).toBe(false); });
  it("approved time references must appear verbatim in the section's microbeats", () => {
    const timed = { ...input, chapter: { ...chapter, timeRefs: [{ sectionIndex: 0, kind: "raw", phrase: "ten past four" }, { sectionIndex: 1, kind: "relative", phrase: "the next morning" }] } } as BlueprintInput;
    const o = JSON.parse(mockBlueprintOutput(timed));
    // mock beats don't quote the phrases → rejected
    expect(parseBlueprint(JSON.stringify(o), timed).ok).toBe(false);
    // quote them in the right sections → accepted, and the phrases ride into the saved blueprint
    o.microbeats.find((b: any) => b.sectionId === "c0s0").text += " At ten past four.";
    o.microbeats.find((b: any) => b.sectionId === "c0s1").text += " The next morning.";
    const r = parseBlueprint(JSON.stringify(o), timed);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value.timeRefs).toHaveLength(2);
    // prompt lists the binding phrases
    expect(buildBlueprintPrompt(timed).user).toContain('"ten past four" (raw)');
    // a book with no time plan is unaffected
    expect(parseBlueprint(JSON.stringify(good()), input).ok).toBe(true);
  });
  it("unknown location/event references are rejected", () => { const o = good(); o.microbeats[0].locationId = "l9"; expect(parseBlueprint(JSON.stringify(o), input).ok).toBe(false); });
  it("prompt carries cast ids and caps the synopsis at 250 words", () => { const p = buildBlueprintPrompt(input).user; expect(p).toContain("k: Kiera Vance"); expect(p).toContain("at most 250 words"); });
  it("validator is deterministic", () => { const b = (parseBlueprint(JSON.stringify(good()), input) as any).value; expect(validateBlueprint(b, input)).toEqual([]); });
});

describe("recognised character ≠ approved knowledge", () => {
  const k = { character: "Kiera Vance", claim: "The beacon is a trap", kind: "knows", source: "direct_witness", truth: "true", evidence: "" } as any;
  const ids = [{ id: "k1", displayName: "Kiera Vance", aliases: [], universeId: null }];
  const base = { identities: ids, universeId: null, bookId: "b", chapterIndex: 0, subsectionIndex: 1, contentHash: "h" };
  it("claims from text that is no longer accepted are held", () => expect(knowledgeHold(k, { sourceCurrent: false })).toBe("source_not_current"));
  it("future reveal knowledge is held", () => expect(knowledgeHold({ ...k, claim: "Jax is the traitor" }, { futureSecretTerms: ["traitor"] })).toBe("future_knowledge"));
  it("a certain fact from deduction alone is held", () => expect(knowledgeHold({ ...k, source: "deduction" }, {})).toBe("unsupported_fact"));
  it("a witnessed claim from current accepted text is recorded", () => expect(knowledgeHold(k, { sourceCurrent: true, futureSecretTerms: ["traitor"] })).toBeNull());
  it("held claims stay pending as a knowledge check, linked to the person", () => {
    const r = planKnowledgeWrites([{ ...k, claim: "Jax is the traitor" }], { ...base, screen: { futureSecretTerms: ["traitor"] } });
    expect(r.rows).toHaveLength(0); expect(r.reviews[0].reason).toBe("knowledge_check"); expect(r.reviews[0].candidate_identity_ids).toEqual(["k1"]);
  });
  it("without a screen behaviour is unchanged", () => expect(planKnowledgeWrites([{ ...k, source: "deduction" }], base).rows).toHaveLength(1));
});
