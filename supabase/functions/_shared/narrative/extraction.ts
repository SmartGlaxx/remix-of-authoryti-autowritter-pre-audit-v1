// Post-generation story-state extraction (pure logic + orchestrator with injected I/O).
// The model call and the database are injected, so the model can be swapped in
// Pass 3 without touching this module, and the whole flow is unit-testable.
import { normText, validateThreadTransition, type Authority, type StoryPosition } from "./rules.ts";

export const EXTRACTION_AUTHORITY: Authority = "AI_INFERENCE"; // generated prose never gets USER/OUTLINE canon
const MIN_EVIDENCE = 12;
const MIN_RESOLUTION_EVIDENCE = 30;

// ---------- Shapes ----------
export interface KnownCharacter { id: string; name: string; aliases?: string[] }
export interface KnownThread { id: string; title: string; status: string; setup_promise?: string | null }

export interface ExtractedEvent {
  title: string; summary: string; location: string | null; participants: string[];
  causes: string[]; consequences: string[]; information_revealed: string[]; information_withheld: string[];
  is_flashback: boolean; story_date: string | null; story_time: string | null; evidence: string;
}
export interface ExtractedCharacterChange {
  name: string; location: string | null; physical_condition: string | null; emotional_state: string | null;
  goals: string[]; motivations: string | null; knowledge: string[]; beliefs: Record<string, string>;
  secrets: string[]; relationships: Record<string, string>; inventory: string[]; key_changes: string | null; evidence: string;
}
export interface ExtractedFact { subject: string; predicate: string; value: string; category: string; confidence: number; evidence: string }
export type ThreadChange = "develops" | "complicates" | "clue" | "resolves" | "abandons" | "supersedes";
export interface ExtractedThreadUpdate { thread_id: string; change: ThreadChange; notes: string; evidence: string; superseded_by_title?: string | null }
export interface ExtractedNewThread { title: string; description: string | null; setup_promise: string | null; importance: "major" | "minor"; evidence: string }
export interface ExtractedEntity { name: string; entity_type: string; description: string | null; evidence: string }

export interface ExtractionPlan {
  events: ExtractedEvent[];
  characterChanges: (ExtractedCharacterChange & { characterId: string | null })[];
  facts: ExtractedFact[];
  threadUpdates: ExtractedThreadUpdate[];
  newThreads: ExtractedNewThread[];
  entities: ExtractedEntity[];
  dropped: { kind: string; reason: string; item: string }[];
}

export const ENTITY_TYPES = ["location", "organization", "object", "faction", "artifact", "framework", "definition", "other"];

// ---------- Prompt ----------
export function buildExtractionPrompt(args: { text: string; position: StoryPosition; characters: KnownCharacter[]; threads: KnownThread[] }): { system: string; user: string } {
  const system = `You are a strict story-state extraction engine. You read ONE newly written section of a book and record ONLY what that text explicitly establishes.
Rules:
- Never invent, infer beyond the text, or use outside knowledge. If the text does not establish something, omit it.
- Every item MUST include "evidence": a short exact quote (copied verbatim, 5-40 words) from the section that proves it.
- Character changes: include only fields the text explicitly changes or reveals in this section; leave all others null/empty.
- Plot threads: refer to existing threads ONLY by their given id. Use "resolves" only when the text clearly and conclusively resolves the thread; "abandons" only when the text explicitly drops it; "supersedes" only when a new thread clearly replaces it (give superseded_by_title equal to a new_threads title).
- new_threads: only genuinely new, unresolved questions/promises the text sets up.
- facts: record a fact ONLY when it is useful, persistent information that a later section would need in order to stay consistent. Ask: "if a future section contradicted this, would it be a continuity error?" If no, omit it.
  In story writing, useful facts include: established character attributes, relationships, what a character knows or believes, secrets, important possessions, established locations, rules of the world, significant past events, and concrete plot revelations.
  In non-fiction or business writing, record only the concrete commitments the book has made that later sections must respect: named frameworks, defined terms, numbered steps, stated figures, case examples introduced by name, and promises of what will be covered later. Do not force story-style facts onto non-fiction.
  NEVER record: rhetorical arguments, persuasive claims, metaphors or similes, mathematical or illustrative analogies, hypothetical or illustrative examples that are not part of the book's own world, generic advice or truisms, transient moods, and phrasing with no continuity value.
  Record as many genuine facts as the section establishes, and no filler.
Return ONLY a JSON object with keys: events, character_changes, facts, thread_updates, new_threads, entities.
events[]: {title, summary, location, participants[], causes[], consequences[], information_revealed[], information_withheld[], is_flashback, story_date, story_time, evidence}
character_changes[]: {name, location, physical_condition, emotional_state, goals[], motivations, knowledge[], beliefs{}, secrets[], relationships{otherName: description}, inventory[], key_changes, evidence}
facts[]: {subject, predicate, value, category ("character"|"world"|"plot"|"timeline"|"general"), confidence (0-1), evidence}
thread_updates[]: {thread_id, change ("develops"|"complicates"|"clue"|"resolves"|"abandons"|"supersedes"), notes, evidence, superseded_by_title}
new_threads[]: {title, description, setup_promise, importance ("major"|"minor"), evidence}
entities[]: {name, entity_type ("location"|"organization"|"object"|"faction"|"artifact"|"framework"|"definition"|"other"), description, evidence}
- Use "artifact" for named functions, APIs, endpoints, classes, libraries and versions; "framework" for named models/methods/pillars; "definition" for defined terms.
- When the text says a newer artifact or term replaces an older one (e.g. "v1 used X; v2 uses Y instead"), record the NEW one with a description that contains the exact words "replaces <old name>".`;
  const chars = args.characters.map((c) => `- ${c.name}${c.aliases?.length ? ` (aka ${c.aliases.join(", ")})` : ""}`).join("\n") || "(none recorded)";
  const threads = args.threads.map((t) => `- id=${t.id} [${t.status}] ${t.title}${t.setup_promise && t.setup_promise !== t.title ? ` — ${t.setup_promise}` : ""}`).join("\n") || "(none)";
  const user = `POSITION: chapter ${args.position.chapterIndex + 1}, section ${args.position.subsectionIndex + 1}
KNOWN CHARACTERS:
${chars}
OPEN PLOT THREADS:
${threads}

SECTION TEXT:
"""
${args.text}
"""`;
  return { system, user };
}

// ---------- Parsing & validation ----------
const str = (v: unknown, max = 500): string | null => (typeof v === "string" && v.trim() ? v.trim().slice(0, max) : null);
const strArr = (v: unknown, max = 12): string[] => (Array.isArray(v) ? v.map((x) => str(x, 300)).filter(Boolean).slice(0, max) as string[] : []);
const strMap = (v: unknown): Record<string, string> => {
  const out: Record<string, string> = {};
  if (v && typeof v === "object" && !Array.isArray(v)) for (const [k, val] of Object.entries(v)) { const s = str(val, 200); if (k.trim() && s) out[k.trim().slice(0, 80)] = s; }
  return out;
};
const arr = (v: unknown): unknown[] => (Array.isArray(v) ? v.slice(0, 30) : []);
/** Facts have no arbitrary cap — only a sanity bound against a runaway model response. */
const factArr = (v: unknown): unknown[] => (Array.isArray(v) ? v.slice(0, 1000) : []);

export function parseModelJson(raw: string): Record<string, unknown> {
  let s = raw.trim().replace(/^```(?:json)?/i, "").replace(/```$/, "").trim();
  const start = s.indexOf("{"), end = s.lastIndexOf("}");
  if (start < 0 || end <= start) throw new Error("Extraction output contained no JSON object");
  s = s.slice(start, end + 1);
  const parsed = JSON.parse(s);
  if (!parsed || typeof parsed !== "object") throw new Error("Extraction output is not an object");
  return parsed;
}

/** True only if the quote genuinely appears in the section text. */
export function evidenceSupported(text: string, evidence: string | null, min = MIN_EVIDENCE): boolean {
  if (!evidence) return false;
  const clean = (s: string) => normText(s.replace(/[“”"‘’'`«»]/g, "").replace(/[—–]/g, "-").replace(/…/g, "..."));
  const e = clean(evidence).replace(/^\.+|\.+$/g, "").trim();
  return e.length >= min && clean(text).includes(e);
}

function matchCharacter(name: string, known: KnownCharacter[]): KnownCharacter | null {
  const n = normText(name);
  return known.find((c) => normText(c.name) === n || (c.aliases ?? []).some((a) => normText(a) === n)) ?? null;
}

export function planExtraction(raw: Record<string, unknown>, ctx: { text: string; characters: KnownCharacter[]; threads: KnownThread[] }): ExtractionPlan {
  const plan: ExtractionPlan = { events: [], characterChanges: [], facts: [], threadUpdates: [], newThreads: [], entities: [], dropped: [] };
  const drop = (kind: string, reason: string, item: unknown) => plan.dropped.push({ kind, reason, item: JSON.stringify(item).slice(0, 200) });
  const ok = (ev: string | null) => evidenceSupported(ctx.text, ev);

  for (const e of arr(raw.events) as Record<string, unknown>[]) {
    const title = str(e?.title, 200), summary = str(e?.summary, 1000), evidence = str(e?.evidence, 600);
    if (!title || !summary) { drop("event", "missing title/summary", e); continue; }
    if (!ok(evidence)) { drop("event", "evidence not found in text", e); continue; }
    plan.events.push({
      title, summary, location: str(e.location, 200), participants: strArr(e.participants, 20),
      causes: strArr(e.causes), consequences: strArr(e.consequences), information_revealed: strArr(e.information_revealed),
      information_withheld: strArr(e.information_withheld), is_flashback: e.is_flashback === true,
      story_date: str(e.story_date, 100), story_time: str(e.story_time, 100), evidence: evidence!,
    });
  }

  for (const c of arr(raw.character_changes) as Record<string, unknown>[]) {
    const name = str(c?.name, 120), evidence = str(c?.evidence, 600);
    if (!name) { drop("character", "missing name", c); continue; }
    if (!ok(evidence)) { drop("character", "evidence not found in text", c); continue; }
    const change = {
      name, location: str(c.location, 200), physical_condition: str(c.physical_condition, 300), emotional_state: str(c.emotional_state, 300),
      goals: strArr(c.goals), motivations: str(c.motivations, 400), knowledge: strArr(c.knowledge), beliefs: strMap(c.beliefs),
      secrets: strArr(c.secrets), relationships: strMap(c.relationships), inventory: strArr(c.inventory), key_changes: str(c.key_changes, 400), evidence: evidence!,
    };
    const hasChange = !!(change.location || change.physical_condition || change.emotional_state || change.goals.length || change.motivations ||
      change.knowledge.length || Object.keys(change.beliefs).length || change.secrets.length || Object.keys(change.relationships).length ||
      change.inventory.length || change.key_changes);
    if (!hasChange) { drop("character", "no explicit state change", c); continue; }
    if (!normText(ctx.text).includes(normText(name))) { drop("character", "character not named in text", c); continue; }
    plan.characterChanges.push({ ...change, characterId: matchCharacter(name, ctx.characters)?.id ?? null });
  }

  for (const f of factArr(raw.facts) as Record<string, unknown>[]) {
    const subject = str(f?.subject, 200), predicate = str(f?.predicate, 200), value = str(f?.value, 500), evidence = str(f?.evidence, 600);
    if (!subject || !predicate || !value) { drop("fact", "incomplete fact", f); continue; }
    if (!ok(evidence)) { drop("fact", "evidence not found in text", f); continue; }
    const category = ["character", "world", "plot", "timeline", "general"].includes(String(f.category)) ? String(f.category) : "general";
    const confidence = typeof f.confidence === "number" ? Math.max(0, Math.min(1, f.confidence)) : 0.6;
    const key = `${normText(subject)}|${normText(predicate)}|${normText(value)}`;
    if (plan.facts.some((x) => `${normText(x.subject)}|${normText(x.predicate)}|${normText(x.value)}` === key)) continue; // in-batch duplicate
    plan.facts.push({ subject, predicate, value, category, confidence, evidence: evidence! });
  }

  for (const n of arr(raw.new_threads) as Record<string, unknown>[]) {
    const title = str(n?.title, 200), evidence = str(n?.evidence, 600);
    if (!title) { drop("new_thread", "missing title", n); continue; }
    if (!ok(evidence)) { drop("new_thread", "evidence not found in text", n); continue; }
    if (ctx.threads.some((t) => normText(t.title) === normText(title))) { drop("new_thread", "duplicates existing thread", n); continue; }
    plan.newThreads.push({ title, description: str(n.description, 600), setup_promise: str(n.setup_promise, 600), importance: n.importance === "minor" ? "minor" : "major", evidence: evidence! });
  }

  const changes: ThreadChange[] = ["develops", "complicates", "clue", "resolves", "abandons", "supersedes"];
  for (const u of arr(raw.thread_updates) as Record<string, unknown>[]) {
    const thread = ctx.threads.find((t) => t.id === u?.thread_id);
    const change = changes.includes(u?.change as ThreadChange) ? (u.change as ThreadChange) : null;
    const notes = str(u?.notes, 800) ?? "", evidence = str(u?.evidence, 600);
    if (!thread) { drop("thread_update", "unknown thread id", u); continue; }
    if (!change) { drop("thread_update", "invalid change", u); continue; }
    if (["RESOLVED", "ABANDONED", "SUPERSEDED"].includes(thread.status)) { drop("thread_update", "thread already closed", u); continue; }
    const closing = change === "resolves" || change === "abandons" || change === "supersedes";
    if (!evidenceSupported(ctx.text, evidence, closing ? MIN_RESOLUTION_EVIDENCE : MIN_EVIDENCE)) { drop("thread_update", closing ? "insufficient evidence to close thread" : "evidence not found in text", u); continue; }
    if (closing && !notes.trim()) { drop("thread_update", "closing a thread requires notes", u); continue; }
    const supersededBy = change === "supersedes" ? str(u.superseded_by_title, 200) : null;
    if (change === "supersedes" && !plan.newThreads.some((t) => supersededBy && normText(t.title) === normText(supersededBy))) { drop("thread_update", "supersedes without a replacing new thread", u); continue; }
    plan.threadUpdates.push({ thread_id: thread.id, change, notes, evidence: evidence!, superseded_by_title: supersededBy });
  }

  for (const en of arr(raw.entities) as Record<string, unknown>[]) {
    const name = str(en?.name, 200), evidence = str(en?.evidence, 600);
    if (!name || !ok(evidence)) { drop("entity", "missing name or evidence", en); continue; }
    const t = ENTITY_TYPES.includes(String(en.entity_type)) ? String(en.entity_type) : "other";
    if (!plan.entities.some((x) => normText(x.name) === normText(name))) plan.entities.push({ name, entity_type: t, description: str(en.description, 400), evidence: evidence! });
  }
  return plan;
}

/** Thread status that a validated update should produce (null = no status change). */
export function threadTransitionFor(update: ExtractedThreadUpdate, currentStatus: string, chapterIndex: number, supersededById: string | null):
  { status: "DEVELOPING" | "RESOLVED" | "ABANDONED" | "SUPERSEDED"; resolutionNotes?: string; resolvedChapterIndex?: number; supersededBy?: string } | null {
  let next: ReturnType<typeof threadTransitionFor> = null;
  if (update.change === "resolves") next = { status: "RESOLVED", resolutionNotes: update.notes, resolvedChapterIndex: chapterIndex };
  else if (update.change === "abandons") next = { status: "ABANDONED", resolutionNotes: update.notes, resolvedChapterIndex: chapterIndex };
  else if (update.change === "supersedes") next = supersededById ? { status: "SUPERSEDED", resolutionNotes: update.notes, resolvedChapterIndex: chapterIndex, supersededBy: supersededById } : null;
  else next = currentStatus === "OPEN" ? { status: "DEVELOPING" } : null;
  if (next && next.status !== "DEVELOPING" && validateThreadTransition(next.status, next)) return null;
  return next;
}

// ---------- Deterministic content hash (idempotency key) ----------
export function contentHash(text: string): string {
  let h1 = 0x811c9dc5, h2 = 0x01000193;
  const s = text.replace(/\s+/g, " ").trim();
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    h1 = Math.imul(h1 ^ c, 16777619) >>> 0;
    h2 = Math.imul(h2 ^ c, 2246822519) >>> 0;
  }
  return `${h1.toString(16).padStart(8, "0")}${h2.toString(16).padStart(8, "0")}_${s.length}`;
}

// ---------- Orchestrator ----------
export interface ExtractionRecord { id: string; book_id?: string; content_hash: string; status: "processing" | "completed" | "failed"; attempts: number; applied: Record<string, unknown>; updated_at?: string }

export interface NarrativeRepo {
  getSectionText(bookId: string, pos: StoryPosition): Promise<{ text: string; subsectionId: string | null } | null>;
  getExtraction(bookId: string, pos: StoryPosition): Promise<ExtractionRecord | null>;
  beginExtraction(bookId: string, pos: StoryPosition, hash: string, subsectionId: string | null): Promise<ExtractionRecord>;
  revertExtraction(rec: ExtractionRecord, pos: StoryPosition): Promise<void>;
  seedFromOutline(bookId: string): Promise<void>;
  loadKnown(bookId: string): Promise<{ characters: KnownCharacter[]; threads: KnownThread[] }>;
  applyPlan(bookId: string, pos: StoryPosition, extractionId: string, plan: ExtractionPlan): Promise<Record<string, unknown>>;
  saveSnapshot(bookId: string, pos: StoryPosition, extractionId: string): Promise<void>;
  completeExtraction(id: string, applied: Record<string, unknown>, model: string): Promise<void>;
  failExtraction(id: string, error: string): Promise<void>;
  logError?(message: string, context: Record<string, unknown>): Promise<void>;
}
export type ModelCaller = (prompt: { system: string; user: string }) => Promise<{ content: string; model: string }>;

export type ExtractionOutcome =
  | { status: "no_prose" }
  | { status: "skipped"; reason: "already_processed" | "in_progress"; extractionId: string }
  | { status: "completed"; extractionId: string; counts: Record<string, number>; replacedPrevious: boolean }
  | { status: "failed"; extractionId?: string; error: string };

const STALE_PROCESSING_MS = 5 * 60 * 1000;

/** Never throws. Prose is only read, never written. */
export async function processSectionExtraction(repo: NarrativeRepo, callModel: ModelCaller, bookId: string, pos: StoryPosition, opts: { now?: number } = {}): Promise<ExtractionOutcome> {
  let extractionId: string | undefined;
  try {
    const section = await repo.getSectionText(bookId, pos);
    if (!section || !section.text.trim()) return { status: "no_prose" }; // failed/unsaved prose → no state recorded

    const hash = contentHash(section.text);
    const existing = await repo.getExtraction(bookId, pos);
    if (existing && existing.content_hash === hash) {
      if (existing.status === "completed") return { status: "skipped", reason: "already_processed", extractionId: existing.id };
      const age = (opts.now ?? Date.now()) - (existing.updated_at ? Date.parse(existing.updated_at) : 0);
      if (existing.status === "processing" && age < STALE_PROCESSING_MS) return { status: "skipped", reason: "in_progress", extractionId: existing.id };
    }
    // Any previously derived state for this position (old text or a partial attempt) is reverted first.
    const replacedPrevious = !!existing;
    if (existing) await repo.revertExtraction(existing, pos);

    const rec = await repo.beginExtraction(bookId, pos, hash, section.subsectionId);
    extractionId = rec.id;

    await repo.seedFromOutline(bookId);
    const known = await repo.loadKnown(bookId);
    const openThreads = known.threads.filter((t) => t.status === "OPEN" || t.status === "DEVELOPING");
    const { content, model } = await callModel(buildExtractionPrompt({ text: section.text, position: pos, characters: known.characters, threads: openThreads }));
    const plan = planExtraction(parseModelJson(content), { text: section.text, characters: known.characters, threads: openThreads });
    const applied = await repo.applyPlan(bookId, pos, rec.id, plan);
    await repo.saveSnapshot(bookId, pos, rec.id);
    await repo.completeExtraction(rec.id, { ...applied, dropped: plan.dropped.slice(0, 40) }, model);
    return {
      status: "completed", extractionId: rec.id, replacedPrevious,
      counts: { events: plan.events.length, characterChanges: plan.characterChanges.length, facts: plan.facts.length, threadUpdates: plan.threadUpdates.length, newThreads: plan.newThreads.length, entities: plan.entities.length, dropped: plan.dropped.length },
    };
  } catch (e) {
    const error = e instanceof Error ? e.message : String(e);
    try { if (extractionId) await repo.failExtraction(extractionId, error); } catch { /* ignore */ }
    try { await repo.logError?.(`Narrative extraction failed: ${error}`, { bookId, ...pos }); } catch { /* ignore */ }
    return { status: "failed", extractionId, error };
  }
}
