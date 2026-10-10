// Phase B safeguards (pure). Mirrors the database rules in migration 0005:
// generation leases with monotonic fencing tokens, exact-detail anchors, and
// canon reconciliation decisions. The database is the enforcement point; these
// helpers let edge functions, the browser and tests share the same definitions.

// ---------- Generation leases ----------
export interface Lease {
  workerId: string;
  fencingToken: number;
  status: "ACTIVE" | "RELEASED";
  expiresAt: number; // epoch ms
}
export type AcquireResult =
  | { acquired: true; lease: Lease; tookOver?: boolean; reentrant?: boolean }
  | { acquired: false; reason: "held" };

export const MIN_TTL_S = 5;
export const MAX_TTL_S = 1800;

export function isLeaseLive(l: Lease | null, now: number): boolean {
  return !!l && l.status === "ACTIVE" && l.expiresAt > now;
}

/** Same decision as acquire_generation_lease. Takeover always bumps the token. */
export function acquireLease(cur: Lease | null, workerId: string, ttlS: number, now: number): AcquireResult {
  if (ttlS < MIN_TTL_S || ttlS > MAX_TTL_S) throw new Error("ttl out of range");
  const expiresAt = now + ttlS * 1000;
  if (!cur) return { acquired: true, lease: { workerId, fencingToken: 1, status: "ACTIVE", expiresAt } };
  if (isLeaseLive(cur, now)) {
    if (cur.workerId === workerId) return { acquired: true, lease: cur, reentrant: true };
    return { acquired: false, reason: "held" };
  }
  return { acquired: true, tookOver: true, lease: { workerId, fencingToken: cur.fencingToken + 1, status: "ACTIVE", expiresAt } };
}

export function renewLease(cur: Lease | null, workerId: string, token: number, ttlS: number, now: number): Lease | null {
  if (!cur || !isLeaseLive(cur, now) || cur.workerId !== workerId || cur.fencingToken !== token) return null;
  return { ...cur, expiresAt: now + ttlS * 1000 };
}

export function releaseLease(cur: Lease | null, workerId: string, token: number): Lease | null {
  if (!cur || cur.status !== "ACTIVE" || cur.workerId !== workerId || cur.fencingToken !== token) return null;
  return { ...cur, status: "RELEASED" };
}

export const STALE_LEASE_ERROR = "STALE_GENERATION_LEASE_REJECTED";

/** Same check as assert_generation_fence: only the current, unexpired holder may commit prose. */
export function canCommitWithFence(cur: Lease | null, workerId: string, token: number, now: number): boolean {
  return isLeaseLive(cur, now) && cur!.workerId === workerId && cur!.fencingToken === token;
}

// ---------- Exact-detail anchors ----------
export type AnchorMatchMode = "EXACT" | "CASE_INSENSITIVE" | "NONE";
export interface ExactAnchor {
  key: string;
  exactText: string;
  matchMode: AnchorMatchMode;
  effectiveChapterIndex: number;
  version: number;
  isActive: boolean;
}

const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** Boundary-aware verbatim presence (so "7-4-1-9" does not match "7-4-1-90"). */
export function containsVerbatim(text: string, exact: string, mode: AnchorMatchMode): boolean {
  if (mode === "NONE") return true;
  const re = new RegExp(`(^|[^\\p{L}\\p{N}])${esc(exact)}(?=$|[^\\p{L}\\p{N}])`, mode === "CASE_INSENSITIVE" ? "iu" : "u");
  return re.test(text);
}

/** Anchors that apply at a position: active and already effective. Future anchors are withheld. */
export function anchorsInScope(anchors: ExactAnchor[], chapterIndex: number): ExactAnchor[] {
  return anchors.filter((a) => a.isActive && a.effectiveChapterIndex <= chapterIndex);
}

/**
 * Conditional exact-match validation: an anchor is only checked when the prose
 * references it (the caller supplies which anchor keys the section is expected to
 * restate). Returns the anchors whose verbatim text is missing.
 */
export function validateAnchors(prose: string, anchors: ExactAnchor[], requiredKeys: string[], chapterIndex: number): ExactAnchor[] {
  const want = new Set(requiredKeys);
  return anchorsInScope(anchors, chapterIndex).filter((a) => want.has(a.key) && !containsVerbatim(prose, a.exactText, a.matchMode));
}

/** Mirrors upsert_exact_anchor: unchanged is idempotent; change retires old and adds version+1. */
export function nextAnchorVersions(existing: ExactAnchor[], key: string, exactText: string, matchMode: AnchorMatchMode, chapter: number):
  { status: "created" | "versioned" | "unchanged"; anchors: ExactAnchor[] } {
  const cur = existing.find((a) => a.key === key && a.isActive);
  if (cur && cur.exactText === exactText && cur.matchMode === matchMode) return { status: "unchanged", anchors: existing };
  const retired = existing.map((a) => (a === cur ? { ...a, isActive: false } : a));
  const next: ExactAnchor = { key, exactText, matchMode, effectiveChapterIndex: chapter, version: cur ? cur.version + 1 : 1, isActive: true };
  return { status: cur ? "versioned" : "created", anchors: [...retired, next] };
}

// ---------- Canon reconciliation ----------
export type ReconciliationDecision = "PENDING" | "KEEP_CANON_REVISE_PROSE" | "ACCEPT_PROSE_UPDATE_CANON" | "DISMISS";
export interface ReconciliationLog {
  ownerId: string;
  severity: "CRITICAL" | "MAJOR" | "MINOR";
  chapterIndex: number;
  decision: ReconciliationDecision;
  replanRequired: boolean;
}

export type DecideResult = { ok: true; log: ReconciliationLog } | { ok: false; reason: "not_authenticated" | "not_found" | "rationale_required" | "invalid_decision" | "already_decided" };

/** Mirrors decide_canon_reconciliation: owner-only, rationale required, decision is final. */
export function decideReconciliation(log: ReconciliationLog | null, actorId: string | null, decision: ReconciliationDecision, rationale: string): DecideResult {
  if (!actorId) return { ok: false, reason: "not_authenticated" };
  if (decision === "PENDING") return { ok: false, reason: "invalid_decision" };
  if (!rationale.trim()) return { ok: false, reason: "rationale_required" };
  if (!log || log.ownerId !== actorId) return { ok: false, reason: "not_found" };
  if (log.decision !== "PENDING") return { ok: false, reason: "already_decided" };
  return { ok: true, log: { ...log, decision, replanRequired: log.replanRequired || decision === "ACCEPT_PROSE_UPDATE_CANON" } };
}

/** Unreviewed critical contradictions at or before a position block further generation. */
export function reconciliationGate(logs: ReconciliationLog[], chapterIndex: number): { ok: true } | { ok: false; pending: number } {
  const pending = logs.filter((l) => l.severity === "CRITICAL" && l.decision === "PENDING" && l.chapterIndex <= chapterIndex).length;
  return pending ? { ok: false, pending } : { ok: true };
}
