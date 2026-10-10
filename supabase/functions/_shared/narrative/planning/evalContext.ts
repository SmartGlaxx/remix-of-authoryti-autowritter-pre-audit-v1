// Builds the evaluator context from an approved plan, established canon and anchors (pure).
import { adapterForBookType } from "./adapters.ts";
import { intentForKind, findingKey, type EvalContext } from "./evaluator.ts";
import { futureSecrets, type PlanResolution } from "./planningContext.ts";
import type { MasterPlanSkeleton } from "./engine.ts";

// deno-lint-ignore no-explicit-any
type Row = Record<string, any>;

export function buildEvalContext(o: {
  bookType: string; plan: PlanResolution; chapterIndex: number; anchors: { anchor_key?: string; key?: string; exact_text?: string; text?: string }[];
  facts: Row[]; controls?: unknown; beatNotes?: { id: string; note?: string; intent?: string }[]; approvedLogs?: Row[];
}): EvalContext {
  const adapter = adapterForBookType(o.bookType);
  const section = o.plan.usable ? o.plan.section : null;
  const notes = new Map((o.beatNotes ?? []).map((n) => [n.id, n]));
  const pos = o.chapterIndex * 10000;
  const facts = o.facts
    .filter((f) => f.is_canonical !== false && (f.canon_status ?? "ESTABLISHED") === "ESTABLISHED" && (f.conflict_status ?? "clean") === "clean")
    .filter((f) => (Number(f.source_chapter_index ?? 0) * 10000 + Number(f.source_subsection_index ?? 0)) < pos + 10000)
    .slice(-80).map((f) => ({ id: String(f.id), text: `${f.subject} ${f.predicate} ${f.value}` }));
  const c = (o.controls ?? {}) as Row;
  return {
    adapter: adapter.id, isFiction: adapter.isFiction, objective: section?.objective ?? "",
    beats: (section?.beats ?? []).map((b) => {
      const n = notes.get(b.id);
      const intent = (["immediate_payoff", "ongoing_arc", "setup_only", "deferred_resolution"] as const).find((x) => x === n?.intent) ?? intentForKind(b.kind);
      return { id: b.id, kind: b.kind, intent, required: intent === "immediate_payoff", note: n?.note };
    }),
    anchors: o.anchors.map((a) => ({ key: String(a.anchor_key ?? a.key ?? ""), text: String(a.exact_text ?? a.text ?? "") })).filter((a) => a.key && a.text),
    facts,
    secrets: o.plan.usable ? futureSecrets(o.plan.master as MasterPlanSkeleton, o.chapterIndex) : [],
    controls: o.controls,
    motifs: Array.isArray(c.motifs) ? c.motifs.map(String) : undefined,
    terminology: Array.isArray(c.terminology) ? c.terminology.map(String) : undefined,
    approvedCanonKeys: (o.approvedLogs ?? []).filter((l) => l.decision === "ACCEPT_PROSE_UPDATE_CANON").map((l) => String(l.canon_reference?.finding_key ?? "")).filter(Boolean),
  };
}

export { findingKey };
