import { describe, it, expect } from "vitest";
import { adapterForBookType } from "../../supabase/functions/_shared/narrative/planning/adapters";
import { validatePlan } from "../../supabase/functions/_shared/narrative/planning/engine";
import {
  STORY_ALTERNATIVE_COUNTS, assertAlternativesEligible, buildAlternativesPrompt, buildChapterPrompt, buildMasterPrompt, buildSectionPrompt, parseAlternatives,
  parseBeats, parseChapter, parseMaster, parseSections, planIdemKey, proseWriterPlanView, runChapterBatch, runWithRepair, shapeSkeleton,
  type BookBrief, type MasterContext,
} from "../../supabase/functions/_shared/narrative/planning/aiPlanning";

// All model responses here are mocked fixtures: these tests prove structure, routing of
// knowledge and persistence logic — not the creative quality of real AI plans.
const brief = (bookType: string, extra: Partial<BookBrief> = {}): BookBrief => ({ title: "T", bookType, premise: "A lighthouse keeper finds a ledger.", targetWords: 30000, chapterCount: 3, ...extra });
const L = (k: number) => Array.from(String(k), (d) => "abcdefghij"[Number(d)]).join("");
const words = (n: number, seed: string) => Array.from({ length: n }, (_, i) => `${seed}${L(i % 97)}`).join(" ");
const alt = (i: number) => ({ title: `Story ${i}`, logline: "l", summary: words(500, `story${L(i)}q`), twist: "t", ending: "e" });

const fictionMaster = JSON.stringify({
  premise: "p", synopsis: "s", ending: "The keeper burns the ledger.",
  genre_data: { protagonist: "Ana", central_conflict: "c", stakes: "s", timeframe: "October 1961, one lighthouse, three weeks" },
  reveals: [{ summary: "The ledger is in Ana's own handwriting", revealChapter: 2, setupChapters: [0, 1] }],
  chapters: [
    { objectiveKind: "setup", objective: "Ana finds the ledger", sectionCount: 2, weight: 0.8 },
    { objectiveKind: "complication", objective: "Entries predict storms", sectionCount: 5, weight: 1.4 },
    { objectiveKind: "resolution", objective: "Ana confronts herself", sectionCount: 3 },
  ],
});
const master = (): MasterContext => {
  const r = parseMaster(fictionMaster, brief("novel"), null);
  if (!r.ok) throw new Error((r as { issues: string[] }).issues.join(";"));
  return { premise: r.value.premise, synopsis: r.value.synopsis, ending: r.value.ending, skeleton: r.value.skeleton };
};

describe("Phase D story alternatives", () => {
  it("supports exactly 3, 5, 7 and 10", () => {
    expect([...STORY_ALTERNATIVE_COUNTS]).toEqual([3, 5, 7, 10]);
    expect(() => assertAlternativesEligible("novel", 4)).toThrow();
    for (const c of STORY_ALTERNATIVE_COUNTS) expect(buildAlternativesPrompt(brief("novel"), c).user).toContain(`exactly ${c} complete story alternatives`);
  });
  it("allows brainstorming alternatives for every book type, nonfiction without inventing facts", () => {
    expect(() => assertAlternativesEligible("business", 3)).not.toThrow();
    expect(() => assertAlternativesEligible("memoir", 3)).not.toThrow();
    expect(buildAlternativesPrompt(brief("self-help"), 3).user).toMatch(/Invent no facts/);
  });
  it("accepts the right count of ~500-word distinct stories, rejects wrong count and near-duplicates", () => {
    expect(parseAlternatives(JSON.stringify({ alternatives: [1, 2, 3, 4, 5].map(alt) }), 5).ok).toBe(true);
    expect(parseAlternatives(JSON.stringify({ alternatives: [1, 2, 3].map(alt) }), 5).ok).toBe(false);
    const dup = [alt(1), { ...alt(1), title: "Other" }, alt(3)];
    const r = parseAlternatives(JSON.stringify({ alternatives: dup }), 3);
    expect(r.ok).toBe(false);
    if (!r.ok) expect((r as { issues: string[] }).issues.join()).toMatch(/too similar/);
  });
  it("prompt does not force fixed twist categories", () => {
    expect(buildAlternativesPrompt(brief("novel"), 7).user).toMatch(/not drawn from a fixed list/);
  });
});

describe("Phase D master plan", () => {
  it("valid master plan with adaptive section counts and exact word estimates", () => {
    const m = master();
    expect(validatePlan(m.skeleton)).toEqual([]);
    expect(m.skeleton.chapters.map((c) => c.sections.length)).toEqual([2, 5, 3]);
    expect(m.skeleton.chapters[1].targetWords).toBeGreaterThan(m.skeleton.chapters[0].targetWords);
    expect(m.skeleton.chapters.reduce((a, c) => a + c.targetWords, 0)).toBe(30000);
  });
  it("chosen alternative feeds the master prompt", () => {
    expect(buildMasterPrompt(brief("novel"), { id: "alt2", ...alt(2), twist: "TWIST-X" }).user).toContain("TWIST-X");
  });
  it("nonfiction master with reveals is rejected", () => {
    const raw = JSON.stringify({ premise: "p", synopsis: "s", ending: "e", genre_data: { audience_role: "a", core_thesis: "b", framework: "c" }, reveals: [{ summary: "x", revealChapter: 1, setupChapters: [0] }], chapters: [{ objectiveKind: "problem", objective: "o" }, { objectiveKind: "implementation", objective: "o" }] });
    expect(parseMaster(raw, brief("business"), null).ok).toBe(false);
  });
  it("biography and memoir use the true-story planner", () => {
    expect(adapterForBookType("biography").id).toBe("narrative_nonfiction");
    expect(adapterForBookType("memoir").isFiction).toBe(false);
    expect(buildMasterPrompt(brief("memoir"), null).system).toMatch(/Never invent biographical facts/);
  });
  it("cookbook sections may declare shared-technique dependencies", () => {
    const sk = shapeSkeleton({ bookType: "cookbook", targetWords: 20000, genreData: { cuisine: "x", skill_level: "y", unit_system: "z" }, reveals: [], chapters: [{ objectiveKind: "technique", objective: "pastry" }, { objectiveKind: "recipe_group", objective: "pies" }] });
    sk.chapters[1].sections[2].dependsOn = ["c0s1"];
    expect(validatePlan(sk)).toEqual([]);
  });
});

describe("Phase D knowledge boundaries", () => {
  it("chapter planner sees the ending and every future reveal", () => {
    const p = buildChapterPrompt(master(), 0, {});
    expect(p.user).toContain("Ana's own handwriting");
    expect(p.user).toContain("The keeper burns the ledger.");
    expect(p.user).toContain("ch3 [resolution]");
  });
  it("prose writer view hides future reveal summaries", () => {
    const v = proseWriterPlanView(master(), 0);
    expect(JSON.stringify(v)).not.toContain("handwriting");
    expect(v.foreshadow).toEqual([{ id: "r1", hint: "setup_only" }]);
    expect(JSON.stringify(proseWriterPlanView(master(), 2))).toContain("handwriting");
  });
});

describe("Phase D chapter, section and beat parsing", () => {
  it("chapter expansion picks its own section count and rejects forward deps", () => {
    const m = master();
    const ok = parseChapter(JSON.stringify({ objective: "o", stakes: "s", focus: "f", sections: [{ objective: "a" }, { objective: "b", dependsOn: ["c1s0"] }, { objective: "c", weight: 2 }], timeRefs: [
      { section: 0, kind: "relative", phrase: "three hours later" }, { section: 1, kind: "relative", phrase: "the next morning" },
      { section: 1, kind: "raw", phrase: "ten past four" }, { section: 2, kind: "combined", phrase: "two hours later, at 5:00 PM" },
    ] }), m, 1, {});
    expect(ok.ok).toBe(true);
    if (ok.ok) { expect(ok.value.chapter.sections).toHaveLength(3); expect(ok.value.chapter.sections.reduce((a, s) => a + s.targetWords, 0)).toBe(m.skeleton.chapters[1].targetWords); expect(ok.value.chapter.timeRefs).toHaveLength(4); }
    expect(parseChapter(JSON.stringify({ objective: "o", stakes: "s", sections: [{ objective: "a", dependsOn: ["c2s0"] }] }), m, 1, {}).ok).toBe(false);
  });
  it("beats vary per section and are restricted to the genre palette", () => {
    const m = master(); const ch = m.skeleton.chapters[0];
    const good = parseBeats(JSON.stringify({ sections: [{ id: "c0s0", beats: [{ kind: "goal", note: "n" }, { kind: "turn", note: "n" }] }, { id: "c0s1", beats: [{ kind: "entry", note: "n" }, { kind: "obstacle", note: "n" }, { kind: "obstacle", note: "n" }, { kind: "exit_hook", note: "n" }] }] }), m, ch);
    expect(good.ok).toBe(true);
    if (good.ok) expect(good.value.chapter.sections.map((s) => s.beats.length)).toEqual([2, 4]);
    expect(parseBeats(JSON.stringify({ sections: [{ id: "c0s0", beats: [{ kind: "claim", note: "n" }] }, { id: "c0s1", beats: [{ kind: "goal", note: "n" }] }] }), m, ch).ok).toBe(false);
  });
  it("chapter time plan: 4–8 refs, proportional mix, scattered, valid sections", () => {
    const m = master();
    const base = { objective: "o", stakes: "s", sections: [{ objective: "a" }, { objective: "b" }, { objective: "c" }] };
    const refs = (r: unknown[]) => JSON.stringify({ ...base, timeRefs: r });
    // valid: 2 relative (50%), 1 raw (25%), 1 combined (25%), all 3 sections covered
    const good = [{ section: 0, kind: "relative", phrase: "three hours later" }, { section: 1, kind: "relative", phrase: "the next morning" },
      { section: 1, kind: "raw", phrase: "noon" }, { section: 2, kind: "combined", phrase: "two hours later, at 5:00 PM" }];
    expect(parseChapter(refs(good), m, 1, {}).ok).toBe(true);
    // missing entirely
    expect(parseChapter(JSON.stringify(base), m, 1, {}).ok).toBe(false);
    // too few
    expect(parseChapter(refs(good.slice(0, 3)), m, 1, {}).ok).toBe(false);
    // all raw → mix violated
    expect(parseChapter(refs([0, 1, 2, 0].map((s) => ({ section: s, kind: "raw", phrase: "noon" }))), m, 1, {}).ok).toBe(false);
    // all in one section → not scattered
    expect(parseChapter(refs(good.map((r) => ({ ...r, section: 0 }))), m, 1, {}).ok).toBe(false);
    // unknown section
    expect(parseChapter(refs([...good.slice(0, 3), { section: 9, kind: "combined", phrase: "later at 5 PM" }]), m, 1, {}).ok).toBe(false);
    // bad kind
    expect(parseChapter(refs([...good.slice(0, 3), { section: 2, kind: "vague", phrase: "later at 5 PM" }]), m, 1, {}).ok).toBe(false);
  });
  it("chapter prompt carries the time rules and prior chapters' established clock", () => {
    const m = master();
    expect(buildChapterPrompt(m, 0, {}).user).toMatch(/40–60% relative-only/);
    const prev = parseChapter(JSON.stringify({ objective: "o", stakes: "s", sections: [{ objective: "a" }], timeRefs: [
      { section: 0, kind: "relative", phrase: "three hours later" }, { section: 0, kind: "relative", phrase: "the next morning" },
      { section: 0, kind: "raw", phrase: "noon" }, { section: 0, kind: "combined", phrase: "two hours later, at 5:00 PM" }] }), m, 0, {});
    expect(prev.ok).toBe(true);
    if (prev.ok) expect(buildChapterPrompt(m, 1, { 0: prev.value.chapter }).user).toContain("ten past four".length ? "three hours later" : "");
  });
  it("master plan requires a fiction timeframe", () => {
    const noTime = fictionMaster.replace(`"timeframe":"October 1961, one lighthouse, three weeks"`, `"protagonist2":"x"`);
    expect(parseMaster(noTime, brief("novel"), null).ok).toBe(false);
    expect(buildMasterPrompt(brief("novel"), null).user).toContain("timeframe");
    expect(buildMasterPrompt(brief("business"), null).user).not.toContain("timeframe");
  });
  it("section summaries must quote their assigned time phrases verbatim", () => {
    const m = master();
    const prev = parseChapter(JSON.stringify({ objective: "o", stakes: "s", sections: [{ objective: "a" }, { objective: "b" }], timeRefs: [
      { section: 0, kind: "relative", phrase: "three hours later" }, { section: 0, kind: "relative", phrase: "the next morning" },
      { section: 1, kind: "raw", phrase: "ten past four" }, { section: 1, kind: "combined", phrase: "two hours later, at 5:00 PM" }] }), m, 1, {});
    expect(prev.ok).toBe(true);
    if (!prev.ok) return;
    const ch = prev.value.chapter;
    const prompt = buildSectionPrompt(m, ch, {});
    expect(prompt.user).toContain('"ten past four" (raw)');
    const withTime = JSON.stringify({ sections: [
      { id: "c1s0", entry: "Three hours later she returns", focus: "the next morning brings news", outcome: "c" },
      { id: "c1s1", entry: "At ten past four the bell rings", focus: "b", outcome: "two hours later, at 5:00 PM it ends" }] });
    expect(parseSections(withTime, m, ch).ok).toBe(true);
    const dropped = JSON.stringify({ sections: [
      { id: "c1s0", entry: "She returns", focus: "news arrives", outcome: "c" },
      { id: "c1s1", entry: "The bell rings", focus: "b", outcome: "it ends" }] });
    const bad = parseSections(dropped, m, ch);
    expect(bad.ok).toBe(false);
    if (bad.ok) throw new Error("expected rejection");
    expect((bad as { issues: string[] }).issues.join()).toMatch(/ten past four/);
  });
  it("true-story sections need evidence tiers, sources for documented claims, and no verification claims", () => {
    const sk = shapeSkeleton({ bookType: "memoir", targetWords: 9000, genreData: { subject: "x", historical_scope: "y", primary_sources: "letters 1961", epistemic_boundaries: "z" }, reveals: [], chapters: [{ objectiveKind: "context_origins", objective: "o", sectionCount: 1 }] });
    const m: MasterContext = { premise: "p", synopsis: "s", ending: "e", skeleton: sk };
    const sec = (evidence: unknown[]) => JSON.stringify({ sections: [{ id: "c0s0", entry: "a", focus: "b", outcome: "c", evidence }] });
    expect(parseSections(sec([{ claim: "Moved to Leeds", tier: "documented", source: "letters 1961" }, { claim: "Felt afraid", tier: "recollection" }]), m, sk.chapters[0]).ok).toBe(true);
    expect(parseSections(sec([]), m, sk.chapters[0]).ok).toBe(false);
    expect(parseSections(sec([{ claim: "x", tier: "documented" }]), m, sk.chapters[0]).ok).toBe(false);
    expect(parseSections(sec([{ claim: "x", tier: "verified" }]), m, sk.chapters[0]).ok).toBe(false);
    expect(parseSections(sec([{ claim: "independently verified date", tier: "recollection" }]), m, sk.chapters[0]).ok).toBe(false);
  });
});

describe("Phase D reliability", () => {
  it("repairs malformed output within the bound", async () => {
    const replies = ["not json", fictionMaster];
    const calls: string[] = [];
    const r = await runWithRepair(async (p) => { calls.push(p.user); return replies.shift()!; }, { system: "s", user: "u" }, (t) => parseMaster(t, brief("novel"), null));
    expect(r.ok).toBe(true); expect(r.attempts).toBe(2); expect(calls[1]).toMatch(/rejected/);
  });
  it("gives up after 2 repairs (3 calls total)", async () => {
    let n = 0;
    const r = await runWithRepair(async () => { n++; return "{}"; }, { system: "s", user: "u" }, (t) => parseMaster(t, brief("novel"), null));
    expect(r.ok).toBe(false); expect(n).toBe(3);
  });
  it("batch keeps completed chapters, stops at the failure, and resumes without re-planning them", async () => {
    const done = new Set<number>(); const ran: number[] = [];
    let failOn: number | null = 2;
    const runOne = async (ch: number) => { ran.push(ch); if (ch === failOn) return { ok: false, issues: ["bad"] }; done.add(ch); return { ok: true, issues: [] }; };
    const first = await runChapterBatch([0, 1, 2, 3], (c) => done.has(c), runOne);
    expect(first).toEqual({ completed: [0, 1], reused: [], failed: { chapter: 2, issues: ["bad"] } });
    failOn = null; ran.length = 0;
    const second = await runChapterBatch([0, 1, 2, 3], (c) => done.has(c), runOne);
    expect(second.reused).toEqual([0, 1]); expect(second.completed).toEqual([2, 3]); expect(ran).toEqual([2, 3]);
  });
  it("idempotency keys are stable for identical inputs", () => {
    expect(planIdemKey(["chapter", "m", 3, "r"])).toBe(planIdemKey(["chapter", "m", 3, "r"]));
    expect(planIdemKey(["chapter", "m", 3, "r"])).not.toBe(planIdemKey(["chapter", "m", 4, "r"]));
  });
});
