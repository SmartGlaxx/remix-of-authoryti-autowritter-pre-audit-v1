import { bulkApprovableIds, isBlueprintExampleRole } from "../../supabase/functions/_shared/narrative/planning/blueprint.ts";

type Row = Record<string, any>;
type Result = { ok: boolean; status?: number; data: Row };
export type AutoStage = "master" | "approve_master" | "chapters" | "sections" | "beats" | "approve_plans" | "blueprints" | "done";
export interface AutoProgress { stage: AutoStage; label: string; done: number; total: number }

/**
 * Hands-off planning: whole-book summary → approval → chapters → sections → beats → approval →
 * detailed blueprints (new people added to cast, blueprint approved) → ready to write.
 * Resumable: every stage skips what already exists. The author starting it is the approval.
 */
export async function autoPlanBook(o: {
  bookId: string; brief: Row; adapter?: string;
  call: (body: Row) => Promise<Result>;
  onProgress: (p: AutoProgress) => void;
  shouldStop: () => boolean;
}): Promise<{ completed: boolean }> {
  const { bookId, call } = o;
  const must = (r: Result, what: string) => {
    if (!r.ok && r.status !== 207) throw new Error(`${what}: ${[r.data?.error, ...((r.data?.issues as string[]) ?? []).slice(0, 3)].filter(Boolean).join(" · ") || "failed"}`);
    return r;
  };
  const status = async () => must(await call({ action: "status", bookId }), "Status").data as { masters: Row[]; plans: Row[] };
  const stop = () => o.shouldStop();

  let st = await status();
  let master = st.masters.find((m) => m.status === "APPROVED") ?? st.masters.find((m) => m.status === "DRAFT");
  if (!master) {
    o.onProgress({ stage: "master", label: "Writing the whole-book summary", done: 0, total: 1 });
    must(await call({ action: "master", bookId, requestId: crypto.randomUUID(), ...o.brief }), "Whole-book summary");
    st = await status(); master = st.masters.find((m) => m.status === "DRAFT");
    if (!master) throw new Error("Whole-book summary was not saved");
  }
  if (stop()) return { completed: false };
  if (master.status !== "APPROVED") {
    o.onProgress({ stage: "approve_master", label: "Approving the whole-book summary", done: 0, total: 1 });
    must(await call({ action: "approve_master", planId: master.id }), "Approve summary");
  }
  const masterPlanId = master.id;
  const total = (master.plan_skeleton?.chapters?.length as number) || 0;
  const mine = async () => (await status()).plans.filter((p) => p.master_plan_id === masterPlanId);
  const has = (rows: Row[], lv: string, ch: number) => rows.some((p) => p.plan_level === lv && p.chapter_index === ch && ["PLANNED", "READY"].includes(p.plan_status));

  // Chapters: the server stops at the first failure; retry a few times so a hiccup doesn't strand later chapters.
  let rows = await mine();
  for (let attempt = 0; attempt < 3; attempt++) {
    const done = [...Array(total).keys()].filter((c) => has(rows, "CHAPTER", c)).length;
    if (done >= total || stop()) break;
    o.onProgress({ stage: "chapters", label: `Planning chapters (${done} of ${total})`, done, total });
    must(await call({ action: "chapters", bookId, masterPlanId, requestId: crypto.randomUUID() }), "Chapter plans");
    rows = await mine();
  }
  const missing = [...Array(total).keys()].filter((c) => !has(rows, "CHAPTER", c));
  if (missing.length && !stop()) throw new Error(`Chapter ${missing[0] + 1} could not be planned — press the button again to retry`);

  for (let ch = 0; ch < total; ch++) {
    if (stop()) return { completed: false };
    if (!has(rows, "SECTION", ch)) {
      o.onProgress({ stage: "sections", label: `Chapter ${ch + 1}: section summaries`, done: ch, total });
      must(await call({ action: "sections", bookId, masterPlanId, chapter: ch, requestId: crypto.randomUUID() }), `Chapter ${ch + 1} sections`);
      rows = await mine();
    }
    if (stop()) return { completed: false };
    if (!has(rows, "BEATS", ch)) {
      o.onProgress({ stage: "beats", label: `Chapter ${ch + 1}: scene beats`, done: ch, total });
      must(await call({ action: "beats", bookId, masterPlanId, chapter: ch, requestId: crypto.randomUUID() }), `Chapter ${ch + 1} beats`);
      rows = await mine();
    }
  }

  const ids = bulkApprovableIds(rows as never);
  if (ids.length) {
    o.onProgress({ stage: "approve_plans", label: "Approving chapter and section plans", done: 0, total: 1 });
    must(await call({ action: "approve_plans", ids }), "Approve plans");
    rows = await mine();
  }

  for (let ch = 0; ch < total; ch++) {
    if (stop()) return { completed: false };
    o.onProgress({ stage: "blueprints", label: `Chapter ${ch + 1}: detailed blueprint`, done: ch, total });
    if (!has(rows, "BLUEPRINT", ch)) {
      must(await call({ action: "blueprint", bookId, masterPlanId, chapter: ch, requestId: crypto.randomUUID() }), `Chapter ${ch + 1} blueprint`);
      rows = await mine();
    }
    const bp = rows.filter((p) => p.plan_level === "BLUEPRINT" && p.chapter_index === ch && p.plan_status === "PLANNED")[0];
    if (!bp) continue; // already approved
    for (const p of ((bp.content?.blueprint?.castProposals as Row[]) ?? []).filter((x) => !isBlueprintExampleRole(x.name, o.adapter ?? ""))) {
      must(await call({ action: "approve_cast_proposal", bookId, planId: bp.id, proposalId: p.id }), `Add ${p.name} to cast`);
    }
    must(await call({ action: "approve_plans", ids: [bp.id] }), `Approve chapter ${ch + 1} blueprint`);
    rows = await mine();
  }
  o.onProgress({ stage: "done", label: "Ready to write", done: total, total });
  return { completed: true };
}
