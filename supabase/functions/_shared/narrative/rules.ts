// Pure narrative rules (no I/O). Single source of truth, shared by the browser
// (src/lib/narrativeRules.ts re-exports) and edge functions (Deno).
export type Authority = "USER_CANON" | "OUTLINE_CANON" | "APPROVED_GENERATED_STATE" | "AI_INFERENCE";
export const AUTHORITY_RANK: Record<Authority, number> = {
  USER_CANON: 4,
  OUTLINE_CANON: 3,
  APPROVED_GENERATED_STATE: 2,
  AI_INFERENCE: 1,
};
export type PlotThreadStatus = "OPEN" | "DEVELOPING" | "RESOLVED" | "ABANDONED" | "SUPERSEDED";

export interface StoryPosition { chapterIndex: number; subsectionIndex: number }
export const toPosition = (p: StoryPosition) => p.chapterIndex * 10000 + p.subsectionIndex;

export type FactDecision =
  | { kind: "insert_clean" }                  // no existing fact for subject+predicate
  | { kind: "duplicate"; existingId: string } // same value, nothing to do
  | { kind: "insert_disputed_noncanonical"; existingId: string } // lower authority: kept, disputed, non-canonical
  | { kind: "insert_disputed"; existingId: string }; // equal or higher: both flagged, human decides

export const normText = (s: string) => s.trim().toLowerCase().replace(/\s+/g, " ");

/**
 * Never auto-overwrite. Lower authority → incoming kept as disputed + non-canonical
 * (existing higher-authority fact stays canonical and clean).
 * Equal/higher authority → both marked disputed for review.
 */
export function decideFactInsertion(
  incoming: { value: string; authority: Authority },
  existing: { id: string; value: string; authority: Authority } | null,
): FactDecision {
  if (!existing) return { kind: "insert_clean" };
  if (normText(existing.value) === normText(incoming.value)) return { kind: "duplicate", existingId: existing.id };
  if (AUTHORITY_RANK[incoming.authority] < AUTHORITY_RANK[existing.authority]) {
    return { kind: "insert_disputed_noncanonical", existingId: existing.id };
  }
  return { kind: "insert_disputed", existingId: existing.id };
}

export function validateThreadTransition(
  status: PlotThreadStatus,
  opts: { resolutionNotes?: string | null; resolvedChapterIndex?: number | null; supersededBy?: string | null },
): string | null {
  const notes = opts.resolutionNotes?.trim();
  if (status === "RESOLVED") {
    if (!notes) return "Resolving a thread requires resolution notes.";
    if (opts.resolvedChapterIndex == null) return "Resolving a thread requires the resolving chapter.";
  }
  if ((status === "ABANDONED" || status === "SUPERSEDED") && !notes) return `${status} requires a reason.`;
  if (status === "SUPERSEDED" && !opts.supersededBy) return "SUPERSEDED requires the replacing thread.";
  return null;
}
