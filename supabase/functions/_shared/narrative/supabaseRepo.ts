// Database implementation of the narrative repository (runs in edge functions with a
// service-role client). Callers MUST verify book ownership before using it; every
// write stamps the verified owner's user_id and is scoped by book_id.
import { normText, toPosition, type StoryPosition } from "./rules.ts";
import { applyCanonicalFact } from "./factMutation.ts";
import { selectNarrativeState, type NarrativeRows } from "./context.ts";
import { EXTRACTION_AUTHORITY, threadTransitionFor, type ExtractionPlan, type ExtractionRecord, type NarrativeRepo } from "./extraction.ts";

// deno-lint-ignore no-explicit-any
type Db = any;
// deno-lint-ignore no-explicit-any
type Row = Record<string, any>;

function check<T = Row>(res: { data: T; error: { message: string } | null }): T {
  if (res.error) throw new Error(res.error.message);
  return res.data;
}

/** Verifies the authenticated user owns the book. Returns the book row or null. */
export async function verifyBookOwnership(db: Db, bookId: string, userId: string): Promise<Row | null> {
  const { data } = await db.from("books").select("id, user_id, outline").eq("id", bookId).maybeSingle();
  return data && data.user_id === userId ? data : null;
}

/** One coherent read of all narrative tables for a book (parallel, book-scoped). */
export async function loadNarrativeRows(db: Db, bookId: string): Promise<NarrativeRows> {
  const q = (t: string, cols = "*") => db.from(t).select(cols).eq("book_id", bookId).limit(5000);
  const [characters, states, events, participants, threads, threadEvents, facts, timeline, entities, snapshots] = await Promise.all([
    q("story_characters"), q("character_states"), q("narrative_events"), q("event_participants"), q("plot_threads"),
    q("plot_thread_events"), q("canonical_facts"), q("story_timeline"), q("story_entities"), q("story_state_snapshots"),
  ]);
  return {
    characters: check(characters) ?? [], states: check(states) ?? [], events: check(events) ?? [], participants: check(participants) ?? [],
    threads: check(threads) ?? [], threadEvents: check(threadEvents) ?? [], facts: check(facts) ?? [], timeline: check(timeline) ?? [],
    entities: check(entities) ?? [], snapshots: check(snapshots) ?? [],
  };
}

export function createSupabaseNarrativeRepo(db: Db, userId: string): NarrativeRepo {
  const user_id = userId;
  const at = (pos: StoryPosition) => ({ chapter_index: pos.chapterIndex, subsection_index: pos.subsectionIndex });

  async function saveUndo(extractionId: string, undo: Row[]) {
    check(await db.from("narrative_extractions").update({ applied: { undo } }).eq("id", extractionId));
  }

  return {
    async getSectionText(bookId, pos) {
      const { data } = await db.from("books").select("outline").eq("id", bookId).maybeSingle();
      const sub = data?.outline?.chapters?.[pos.chapterIndex]?.subsections?.[pos.subsectionIndex];
      if (!sub || sub.status !== "completed" || typeof sub.content !== "string" || !sub.content.trim()) return null;
      return { text: sub.content, subsectionId: sub.id ?? null };
    },

    async getExtraction(bookId, pos) {
      return check(await db.from("narrative_extractions").select("*").eq("book_id", bookId)
        .eq("chapter_index", pos.chapterIndex).eq("subsection_index", pos.subsectionIndex).maybeSingle());
    },

    async beginExtraction(bookId, pos, hash, subsectionId) {
      const prev = check(await db.from("narrative_extractions").select("attempts").eq("book_id", bookId)
        .eq("chapter_index", pos.chapterIndex).eq("subsection_index", pos.subsectionIndex).maybeSingle());
      return check(await db.from("narrative_extractions").upsert({
        book_id: bookId, user_id, ...at(pos), subsection_id: subsectionId, content_hash: hash, status: "processing",
        attempts: (prev?.attempts ?? 0) + 1, error: null, applied: {},
      }, { onConflict: "book_id,chapter_index,subsection_index" }).select().single()) as ExtractionRecord;
    },

    async revertExtraction(rec, pos) {
      const undo: Row[] = ((rec.applied as Row)?.undo as Row[]) ?? [];
      // Undo status changes on pre-existing rows (reverse order).
      for (const u of [...undo].reverse()) {
        if (u.table === "plot_threads") check(await db.from("plot_threads").update(u.before).eq("id", u.id));
        if (u.table === "canonical_facts") check(await db.from("canonical_facts").update(u.before).eq("id", u.id));
      }
      // Delete rows derived by this extraction (junction rows cascade with events/threads).
      const del = (t: string) => db.from(t).delete().eq("extraction_id", rec.id);
      for (const t of ["story_timeline", "canonical_facts", "character_states", "narrative_events", "plot_threads"]) check(await del(t));
      // Restore is_current on the latest remaining state per character at this position.
      const remaining: Row[] = check(await db.from("character_states").select("id, character_id, version").eq("book_id", rec.book_id ?? "")
        .eq("chapter_index", pos.chapterIndex).eq("subsection_index", pos.subsectionIndex)) ?? [];
      const latest = new Map<string, Row>();
      for (const r of remaining) if (!latest.has(r.character_id) || latest.get(r.character_id)!.version < r.version) latest.set(r.character_id, r);
      for (const r of latest.values()) check(await db.from("character_states").update({ is_current: true, superseded_by: null }).eq("id", r.id));
    },

    async seedFromOutline(bookId) {
      const { data: book } = await db.from("books").select("outline").eq("id", bookId).maybeSingle();
      const outline = book?.outline;
      if (!outline) return;
      const existingChars: Row[] = check(await db.from("story_characters").select("source_key").eq("book_id", bookId)) ?? [];
      const have = new Set(existingChars.map((c) => c.source_key));
      const newChars = (outline.characters ?? []).filter((c: Row) => c?.id && c?.name && !have.has(c.id))
        .map((c: Row) => ({ book_id: bookId, user_id, source_key: c.id, name: c.name, role: c.role ?? null }));
      if (newChars.length) check(await db.from("story_characters").insert(newChars));
      const existingThreads: Row[] = check(await db.from("plot_threads").select("source_key").eq("book_id", bookId)) ?? [];
      const haveT = new Set(existingThreads.map((t) => t.source_key));
      const promises: string[] = (outline.openPromises ?? []).filter((s: unknown) => typeof s === "string" && s.trim());
      const newThreads = promises.map((p, i) => ({ source_key: `outline_promise_${i}`, p })).filter((x) => !haveT.has(x.source_key))
        .map((x) => ({ book_id: bookId, user_id, source_key: x.source_key, title: x.p.slice(0, 200), setup_promise: x.p, status: "OPEN", authority: "OUTLINE_CANON" }));
      if (newThreads.length) check(await db.from("plot_threads").insert(newThreads));
    },

    async loadKnown(bookId) {
      const [c, t] = await Promise.all([
        db.from("story_characters").select("id, name, aliases").eq("book_id", bookId).eq("is_active", true),
        db.from("plot_threads").select("id, title, status, setup_promise").eq("book_id", bookId),
      ]);
      return { characters: check(c) ?? [], threads: check(t) ?? [] };
    },

    async applyPlan(bookId, pos, extractionId, plan: ExtractionPlan) {
      const undo: Row[] = [];
      const base = { book_id: bookId, user_id, extraction_id: extractionId };
      const p = toPosition(pos);

      // Characters (register any newly named character; idempotent by source_key)
      const chars: Row[] = check(await db.from("story_characters").select("id, name, aliases").eq("book_id", bookId)) ?? [];
      const findChar = (name: string) => chars.find((c) => normText(c.name) === normText(name) || (c.aliases ?? []).some((a: string) => normText(a) === normText(name)));
      async function ensureChar(name: string): Promise<string> {
        const found = findChar(name);
        if (found) return found.id;
        const source_key = `extracted:${normText(name)}`;
        const ex = check(await db.from("story_characters").select("id, name, aliases").eq("book_id", bookId).eq("source_key", source_key).maybeSingle());
        const row = ex ?? check(await db.from("story_characters").insert({ ...base, source_key, name }).select("id, name, aliases").single());
        chars.push(row);
        return row.id;
      }

      // Entities (idempotent by source_key; first appearance = this position, established by the text)
      for (const en of plan.entities) {
        const source_key = `extracted:${en.entity_type}:${normText(en.name)}`;
        const ex = check(await db.from("story_entities").select("id").eq("book_id", bookId).eq("source_key", source_key).maybeSingle());
        if (!ex) check(await db.from("story_entities").insert({ book_id: bookId, user_id, source_key, name: en.name, entity_type: en.entity_type, description: en.description, first_chapter_index: pos.chapterIndex, first_subsection_index: pos.subsectionIndex }));
      }

      // Events + participants + timeline
      const eventIds: string[] = [];
      for (let i = 0; i < plan.events.length; i++) {
        const e = plan.events[i];
        const ev = check(await db.from("narrative_events").insert({
          ...base, ...at(pos), chronological_order: p + i / 100, title: e.title, summary: e.summary, location_text: e.location,
          causes: e.causes, consequences: e.consequences, information_revealed: e.information_revealed, information_withheld: e.information_withheld,
          authority: EXTRACTION_AUTHORITY, is_canonical: true, prose_excerpt: e.evidence,
        }).select("id").single());
        eventIds.push(ev.id);
        const pids = Array.from(new Set(await Promise.all(e.participants.map(ensureChar))));
        if (pids.length) check(await db.from("event_participants").insert(pids.map((character_id) => ({ event_id: ev.id, character_id, book_id: bookId, user_id }))));
        check(await db.from("story_timeline").insert({
          ...base, event_id: ev.id, ...at(pos), relative_order: p + i / 100, story_date: e.story_date, story_time: e.story_time,
          location_text: e.location, participant_ids: pids, event_summary: e.summary, is_flashback: e.is_flashback,
        }));
      }

      // Character states (only explicit changes; append-only versions at this position)
      for (const c of plan.characterChanges) {
        const character_id = c.characterId ?? await ensureChar(c.name);
        const prev = check(await db.from("character_states").select("id, version").eq("book_id", bookId).eq("character_id", character_id)
          .eq("chapter_index", pos.chapterIndex).eq("subsection_index", pos.subsectionIndex).eq("is_current", true).maybeSingle());
        const ins = check(await db.from("character_states").insert({
          ...base, character_id, ...at(pos), location_text: c.location, physical_condition: c.physical_condition, emotional_state: c.emotional_state,
          current_goals: c.goals, current_motivations: c.motivations, knowledge: c.knowledge, beliefs: c.beliefs, secrets_known: c.secrets,
          relationships: c.relationships, inventory: c.inventory, key_changes: c.key_changes, authority: EXTRACTION_AUTHORITY,
          version: prev ? prev.version + 1 : 1, is_current: true,
        }).select("id").single());
        if (prev) check(await db.from("character_states").update({ is_current: false, superseded_by: ins.id }).eq("id", prev.id));
      }

      // Facts — one shared implementation with the browser service (factMutation.ts).
      const factOutcomes: Record<string, number> = {};
      for (const f of plan.facts) {
        const res = await applyCanonicalFact(db, {
          bookId, userId: user_id,
          fact: {
            subject: f.subject, predicate: f.predicate, value: f.value, category: f.category,
            authority: EXTRACTION_AUTHORITY, sourceType: "extraction", position: pos,
            sourceExcerpt: f.evidence, confidence: f.confidence, extractionId,
          },
        }, async (before) => {
          undo.push({ table: "canonical_facts", id: before.id, before: { conflict_status: before.conflict_status, conflicting_fact_id: before.conflicting_fact_id } });
          await saveUndo(extractionId, undo);
        });
        factOutcomes[res.outcome] = (factOutcomes[res.outcome] ?? 0) + 1;
      }

      // New plot threads (introduced here — the text established them at this position)
      const newThreadIds = new Map<string, string>();
      for (const t of plan.newThreads) {
        const source_key = `extracted:${pos.chapterIndex}:${pos.subsectionIndex}:${normText(t.title).slice(0, 120)}`;
        const ins = check(await db.from("plot_threads").insert({
          ...base, source_key, title: t.title, description: t.description, setup_promise: t.setup_promise ?? t.evidence, importance: t.importance,
          introduced_chapter_index: pos.chapterIndex, introduced_subsection_index: pos.subsectionIndex, status: "OPEN", authority: EXTRACTION_AUTHORITY,
        }).select("id").single());
        newThreadIds.set(normText(t.title), ins.id);
        if (eventIds[0]) check(await db.from("plot_thread_events").insert({ thread_id: ins.id, event_id: eventIds[0], relation: "introduces", book_id: bookId, user_id }));
      }

      // Existing thread developments (Pass 1 lifecycle rules enforced)
      let threadStatusChanges = 0;
      for (const u of plan.threadUpdates) {
        const cur = check(await db.from("plot_threads").select("id, status, resolution_notes, resolved_chapter_index, resolution_event_id, superseded_by").eq("id", u.thread_id).eq("book_id", bookId).maybeSingle());
        if (!cur) continue;
        const relation = u.change === "resolves" ? "resolves" : u.change === "clue" ? "clue" : u.change === "complicates" ? "complicates" : "develops";
        if (eventIds[0]) check(await db.from("plot_thread_events").upsert({ thread_id: cur.id, event_id: eventIds[0], relation, book_id: bookId, user_id }, { onConflict: "thread_id,event_id" }));
        const next = threadTransitionFor(u, cur.status, pos.chapterIndex, u.superseded_by_title ? newThreadIds.get(normText(u.superseded_by_title)) ?? null : null);
        if (!next) continue;
        undo.push({ table: "plot_threads", id: cur.id, before: { status: cur.status, resolution_notes: cur.resolution_notes, resolved_chapter_index: cur.resolved_chapter_index, resolution_event_id: cur.resolution_event_id, superseded_by: cur.superseded_by } });
        await saveUndo(extractionId, undo);
        check(await db.from("plot_threads").update({
          status: next.status, resolution_notes: next.resolutionNotes ?? cur.resolution_notes, resolved_chapter_index: next.resolvedChapterIndex ?? cur.resolved_chapter_index,
          resolution_event_id: next.status === "RESOLVED" ? eventIds[eventIds.length - 1] ?? null : cur.resolution_event_id, superseded_by: next.supersededBy ?? cur.superseded_by,
        }).eq("id", cur.id));
        threadStatusChanges++;
      }

      return { undo, eventIds, factOutcomes, threadStatusChanges };
    },

    async saveSnapshot(bookId, pos, _extractionId) {
      // Derived view only: reconstructed from the ledgers as of the end of this section.
      const rows = await loadNarrativeRows(db, bookId);
      const s = selectNarrativeState(rows, { chapterIndex: pos.chapterIndex, subsectionIndex: pos.subsectionIndex + 1 });
      const { data: book } = await db.from("books").select("outline").eq("id", bookId).maybeSingle();
      const sub = book?.outline?.chapters?.[pos.chapterIndex]?.subsections?.[pos.subsectionIndex];
      const prevSnap = rows.snapshots.filter((x) => toPosition({ chapterIndex: x.chapter_index, subsectionIndex: x.subsection_index }) < toPosition(pos))
        .sort((a, b) => toPosition({ chapterIndex: b.chapter_index, subsectionIndex: b.subsection_index }) - toPosition({ chapterIndex: a.chapter_index, subsectionIndex: a.subsection_index }))[0];
      const thisSection = (typeof sub?.summary === "string" && sub.summary.trim()) ? sub.summary.trim() : s.recentEvents.filter((e) => toPosition(e.pos) === toPosition(pos)).map((e) => e.summary).join(" ");
      const narrative_summary = [prevSnap?.narrative_summary ? String(prevSnap.narrative_summary).slice(-1200) : "", thisSection].filter(Boolean).join(" ").slice(-1600) || null;
      const existing = rows.snapshots.find((x) => x.chapter_index === pos.chapterIndex && x.subsection_index === pos.subsectionIndex && x.scope === "subsection");
      check(await db.from("story_state_snapshots").upsert({
        book_id: bookId, user_id, ...at(pos), scope: "subsection", narrative_summary, timeline_position: toPosition(pos),
        state: {
          derived: true, characters_with_state: s.characters.filter((c) => c.state).map((c) => c.id),
          active_thread_ids: s.activeThreads.map((t) => t.id), canonical_fact_count: s.facts.length, disputed_fact_count: s.disputedFacts.length,
          recent_event_titles: s.recentEvents.map((e) => e.title),
        },
        version: existing ? (existing.version ?? 1) + 1 : 1,
      }, { onConflict: "book_id,chapter_index,subsection_index,scope" }));
    },

    async completeExtraction(id, applied, model) {
      check(await db.from("narrative_extractions").update({ status: "completed", applied, model_identifier: model, error: null }).eq("id", id));
    },
    async failExtraction(id, error) {
      check(await db.from("narrative_extractions").update({ status: "failed", error: error.slice(0, 2000) }).eq("id", id));
    },
    async logError(message, context) {
      await db.from("error_logs").insert({ source: "edge", function_name: "extract-narrative-state", user_id, message: message.slice(0, 2000), context });
    },
  };
}
