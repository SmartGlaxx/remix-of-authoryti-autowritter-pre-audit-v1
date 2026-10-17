// Display only: never changes validation history or acceptance eligibility.
export type ReviewLog = { chapter_index: number; subsection_index: number; decision: string; description: string; newer?: { summary: string } };
export function allIssuesDismissed(issues: unknown, logs: ReviewLog[], chapter: number, section: number): boolean {
  if (!Array.isArray(issues) || issues.length === 0) return false;
  return issues.every((issue) => {
    if (!issue || typeof issue.explanation !== "string" || typeof issue.excerpt !== "string") return false;
    return logs.some((log) => log.chapter_index === chapter && log.subsection_index === section && log.decision === "DISMISS" && log.description === issue.explanation && log.newer?.summary === issue.excerpt);
  });
}
export function hasUnfinishedRepair(log: { decision: string; candidate: unknown; application_status: string }): boolean {
  return log.decision !== "PENDING" && log.decision !== "DISMISS" && Boolean(log.candidate || ["PENDING_APPLICATION", "AWAITING_SYNC"].includes(log.application_status));
}
export function displayWritingStatus(status: "pending" | "writing" | "completed", bookStatus: string) {
  return status === "writing" && bookStatus !== "writing" ? "pending" : status;
}
