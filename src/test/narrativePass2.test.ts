import { describe, it, expect } from "vitest";
import { buildNarrativeContext, selectNarrativeState, renderNarrativeContext, type NarrativeRows } from "../../supabase/functions/_shared/narrative/context.ts";
import {
  planExtraction, processSectionExtraction, threadTransitionFor, contentHash, evidenceSupported, EXTRACTION_AUTHORITY,
  type NarrativeRepo, type ExtractionRecord, type ExtractionPlan,
} from "../../supabase/functions/_shared/narrative/extraction.ts";
import { decideFactInsertion, validateThreadTransition } from "../../supabase/functions/_shared/narrative/rules.ts";

const P = (c: number, s: number) => c * 10000 + s;
const empty = (): NarrativeRows => ({ characters: [], states: [], events: [], participants: [], threads: [], threadEvents: [], facts: [], timeline: [], entities: [], snapshots: [] });

function fixture(): NarrativeRows {
  const r = empty();
  r.characters = [{ id: "c1", name: "Mara", source_key: "char_1", role: "protagonist", aliases: [], is_active: true }];
  r.states = [
    { id: "s1", character_id: "c1", chapter_index: 0, subsection_index: 1, position: P(0, 1), emotional_state: "anxious", location_text: "harbour", knowledge: ["the map is fake"], current_goals: [], inventory: [], secrets_known: [], beliefs: {}, relationships: {}, version: 1, is_current: true },
    { id: "s2", character_id: "c1", chapter_index: 2, subsection_index: 0, position: P(2, 0), physical_condition: "FUTURE_WOUND", knowledge: ["FUTURE_SECRET"], current_goals: [], inventory: [], secrets_known: [], beliefs: {}, relationships: {}, version: 1, is_current: true },
  ];
  r.events = [
    { id: "e1", chapter_index: 0, subsection_index: 1, position: P(0, 1), title: "Map found", summary: "Mara finds a map", is_canonical: true, causes: [], consequences: [], information_revealed: [] },
    { id: "e2", chapter_index: 1, subsection_index: 2, position: P(1, 2), title: "FUTURE_EVENT", summary: "future", is_canonical: true, causes: [], consequences: [], information_revealed: [] },
    { id: "e3", chapter_index: 1, subsection_index: 3, position: P(1, 3), title: "Treasure recovered", summary: "FUTURE_RESOLUTION", is_canonical: true, causes: [], consequences: [], information_revealed: [] },
  ];
  r.participants = [{ event_id: "e1", character_id: "c1" }];
  r.threads = [
    { id: "t1", title: "Where is the treasure?", status: "RESOLVED", resolution_notes: "SECRET_RESOLUTION_NOTES", resolved_chapter_index: 1, resolution_event_id: "e3", introduced_chapter_index: 0, introduced_subsection_index: 0, importance: "major" },
    { id: "t2", title: "Who betrayed the crew?", status: "OPEN", introduced_chapter_index: null, introduced_subsection_index: null, importance: "major", setup_promise: "A traitor is aboard" },
    { id: "t3", title: "FUTURE_THREAD", status: "OPEN", introduced_chapter_index: 3, introduced_subsection_index: 0, importance: "minor" },
  ];
  r.threadEvents = [{ thread_id: "t1", event_id: "e1", relation: "clue" }, { thread_id: "t1", event_id: "e3", relation: "resolves" }];
  r.facts = [
    { id: "f1", subject: "Mara", predicate: "age", value: "32", authority: "OUTLINE_CANON", is_canonical: true, conflict_status: "clean", source_chapter_index: null },
    { id: "f2", subject: "Ship", predicate: "name", value: "Heron", authority: "AI_INFERENCE", is_canonical: true, conflict_status: "disputed", source_chapter_index: 0, source_subsection_index: 1 },
    { id: "f3", subject: "Ship", predicate: "name", value: "Swift", authority: "AI_INFERENCE", is_canonical: true, conflict_status: "disputed", source_chapter_index: 0, source_subsection_index: 1 },
    { id: "f4", subject: "Mara", predicate: "scar", value: "FUTURE_FACT", authority: "AI_INFERENCE", is_canonical: true, conflict_status: "clean", source_chapter_index: 2, source_subsection_index: 0 },
  ];
  return r;
}

const at1_0 = { chapterIndex: 1, subsectionIndex: 0 };

describe("Pass 2 — point-in-time narrative context", () => {
  it("1. excludes future events", () => {
    const ctx = buildNarrativeContext(fixture(), at1_0);
    expect(ctx).toContain("Map found");
    expect(ctx).not.toContain("FUTURE_EVENT");
    expect(ctx).not.toContain("FUTURE_RESOLUTION");
  });
  it("2. excludes future character states", () => {
    const ctx = buildNarrativeContext(fixture(), at1_0);
    expect(ctx).toContain("anxious");
    expect(ctx).not.toContain("FUTURE_WOUND");
    expect(ctx).not.toContain("FUTURE_SECRET");
  });
  it("3. excludes future plot resolutions (thread shown as still open, no resolution notes)", () => {
    const s = selectNarrativeState(fixture(), at1_0);
    const t1 = s.activeThreads.find((t) => t.id === "t1");
    expect(t1).toBeTruthy();
    expect(t1!.status).toBe("DEVELOPING");
    const ctx = renderNarrativeContext(s);
    expect(ctx).not.toContain("SECRET_RESOLUTION_NOTES");
    // after the resolution point it is no longer active
    expect(selectNarrativeState(fixture(), { chapterIndex: 1, subsectionIndex: 4 }).activeThreads.some((t) => t.id === "t1")).toBe(false);
  });
  it("4. disputed facts are labelled and never presented as canonical", () => {
    const s = selectNarrativeState(fixture(), at1_0);
    expect(s.facts.map((f) => f.id)).toEqual(["f1"]);
    expect(s.disputedFacts.map((f) => f.id).sort()).toEqual(["f2", "f3"]);
    const ctx = renderNarrativeContext(s);
    const established = ctx.split("DISPUTED")[0];
    expect(established).not.toContain("Heron");
    expect(ctx).toContain("(disputed) Ship name: Heron");
    expect(ctx).not.toContain("FUTURE_FACT");
  });
  it("5. includes relevant active plot threads, excludes future-introduced ones", () => {
    const s = selectNarrativeState(fixture(), at1_0);
    expect(s.activeThreads.map((t) => t.id)).toContain("t2");
    expect(s.activeThreads.map((t) => t.id)).not.toContain("t3");
    expect(renderNarrativeContext(s)).toContain("A traitor is aboard");
  });
  it("6. retrieves merged temporal character state with unknowns left unknown", () => {
    const s = selectNarrativeState(fixture(), at1_0);
    const mara = s.characters.find((c) => c.id === "c1")!;
    expect(mara.state?.emotional).toBe("anxious");
    expect(mara.state?.location).toBe("harbour");
    expect(mara.state?.physical).toBeNull();
    expect(mara.state?.asOf).toEqual({ chapterIndex: 0, subsectionIndex: 1 });
    // later position sees the later state merged on top
    const later = selectNarrativeState(fixture(), { chapterIndex: 2, subsectionIndex: 1 }).characters[0].state!;
    expect(later.physical).toBe("FUTURE_WOUND");
    expect(later.knowledge).toEqual(["the map is fake", "FUTURE_SECRET"]);
  });
  it("never uses state recorded at the section being (re)written", () => {
    const s = selectNarrativeState(fixture(), { chapterIndex: 0, subsectionIndex: 1 });
    expect(s.recentEvents).toHaveLength(0);
    expect(s.characters.every((c) => c.state === null)).toBe(true); // a character first recorded at this section is not yet known
  });
});

const TEXT = `Mara pushed open the harbour door. "The map is a forgery," she whispered to Tomas, and her hands would not stop shaking. Outside, the Heron creaked at anchor. Tomas finally confessed that he had sold the crew's route to the Admiralty, and the betrayal was out in the open at last.`;
const known = { text: TEXT, characters: [{ id: "c1", name: "Mara" }], threads: [{ id: "t2", title: "Who betrayed the crew?", status: "OPEN" }] };

describe("Pass 2 — extraction planning", () => {
  it("7. a generated section produces an event record (evidence-backed)", () => {
    const plan = planExtraction({ events: [{ title: "Forgery revealed", summary: "Mara tells Tomas the map is fake", participants: ["Mara", "Tomas"], evidence: "The map is a forgery,\" she whispered to Tomas" }] }, known);
    expect(plan.events).toHaveLength(1);
    expect(plan.events[0].participants).toEqual(["Mara", "Tomas"]);
  });
  it("8. character changes recorded only when explicitly established", () => {
    const plan = planExtraction({
      character_changes: [
        { name: "Mara", emotional_state: "shaken", evidence: "her hands would not stop shaking" },
        { name: "Mara", physical_condition: "broken arm", evidence: "Mara broke her arm on the pier" }, // not in text
        { name: "Mara", evidence: "Mara pushed open the harbour door" }, // no change fields
        { name: "Ghost", emotional_state: "angry", evidence: "Mara pushed open the harbour door" }, // not named in text
      ],
    }, known);
    expect(plan.characterChanges).toHaveLength(1);
    expect(plan.characterChanges[0]).toMatchObject({ name: "Mara", characterId: "c1", emotional_state: "shaken", physical_condition: null });
    expect(plan.dropped.length).toBe(3);
  });
  it("9. extracted facts use AI_INFERENCE and the Pass 1 conflict rules", () => {
    expect(EXTRACTION_AUTHORITY).toBe("AI_INFERENCE");
    const plan = planExtraction({ facts: [{ subject: "Ship", predicate: "name", value: "Heron", evidence: "the Heron creaked at anchor" }, { subject: "Ship", predicate: "name", value: "Heron", evidence: "the Heron creaked at anchor" }] }, known);
    expect(plan.facts).toHaveLength(1); // in-batch duplicate removed
    const f = plan.facts[0];
    expect(decideFactInsertion({ value: f.value, authority: EXTRACTION_AUTHORITY }, { id: "x", value: "Swift", authority: "OUTLINE_CANON" }).kind).toBe("insert_disputed_noncanonical");
    expect(decideFactInsertion({ value: f.value, authority: EXTRACTION_AUTHORITY }, { id: "x", value: "heron", authority: "AI_INFERENCE" }).kind).toBe("duplicate");
  });
  it("10. plot-thread development is recorded (OPEN → DEVELOPING)", () => {
    const plan = planExtraction({ thread_updates: [{ thread_id: "t2", change: "develops", notes: "", evidence: "the Heron creaked at anchor" }] }, known);
    expect(plan.threadUpdates).toHaveLength(1);
    expect(threadTransitionFor(plan.threadUpdates[0], "OPEN", 1, null)).toEqual({ status: "DEVELOPING" });
    expect(threadTransitionFor(plan.threadUpdates[0], "DEVELOPING", 1, null)).toBeNull();
  });
  it("11. resolution requires strong evidence + notes and satisfies Pass 1 rules", () => {
    const weak = planExtraction({ thread_updates: [{ thread_id: "t2", change: "resolves", notes: "Tomas confessed", evidence: "Tomas finally confessed" }] }, known);
    expect(weak.threadUpdates).toHaveLength(0);
    const noNotes = planExtraction({ thread_updates: [{ thread_id: "t2", change: "resolves", notes: "", evidence: "Tomas finally confessed that he had sold the crew's route to the Admiralty" }] }, known);
    expect(noNotes.threadUpdates).toHaveLength(0);
    const strong = planExtraction({ thread_updates: [{ thread_id: "t2", change: "resolves", notes: "Tomas confessed to selling the route", evidence: "Tomas finally confessed that he had sold the crew's route to the Admiralty" }] }, known);
    expect(strong.threadUpdates).toHaveLength(1);
    const next = threadTransitionFor(strong.threadUpdates[0], "OPEN", 1, null)!;
    expect(next.status).toBe("RESOLVED");
    expect(validateThreadTransition(next.status, next)).toBeNull();
    // unknown thread ids and supersedes-without-replacement are rejected
    expect(planExtraction({ thread_updates: [{ thread_id: "nope", change: "develops", evidence: "the Heron creaked at anchor" }] }, known).threadUpdates).toHaveLength(0);
    expect(planExtraction({ thread_updates: [{ thread_id: "t2", change: "supersedes", notes: "x", evidence: "Tomas finally confessed that he had sold the crew's route" }] }, known).threadUpdates).toHaveLength(0);
  });
  it("evidence must genuinely appear in the text", () => {
    expect(evidenceSupported(TEXT, "“The map is a forgery,” she whispered")).toBe(true);
    expect(evidenceSupported(TEXT, "The map was genuine all along")).toBe(false);
    expect(evidenceSupported(TEXT, "Mara")).toBe(false); // too short to prove anything
  });
});

// ---------- In-memory repo for orchestration tests ----------
function memoryRepo(sectionText: string | null) {
  const state = { text: sectionText, records: new Map<string, ExtractionRecord>(), rows: [] as { extractionId: string; kind: string }[], applyCalls: 0, fail: null as string | null, reverted: 0 };
  let n = 0;
  const repo: NarrativeRepo = {
    async getSectionText() { return state.text ? { text: state.text, subsectionId: "sub1" } : null; },
    async getExtraction() { return state.records.get("k") ?? null; },
    async beginExtraction(_b, _p, hash) { const prev = state.records.get("k"); const r: ExtractionRecord = { id: `x${++n}`, content_hash: hash, status: "processing", attempts: (prev?.attempts ?? 0) + 1, applied: {}, updated_at: new Date().toISOString() }; state.records.set("k", r); return r; },
    async revertExtraction(rec) { state.reverted++; state.rows = state.rows.filter((r) => r.extractionId !== rec.id); },
    async seedFromOutline() {},
    async loadKnown() { return { characters: known.characters, threads: known.threads }; },
    async applyPlan(_b, _p, id, plan: ExtractionPlan) {
      state.applyCalls++;
      if (state.fail) throw new Error(state.fail);
      plan.events.forEach(() => state.rows.push({ extractionId: id, kind: "event" }));
      plan.facts.forEach(() => state.rows.push({ extractionId: id, kind: "fact" }));
      return {};
    },
    async saveSnapshot() {},
    async completeExtraction(id) { const r = state.records.get("k")!; if (r.id === id) r.status = "completed"; },
    async failExtraction(id) { const r = state.records.get("k")!; if (r.id === id) r.status = "failed"; },
  };
  return { repo, state };
}
const modelOutput = JSON.stringify({
  events: [{ title: "Confession", summary: "Tomas confesses", participants: ["Tomas"], evidence: "Tomas finally confessed that he had sold" }],
  facts: [{ subject: "Ship", predicate: "name", value: "Heron", evidence: "the Heron creaked at anchor" }],
});
const okModel = async () => ({ content: modelOutput, model: "test" });
const pos = { chapterIndex: 0, subsectionIndex: 0 };

describe("Pass 2 — orchestration, failure isolation, idempotency", () => {
  it("12. failed extraction returns a failure result without throwing (prose untouched)", async () => {
    const { repo, state } = memoryRepo(TEXT);
    const out = await processSectionExtraction(repo, async () => { throw new Error("model down"); }, "b", pos);
    expect(out.status).toBe("failed");
    expect(state.text).toBe(TEXT);
    expect(state.records.get("k")!.status).toBe("failed");
    // retryable: next attempt succeeds and does not duplicate
    const retry = await processSectionExtraction(repo, okModel, "b", pos);
    expect(retry.status).toBe("completed");
    expect(state.rows).toHaveLength(2);
  });
  it("12b. partial apply failure is rolled back on retry", async () => {
    const { repo, state } = memoryRepo(TEXT);
    state.fail = "db hiccup";
    expect((await processSectionExtraction(repo, okModel, "b", pos)).status).toBe("failed");
    state.fail = null;
    expect((await processSectionExtraction(repo, okModel, "b", pos)).status).toBe("completed");
    expect(state.rows).toHaveLength(2);
  });
  it("13. no prose → no narrative state, no model call", async () => {
    const { repo, state } = memoryRepo(null);
    let called = false;
    const out = await processSectionExtraction(repo, async () => { called = true; return { content: "{}", model: "t" }; }, "b", pos);
    expect(out.status).toBe("no_prose");
    expect(called).toBe(false);
    expect(state.records.size).toBe(0);
    expect(state.rows).toHaveLength(0);
  });
  it("14. reprocessing the same section never duplicates; changed text replaces old state", async () => {
    const { repo, state } = memoryRepo(TEXT);
    expect((await processSectionExtraction(repo, okModel, "b", pos)).status).toBe("completed");
    const again = await processSectionExtraction(repo, okModel, "b", pos);
    expect(again).toMatchObject({ status: "skipped", reason: "already_processed" });
    expect(state.rows).toHaveLength(2);
    expect(state.applyCalls).toBe(1);
    state.text = TEXT + " A gull screamed overhead.";
    const replaced = await processSectionExtraction(repo, okModel, "b", pos);
    expect(replaced).toMatchObject({ status: "completed", replacedPrevious: true });
    expect(state.rows).toHaveLength(2);
    expect(new Set(state.rows.map((r) => r.extractionId)).size).toBe(1);
  });
  it("content hash is deterministic and whitespace-insensitive", () => {
    expect(contentHash("a  b\nc")).toBe(contentHash("a b c"));
    expect(contentHash("a b c")).not.toBe(contentHash("a b d"));
  });
  it("15. empty narrative memory leaves the writer prompt unchanged", () => {
    expect(buildNarrativeContext(empty(), { chapterIndex: 0, subsectionIndex: 0 })).toBe("");
  });
});
