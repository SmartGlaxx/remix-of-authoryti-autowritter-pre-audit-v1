// Phase F I/O for the opt-in progressive pipeline (server only). Pure decisions live in pipeline.ts.
import { previousPosition, priorFromAcceptances, progressiveGate, requiredAnchorKeys, scopedAnchors, type AnchorRow, type GateResult } from "./pipeline.ts";
import { resolvePlanForSection, type PlanResolution } from "./planningContext.ts";
import { adapterForBookType } from "./adapters.ts";
import { blueprintGate, resolveBlueprintMode, type BlueprintGate } from "./blueprint.ts";

// deno-lint-ignore no-explicit-any
type Db = any;
// deno-lint-ignore no-explicit-any
type Row = Record<string, any>;

export interface ProgressiveState {
  gate: GateResult; master: Row | null; readyPlans: Row[]; anchors: AnchorRow[]; anchorRows: Row[];
  plan: PlanResolution; required: string[];
}

export async function loadProgressiveState(db: Db, bookId: string, userId: string, bookType: string, outline: Row | null, ch: number, sub: number): Promise<ProgressiveState> {
  const prev = previousPosition(outline, ch, sub);
  const [m, p, a, l, acc] = await Promise.all([
    db.from("book_master_plans").select("id, status, version, plan_skeleton").eq("book_id", bookId).eq("user_id", userId).eq("status", "APPROVED").order("version", { ascending: false }).limit(1),
    db.from("book_progressive_plans").select("id, plan_status, chapter_index, subsection_index, content").eq("book_id", bookId).eq("plan_status", "READY").eq("chapter_index", ch),
    db.from("narrative_exact_anchors").select("anchor_key, exact_text, match_mode, effective_chapter_index, version, is_active, context_hint, retrieval_tags, source_type, canon_status").eq("book_id", bookId).eq("is_active", true).eq("canon_status", "ESTABLISHED").limit(500),
    db.from("canon_reconciliation_logs").select("id, decision, dedup_key, severity, chapter_index, subsection_index, application_status").eq("book_id", bookId).eq("decision", "PENDING").limit(200),
    prev ? db.from("book_section_acceptances").select("manuscript_status, extraction_status, updated_at").eq("book_id", bookId).eq("chapter_index", prev.chapterIndex).eq("subsection_index", prev.subsectionIndex) : Promise.resolve({ data: [] }),
  ]);
  for (const r of [m, p, a, l, acc]) if (r?.error) throw new Error(r.error.message);
  const master = m.data?.[0] ?? null;
  // Progressive rows keep the section plan in `content`; planningContext reads it as plan_skeleton.
  const readyPlans = (p.data ?? []).map((r: Row) => ({ ...r, plan_skeleton: r.content?.section?.objective ? { ...r.content.section, detail: r.content.detail } : r.content }));
  const anchorRows = a.data ?? [];
  const anchors = scopedAnchors(anchorRows as AnchorRow[], ch);
  let prior = prev ? priorFromAcceptances(acc.data ?? []) : null;
  // A previous section written before the new pathway was switched on has no acceptance record;
  // the existing extraction ledger is then the source of truth.
  if (prior === "missing") {
    const { data: ex } = await db.from("narrative_extractions").select("status").eq("book_id", bookId).eq("chapter_index", prev!.chapterIndex).eq("subsection_index", prev!.subsectionIndex).order("updated_at", { ascending: false }).limit(1);
    const s = ex?.[0]?.status;
    prior = { manuscript: "ACCEPTED", extraction: s === "completed" ? "EXTRACTED" : s === "failed" ? "FAILED" : "PENDING_EXTRACTION" };
  }
  const gate = progressiveGate(prior, l.data ?? [], { chapterIndex: ch, subsectionIndex: sub });
  const plan = resolvePlanForSection(master, { chapterIndex: ch, subsectionIndex: sub }, bookType, readyPlans);
  const required = requiredAnchorKeys(plan.usable ? plan.section : null, anchors);
  return { gate, master, readyPlans, anchors, anchorRows, plan, required };
}

/** Stage 2 completion: approved-blueprint gate for books in the required-blueprint workflow. */
export async function loadBlueprintGate(db: Db, bookId: string, userId: string, controls: unknown, ch: number): Promise<BlueprintGate> {
  const mode = resolveBlueprintMode(controls);
  if (mode !== "required") return blueprintGate(mode, [], ch, []);
  const [b, c, book] = await Promise.all([
    db.from("book_progressive_plans").select("id, plan_status, version, content").eq("book_id", bookId).eq("plan_level", "BLUEPRINT").eq("chapter_index", ch).eq("plan_status", "READY"),
    db.from("story_characters").select("id, name, aliases").eq("book_id", bookId).eq("user_id", userId).eq("is_active", true),
    db.from("books").select("book_type").eq("id", bookId).eq("user_id", userId).maybeSingle(),
  ]);
  for (const r of [b, c, book]) if (r?.error) throw new Error(r.error.message);
  if (!book.data) throw new Error("Book not found");
  return blueprintGate(mode, b.data ?? [], ch, (c.data ?? []).map((x: Row) => ({ id: x.id, name: x.name, aliases: x.aliases ?? [] })), adapterForBookType(book.data.book_type).id);
}
