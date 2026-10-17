import { describe, it, expect } from "vitest";
import {
  emptySetup, normalizeSetup, selectedSetupApproach, validateSetup, lockedChanges, setupPlannerGuidance, setupBookColumns, parseTwists, recommendCast,
  mockAlternativesOutput, mockConceptsOutput, mockTwistsOutput, checkReviewDecision, type BookSetup,
} from "../../supabase/functions/_shared/narrative/planning/bookSetup";
import { parseAlternatives, parseConcepts, runWithRepair, buildAlternativesPrompt, buildMasterPrompt, type BookBrief } from "../../supabase/functions/_shared/narrative/planning/aiPlanning";
import { planKnowledgeWrites } from "../../supabase/functions/_shared/narrative/knowledge";
import { isRole } from "../../supabase/functions/_shared/narrative/personaGeneration";

const brief: BookBrief = { title: "Port Ellery", bookType: "novel", genre: "mystery", audience: "adult", premise: "A harbour town hides a drowning.", guidance: null, targetWords: 50000, chapterCount: 12, series: null };
const ID1 = "11111111-1111-4111-8111-111111111111", ID2 = "22222222-2222-4222-8222-222222222222";
const withCast = (p: Partial<BookSetup> = {}): BookSetup => ({ ...emptySetup("x"), cast: [
  { key: "a", name: "Mara Quell", role: "protagonist", identityId: ID1, lightweight: false },
  { key: "b", name: "John Hale", role: "antagonist", identityId: null, lightweight: true },
], ...p });

describe("Phase 4 — story alternatives (free engine, real parsers)", () => {
  for (const n of [3, 5, 7, 10] as const) it(`produces ${n} distinct alternatives that pass the production parser`, () => {
    const r = parseAlternatives(mockAlternativesOutput(brief, n), n);
    expect(r.ok).toBe(true);
    if (r.ok) expect(new Set(r.value.map((a) => a.title)).size).toBe(n);
  });
  it("keeps fixed author requirements in every alternative", () => {
    const r = parseAlternatives(mockAlternativesOutput(brief, 5, ["Set in Port Ellery harbour"]), 5);
    expect(r.ok && r.value.every((a) => a.summary.includes("Port Ellery harbour"))).toBe(true);
  });
  it("regenerating with a variation gives a different set", () => {
    expect(mockAlternativesOutput({ ...brief, guidance: "variation 1" }, 3)).not.toBe(mockAlternativesOutput({ ...brief, guidance: "variation 2" }, 3));
  });
  it("runs through the same repair loop without any model call", async () => {
    let calls = 0; const out = mockAlternativesOutput(brief, 3);
    const r = await runWithRepair(async () => { calls++; return out; }, buildAlternativesPrompt(brief, 3), (t) => parseAlternatives(t, 3));
    expect(r.ok).toBe(true); expect(calls).toBe(1);
  });
  it("nonfiction gets approaches, not plots", () => {
    const r = parseConcepts(mockConceptsOutput({ ...brief, bookType: "self-help" }, 3), 3);
    expect(r.ok).toBe(true);
  });
  for (const n of [3, 5, 7, 10] as const) it(`master planning develops only the selected approach from ${n} options`, () => {
    const alternatives = Array.from({ length: n }, (_, i) => ({ id: `a${i}`, title: `Approach ${i + 1}`, logline: `Thesis ${i + 1}`, summary: `Detailed summary ${i + 1}`, twist: "", ending: `Outcome ${i + 1}`, coreThesis: `Thesis ${i + 1}`, approach: `Method ${i + 1}`, pillars: [`First support ${i + 1}`, `Second support ${i + 1}`], readerOutcome: `Outcome ${i + 1}` }));
    const setup = normalizeSetup({ ...emptySetup(), alternatives, selectedIndex: n - 1 });
    const picked = selectedSetupApproach(setup);
    expect(picked).toEqual(alternatives[n - 1]);
    const guidance = setupPlannerGuidance(setup);
    expect(guidance.alternative).toEqual(picked);
    const prompt = buildMasterPrompt({ ...brief, bookType: "self-help", guidance: guidance.guidance }, guidance.alternative).user;
    expect(prompt).toContain(`Detailed summary ${n}`);
    expect(prompt).toContain(`Method ${n}`);
    expect(prompt).toContain(`First support ${n}`);
    expect(prompt).toContain(`Outcome ${n}`);
    expect(prompt).not.toContain("Detailed summary 1");
    expect(prompt).not.toContain("Method 1");
  });
  it("skipping stories leaves no chosen alternative for the planner", () => {
    expect(setupPlannerGuidance({ ...emptySetup(), storyMode: "skip", alternatives: [{ id: "a", title: "t", logline: "", summary: "", twist: "", ending: "" }], selectedIndex: 0 }).alternative).toBeNull();
  });
});

describe("Phase 4 — plot twists", () => {
  it("parses proposed twists with in-range reveal chapters", () => {
    const r = parseTwists(mockTwistsOutput(brief, 3), 12);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value.every((t) => t.status === "proposed" && t.revealChapter !== null && t.revealChapter < 12)).toBe(true);
  });
  it("only approved twists reach the planner, with reveal timing", () => {
    const st = { ...emptySetup(), twistsEnabled: true, twists: [
      { id: "1", text: "The mentor staged it", status: "approved" as const, revealChapter: 8, clues: ["a key"] },
      { id: "2", text: "The dog was a robot", status: "rejected" as const, revealChapter: 3, clues: [] },
    ] };
    const g = setupPlannerGuidance(st).guidance;
    expect(g).toContain("The mentor staged it"); expect(g).toContain("chapter 9"); expect(g).not.toContain("robot");
    expect(g).toContain("not established canon");
  });
  it("twists switched off are ignored even if approved", () => {
    const g = setupPlannerGuidance({ ...emptySetup(), twistsEnabled: false, twists: [{ id: "1", text: "Secret twin", status: "approved", revealChapter: 2, clues: [] }] }).guidance;
    expect(g).not.toContain("Secret twin");
  });
  it("blocks twists past the last chapter", () => {
    const st = { ...emptySetup(), twistsEnabled: true, twists: [{ id: "1", text: "x", status: "approved" as const, revealChapter: 20, clues: [] }] };
    expect(validateSetup(st, { bookType: "novel", chapterCount: 12 }).some((i) => i.code === "TWIST_CHAPTER_RANGE" && i.blocking)).toBe(true);
  });
  it("nonfiction cannot use twists or multiple viewpoints", () => {
    const codes = validateSetup({ ...emptySetup(), twistsEnabled: true, perspective: "multiple" }, { bookType: "self-help" }).map((i) => i.code);
    expect(codes).toContain("NONFICTION_TWISTS"); expect(codes).toContain("NONFICTION_MULTI_POV");
  });
});

describe("Phase 4 — narrator, perspective, roles", () => {
  it("persona-led first person needs exactly one primary narrator", () => {
    const st = withCast({ narration: { pov: "first_person", personaLed: true, narratorKey: "a", vantage: "immediate", tellingDate: null } });
    expect(validateSetup(st, { bookType: "novel" }).some((i) => i.code === "ONE_PRIMARY_NARRATOR")).toBe(true);
    st.cast[0].role = "primary_narrator";
    expect(validateSetup(st, { bookType: "novel" }).filter((i) => i.blocking)).toEqual([]);
    st.cast[1].role = "primary_narrator";
    expect(validateSetup(st, { bookType: "novel" }).some((i) => i.code === "ONE_PRIMARY_NARRATOR")).toBe(true);
  });
  it("persona-led mode is never silently turned into multiple narrators", () => {
    const st = withCast({ perspective: "multiple", narration: { pov: "first_person", personaLed: true, narratorKey: "a", vantage: "immediate", tellingDate: null } });
    st.cast[0].role = "primary_narrator";
    expect(validateSetup(st, { bookType: "novel" }).some((i) => i.code === "PERSONA_LED_SINGLE_NARRATOR" && i.blocking)).toBe(true);
  });
  it("two viewpoints may share a chapter in separate sections (advisory only)", () => {
    const st = withCast({ perspective: "multiple", viewpoints: [{ castKey: "a", purpose: "", chapters: [2], sections: ["2:0"] }, { castKey: "b", purpose: "", chapters: [2], sections: ["2:1"] }] });
    const issues = validateSetup(st, { bookType: "novel" });
    expect(issues.filter((i) => i.blocking)).toEqual([]);
    expect(issues.some((i) => i.code === "VIEWPOINT_SHARED_CHAPTER" && !i.blocking)).toBe(true);
  });
  it("two viewpoints in the same section is head-hopping (blocking)", () => {
    const st = withCast({ perspective: "multiple", viewpoints: [{ castKey: "a", purpose: "", chapters: [2], sections: ["2:1"] }, { castKey: "b", purpose: "", chapters: [2], sections: ["2:1"] }] });
    expect(validateSetup(st, { bookType: "novel" }).some((i) => i.code === "HEAD_HOPPING" && i.blocking)).toBe(true);
  });
  it("test mode blocks every key source so no paid call can happen", async () => {
    const { failClosedDeps, statusForAIError } = await import("../../supabase/functions/_shared/ai/client");
    let touched = false;
    const deps = failClosedDeps({ env: { LOVABLE_API_KEY: "x", DEEPSEEK_API_KEY: "y" }, getUserKey: async () => { touched = true; return "k"; }, recordUsage: async () => {} });
    expect(deps.env).toEqual({});
    const err = await deps.getUserKey("google" as any).catch((e) => e);
    expect(err.code).toBe("test_mode_blocked");
    expect(statusForAIError(err)).toBe(403);
    expect(touched).toBe(false);
  });
  it("single perspective allows only one viewpoint", () => {
    const st = withCast({ viewpoints: [{ castKey: "a", purpose: "", chapters: [] }, { castKey: "b", purpose: "", chapters: [] }] });
    expect(validateSetup(st, { bookType: "novel" }).some((i) => i.code === "SINGLE_ONE_VIEWPOINT")).toBe(true);
  });
  it("book roles are separate from persona domains (ally, rival, viewpoint allowed)", () => {
    expect(isRole("ally") && isRole("rival") && isRole("viewpoint")).toBe(true);
    expect(isRole("medicine")).toBe(false);
  });
  it("the same persona can't be added twice", () => {
    const st = withCast(); st.cast[1].identityId = ID1;
    expect(validateSetup(st, { bookType: "novel" }).some((i) => i.code === "DUPLICATE_IDENTITY")).toBe(true);
  });
  it("narrator columns come from the cast identity; book-only narrators set no identity", () => {
    const st = withCast({ narration: { pov: "first_person", personaLed: false, narratorKey: "a", vantage: "retrospective", tellingDate: "March 2031" } });
    const c = setupBookColumns(st);
    expect(c.narrator_identity_id).toBe(ID1); expect(c.narrative_vantage).toBe("retrospective"); expect(c.narrator_telling_date).toEqual({ rawText: "March 2031" });
    expect(setupBookColumns({ ...st, narration: { ...st.narration, narratorKey: "b", vantage: "immediate" } })).toMatchObject({ narrator_identity_id: null, narrator_telling_date: null });
  });
});

describe("Phase 4 — pen names and universes", () => {
  it("a pen name can never be a character", () => {
    const st = withCast(); st.cast[1].name = "J. R. Quill";
    expect(validateSetup(st, { bookType: "novel", penNames: [{ id: ID2, pen_name: "J. R. Quill" }] }).some((i) => i.code === "PEN_NAME_AS_CHARACTER" && i.blocking)).toBe(true);
  });
  it("choosing a pen name doesn't make it the narrator", () => {
    const c = setupBookColumns({ ...emptySetup(), penNameId: ID2 });
    expect(c.author_identity_id).toBe(ID2); expect(c.narrator_identity_id).toBeNull();
  });
  it("normalize drops invalid ids so nothing unowned slips through", () => {
    const st = normalizeSetup({ universeId: "not-a-uuid", penNameId: "x", cast: [{ name: "A", identityId: "bad" }] });
    expect(st.universeId).toBeNull(); expect(st.penNameId).toBeNull(); expect(st.cast[0].identityId).toBeNull(); expect(st.cast[0].lightweight).toBe(true);
  });
});

describe("Phase 4 — save/resume and locks", () => {
  it("round-trips a partially completed setup", () => {
    const st = withCast({ stage: "twists", fixedRequirements: ["Harbour town"], twistsEnabled: true });
    expect(normalizeSetup(JSON.parse(JSON.stringify(st)))).toMatchObject({ stage: "twists", fixedRequirements: ["Harbour town"], twistsEnabled: true, cast: st.cast });
  });
  it("before writing, everything may change", () => {
    expect(lockedChanges(withCast(), { ...withCast(), universeId: ID2 }, false)).toEqual([]);
  });
  it("after writing, story, narrator, vantage, universe and identities are protected", () => {
    const prev = withCast();
    const next = { ...withCast(), universeId: ID2, narration: { ...prev.narration, vantage: "retrospective" as const } };
    next.cast = next.cast.map((c) => (c.key === "a" ? { ...c, identityId: ID2 } : c));
    const l = lockedChanges(prev, next, true);
    expect(l).toEqual(expect.arrayContaining(["narrative vantage", "shared universe", "identity of Mara Quell"]));
  });
  it("after writing, roles and notes stay editable", () => {
    const next = withCast(); next.cast[1].role = "rival"; next.cast[1].note = "older brother";
    expect(lockedChanges(withCast(), next, true)).toEqual([]);
  });
});

describe("Phase 4 — cast recommendations never create or merge", () => {
  const ids = [{ id: ID1, displayName: "Mara Quell", aliases: [], universeId: null }, { id: ID2, displayName: "Mara Stone", aliases: [], universeId: null }];
  it("classifies names against existing identities", () => {
    const recs = recommendCast("Mara Quell meets Petr Saul. Petr Saul lies. Ana Bell waves.", ids, null);
    expect(recs.find((r) => r.name === "Mara Quell")?.status).toBe("existing_match");
    expect(recs.find((r) => r.name === "Petr Saul")?.status).toBe("new_profile");
    expect(recs.find((r) => r.name === "Ana Bell")?.status).toBe("lightweight");
  });
  it("flags missing story functions", () => {
    expect(recommendCast("", [], null).map((r) => r.name)).toEqual(["(protagonist)", "(opposing force)"]);
  });
});

describe("Phase 4 — unmatched identity review", () => {
  const review = { reason: "ambiguous", candidate_identity_ids: [ID1], status: "PENDING" };
  it("ambiguous names can only be confirmed as a listed candidate", () => {
    expect(checkReviewDecision(review, "confirm_existing", ID2)).toMatch(/not one of/);
    expect(checkReviewDecision(review, "confirm_existing", ID1)).toBeNull();
  });
  it("decided reviews can't be decided twice", () => {
    expect(checkReviewDecision({ ...review, status: "RESOLVED" }, "dismiss")).toBe("Already decided");
  });
  it("resolving re-plans the held item idempotently onto the chosen identity", () => {
    const item = { character: "Mara", claim: "The boat was sabotaged", kind: "fact", source: "witnessed", truth: "true", evidence: "Mara saw the cut rope", storyDate: null, fromCharacter: null, supersedes: null } as any;
    const opts = { universeId: null, bookId: "b", chapterIndex: 2, subsectionIndex: 1, contentHash: "h" };
    const before = planKnowledgeWrites([item], { ...opts, identities: [{ id: ID1, displayName: "Mara Quell", aliases: [], universeId: null }, { id: ID2, displayName: "Mara Stone", aliases: [], universeId: null }] });
    expect(before.rows).toHaveLength(0); expect(before.reviews).toHaveLength(1);
    const after = planKnowledgeWrites([item], { ...opts, identities: [{ id: ID1, displayName: "Mara Quell", aliases: ["Mara"], universeId: null }] });
    expect(after.rows[0].identity_id).toBe(ID1);
    expect(planKnowledgeWrites([item], { ...opts, identities: [{ id: ID1, displayName: "Mara Quell", aliases: ["Mara"], universeId: null }] }).rows[0].dedup_key).toBe(after.rows[0].dedup_key);
  });
});
