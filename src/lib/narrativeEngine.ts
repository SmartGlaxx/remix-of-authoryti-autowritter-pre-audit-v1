// Narrative Engine service (Pass 1). Persistence + retrieval for story memory.
// Not yet wired into generation (Pass 2).
import { supabase } from "@/integrations/supabase/client";
import type { Book, BookOutline } from "@/types/book";
import { validateThreadTransition } from "./narrativeRules";
import { applyCanonicalFact } from "../../supabase/functions/_shared/narrative/factMutation";
import {
  toPosition,
  type Authority, type CanonicalFact, type CharacterState, type FactCategory, type FactSourceType,
  type NarrativeEvent, type PlotThread, type PlotThreadStatus, type StoryCharacter,
  type StoryPosition, type StoryStateAtPosition, type StoryStateSnapshot, type TimelineEntry,
} from "@/types/narrative";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const db = supabase as any;

async function ownerId(): Promise<string> {
  const { data } = await supabase.auth.getUser();
  if (!data.user) throw new Error("Not signed in");
  return data.user.id;
}
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function check(res: { data: any; error: { message: string } | null }): any {
  if (res.error) throw new Error(res.error.message);
  return res.data;
}

// ---------- Characters ----------
export async function upsertCharacter(bookId: string, c: { sourceKey?: string; name: string; role?: string; aliases?: string[] }): Promise<StoryCharacter> {
  const user_id = await ownerId();
  const row = { book_id: bookId, user_id, source_key: c.sourceKey ?? null, name: c.name, role: c.role ?? null, aliases: c.aliases ?? [] };
  if (c.sourceKey) {
    const existing = check(await db.from("story_characters").select("*").eq("book_id", bookId).eq("source_key", c.sourceKey).maybeSingle());
    if (existing) return check(await db.from("story_characters").update(row).eq("id", existing.id).select().single());
  }
  return check(await db.from("story_characters").insert(row).select().single());
}

// ---------- Character state (append-only versions) ----------
export async function recordCharacterState(
  bookId: string, characterId: string, pos: StoryPosition,
  s: Partial<Omit<CharacterState, "id" | "book_id" | "character_id" | "position" | "version" | "is_current" | "superseded_by">> & { authority?: Authority },
): Promise<CharacterState> {
  const user_id = await ownerId();
  const prev = check(await db.from("character_states").select("*")
    .eq("book_id", bookId).eq("character_id", characterId)
    .eq("chapter_index", pos.chapterIndex).eq("subsection_index", pos.subsectionIndex).eq("is_current", true).maybeSingle());
  const inserted: CharacterState = check(await db.from("character_states").insert({
    ...s, book_id: bookId, user_id, character_id: characterId,
    chapter_index: pos.chapterIndex, subsection_index: pos.subsectionIndex,
    version: prev ? prev.version + 1 : 1, is_current: true,
  }).select().single());
  if (prev) check(await db.from("character_states").update({ is_current: false, superseded_by: inserted.id }).eq("id", prev.id));
  return inserted;
}

export async function getCharacterStateAt(bookId: string, characterId: string, pos: StoryPosition): Promise<CharacterState | null> {
  return check(await db.from("character_states").select("*")
    .eq("book_id", bookId).eq("character_id", characterId).eq("is_current", true)
    .lte("position", toPosition(pos)).order("position", { ascending: false }).limit(1).maybeSingle());
}

// ---------- Events ----------
export async function recordEvent(
  bookId: string, pos: StoryPosition,
  e: Partial<Omit<NarrativeEvent, "id" | "book_id" | "position">> & { title: string; summary: string; participantIds?: string[]; threadLinks?: { threadId: string; relation?: string }[] },
): Promise<NarrativeEvent> {
  const user_id = await ownerId();
  const { participantIds = [], threadLinks = [], ...rest } = e;
  const ev: NarrativeEvent = check(await db.from("narrative_events").insert({
    ...rest, book_id: bookId, user_id, chapter_index: pos.chapterIndex, subsection_index: pos.subsectionIndex,
  }).select().single());
  if (participantIds.length) check(await db.from("event_participants").insert(participantIds.map((character_id) => ({ event_id: ev.id, character_id, book_id: bookId, user_id }))));
  if (threadLinks.length) check(await db.from("plot_thread_events").insert(threadLinks.map((l) => ({ thread_id: l.threadId, event_id: ev.id, relation: l.relation ?? "develops", book_id: bookId, user_id }))));
  return ev;
}

// ---------- Plot threads ----------
export async function createPlotThread(bookId: string, t: Partial<Omit<PlotThread, "id" | "book_id">> & { title: string }): Promise<PlotThread> {
  const user_id = await ownerId();
  return check(await db.from("plot_threads").insert({ ...t, book_id: bookId, user_id }).select().single());
}

export async function updatePlotThreadStatus(threadId: string, status: PlotThreadStatus, opts: { resolutionNotes?: string; resolvedChapterIndex?: number; resolutionEventId?: string; supersededBy?: string } = {}): Promise<PlotThread> {
  const err = validateThreadTransition(status, opts);
  if (err) throw new Error(err);
  return check(await db.from("plot_threads").update({
    status, resolution_notes: opts.resolutionNotes ?? null, resolved_chapter_index: opts.resolvedChapterIndex ?? null,
    resolution_event_id: opts.resolutionEventId ?? null, superseded_by: opts.supersededBy ?? null,
  }).eq("id", threadId).select().single());
}

// ---------- Canonical facts ----------
export interface NewFact {
  subject: string; predicate: string; value: string; category?: FactCategory;
  authority: Authority; sourceType: FactSourceType; position?: StoryPosition;
  sourceExcerpt?: string; confidence?: number; subjectCharacterId?: string; subjectEntityId?: string;
}

export async function recordCanonicalFact(bookId: string, f: NewFact): Promise<{ fact: CanonicalFact | null; outcome: string }> {
  const user_id = await ownerId();
  // Single shared implementation — identical rules in the browser and in edge functions.
  const res = await applyCanonicalFact(db, {
    bookId, userId: user_id,
    fact: {
      subject: f.subject, predicate: f.predicate, value: f.value, category: f.category,
      authority: f.authority, sourceType: f.sourceType, position: f.position ?? null,
      sourceExcerpt: f.sourceExcerpt ?? null, confidence: f.confidence,
      subjectCharacterId: f.subjectCharacterId ?? null, subjectEntityId: f.subjectEntityId ?? null,
    },
  });
  return { fact: (res.fact as CanonicalFact | null) ?? null, outcome: res.outcome };
}

/** Explicit human/authority resolution of a dispute. */
export async function resolveFactConflict(winnerId: string, loserId: string, notes: string) {
  check(await db.from("canonical_facts").update({ conflict_status: "clean", is_canonical: true }).eq("id", winnerId));
  check(await db.from("canonical_facts").update({ conflict_status: "superseded", is_canonical: false, notes }).eq("id", loserId));
}

// ---------- Timeline & snapshots ----------
export async function addTimelineEntry(bookId: string, t: Partial<Omit<TimelineEntry, "id" | "book_id">> & { relative_order: number; event_summary: string }): Promise<TimelineEntry> {
  const user_id = await ownerId();
  return check(await db.from("story_timeline").insert({ ...t, book_id: bookId, user_id }).select().single());
}

export async function saveSnapshot(bookId: string, pos: StoryPosition, scope: "subsection" | "chapter", data: { narrativeSummary?: string; timelinePosition?: number; state?: Record<string, unknown> }): Promise<StoryStateSnapshot> {
  const user_id = await ownerId();
  const prev = check(await db.from("story_state_snapshots").select("version").eq("book_id", bookId)
    .eq("chapter_index", pos.chapterIndex).eq("subsection_index", pos.subsectionIndex).eq("scope", scope).maybeSingle());
  return check(await db.from("story_state_snapshots").upsert({
    book_id: bookId, user_id, chapter_index: pos.chapterIndex, subsection_index: pos.subsectionIndex, scope,
    narrative_summary: data.narrativeSummary ?? null, timeline_position: data.timelinePosition ?? null,
    state: data.state ?? {}, version: prev ? prev.version + 1 : 1,
  }, { onConflict: "book_id,chapter_index,subsection_index,scope" }).select().single());
}

// ---------- Retrieval: "what was true at position X?" ----------
export async function getStoryStateAt(bookId: string, pos: StoryPosition, outline?: BookOutline | null): Promise<StoryStateAtPosition> {
  const p = toPosition(pos);
  const [chars, threads, events, facts, snaps, timeline] = await Promise.all([
    db.from("story_characters").select("*").eq("book_id", bookId).eq("is_active", true),
    db.from("plot_threads").select("*").eq("book_id", bookId).in("status", ["OPEN", "DEVELOPING"]),
    db.from("narrative_events").select("*").eq("book_id", bookId).eq("is_canonical", true).lte("position", p).order("position", { ascending: false }).limit(10),
    db.from("canonical_facts").select("*").eq("book_id", bookId).eq("is_canonical", true),
    db.from("story_state_snapshots").select("*").eq("book_id", bookId).lte("chapter_index", pos.chapterIndex).order("chapter_index", { ascending: false }).order("subsection_index", { ascending: false }).limit(5),
    db.from("story_timeline").select("*").eq("book_id", bookId).order("relative_order", { ascending: false }),
  ]);
  const characters: StoryCharacter[] = check(chars);
  const states = await Promise.all(characters.map((c) => getCharacterStateAt(bookId, c.id, pos)));
  const allFacts: CanonicalFact[] = check(facts).filter((f: CanonicalFact) =>
    f.source_chapter_index == null || toPosition({ chapterIndex: f.source_chapter_index, subsectionIndex: f.source_subsection_index ?? 0 }) <= p);
  const snap = (check(snaps) as StoryStateSnapshot[]).find((s) => toPosition({ chapterIndex: s.chapter_index, subsectionIndex: s.subsection_index }) <= p) ?? null;
  const tl = (check(timeline) as TimelineEntry[]).find((t) => t.chapter_index != null && toPosition({ chapterIndex: t.chapter_index, subsectionIndex: t.subsection_index ?? 0 }) <= p) ?? null;
  const openThreads = (check(threads) as PlotThread[]).filter((t) =>
    t.introduced_chapter_index == null || toPosition({ chapterIndex: t.introduced_chapter_index, subsectionIndex: t.introduced_subsection_index ?? 0 }) <= p);

  return {
    position: pos,
    characters: characters.map((c, i) => ({
      character: c,
      profile: outline?.characters?.find((o) => o.id === c.source_key) ?? null,
      state: states[i],
    })),
    openThreads,
    recentEvents: check(events),
    facts: allFacts.filter((f) => f.conflict_status === "clean"),
    disputedFacts: allFacts.filter((f) => f.conflict_status === "disputed"),
    timelinePosition: tl,
    latestSnapshot: snap,
  };
}

// ---------- Non-destructive seeding from existing outline ----------
/** Registers outline characters and open promises. Invents no facts or states. Idempotent. */
export async function seedNarrativeStateFromOutline(book: Pick<Book, "id"> & { outline?: BookOutline | null }) {
  const outline = book.outline;
  const result = { characters: 0, threads: 0 };
  if (!outline) return result;
  for (const c of outline.characters ?? []) {
    if (!c?.id || !c?.name) continue;
    await upsertCharacter(book.id, { sourceKey: c.id, name: c.name, role: c.role });
    result.characters++;
  }
  const user_id = await ownerId();
  const promises = (outline.openPromises ?? []).filter((s) => typeof s === "string" && s.trim());
  for (let i = 0; i < promises.length; i++) {
    const source_key = `outline_promise_${i}`;
    const exists = check(await db.from("plot_threads").select("id").eq("book_id", book.id).eq("source_key", source_key).maybeSingle());
    if (exists) continue;
    check(await db.from("plot_threads").insert({ book_id: book.id, user_id, source_key, title: promises[i].slice(0, 200), setup_promise: promises[i], status: "OPEN", authority: "OUTLINE_CANON" }));
    result.threads++;
  }
  return result;
}
