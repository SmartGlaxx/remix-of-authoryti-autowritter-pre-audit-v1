// Just-in-time chapter blueprints: the app builds and approves a chapter's detailed blueprint
// the moment writing reaches it. Cast safety is kept — if the blueprint proposes a new named
// person, approval is refused server-side and the author is asked to add them first.
import { supabase } from "@/integrations/supabase/client";
import { callPlanBook } from "@/lib/candidateReview";

type Row = { id: string; plan_status: string; version?: number };

async function latestBlueprint(bookId: string, masterId: string, ch: number): Promise<Row | null> {
  const { data } = await supabase.from("book_progressive_plans").select("id, plan_status, version")
    .eq("book_id", bookId).eq("master_plan_id", masterId).eq("plan_level", "BLUEPRINT").eq("chapter_index", ch)
    .order("version", { ascending: false }).limit(5);
  const rows = (data ?? []) as Row[];
  return rows.find((r) => r.plan_status === "READY") ?? rows.find((r) => r.plan_status === "PLANNED") ?? null;
}

/** Ensures chapter `ch` has an approved blueprint. Throws a readable error when the author must act. */
export async function ensureChapterBlueprint(bookId: string, ch: number, onStatus?: (msg: string) => void): Promise<void> {
  const { data: m } = await supabase.from("book_master_plans").select("id").eq("book_id", bookId).eq("status", "APPROVED")
    .order("version", { ascending: false }).limit(1).maybeSingle();
  if (!m?.id) throw new Error("This book needs an approved master plan first.");
  let bp = await latestBlueprint(bookId, m.id, ch);
  if (bp?.plan_status === "READY") return;
  if (!bp) {
    onStatus?.(`Preparing the detailed blueprint for chapter ${ch + 1}…`);
    const r = await callPlanBook({ action: "blueprint", bookId, masterPlanId: m.id, chapter: ch, requestId: crypto.randomUUID() });
    if (!r.ok) throw new Error([r.data.error, ...((r.data.issues as string[] | undefined) ?? []).slice(0, 2)].filter(Boolean).join(" · ") || "Blueprint failed");
    bp = await latestBlueprint(bookId, m.id, ch);
    if (!bp) throw new Error(`Chapter ${ch + 1}'s blueprint could not be saved.`);
  }
  const a = await callPlanBook({ action: "approve_plans", ids: [bp.id] });
  if (!a.ok) {
    if (a.data.code === "CAST_APPROVAL_REQUIRED") throw new Error(`Chapter ${ch + 1} introduces new people — add them to your cast in the planner first: ${a.data.error}`);
    throw new Error(a.data.error ?? "Blueprint approval failed");
  }
}
