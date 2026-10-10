// Which reconciliation log entries may block generation. Decided entries never block,
// and Phase B self-test records (dedup_key "selftest_*") are excluded so the permanent
// self-test log on a test book can never block benchmarks.
export interface ReconLogLite { decision: string; dedup_key: string; severity: string; application_status?: string | null }

export const isSelfTestRecord = (l: Pick<ReconLogLite, "dedup_key">) => l.dedup_key.startsWith("selftest_");

export function blockingDiscrepancies<T extends ReconLogLite>(logs: T[]): T[] {
  return logs.filter((l) => l.decision === "PENDING" && l.application_status !== "ABANDONED" && !isSelfTestRecord(l) && (l.severity === "CRITICAL" || l.severity === "MAJOR"));
}
