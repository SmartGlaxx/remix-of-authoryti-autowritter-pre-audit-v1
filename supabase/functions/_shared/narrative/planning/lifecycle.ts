// Progressive planning lifecycle rules (pure). Mirrors the database triggers on
// book_master_plans / book_progressive_plans / book_section_acceptances so the
// browser, edge functions and tests share one definition.
// Planning lifecycle and manuscript lifecycle are deliberately separate: a planned
// event is never established canon until accepted prose is extracted.

export type MasterPlanStatus = "DRAFT" | "APPROVED" | "SUPERSEDED" | "CANCELLED";
export type PlanStatus = "PLANNED" | "READY" | "SUPERSEDED" | "CANCELLED";
export type ManuscriptStatus = "DRAFTED" | "ACCEPTED" | "ESTABLISHED" | "REVISED";
export type ExtractionStatus = "NOT_STARTED" | "PENDING_EXTRACTION" | "EXTRACTED" | "FAILED";

const MASTER: Record<MasterPlanStatus, MasterPlanStatus[]> = {
  DRAFT: ["DRAFT", "APPROVED", "CANCELLED"],
  APPROVED: ["APPROVED", "SUPERSEDED", "CANCELLED"],
  SUPERSEDED: ["SUPERSEDED"],
  CANCELLED: ["CANCELLED"],
};
const PLAN: Record<PlanStatus, PlanStatus[]> = {
  PLANNED: ["PLANNED", "READY", "SUPERSEDED", "CANCELLED"],
  READY: ["READY", "SUPERSEDED", "CANCELLED"],
  SUPERSEDED: ["SUPERSEDED"],
  CANCELLED: ["CANCELLED"],
};
const MANUSCRIPT: Record<ManuscriptStatus, ManuscriptStatus[]> = {
  DRAFTED: ["DRAFTED", "ACCEPTED"],
  ACCEPTED: ["ACCEPTED", "ESTABLISHED", "REVISED"],
  ESTABLISHED: ["ESTABLISHED", "REVISED"],
  REVISED: ["REVISED"],
};

export const canTransitionMaster = (a: MasterPlanStatus, b: MasterPlanStatus) => MASTER[a].includes(b);
export const canTransitionPlan = (a: PlanStatus, b: PlanStatus) => PLAN[a].includes(b);
export const canTransitionManuscript = (a: ManuscriptStatus, b: ManuscriptStatus) => MANUSCRIPT[a].includes(b);

/** Content of approved master plans and ready progressive plans is frozen. */
export const isMasterContentFrozen = (s: MasterPlanStatus) => s !== "DRAFT";
export const isPlanContentFrozen = (s: PlanStatus) => s !== "PLANNED";

/** Only ESTABLISHED (accepted + extracted) prose may count as canon. Plans never do. */
export const countsAsCanon = (m: ManuscriptStatus, e: ExtractionStatus) =>
  (m === "ESTABLISHED" || m === "ACCEPTED") && e === "EXTRACTED";

export interface PriorSection { manuscript: ManuscriptStatus; extraction: ExtractionStatus }

/**
 * Decides whether section N may be generated given section N-1's acceptance record.
 * Accepted-but-not-extracted prose blocks generation (stale canon) and asks for recovery.
 */
export function generationGate(prior: PriorSection | null): { ok: true } | { ok: false; action: "recover_extraction" | "await_acceptance"; reason: string } {
  if (!prior) return { ok: true };
  if (prior.manuscript === "DRAFTED") return { ok: false, action: "await_acceptance", reason: "Previous section not accepted yet" };
  if (prior.extraction === "PENDING_EXTRACTION" || prior.extraction === "NOT_STARTED" || prior.extraction === "FAILED") {
    return { ok: false, action: "recover_extraction", reason: "Previous section's story memory not updated yet" };
  }
  return { ok: true };
}
