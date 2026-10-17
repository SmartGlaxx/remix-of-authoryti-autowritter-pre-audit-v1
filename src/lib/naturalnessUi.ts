// Browser helpers for the Writing Naturalness screens (Stage E). Real tables/actions only:
// naturalness_findings (owner status/notes), book_literary_artifacts (owner CRUD),
// candidate-review "naturalness_rewrite", writer-learning recommendations/approve/revert/pin.
import { supabase } from "@/integrations/supabase/client";
import type { NaturalnessMode } from "../../supabase/functions/_shared/writers/naturalness";

export const MODE_LABELS: Record<NaturalnessMode, { label: string; note: string }> = {
  off: { label: "Off", note: "No style checks and no rewriting." },
  analyze_only: { label: "Analyze only", note: "Notes style patterns after each section. Never changes your text." },
  analyze_and_rewrite: { label: "Analyze + targeted rewrite", note: "Also makes small, bounded fixes to new drafts before the normal checks. Dialogue, names and numbers are never touched." },
};

export const CATEGORY_LABELS: Record<string, string> = {
  opening_recurrence: "Repeated section opening",
  figurative_density: "Dense figurative language",
  burstiness: "Even sentence rhythm",
  mechanical_pattern: "Mechanical phrasing",
  dialogue_contradiction: "Dialogue note",
};

/** Best phrase from a finding the author could mark as an intentional motif. */
export function motifCandidate(evidence: Record<string, unknown> | null | undefined): string {
  const ev = (evidence ?? {}) as { opening?: string; starters?: { starter: string }[]; stockPhrases?: string[] };
  if (ev.stockPhrases?.[0]) return String(ev.stockPhrases[0]);
  if (ev.starters?.[0]?.starter) return ev.starters[0].starter;
  if (ev.opening) return ev.opening.split(/\s+/).slice(0, 6).join(" ");
  return "";
}

export async function callLearning<T = any>(body: Record<string, unknown>): Promise<{ ok: boolean; data: T }> {
  try {
    const { data: s } = await supabase.auth.getSession();
    const res = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/writer-learning`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${s.session?.access_token ?? ""}`, apikey: import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY },
      body: JSON.stringify(body),
    });
    return { ok: res.ok, data: await res.json().catch(() => ({})) };
  } catch {
    return { ok: false, data: { error: "Could not connect. Try again shortly." } as T };
  }
}
