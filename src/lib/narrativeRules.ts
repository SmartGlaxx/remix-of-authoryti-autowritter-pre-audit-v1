// Pure rules for the narrative engine (no I/O) — unit-tested.
import { AUTHORITY_RANK, type Authority, type PlotThreadStatus } from "@/types/narrative";

export type FactDecision =
  | { kind: "insert_clean" }                  // no existing fact for subject+predicate
  | { kind: "duplicate"; existingId: string } // same value, nothing to do
  | { kind: "insert_disputed_noncanonical"; existingId: string } // lower authority: kept, disputed, non-canonical
  | { kind: "insert_disputed"; existingId: string }; // equal or higher: both flagged, human decides

const norm = (s: string) => s.trim().toLowerCase().replace(/\s+/g, " ");

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
  if (norm(existing.value) === norm(incoming.value)) return { kind: "duplicate", existingId: existing.id };
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
