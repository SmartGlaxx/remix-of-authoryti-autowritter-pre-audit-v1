// Single authoritative implementation of canonical-fact database mutation.
// Used by BOTH the browser service (src/lib/narrativeEngine.ts) and the edge
// repository (supabaseRepo.ts) so the Pass 1 conflict rules can never diverge.
import { decideFactInsertion, type Authority, type StoryPosition } from "./rules.ts";

// deno-lint-ignore no-explicit-any
type Db = any;
// deno-lint-ignore no-explicit-any
type Row = Record<string, any>;

export const LOWER_AUTHORITY_NOTE = "Lower authority than existing canon; disputed pending review.";

export type FactOutcome = "duplicate" | "inserted" | "disputed_noncanonical" | "disputed";

export interface FactWrite {
  subject: string;
  predicate: string;
  value: string;
  category?: string;
  authority: Authority;
  sourceType: string;
  position?: StoryPosition | null;
  sourceExcerpt?: string | null;
  confidence?: number;
  subjectCharacterId?: string | null;
  subjectEntityId?: string | null;
  extractionId?: string | null;
}

export interface FactApplyResult {
  outcome: FactOutcome;
  fact: Row | null;
  /** The pre-existing row's prior conflict columns, when this write changed them (undo log). */
  existingBefore: { id: string; conflict_status: string; conflicting_fact_id: string | null } | null;
}

function check<T = Row>(res: { data: T; error: { message: string } | null }): T {
  if (res.error) throw new Error(res.error.message);
  return res.data;
}

/** The current competing canon row for this subject+predicate, if any. */
export async function findCompetingFact(db: Db, bookId: string, subject: string, predicate: string): Promise<Row | null> {
  return check(await db.from("canonical_facts").select("id, value, authority, conflict_status, is_canonical, conflicting_fact_id")
    .eq("book_id", bookId).ilike("subject", subject).ilike("predicate", predicate)
    .eq("is_canonical", true).in("conflict_status", ["clean", "disputed"])
    .order("created_at", { ascending: true }).limit(1).maybeSingle());
}

/**
 * Applies one canonical fact using the Pass 1 rules. Never overwrites a value:
 * - duplicate            → nothing written
 * - no competitor        → inserted clean + canonical
 * - lower authority      → inserted disputed + non-canonical, existing untouched
 * - equal/higher         → inserted disputed + canonical, existing flagged disputed (both preserved)
 *
 * `onBeforeExistingUpdate` lets a caller persist an undo entry before the
 * pre-existing row is touched.
 */
export async function applyCanonicalFact(
  db: Db,
  args: { bookId: string; userId: string; fact: FactWrite },
  onBeforeExistingUpdate?: (before: { id: string; conflict_status: string; conflicting_fact_id: string | null }) => Promise<void>,
): Promise<FactApplyResult> {
  const { bookId, userId, fact: f } = args;
  const existing = await findCompetingFact(db, bookId, f.subject, f.predicate);
  const decision = decideFactInsertion({ value: f.value, authority: f.authority }, existing as { id: string; value: string; authority: Authority } | null);
  if (decision.kind === "duplicate") return { outcome: "duplicate", fact: existing, existingBefore: null };

  const row: Row = {
    book_id: bookId, user_id: userId, subject: f.subject, predicate: f.predicate, value: f.value,
    category: f.category ?? "general", authority: f.authority, source_type: f.sourceType,
    source_chapter_index: f.position?.chapterIndex ?? null, source_subsection_index: f.position?.subsectionIndex ?? null,
    source_excerpt: f.sourceExcerpt ?? null, confidence: f.confidence ?? 0.7,
    subject_character_id: f.subjectCharacterId ?? null, subject_entity_id: f.subjectEntityId ?? null,
    extraction_id: f.extractionId ?? null,
  };

  if (decision.kind === "insert_clean") {
    const inserted = check(await db.from("canonical_facts").insert({ ...row, conflict_status: "clean", is_canonical: true }).select().single());
    return { outcome: "inserted", fact: inserted, existingBefore: null };
  }

  if (decision.kind === "insert_disputed_noncanonical") {
    const inserted = check(await db.from("canonical_facts").insert({
      ...row, conflict_status: "disputed", is_canonical: false,
      conflicting_fact_id: decision.existingId, notes: LOWER_AUTHORITY_NOTE,
    }).select().single());
    return { outcome: "disputed_noncanonical", fact: inserted, existingBefore: null };
  }

  const before = { id: existing!.id, conflict_status: existing!.conflict_status, conflicting_fact_id: existing!.conflicting_fact_id ?? null };
  if (onBeforeExistingUpdate) await onBeforeExistingUpdate(before);
  const inserted = check(await db.from("canonical_facts").insert({ ...row, conflict_status: "disputed", is_canonical: true, conflicting_fact_id: decision.existingId }).select().single());
  check(await db.from("canonical_facts").update({ conflict_status: "disputed", conflicting_fact_id: inserted.id }).eq("id", decision.existingId));
  return { outcome: "disputed", fact: inserted, existingBefore: before };
}
