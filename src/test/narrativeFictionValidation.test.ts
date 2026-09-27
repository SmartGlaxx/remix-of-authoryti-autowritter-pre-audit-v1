// Pass 2 fiction validation — a three-chapter fiction fixture run end to end through
// the real extraction orchestrator, the real shared fact-mutation implementation and
// the real point-in-time context selection. No production data is touched.
import { describe, it, expect } from "vitest";
import { buildNarrativeContext, selectNarrativeState, type NarrativeRows } from "../../supabase/functions/_shared/narrative/context.ts";
import {
  processSectionExtraction, threadTransitionFor, contentHash,
  type NarrativeRepo, type ExtractionRecord, type ExtractionPlan, type ModelCaller,
} from "../../supabase/functions/_shared/narrative/extraction.ts";
import { applyCanonicalFact } from "../../supabase/functions/_shared/narrative/factMutation.ts";
import { normText, toPosition, type StoryPosition } from "../../supabase/functions/_shared/narrative/rules.ts";

// ---------------------------------------------------------------- fake database
/** Minimal in-memory stand-in for the subset of the client used by factMutation. */
function fakeDb(facts: Row[]) {
  let seq = 0;
  const nextId = () => `f${++seq}`;
  const wrap = (data: unknown) => Promise.resolve({ data, error: null });
  return {
    from(table: string) {
      if (table !== "canonical_facts") throw new Error(`fakeDb only handles canonical_facts, got ${table}`);
      const filters: ((r: Row) => boolean)[] = [];
      const api: Row = {
        select: () => api,
        order: () => api,
        limit: () => api,
        eq(col: string, v: unknown) { filters.push((r) => r[col] === v); return api; },
        ilike(col: string, v: string) { filters.push((r) => normText(String(r[col] ?? "")) === normText(v)); return api; },
        in(col: string, vs: unknown[]) { filters.push((r) => vs.includes(r[col])); return api; },
        maybeSingle: () => wrap(facts.filter((r) => filters.every((f) => f(r)))[0] ?? null),
        single: () => wrap(facts.filter((r) => filters.every((f) => f(r)))[0] ?? null),
        insert(row: Row) {
          const created = { id: nextId(), conflicting_fact_id: null, notes: null, ...row };
          facts.push(created);
          return { select: () => ({ single: () => wrap(created) }) };
        },
        update(patch: Row) {
          return {
            eq(col: string, v: unknown) {
              for (const r of facts) if (r[col] === v) Object.assign(r, patch);
              return wrap(null);
            },
          };
        },
      };
      return api;
    },
  };
}

// ---------------------------------------------------------------- memory repo
type Row = Record<string, unknown>;

interface Section { text: string; pos: StoryPosition }

class MemoryRepo implements NarrativeRepo {
  rows: NarrativeRows = { characters: [], states: [], events: [], participants: [], threads: [], threadEvents: [], facts: [], timeline: [], entities: [], snapshots: [] };
  extractions: (ExtractionRecord & { chapter_index: number; subsection_index: number })[] = [];
  sections = new Map<string, string>();
  failApply = false;
  private seq = 0;
  private id = (p: string) => `${p}${++this.seq}`;
  private key = (pos: StoryPosition) => `${pos.chapterIndex}:${pos.subsectionIndex}`;

  setSection(pos: StoryPosition, text: string) { this.sections.set(this.key(pos), text); }

  async getSectionText(_b: string, pos: StoryPosition) {
    const text = this.sections.get(this.key(pos));
    return text ? { text, subsectionId: this.key(pos) } : null;
  }
  async getExtraction(_b: string, pos: StoryPosition) {
    return this.extractions.find((e) => e.chapter_index === pos.chapterIndex && e.subsection_index === pos.subsectionIndex) ?? null;
  }
  async beginExtraction(_b: string, pos: StoryPosition, hash: string) {
    const found = await this.getExtraction(_b, pos);
    if (found) { Object.assign(found, { content_hash: hash, status: "processing", attempts: found.attempts + 1, applied: {}, updated_at: new Date().toISOString() }); return found; }
    const rec = { id: this.id("x"), chapter_index: pos.chapterIndex, subsection_index: pos.subsectionIndex, content_hash: hash, status: "processing" as const, attempts: 1, applied: {}, updated_at: new Date().toISOString() };
    this.extractions.push(rec);
    return rec;
  }
  async revertExtraction(rec: ExtractionRecord) {
    const undo = ((rec.applied as Row)?.undo as Row[]) ?? [];
    for (const u of [...undo].reverse()) {
      const list = u.table === "plot_threads" ? this.rows.threads : this.rows.facts;
      const row = (list as Row[]).find((r) => r.id === u.id);
      if (row) Object.assign(row, u.before);
    }
    const drop = (list: Row[]) => list.filter((r) => r.extraction_id !== rec.id);
    this.rows.events = drop(this.rows.events as Row[]) as never;
    this.rows.states = drop(this.rows.states as Row[]) as never;
    this.rows.facts = drop(this.rows.facts as Row[]) as never;
    this.rows.threads = drop(this.rows.threads as Row[]) as never;
    this.rows.timeline = drop(this.rows.timeline as Row[]) as never;
  }
  async seedFromOutline() { /* fixture seeds directly */ }
  async loadKnown() {
    return {
      characters: (this.rows.characters as Row[]).map((c) => ({ id: String(c.id), name: String(c.name), aliases: (c.aliases as string[]) ?? [] })),
      threads: (this.rows.threads as Row[]).map((t) => ({ id: String(t.id), title: String(t.title), status: String(t.status), setup_promise: (t.setup_promise as string) ?? null })),
    };
  }
  private ensureChar(name: string): string {
    const found = (this.rows.characters as Row[]).find((c) => normText(String(c.name)) === normText(name));
    if (found) return String(found.id);
    const row = { id: this.id("c"), name, aliases: [], is_active: true };
    (this.rows.characters as Row[]).push(row);
    return row.id;
  }
  async applyPlan(bookId: string, pos: StoryPosition, extractionId: string, plan: ExtractionPlan) {
    if (this.failApply) throw new Error("simulated extraction failure");
    const undo: Row[] = [];
    const p = toPosition(pos);
    const at = { chapter_index: pos.chapterIndex, subsection_index: pos.subsectionIndex, position: p, extraction_id: extractionId };

    for (const en of plan.entities) {
      if (!(this.rows.entities as Row[]).some((e) => normText(String(e.name)) === normText(en.name))) {
        (this.rows.entities as Row[]).push({ id: this.id("en"), name: en.name, entity_type: en.entity_type, description: en.description, first_chapter_index: pos.chapterIndex, first_subsection_index: pos.subsectionIndex, is_active: true });
      }
    }
    const eventIds: string[] = [];
    for (const e of plan.events) {
      const id = this.id("e");
      (this.rows.events as Row[]).push({ id, ...at, title: e.title, summary: e.summary, location_text: e.location, causes: e.causes, consequences: e.consequences, information_revealed: e.information_revealed, information_withheld: e.information_withheld, is_canonical: true });
      eventIds.push(id);
      for (const name of e.participants) (this.rows.participants as Row[]).push({ event_id: id, character_id: this.ensureChar(name) });
      (this.rows.timeline as Row[]).push({ id: this.id("tl"), event_id: id, ...at, relative_order: p, event_summary: e.summary, is_flashback: e.is_flashback });
    }
    for (const c of plan.characterChanges) {
      const character_id = c.characterId ?? this.ensureChar(c.name);
      const prev = (this.rows.states as Row[]).find((s) => s.character_id === character_id && s.position === p && s.is_current);
      const id = this.id("s");
      (this.rows.states as Row[]).push({
        id, character_id, ...at, location_text: c.location, physical_condition: c.physical_condition, emotional_state: c.emotional_state,
        current_goals: c.goals, current_motivations: c.motivations, knowledge: c.knowledge, beliefs: c.beliefs, secrets_known: c.secrets,
        relationships: c.relationships, inventory: c.inventory, key_changes: c.key_changes, version: prev ? Number(prev.version) + 1 : 1, is_current: true,
      });
      if (prev) Object.assign(prev, { is_current: false, superseded_by: id });
    }
    const factOutcomes: Record<string, number> = {};
    for (const f of plan.facts) {
      const res = await applyCanonicalFact(fakeDb(this.rows.facts as Row[]), {
        bookId, userId: "u1",
        fact: { subject: f.subject, predicate: f.predicate, value: f.value, category: f.category, authority: "AI_INFERENCE", sourceType: "extraction", position: pos, sourceExcerpt: f.evidence, confidence: f.confidence, extractionId },
      }, async (before) => { undo.push({ table: "canonical_facts", id: before.id, before: { conflict_status: before.conflict_status, conflicting_fact_id: before.conflicting_fact_id } }); });
      factOutcomes[res.outcome] = (factOutcomes[res.outcome] ?? 0) + 1;
    }
    const newIds = new Map<string, string>();
    for (const t of plan.newThreads) {
      const id = this.id("t");
      (this.rows.threads as Row[]).push({ id, title: t.title, description: t.description, setup_promise: t.setup_promise ?? t.evidence, importance: t.importance, status: "OPEN", introduced_chapter_index: pos.chapterIndex, introduced_subsection_index: pos.subsectionIndex, extraction_id: extractionId });
      newIds.set(normText(t.title), id);
      if (eventIds[0]) (this.rows.threadEvents as Row[]).push({ thread_id: id, event_id: eventIds[0], relation: "introduces" });
    }
    let threadStatusChanges = 0;
    for (const u of plan.threadUpdates) {
      const cur = (this.rows.threads as Row[]).find((t) => t.id === u.thread_id);
      if (!cur) continue;
      const relation = u.change === "resolves" ? "resolves" : u.change === "clue" ? "clue" : u.change === "complicates" ? "complicates" : "develops";
      if (eventIds[0]) (this.rows.threadEvents as Row[]).push({ thread_id: cur.id, event_id: eventIds[0], relation });
      const next = threadTransitionFor(u, String(cur.status), pos.chapterIndex, u.superseded_by_title ? newIds.get(normText(u.superseded_by_title)) ?? null : null);
      if (!next) continue;
      undo.push({ table: "plot_threads", id: cur.id, before: { status: cur.status, resolution_notes: cur.resolution_notes ?? null, resolved_chapter_index: cur.resolved_chapter_index ?? null } });
      Object.assign(cur, { status: next.status, resolution_notes: next.resolutionNotes ?? cur.resolution_notes, resolved_chapter_index: next.resolvedChapterIndex ?? cur.resolved_chapter_index, resolution_event_id: next.status === "RESOLVED" ? eventIds[eventIds.length - 1] : cur.resolution_event_id });
      threadStatusChanges++;
    }
    return { undo, factOutcomes, threadStatusChanges };
  }
  async saveSnapshot(_b: string, pos: StoryPosition) {
    const existing = (this.rows.snapshots as Row[]).find((s) => s.chapter_index === pos.chapterIndex && s.subsection_index === pos.subsectionIndex);
    if (existing) { existing.version = Number(existing.version) + 1; return; }
    (this.rows.snapshots as Row[]).push({ id: this.id("sn"), chapter_index: pos.chapterIndex, subsection_index: pos.subsectionIndex, scope: "subsection", narrative_summary: null, version: 1, state: {} });
  }
  async completeExtraction(id: string, applied: Record<string, unknown>) {
    const rec = this.extractions.find((e) => e.id === id);
    if (rec) Object.assign(rec, { status: "completed", applied, error: null });
  }
  async failExtraction(id: string, error: string) {
    const rec = this.extractions.find((e) => e.id === id);
    if (rec) Object.assign(rec, { status: "failed", error });
  }
}

// ---------------------------------------------------------------- fiction fixture
const CH1 = `Mara stepped onto the harbour wall at Greyport and pulled her coat tight. Her brother Tomas waited by the crates with the brass key their father had left them. "Someone aboard sold our route to the Admiralty," Mara said, and her hands were shaking with anger. Tomas handed her the brass key without a word, and she slipped it into her pocket.`;

const CH2 = `Inside the lighthouse at Greyport, Mara turned the brass key in the old lock and found the ledger. The ledger listed every payment made to the traitor, but the name at the bottom had been burned away. Tomas had gone quiet, and Mara noticed he would not look at the burned page.`;

const CH3 = `Tomas finally confessed in the lighthouse that he was the one who had sold the route to the Admiralty, and he had done it to pay their father's debts. Mara took the ledger from him and walked out into the rain, calm at last, knowing exactly who had betrayed the crew.`;

function modelFor(text: string): ModelCaller {
  return async () => ({ content: JSON.stringify(payloadFor(text)), model: "test-model" });
}

function payloadFor(text: string): Record<string, unknown> {
  if (text === CH1) {
    return {
      events: [{ title: "Arrival at Greyport", summary: "Mara meets Tomas on the harbour wall and learns the route was sold.", location: "Greyport", participants: ["Mara", "Tomas"], causes: ["the route was sold to the Admiralty"], consequences: ["Mara resolves to find the traitor"], information_revealed: ["someone sold the route"], information_withheld: ["the traitor's name"], is_flashback: false, story_date: null, story_time: null, evidence: "Mara stepped onto the harbour wall at Greyport" }],
      character_changes: [
        { name: "Mara", location: "Greyport harbour wall", physical_condition: null, emotional_state: "angry", goals: ["find the traitor"], motivations: null, knowledge: ["the route was sold to the Admiralty"], beliefs: {}, secrets: [], relationships: { Tomas: "brother" }, inventory: ["brass key"], key_changes: "Receives the brass key", evidence: "she slipped it into her pocket" },
        { name: "Tomas", location: "Greyport harbour wall", physical_condition: null, emotional_state: null, goals: [], motivations: null, knowledge: [], beliefs: {}, secrets: [], relationships: { Mara: "sister" }, inventory: [], key_changes: "Gives the brass key away", evidence: "Tomas handed her the brass key without a word" },
      ],
      facts: [
        { subject: "Mara", predicate: "sibling", value: "Tomas is her brother", category: "character", confidence: 0.9, evidence: "Her brother Tomas waited by the crates" },
        { subject: "Brass key", predicate: "origin", value: "left to them by their father", category: "world", confidence: 0.8, evidence: "with the brass key their father had left them" },
        { subject: "Rain", predicate: "feeling", value: "the storm is like a hand pressing down", category: "general", confidence: 0.4, evidence: "not present in the text at all" },
      ],
      thread_updates: [],
      new_threads: [{ title: "Who betrayed the crew?", description: "Someone aboard sold the route to the Admiralty.", setup_promise: "The traitor must be identified.", importance: "major", evidence: "Someone aboard sold our route to the Admiralty" }],
      entities: [{ name: "Greyport", entity_type: "location", description: "Harbour town", evidence: "Mara stepped onto the harbour wall at Greyport" }],
    };
  }
  if (text === CH2) {
    return {
      events: [{ title: "The ledger is found", summary: "Mara opens the lighthouse lock with the brass key and finds a ledger with the traitor's name burned away.", location: "Greyport lighthouse", participants: ["Mara", "Tomas"], causes: ["Mara had the brass key"], consequences: ["Mara suspects Tomas"], information_revealed: ["payments were made to a traitor"], information_withheld: ["the traitor's name"], is_flashback: false, story_date: null, story_time: null, evidence: "Mara turned the brass key in the old lock and found the ledger" }],
      character_changes: [{ name: "Mara", location: "Greyport lighthouse", physical_condition: null, emotional_state: "suspicious", goals: ["identify the traitor"], motivations: null, knowledge: ["a ledger records payments to the traitor"], beliefs: {}, secrets: [], relationships: {}, inventory: ["ledger"], key_changes: "Takes the ledger", evidence: "found the ledger" }],
      facts: [{ subject: "Ledger", predicate: "contents", value: "lists every payment made to the traitor", category: "plot", confidence: 0.9, evidence: "The ledger listed every payment made to the traitor" }],
      thread_updates: [{ thread_id: "PLACEHOLDER_BETRAYAL", change: "clue", notes: "The ledger narrows the search but the name is burned away.", evidence: "the name at the bottom had been burned away" }],
      new_threads: [],
      entities: [{ name: "Greyport lighthouse", entity_type: "location", description: "Lighthouse holding the ledger", evidence: "Inside the lighthouse at Greyport" }],
    };
  }
  return {
    events: [{ title: "Tomas confesses", summary: "Tomas admits he sold the route to pay their father's debts.", location: "Greyport lighthouse", participants: ["Mara", "Tomas"], causes: ["the ledger was found"], consequences: ["the betrayal is resolved"], information_revealed: ["Tomas is the traitor"], information_withheld: [], is_flashback: false, story_date: null, story_time: null, evidence: "Tomas finally confessed in the lighthouse that he was the one who had sold the route" }],
    character_changes: [
      { name: "Tomas", location: "Greyport lighthouse", physical_condition: null, emotional_state: "ashamed", goals: [], motivations: "to pay their father's debts", knowledge: [], beliefs: {}, secrets: ["he sold the route to the Admiralty"], relationships: {}, inventory: [], key_changes: "Confesses to the betrayal", evidence: "he had done it to pay their father's debts" },
      { name: "Mara", location: "Greyport lighthouse", physical_condition: null, emotional_state: "calm", goals: [], motivations: null, knowledge: ["Tomas betrayed the crew"], beliefs: {}, secrets: [], relationships: {}, inventory: ["ledger"], key_changes: "Learns the traitor's identity", evidence: "walked out into the rain, calm at last" },
    ],
    facts: [{ subject: "Tomas", predicate: "betrayal", value: "sold the crew's route to the Admiralty", category: "plot", confidence: 0.95, evidence: "he was the one who had sold the route to the Admiralty" }],
    thread_updates: [{ thread_id: "PLACEHOLDER_BETRAYAL", change: "resolves", notes: "Tomas confesses that he sold the route to pay their father's debts.", evidence: "Tomas finally confessed in the lighthouse that he was the one who had sold the route to the Admiralty" }],
    new_threads: [],
    entities: [],
  };
}

/** Rewrites the placeholder thread id to the real id created in chapter 1. */
function modelWithThreadId(text: string, repo: MemoryRepo): ModelCaller {
  return async () => {
    const thread = (repo.rows.threads as Row[]).find((t) => String(t.title).includes("betrayed"));
    const json = JSON.stringify(payloadFor(text)).replace("PLACEHOLDER_BETRAYAL", String(thread?.id ?? "unknown"));
    return { content: json, model: "test-model" };
  };
}

const C1 = { chapterIndex: 0, subsectionIndex: 0 };
const C2 = { chapterIndex: 1, subsectionIndex: 0 };
const C3 = { chapterIndex: 2, subsectionIndex: 0 };

async function runFixture() {
  const repo = new MemoryRepo();
  repo.setSection(C1, CH1);
  repo.setSection(C2, CH2);
  repo.setSection(C3, CH3);
  const r1 = await processSectionExtraction(repo, modelFor(CH1), "book1", C1);
  const r2 = await processSectionExtraction(repo, modelWithThreadId(CH2, repo), "book1", C2);
  const r3 = await processSectionExtraction(repo, modelWithThreadId(CH3, repo), "book1", C3);
  return { repo, r1, r2, r3 };
}

// ---------------------------------------------------------------- tests
describe("Pass 2 fiction validation — multi-scene story", () => {
  it("extracts every chapter successfully", async () => {
    const { r1, r2, r3 } = await runFixture();
    expect(r1.status).toBe("completed");
    expect(r2.status).toBe("completed");
    expect(r3.status).toBe("completed");
  });

  it("chapter 1 context cannot see chapter 2 or chapter 3 information", async () => {
    const { repo } = await runFixture();
    const ctx = buildNarrativeContext(repo.rows, C1);
    expect(ctx).not.toContain("ledger");
    expect(ctx).not.toContain("confess");
    expect(ctx).not.toContain("lighthouse");
  });

  it("chapter 2 context sees chapter 1 but not chapter 3", async () => {
    const { repo } = await runFixture();
    const ctx = buildNarrativeContext(repo.rows, C2);
    expect(ctx).toContain("Greyport");
    expect(ctx.toLowerCase()).not.toContain("confess");
    expect(ctx).not.toContain("sold the crew's route to the Admiralty");
  });

  it("character state evolves and location changes are preserved", async () => {
    const { repo } = await runFixture();
    const atC2 = selectNarrativeState(repo.rows, C2).characters.find((c) => c.name === "Mara")!;
    expect(atC2.state?.emotional).toBe("angry");
    expect(atC2.state?.location).toBe("Greyport harbour wall");
    expect(atC2.state?.inventory).toContain("brass key");
    const atC3 = selectNarrativeState(repo.rows, C3).characters.find((c) => c.name === "Mara")!;
    expect(atC3.state?.emotional).toBe("suspicious");
    expect(atC3.state?.location).toBe("Greyport lighthouse");
    expect(atC3.state?.inventory).toContain("ledger");
  });

  it("item transfers and causal links are recorded on events", async () => {
    const { repo } = await runFixture();
    const ev = (repo.rows.events as Row[]).find((e) => String(e.title).includes("ledger"))!;
    expect(ev.causes).toContain("Mara had the brass key");
    expect(ev.consequences).toContain("Mara suspects Tomas");
  });

  it("the secret is only recorded after it is revealed", async () => {
    const { repo } = await runFixture();
    const before = selectNarrativeState(repo.rows, C3).characters.find((c) => c.name === "Tomas")!;
    expect(before.state?.secrets ?? []).toHaveLength(0);
    const after = selectNarrativeState(repo.rows, { chapterIndex: 3, subsectionIndex: 0 }).characters.find((c) => c.name === "Tomas")!;
    expect(after.state?.secrets).toContain("he sold the route to the Admiralty");
  });

  it("the plot thread opens in chapter 1, develops in chapter 2 and resolves in chapter 3", async () => {
    const { repo } = await runFixture();
    const thread = (repo.rows.threads as Row[]).find((t) => String(t.title).includes("betrayed"))!;
    expect(thread.status).toBe("RESOLVED");
    expect(String(thread.resolution_notes)).toContain("confesses");
    expect(thread.resolved_chapter_index).toBe(2);
    // point-in-time: still open at chapters 1 and 2, gone from active by chapter 4
    expect(selectNarrativeState(repo.rows, C2).activeThreads.some((t) => t.id === thread.id)).toBe(true);
    expect(selectNarrativeState(repo.rows, C3).activeThreads.find((t) => t.id === thread.id)?.status).toBe("DEVELOPING");
    expect(selectNarrativeState(repo.rows, { chapterIndex: 3, subsectionIndex: 0 }).activeThreads.some((t) => t.id === thread.id)).toBe(false);
  });

  it("chapter 3 resolution never leaks backward", async () => {
    const { repo } = await runFixture();
    for (const pos of [C1, C2, C3]) {
      expect(buildNarrativeContext(repo.rows, pos)).not.toContain("Tomas confesses that he sold the route");
    }
  });

  it("facts without a real quote from the text are dropped", async () => {
    const { repo } = await runFixture();
    expect((repo.rows.facts as Row[]).some((f) => String(f.value).includes("hand pressing down"))).toBe(false);
    expect((repo.rows.facts as Row[]).some((f) => String(f.value).includes("Tomas is her brother"))).toBe(true);
  });

  it("recorded facts are canonical and follow the authority rules", async () => {
    const { repo } = await runFixture();
    const facts = repo.rows.facts as Row[];
    for (const f of facts) {
      expect(f.authority).toBe("AI_INFERENCE");
      expect(["clean", "disputed"]).toContain(f.conflict_status);
    }
    // an existing higher-authority fact is never displaced by extraction
    const db = fakeDb(facts);
    facts.push({ id: "user1", subject: "Mara", predicate: "age", value: "32", authority: "USER_CANON", is_canonical: true, conflict_status: "clean", conflicting_fact_id: null });
    const res = await applyCanonicalFact(db, { bookId: "book1", userId: "u1", fact: { subject: "Mara", predicate: "age", value: "41", authority: "AI_INFERENCE", sourceType: "extraction" } });
    expect(res.outcome).toBe("disputed_noncanonical");
    expect(res.fact!.is_canonical).toBe(false);
    expect(facts.find((f) => f.id === "user1")!.conflict_status).toBe("clean");
    expect(facts.find((f) => f.id === "user1")!.is_canonical).toBe(true);
  });

  it("re-running extraction on identical text creates no duplicates", async () => {
    const { repo } = await runFixture();
    const before = { events: repo.rows.events.length, facts: repo.rows.facts.length, states: repo.rows.states.length, threads: repo.rows.threads.length };
    const again = await processSectionExtraction(repo, modelFor(CH1), "book1", C1);
    expect(again.status).toBe("skipped");
    expect({ events: repo.rows.events.length, facts: repo.rows.facts.length, states: repo.rows.states.length, threads: repo.rows.threads.length }).toEqual(before);
  });

  it("regenerating a section replaces its previous extracted state", async () => {
    const { repo } = await runFixture();
    const eventsBefore = repo.rows.events.length;
    const rewritten = `${CH1} A grey gull settled on the crates and watched them both.`;
    repo.setSection(C1, rewritten);
    const res = await processSectionExtraction(repo, modelFor(CH1), "book1", C1);
    expect(res.status).toBe("completed");
    expect((res as { replacedPrevious: boolean }).replacedPrevious).toBe(true);
    // the old chapter-1 rows were removed, not stacked on top
    expect(repo.rows.events.length).toBe(eventsBefore);
    expect((repo.rows.events as Row[]).filter((e) => e.chapter_index === 0)).toHaveLength(1);
  });
});

describe("Pass 2 failure and retry behaviour", () => {
  it("a failed extraction corrupts nothing and is marked failed", async () => {
    const repo = new MemoryRepo();
    repo.setSection(C1, CH1);
    repo.failApply = true;
    const res = await processSectionExtraction(repo, modelFor(CH1), "book1", C1);
    expect(res.status).toBe("failed");
    expect(repo.rows.events).toHaveLength(0);
    expect(repo.rows.facts).toHaveLength(0);
    expect(repo.extractions[0].status).toBe("failed");
  });

  it("retrying a failed extraction produces a consistent final state", async () => {
    const repo = new MemoryRepo();
    repo.setSection(C1, CH1);
    repo.failApply = true;
    await processSectionExtraction(repo, modelFor(CH1), "book1", C1);
    repo.failApply = false;
    const res = await processSectionExtraction(repo, modelFor(CH1), "book1", C1);
    expect(res.status).toBe("completed");
    expect(repo.rows.events).toHaveLength(1);
    expect(repo.extractions).toHaveLength(1);
    expect(repo.extractions[0].status).toBe("completed");
  });

  it("the content hash is stable for identical text and changes when the text changes", () => {
    expect(contentHash(CH1)).toBe(contentHash(`${CH1} `));
    expect(contentHash(CH1)).not.toBe(contentHash(CH2));
  });
});
