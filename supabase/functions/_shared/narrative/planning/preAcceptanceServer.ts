// Server I/O around the pure pre-acceptance gate: model calls, cost, and persistence of findings.
// Material findings → canon reconciliation + recoverable candidate draft; others → editorial review.
import { generateAIText, type AIDeps } from "../../ai/client.ts";
import { estimateCostUSD } from "../../ai/registry.ts";
import type { BookModelConfig } from "../../ai/roles.ts";
import { findingKey, runPreAcceptance, type EvalContext, type EvalModel, type PreAcceptanceResult } from "./evaluator.ts";
import { routeFinding } from "./validation.ts";

// deno-lint-ignore no-explicit-any
type Db = any;

export function modelCallers(config: BookModelConfig, userId: string, bookId: string, deps: AIDeps): { evaluate: EvalModel; repair: EvalModel } {
  const mk = (role: "continuity_checker" | "continuity_reviser"): EvalModel => async (p) => {
    const { text, meta } = await generateAIText({ role, config, userId, bookId, request: { system: p.system, user: p.user, json: true } } as never, deps);
    // deno-lint-ignore no-explicit-any
    const u = ((meta as any)?.usage ?? {}) as { inputTokens?: number | null; outputTokens?: number | null; cachedInputTokens?: number | null };
    let costUsd: number | null = null;
    // deno-lint-ignore no-explicit-any
    try { costUsd = (meta as any)?.model ? estimateCostUSD(String((meta as any).model), { inputTokens: u.inputTokens ?? null, outputTokens: u.outputTokens ?? null, cachedInputTokens: u.cachedInputTokens ?? null }) : null; } catch { costUsd = null; }
    return { text, usage: { inputTokens: u.inputTokens, outputTokens: u.outputTokens, costUsd } };
  };
  return { evaluate: mk("continuity_checker"), repair: mk("continuity_reviser") };
}

export interface PersistArgs {
  db: Db; bookId: string; userId: string; chapter: number; sub: number; hash: string; masterPlanId: string | null;
  origin: "generated" | "author_edit" | "retry"; parentId?: string | null;
}

/** Records findings. Returns the candidate id when the draft must wait for the author. */
export async function persistOutcome(r: PreAcceptanceResult, a: PersistArgs): Promise<{ candidateId: string | null }> {
  const dedupKeys: string[] = [];
  for (const f of r.findings) {
    const route = routeFinding(f);
    const dk = `pg_${a.bookId}_${a.chapter}_${a.sub}_${a.hash.slice(0, 16)}_${f.code}_${dedupKeys.length}`.slice(0, 400);
    if (route === "canon_reconciliation") {
      await a.db.rpc("record_canon_discrepancy", { p_book_id: a.bookId, p_user_id: a.userId, p_chapter: a.chapter, p_sub: a.sub, p_severity: "CRITICAL",
        p_type: f.code, p_description: f.message, p_excerpt: f.excerpt ?? "", p_canon_ref: { source: "phase_g", stage: f.stage, source_ref: f.sourceRef ?? null, finding_key: findingKey(f) },
        p_content_hash: a.hash, p_dedup_key: dk });
      dedupKeys.push(dk);
    } else if (route !== "none") {
      await a.db.from("editorial_validation_findings").upsert({ book_id: a.bookId, user_id: a.userId, chapter_index: a.chapter, subsection_index: a.sub, content_hash: a.hash,
        code: f.code, category: f.category, severity: f.severity, route, message: f.message, excerpt: f.excerpt ?? null,
        details: { stage: f.stage, source_ref: f.sourceRef ?? null }, dedup_key: dk }, { onConflict: "dedup_key", ignoreDuplicates: true });
    }
  }
  if (r.decision === "accept") return { candidateId: null };
  const { data, error } = await a.db.rpc("save_candidate_draft", {
    p_book_id: a.bookId, p_user_id: a.userId, p_chapter: a.chapter, p_sub: a.sub, p_master_plan_id: a.masterPlanId, p_text: r.text,
    p_hash: a.hash, p_status: r.decision === "blocked_material" ? "BLOCKED_MATERIAL" : "NEEDS_AUTHOR_REVIEW",
    p_findings: r.heldForApproval ? [...r.findings, { code: "BROAD_REWRITE_PROPOSED", stage: 5, severity: "moderate", message: `A correction would change ${Math.round(r.heldForApproval.ratio * 100)}% of paragraphs; review it before use.`, proposed_text: r.heldForApproval.text }] : r.findings, p_usage: r.usage, p_origin: a.origin, p_parent: a.parentId ?? null, p_dedup_keys: dedupKeys,
  });
  if (error) throw new Error(error.message);
  return { candidateId: data?.candidate_id ?? null };
}

export { runPreAcceptance, type EvalContext };
